export type TestType = 'Website Test' | 'Video Playback Test';
export type BrowserEngine = 'Chrome';
export type TestMode = 'Normal' | 'Incognito';
export type TestStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'timed_out';

export type PageLoadStatus = 'pending' | 'loaded' | 'error' | 'timed_out';
export type ScrollStatus =
  | 'not_run'
  | 'scrolling'
  | 'reached_bottom'
  | 'no_new_content'
  | 'max_scrolls_reached'
  | 'timed_out'
  | 'stopped'
  | 'error';

export type VideoPlaybackStatus =
  | 'not_run'
  | 'playing_verified'
  | 'autoplay_blocked_manual_required'
  | 'player_error'
  | 'no_video_found';

export interface QaScrollConfig {
  scrollEnabled: boolean;
  scrollIntervalMs: number;
  scrollDistancePx: number;
  maxScrollCount: number;
  noNewContentThreshold: number;
  maxDurationMs: number;
}

export interface AuthorizedDomain {
  id: number;
  domain: string;
  ownershipNote: string;
  authorizedBy: string;
  createdAt: string;
}

export interface TestResultRecord {
  id: number;
  sessionId: number;
  instanceIndex: number;
  instanceUid: string;
  status: TestStatus;
  httpStatus: number | null;
  loadTimeMs: number | null;
  finalUrl: string | null;
  pageTitle: string | null;
  pageLoadStatus: PageLoadStatus;
  scrollStatus: ScrollStatus;
  scrollSteps: number;
  maxScrollSteps: number;
  scrollProgressPct: number;
  initialHeight: number | null;
  finalHeight: number | null;
  heightChanges: number;
  lazyLoadedDetected: boolean;
  videoVisible: boolean | null;
  videoPlaybackStatus: VideoPlaybackStatus;
  videoError: string | null;
  message: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface AgentCommandContract {
  phase: '4/4';
  sessionId: number;
  testType: TestType;
  url: string;
  domain: string;
  browser: BrowserEngine;
  quantity: number;
  mode: TestMode;
  qaConfig: QaScrollConfig;
  securityPolicy: {
    bindHost: '127.0.0.1';
    isolatedProfile: true;
    allowPersonalProfileAccess: false;
    allowAdInteraction: false;
    allowArtificialEngagement: false;
  };
  preparedAt: string;
}

export interface TestSession {
  id: number;
  testType: TestType;
  url: string;
  domain: string;
  browser: BrowserEngine;
  quantity: number;
  mode: TestMode;
  status: TestStatus;
  authorizationConfirmed: boolean;
  retryOfSessionId: number | null;
  retryAttempt: number;
  qaConfig: QaScrollConfig;
  agentPayload: AgentCommandContract;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  results: TestResultRecord[];
}

export interface TestStatusCounts {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  stopped: number;
  timed_out: number;
  total: number;
  activeInstances: number;
}

export interface ConcurrencyLimits {
  allowedBrowser: BrowserEngine;
  maxQuantityPerSession: number;
  maxActiveInstances: number;
  allowLocalDevTargets: boolean;
  maxRetryAttempts: number;
}

export interface AppSettings {
  maxQuantityPerSession: number;
  maxActiveInstances: number;
  allowLocalDevTargets: boolean;
}

export interface ChromeDetectionStatus {
  installed: boolean;
  executablePath: string | null;
  detectionMethod: string;
  checkedAt: string;
  error: string | null;
}

export interface AgentActiveInstance {
  instanceUid: string;
  sessionId: number;
  instanceIndex: number;
  mode: TestMode;
  url: string;
  status: TestStatus;
  startedAt: string;
}

export interface AgentInterfaceStatus {
  bindHost: '127.0.0.1';
  port: number;
  reachable: boolean;
  authenticated: boolean;
  phase: string;
  engine: string;
  chrome: ChromeDetectionStatus;
  activeInstancesCount: number;
  activeInstances: AgentActiveInstance[];
  securityPolicy: {
    isolatedProfilesOnly: boolean;
    personalProfileAccess: boolean;
    adInteractionBlocked: boolean;
    artificialEngagementBlocked: boolean;
  };
  checkedAt: string;
  error?: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  phase: '4/4';
  service: string;
  database: {
    connected: boolean;
    driver: 'sqlite';
    tables: string[];
  };
  agentInterface: AgentInterfaceStatus;
  limits: ConcurrencyLimits;
  timestamp: string;
}
