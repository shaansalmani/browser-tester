import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type {
  AgentActiveInstance,
  PageLoadStatus,
  QaScrollConfig,
  ScrollStatus,
  TestMode,
  TestStatus,
  TestType,
  VideoPlaybackStatus,
} from '../src/types/testing.ts';
import { detectGoogleChrome } from './chromeDetector.ts';
import { AGENT_PORT } from './config.ts';
import { isLoopbackAddress, isPrivateOrRestrictedIp, verifyUrlDnsSafety } from './validation.ts';

const BLOCKED_AD_DOMAINS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'adnxs.com',
  'adsrvr.org',
  'taboola.com',
  'outbrain.com',
  'criteo.com',
  'pubmatic.com',
];

const SAFE_CHROME_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-default-apps',
];

interface ManagedInstance {
  instanceUid: string;
  sessionId: number;
  instanceIndex: number;
  testType: TestType;
  mode: TestMode;
  url: string;
  qaConfig: QaScrollConfig;
  allowLocalDevTargets: boolean;
  status: TestStatus;
  startedAt: string;
  tempProfileDir: string | null;
  browser: Browser | null;
  context: BrowserContext;
  stopping: boolean;
  cleanedUp: boolean;
}

export interface LaunchSessionRequest {
  sessionId: number;
  testType: TestType;
  url: string;
  quantity: number;
  mode: TestMode;
  qaConfig: QaScrollConfig;
  allowLocalDevTargets: boolean;
}

export type InstanceStatusCallback = (update: {
  sessionId: number;
  instanceIndex: number;
  instanceUid: string;
  status: TestStatus;
  httpStatus?: number | null;
  loadTimeMs?: number | null;
  finalUrl?: string | null;
  pageTitle?: string | null;
  pageLoadStatus?: PageLoadStatus;
  scrollStatus?: ScrollStatus;
  scrollSteps?: number;
  maxScrollSteps?: number;
  scrollProgressPct?: number;
  initialHeight?: number | null;
  finalHeight?: number | null;
  heightChanges?: number;
  lazyLoadedDetected?: boolean;
  videoVisible?: boolean | null;
  videoPlaybackStatus?: VideoPlaybackStatus;
  videoError?: string | null;
  message?: string | null;
}) => Promise<void>;

function isAdHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return BLOCKED_AD_DOMAINS.some((ad) => host === ad || host.endsWith(`.${ad}`));
}

function cleanupTempDir(dirPath: string | null): void {
  if (!dirPath) return;
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // Best-effort temp cleanup
  }
}

async function attachPolicyGuards(
  context: BrowserContext,
  allowLocalDevTargets: boolean
): Promise<void> {
  await context.route('**/*', async (route) => {
    const request = route.request();
    const reqUrl = request.url();

    // Allow safe inline data/blob/about URLs for page rendering
    if (
      reqUrl.startsWith('data:') ||
      reqUrl.startsWith('blob:') ||
      reqUrl === 'about:blank'
    ) {
      await route.continue();
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(reqUrl);
    } catch {
      await route.abort('blockedbyclient');
      return;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      await route.abort('blockedbyclient');
      return;
    }

    const hostname = parsed.hostname.toLowerCase();
    const reqPort = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;

    // Never allow any tested page or redirect to touch the local agent port
    if (isLoopbackAddress(hostname) && reqPort === AGENT_PORT) {
      await route.abort('blockedbyclient');
      return;
    }

    // Block ad-serving hosts
    if (isAdHostname(hostname)) {
      await route.abort('blockedbyclient');
      return;
    }

    // Block SSRF redirects or subresource requests targeting private/metadata IPs
    if (isPrivateOrRestrictedIp(hostname)) {
      if (!(allowLocalDevTargets && isLoopbackAddress(hostname))) {
        await route.abort('blockedbyclient');
        return;
      }
    }

    // For top-level navigation / redirect hops, also enforce DNS resolution safety
    if (request.isNavigationRequest()) {
      const dnsCheck = await verifyUrlDnsSafety(hostname, allowLocalDevTargets);
      if (!dnsCheck.safe) {
        await route.abort('blockedbyclient');
        return;
      }
    }

    await route.continue();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PlaywrightChromeManager {
  private readonly instances = new Map<string, ManagedInstance>();
  private readonly onStatusUpdate: InstanceStatusCallback;

  constructor(onStatusUpdate: InstanceStatusCallback) {
    this.onStatusUpdate = onStatusUpdate;
  }

  getActiveInstances(): AgentActiveInstance[] {
    return Array.from(this.instances.values()).map((inst) => ({
      instanceUid: inst.instanceUid,
      sessionId: inst.sessionId,
      instanceIndex: inst.instanceIndex,
      mode: inst.mode,
      url: inst.url,
      status: inst.status,
      startedAt: inst.startedAt,
    }));
  }

  getActiveCount(): number {
    return this.instances.size;
  }

  async launchSession(req: LaunchSessionRequest): Promise<{
    launched: AgentActiveInstance[];
    failedInstances: Array<{ instanceIndex: number; error: string }>;
  }> {
    const chrome = detectGoogleChrome();
    if (!chrome.installed || !chrome.executablePath) {
      throw new Error(chrome.error || 'Google Chrome is not installed on this machine.');
    }

    const launched: AgentActiveInstance[] = [];
    const failedInstances: Array<{ instanceIndex: number; error: string }> = [];

    for (let index = 1; index <= req.quantity; index += 1) {
      const instanceUid = `bt-${req.sessionId}-${index}`;
      try {
        const instance = await this.launchSingleInstance({
          instanceUid,
          sessionId: req.sessionId,
          instanceIndex: index,
          testType: req.testType,
          mode: req.mode,
          url: req.url,
          qaConfig: req.qaConfig,
          allowLocalDevTargets: req.allowLocalDevTargets,
          executablePath: chrome.executablePath,
        });
        launched.push(instance);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to launch Chrome instance';
        failedInstances.push({ instanceIndex: index, error: errorMsg });
        await this.onStatusUpdate({
          sessionId: req.sessionId,
          instanceIndex: index,
          instanceUid,
          status: 'failed',
          pageLoadStatus: 'error',
          message: errorMsg,
        });
      }
    }

    return { launched, failedInstances };
  }

  private async launchSingleInstance(params: {
    instanceUid: string;
    sessionId: number;
    instanceIndex: number;
    testType: TestType;
    mode: TestMode;
    url: string;
    qaConfig: QaScrollConfig;
    allowLocalDevTargets: boolean;
    executablePath: string;
  }): Promise<AgentActiveInstance> {
    const startedAt = new Date().toISOString();
    let tempProfileDir: string | null = null;
    let browser: Browser | null = null;
    let context: BrowserContext;

    try {
      if (params.mode === 'Normal') {
        tempProfileDir = fs.mkdtempSync(
          path.join(os.tmpdir(), `bt-normal-${params.sessionId}-${params.instanceIndex}-`)
        );
        context = await chromium.launchPersistentContext(tempProfileDir, {
          executablePath: params.executablePath,
          headless: false,
          args: SAFE_CHROME_ARGS,
          acceptDownloads: false,
        });
      } else {
        browser = await chromium.launch({
          executablePath: params.executablePath,
          headless: false,
          args: [...SAFE_CHROME_ARGS, '--incognito'],
        });
        context = await browser.newContext({
          acceptDownloads: false,
        });
      }

      await attachPolicyGuards(context, params.allowLocalDevTargets);

      const managed: ManagedInstance = {
        instanceUid: params.instanceUid,
        sessionId: params.sessionId,
        instanceIndex: params.instanceIndex,
        testType: params.testType,
        mode: params.mode,
        url: params.url,
        qaConfig: params.qaConfig,
        allowLocalDevTargets: params.allowLocalDevTargets,
        status: 'running',
        startedAt,
        tempProfileDir,
        browser,
        context,
        stopping: false,
        cleanedUp: false,
      };

      this.instances.set(params.instanceUid, managed);

      const onUnexpectedClose = async () => {
        if (managed.stopping || managed.status !== 'running') {
          return;
        }
        managed.stopping = true;
        managed.status = 'stopped';
        await this.closeAndCleanup(managed);
        await this.onStatusUpdate({
          sessionId: managed.sessionId,
          instanceIndex: managed.instanceIndex,
          instanceUid: managed.instanceUid,
          status: 'stopped',
          scrollStatus: 'stopped',
          message: 'Chrome window closed externally; temporary profile cleaned up.',
        });
      };

      if (browser) {
        browser.on('disconnected', () => {
          void onUnexpectedClose();
        });
      } else {
        context.on('close', () => {
          void onUnexpectedClose();
        });
      }

      await this.onStatusUpdate({
        sessionId: params.sessionId,
        instanceIndex: params.instanceIndex,
        instanceUid: params.instanceUid,
        status: 'running',
        pageLoadStatus: 'pending',
        scrollStatus: 'not_run',
        maxScrollSteps:
          params.testType === 'Website Test' && params.qaConfig.scrollEnabled
            ? params.qaConfig.maxScrollCount
            : 0,
        message: `Chrome (${params.mode}) launched; loading ${params.url}`,
      });

      void this.executeQaWorkflow(managed);

      return {
        instanceUid: managed.instanceUid,
        sessionId: managed.sessionId,
        instanceIndex: managed.instanceIndex,
        mode: managed.mode,
        url: managed.url,
        status: managed.status,
        startedAt: managed.startedAt,
      };
    } catch (err) {
      this.instances.delete(params.instanceUid);
      try {
        if (browser) await browser.close();
      } catch {}
      cleanupTempDir(tempProfileDir);
      throw err;
    }
  }

  private async closeAndCleanup(managed: ManagedInstance): Promise<void> {
    if (managed.cleanedUp) return;
    managed.cleanedUp = true;
    this.instances.delete(managed.instanceUid);
    try {
      await managed.context.close();
    } catch {}
    try {
      if (managed.browser) {
        await managed.browser.close();
      }
    } catch {}
    cleanupTempDir(managed.tempProfileDir);
  }

  private async executeQaWorkflow(managed: ManagedInstance): Promise<void> {
    const startMs = Date.now();
    const deadlineMs = startMs + managed.qaConfig.maxDurationMs;
    const runtimeErrors: string[] = [];

    let page: Page | null = null;
    try {
      const pages = managed.context.pages();
      page = pages.length > 0 ? pages[0] : await managed.context.newPage();

      page.on('close', () => {
        if (!managed.stopping && managed.status === 'running') {
          void this.stopInstance(managed.instanceUid, 'Browser tab closed externally');
        }
      });

      page.on('pageerror', (err) => {
        runtimeErrors.push(`Page JS error: ${err.message}`);
      });

      const remainingNavMs = Math.max(2000, deadlineMs - Date.now());
      const navTimeoutMs = Math.min(25000, remainingNavMs);

      const navStart = Date.now();
      let response;
      try {
        response = await page.goto(managed.url, {
          waitUntil: 'domcontentloaded',
          timeout: navTimeoutMs,
        });
      } catch (navErr) {
        if (managed.stopping) return;
        const msg = navErr instanceof Error ? navErr.message : 'Navigation failed';
        const timedOut = msg.toLowerCase().includes('timeout') || Date.now() >= deadlineMs;
        managed.status = timedOut ? 'timed_out' : 'failed';
        await this.onStatusUpdate({
          sessionId: managed.sessionId,
          instanceIndex: managed.instanceIndex,
          instanceUid: managed.instanceUid,
          status: managed.status,
          loadTimeMs: Date.now() - navStart,
          pageLoadStatus: timedOut ? 'timed_out' : 'error',
          scrollStatus: 'not_run',
          message: msg,
        });
        return;
      }

      if (managed.stopping) return;

      const loadTimeMs = Date.now() - navStart;
      const httpStatus = response ? response.status() : null;
      const finalUrl = page.url();
      const pageTitle = (await page.title().catch(() => '')) || '(Untitled page)';
      const hasHttpError = httpStatus !== null && httpStatus >= 400;

      if (hasHttpError) {
        runtimeErrors.push(`HTTP error status ${httpStatus}`);
      }

      const pageLoadStatus: PageLoadStatus = hasHttpError ? 'error' : 'loaded';

      await this.onStatusUpdate({
        sessionId: managed.sessionId,
        instanceIndex: managed.instanceIndex,
        instanceUid: managed.instanceUid,
        status: 'running',
        httpStatus,
        loadTimeMs,
        finalUrl,
        pageTitle,
        pageLoadStatus,
        message: hasHttpError
          ? `Page returned HTTP ${httpStatus} (${loadTimeMs} ms)`
          : `Loaded "${pageTitle}" in ${loadTimeMs} ms`,
      });

      if (hasHttpError) {
        managed.status = 'failed';
        await this.onStatusUpdate({
          sessionId: managed.sessionId,
          instanceIndex: managed.instanceIndex,
          instanceUid: managed.instanceUid,
          status: 'failed',
          httpStatus,
          loadTimeMs,
          finalUrl,
          pageTitle,
          pageLoadStatus: 'error',
          scrollStatus: 'not_run',
          message: runtimeErrors.join(' | '),
        });
        return;
      }

      if (managed.testType === 'Website Test') {
        await this.runControlledScrollQa(managed, page, deadlineMs, {
          httpStatus,
          loadTimeMs,
          finalUrl,
          pageTitle,
          runtimeErrors,
        });
      } else {
        await this.runVideoPlaybackQa(managed, page, deadlineMs, {
          httpStatus,
          loadTimeMs,
          finalUrl,
          pageTitle,
          runtimeErrors,
        });
      }
    } catch (err) {
      if (!managed.stopping) {
        const msg = err instanceof Error ? err.message : 'Unexpected QA execution error';
        managed.status = 'failed';
        await this.onStatusUpdate({
          sessionId: managed.sessionId,
          instanceIndex: managed.instanceIndex,
          instanceUid: managed.instanceUid,
          status: 'failed',
          pageLoadStatus: 'error',
          message: msg,
        });
      }
    } finally {
      await this.closeAndCleanup(managed);
    }
  }

  private async runControlledScrollQa(
    managed: ManagedInstance,
    page: Page,
    deadlineMs: number,
    meta: {
      httpStatus: number | null;
      loadTimeMs: number;
      finalUrl: string;
      pageTitle: string;
      runtimeErrors: string[];
    }
  ): Promise<void> {
    const cfg = managed.qaConfig;

    if (!cfg.scrollEnabled) {
      managed.status = 'completed';
      await this.onStatusUpdate({
        sessionId: managed.sessionId,
        instanceIndex: managed.instanceIndex,
        instanceUid: managed.instanceUid,
        status: 'completed',
        httpStatus: meta.httpStatus,
        loadTimeMs: meta.loadTimeMs,
        finalUrl: meta.finalUrl,
        pageTitle: meta.pageTitle,
        pageLoadStatus: 'loaded',
        scrollStatus: 'not_run',
        scrollSteps: 0,
        maxScrollSteps: 0,
        scrollProgressPct: 100,
        message: `Page loaded cleanly ("${meta.pageTitle}"); scrolling disabled.`,
      });
      return;
    }

    const initialMetrics = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      domCount: document.querySelectorAll('img, section, article, div, li').length,
    }));

    const initialHeight = initialMetrics.scrollHeight;
    let prevHeight = initialHeight;
    let prevDomCount = initialMetrics.domCount;
    let scrollSteps = 0;
    let heightChanges = 0;
    let staleChecks = 0;
    let lazyLoadedDetected = false;
    let finalScrollStatus: ScrollStatus = 'max_scrolls_reached';
    let timedOut = false;

    while (!managed.stopping) {
      if (Date.now() >= deadlineMs) {
        timedOut = true;
        finalScrollStatus = 'timed_out';
        break;
      }

      if (scrollSteps >= cfg.maxScrollCount) {
        finalScrollStatus = 'max_scrolls_reached';
        break;
      }

      const waitMs = Math.min(cfg.scrollIntervalMs, Math.max(50, deadlineMs - Date.now()));
      await sleep(waitMs);
      if (managed.stopping) return;
      if (Date.now() >= deadlineMs) {
        timedOut = true;
        finalScrollStatus = 'timed_out';
        break;
      }

      await page.evaluate((distance) => {
        window.scrollBy({ top: distance, behavior: 'smooth' });
      }, cfg.scrollDistancePx);
      scrollSteps += 1;

      await sleep(Math.min(250, Math.max(50, deadlineMs - Date.now())));
      if (managed.stopping) return;

      const current = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        scrollY: window.scrollY,
        innerHeight: window.innerHeight,
        domCount: document.querySelectorAll('img, section, article, div, li').length,
      }));

      if (current.scrollHeight > prevHeight) {
        heightChanges += 1;
        staleChecks = 0;
        lazyLoadedDetected = true;
      } else if (current.domCount > prevDomCount) {
        lazyLoadedDetected = true;
        staleChecks = 0;
      }

      const atBottom = current.scrollY + current.innerHeight >= current.scrollHeight - 4;
      if (atBottom && current.scrollHeight === prevHeight) {
        staleChecks += 1;
      }

      prevHeight = current.scrollHeight;
      prevDomCount = current.domCount;

      const distancePct =
        current.scrollHeight > 0
          ? Math.min(
              100,
              Math.round(((current.scrollY + current.innerHeight) / current.scrollHeight) * 100)
            )
          : 100;
      const stepPct = Math.round((scrollSteps / cfg.maxScrollCount) * 100);
      const scrollProgressPct = Math.max(distancePct, stepPct);

      await this.onStatusUpdate({
        sessionId: managed.sessionId,
        instanceIndex: managed.instanceIndex,
        instanceUid: managed.instanceUid,
        status: 'running',
        httpStatus: meta.httpStatus,
        loadTimeMs: meta.loadTimeMs,
        finalUrl: meta.finalUrl,
        pageTitle: meta.pageTitle,
        pageLoadStatus: 'loaded',
        scrollStatus: 'scrolling',
        scrollSteps,
        maxScrollSteps: cfg.maxScrollCount,
        scrollProgressPct,
        initialHeight,
        finalHeight: current.scrollHeight,
        heightChanges,
        lazyLoadedDetected,
        message: `Scrolling ${scrollSteps}/${cfg.maxScrollCount} (${scrollProgressPct}%) · Height ${current.scrollHeight}px`,
      });

      if (atBottom && staleChecks >= cfg.noNewContentThreshold) {
        finalScrollStatus = heightChanges > 0 ? 'no_new_content' : 'reached_bottom';
        break;
      }
    }

    if (managed.stopping) return;

    const finalStatus: TestStatus = timedOut ? 'timed_out' : 'completed';
    managed.status = finalStatus;
    const summaryParts = [
      `Title: "${meta.pageTitle}"`,
      `Scroll: ${finalScrollStatus} (${scrollSteps}/${cfg.maxScrollCount} steps)`,
      `Height: ${initialHeight}px → ${prevHeight}px`,
    ];
    if (lazyLoadedDetected) summaryParts.push('Lazy-loaded content detected');
    if (meta.runtimeErrors.length > 0) {
      summaryParts.push(`Warnings: ${meta.runtimeErrors.join('; ')}`);
    }

    await this.onStatusUpdate({
      sessionId: managed.sessionId,
      instanceIndex: managed.instanceIndex,
      instanceUid: managed.instanceUid,
      status: finalStatus,
      httpStatus: meta.httpStatus,
      loadTimeMs: meta.loadTimeMs,
      finalUrl: meta.finalUrl,
      pageTitle: meta.pageTitle,
      pageLoadStatus: timedOut ? 'timed_out' : 'loaded',
      scrollStatus: finalScrollStatus,
      scrollSteps,
      maxScrollSteps: cfg.maxScrollCount,
      scrollProgressPct: timedOut
        ? Math.round((scrollSteps / cfg.maxScrollCount) * 100)
        : 100,
      initialHeight,
      finalHeight: prevHeight,
      heightChanges,
      lazyLoadedDetected,
      message: summaryParts.join(' · '),
    });
  }

  private async runVideoPlaybackQa(
    managed: ManagedInstance,
    page: Page,
    deadlineMs: number,
    meta: {
      httpStatus: number | null;
      loadTimeMs: number;
      finalUrl: string;
      pageTitle: string;
      runtimeErrors: string[];
    }
  ): Promise<void> {
    await sleep(Math.min(1000, Math.max(200, deadlineMs - Date.now())));
    if (managed.stopping) return;

    if (Date.now() >= deadlineMs) {
      managed.status = 'timed_out';
      await this.onStatusUpdate({
        sessionId: managed.sessionId,
        instanceIndex: managed.instanceIndex,
        instanceUid: managed.instanceUid,
        status: 'timed_out',
        httpStatus: meta.httpStatus,
        loadTimeMs: meta.loadTimeMs,
        finalUrl: meta.finalUrl,
        pageTitle: meta.pageTitle,
        pageLoadStatus: 'timed_out',
        videoPlaybackStatus: 'not_run',
        message: 'Video playback QA timed out before player inspection completed.',
      });
      return;
    }

    const videoCheck = await page.evaluate(async () => {
      const videos = Array.from(document.querySelectorAll('video'));
      if (videos.length === 0) {
        const iframes = Array.from(document.querySelectorAll('iframe'));
        const visibleIframe = iframes.find((f) => {
          const rect = f.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        return {
          videoDetected: Boolean(visibleIframe),
          videoVisible: Boolean(visibleIframe),
          playbackStatus: visibleIframe
            ? ('autoplay_blocked_manual_required' as const)
            : ('no_video_found' as const),
          videoError: visibleIframe
            ? 'Embedded iframe player detected; direct HTML5 media API unavailable cross-origin.'
            : 'No <video> element found on page.',
        };
      }

      const primary = videos[0];
      const rect = primary.getBoundingClientRect();
      const style = window.getComputedStyle(primary);
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0';

      if (primary.error) {
        return {
          videoDetected: true,
          videoVisible: visible,
          playbackStatus: 'player_error' as const,
          videoError: `MediaError code ${primary.error.code}: ${primary.error.message || 'Playback error'}`,
        };
      }

      primary.loop = false;
      const startTime = primary.currentTime;
      try {
        await primary.play();
        await new Promise((r) => setTimeout(r, 1200));
        const advanced = !primary.paused || primary.currentTime > startTime || primary.readyState >= 2;
        primary.pause();
        return {
          videoDetected: true,
          videoVisible: visible,
          playbackStatus: advanced
            ? ('playing_verified' as const)
            : ('autoplay_blocked_manual_required' as const),
          videoError: null,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Playback blocked';
        const isAutoplayBlock =
          msg.toLowerCase().includes('notallowed') || msg.toLowerCase().includes('interact');
        return {
          videoDetected: true,
          videoVisible: visible,
          playbackStatus: isAutoplayBlock
            ? ('autoplay_blocked_manual_required' as const)
            : ('player_error' as const),
          videoError: msg,
        };
      }
    });

    if (managed.stopping) return;

    const failedPlayer = videoCheck.playbackStatus === 'player_error';
    const finalStatus: TestStatus = failedPlayer ? 'failed' : 'completed';
    managed.status = finalStatus;

    await this.onStatusUpdate({
      sessionId: managed.sessionId,
      instanceIndex: managed.instanceIndex,
      instanceUid: managed.instanceUid,
      status: finalStatus,
      httpStatus: meta.httpStatus,
      loadTimeMs: meta.loadTimeMs,
      finalUrl: meta.finalUrl,
      pageTitle: meta.pageTitle,
      pageLoadStatus: 'loaded',
      scrollStatus: 'not_run',
      scrollProgressPct: 100,
      videoVisible: videoCheck.videoVisible,
      videoPlaybackStatus: videoCheck.playbackStatus,
      videoError: videoCheck.videoError,
      message: `Video visible: ${videoCheck.videoVisible ? 'Yes' : 'No'} · Playback: ${videoCheck.playbackStatus}${
        videoCheck.videoError ? ` (${videoCheck.videoError})` : ''
      }`,
    });
  }

  async stopInstance(instanceUid: string, reason = 'Stopped by user'): Promise<boolean> {
    const managed = this.instances.get(instanceUid);
    if (!managed) return false;

    managed.stopping = true;
    managed.status = 'stopped';
    await this.closeAndCleanup(managed);

    await this.onStatusUpdate({
      sessionId: managed.sessionId,
      instanceIndex: managed.instanceIndex,
      instanceUid: managed.instanceUid,
      status: 'stopped',
      scrollStatus: 'stopped',
      message: `${reason}; temporary profile cleaned up.`,
    });

    return true;
  }

  async stopSession(sessionId: number, reason = 'Session stopped by user'): Promise<number> {
    const targets = Array.from(this.instances.values()).filter(
      (inst) => inst.sessionId === sessionId
    );

    let stoppedCount = 0;
    for (const inst of targets) {
      const ok = await this.stopInstance(inst.instanceUid, reason);
      if (ok) stoppedCount += 1;
    }
    return stoppedCount;
  }

  async stopAll(reason = 'All sessions stopped by user'): Promise<number> {
    const uids = Array.from(this.instances.keys());
    let stoppedCount = 0;
    for (const uid of uids) {
      const ok = await this.stopInstance(uid, reason);
      if (ok) stoppedCount += 1;
    }
    return stoppedCount;
  }
}
