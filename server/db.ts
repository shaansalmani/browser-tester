import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  AgentCommandContract,
  AppSettings,
  AuthorizedDomain,
  PageLoadStatus,
  QaScrollConfig,
  ScrollStatus,
  TestMode,
  TestResultRecord,
  TestSession,
  TestStatus,
  TestStatusCounts,
  TestType,
  VideoPlaybackStatus,
} from '../src/types/testing.ts';
import {
  DB_PATH,
  DEFAULT_ALLOW_LOCAL_DEV_TARGETS,
  DEFAULT_MAX_ACTIVE_INSTANCES,
  DEFAULT_MAX_QUANTITY_PER_SESSION,
  DEFAULT_QA_SCROLL_CONFIG,
  HARD_MAX_ACTIVE_INSTANCES,
  HARD_MAX_QUANTITY_PER_SESSION,
} from './config.ts';

let dbInstance: Database.Database | null = null;

function ensureDbDirectory(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getDb(): Database.Database {
  if (!dbInstance) {
    ensureDbDirectory(DB_PATH);
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
    initializeSchema(dbInstance);
  }
  return dbInstance;
}

function getColumnNames(db: Database.Database, tableName: string): Set<string> {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(cols.map((c) => c.name));
}

function migrateToPhase3SchemaIfNeeded(db: Database.Database): void {
  const sessionMeta = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'test_sessions'`)
    .get() as { sql: string } | undefined;

  if (!sessionMeta) return;

  const sessionCols = getColumnNames(db, 'test_sessions');
  const resultCols = getColumnNames(db, 'test_results');
  const needsPhase3Migration =
    !sessionMeta.sql.includes("'timed_out'") ||
    !sessionCols.has('qa_config_json') ||
    !sessionCols.has('retry_attempt') ||
    !resultCols.has('page_title') ||
    !resultCols.has('scroll_status');

  if (!needsPhase3Migration) return;

  db.pragma('foreign_keys = OFF');
  const migrateTx = db.transaction(() => {
    const hasQaConfig = sessionCols.has('qa_config_json');
    const hasRetryAttempt = sessionCols.has('retry_attempt');
    const hasInstanceUid = resultCols.has('instance_uid');

    db.exec(`
      CREATE TABLE test_sessions_v3 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        test_type TEXT NOT NULL CHECK (test_type IN ('Website Test', 'Video Playback Test')),
        url TEXT NOT NULL,
        domain TEXT NOT NULL,
        browser TEXT NOT NULL DEFAULT 'Chrome' CHECK (browser = 'Chrome'),
        quantity INTEGER NOT NULL CHECK (quantity >= 1 AND quantity <= 5),
        mode TEXT NOT NULL CHECK (mode IN ('Normal', 'Incognito')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'stopped', 'timed_out')),
        authorization_confirmed INTEGER NOT NULL DEFAULT 1 CHECK (authorization_confirmed = 1),
        retry_of_session_id INTEGER NULL REFERENCES test_sessions_v3(id) ON DELETE SET NULL,
        retry_attempt INTEGER NOT NULL DEFAULT 0,
        qa_config_json TEXT NOT NULL DEFAULT '{}',
        agent_payload_json TEXT NOT NULL,
        error_message TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO test_sessions_v3 (
        id, test_type, url, domain, browser, quantity, mode, status,
        authorization_confirmed, retry_of_session_id, retry_attempt, qa_config_json,
        agent_payload_json, error_message, created_at, updated_at
      )
      SELECT
        id, test_type, url, domain, browser, quantity, mode, status,
        authorization_confirmed, retry_of_session_id,
        ${hasRetryAttempt ? 'retry_attempt' : '0'},
        ${hasQaConfig ? 'qa_config_json' : `'${JSON.stringify(DEFAULT_QA_SCROLL_CONFIG)}'`},
        agent_payload_json, error_message, created_at, updated_at
      FROM test_sessions;

      DROP TABLE test_sessions;
      ALTER TABLE test_sessions_v3 RENAME TO test_sessions;

      CREATE TABLE test_results_v3 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
        instance_index INTEGER NOT NULL,
        instance_uid TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'stopped', 'timed_out')),
        http_status INTEGER NULL,
        load_time_ms INTEGER NULL,
        final_url TEXT NULL,
        page_title TEXT NULL,
        page_load_status TEXT NOT NULL DEFAULT 'pending',
        scroll_status TEXT NOT NULL DEFAULT 'not_run',
        scroll_steps INTEGER NOT NULL DEFAULT 0,
        max_scroll_steps INTEGER NOT NULL DEFAULT 0,
        scroll_progress_pct INTEGER NOT NULL DEFAULT 0,
        initial_height INTEGER NULL,
        final_height INTEGER NULL,
        height_changes INTEGER NOT NULL DEFAULT 0,
        lazy_loaded_detected INTEGER NOT NULL DEFAULT 0,
        video_visible INTEGER NULL,
        video_playback_status TEXT NOT NULL DEFAULT 'not_run',
        video_error TEXT NULL,
        message TEXT NULL,
        started_at TEXT NULL,
        completed_at TEXT NULL,
        created_at TEXT NOT NULL
      );

      INSERT INTO test_results_v3 (
        id, session_id, instance_index, instance_uid, status, http_status, load_time_ms,
        message, started_at, completed_at, created_at
      )
      SELECT
        id, session_id, instance_index,
        ${hasInstanceUid ? 'instance_uid' : `('bt-' || session_id || '-' || instance_index)`},
        status, http_status, load_time_ms, message, started_at, completed_at, created_at
      FROM test_results;

      DROP TABLE test_results;
      ALTER TABLE test_results_v3 RENAME TO test_results;
    `);
  });

  migrateTx();
  db.pragma('foreign_keys = ON');
}

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS authorized_domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL UNIQUE,
      ownership_note TEXT NOT NULL,
      authorized_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS test_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_type TEXT NOT NULL CHECK (test_type IN ('Website Test', 'Video Playback Test')),
      url TEXT NOT NULL,
      domain TEXT NOT NULL,
      browser TEXT NOT NULL DEFAULT 'Chrome' CHECK (browser = 'Chrome'),
      quantity INTEGER NOT NULL CHECK (quantity >= 1 AND quantity <= 5),
      mode TEXT NOT NULL CHECK (mode IN ('Normal', 'Incognito')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'stopped', 'timed_out')),
      authorization_confirmed INTEGER NOT NULL DEFAULT 1 CHECK (authorization_confirmed = 1),
      retry_of_session_id INTEGER NULL REFERENCES test_sessions(id) ON DELETE SET NULL,
      retry_attempt INTEGER NOT NULL DEFAULT 0,
      qa_config_json TEXT NOT NULL DEFAULT '{}',
      agent_payload_json TEXT NOT NULL,
      error_message TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS test_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
      instance_index INTEGER NOT NULL,
      instance_uid TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'stopped', 'timed_out')),
      http_status INTEGER NULL,
      load_time_ms INTEGER NULL,
      final_url TEXT NULL,
      page_title TEXT NULL,
      page_load_status TEXT NOT NULL DEFAULT 'pending',
      scroll_status TEXT NOT NULL DEFAULT 'not_run',
      scroll_steps INTEGER NOT NULL DEFAULT 0,
      max_scroll_steps INTEGER NOT NULL DEFAULT 0,
      scroll_progress_pct INTEGER NOT NULL DEFAULT 0,
      initial_height INTEGER NULL,
      final_height INTEGER NULL,
      height_changes INTEGER NOT NULL DEFAULT 0,
      lazy_loaded_detected INTEGER NOT NULL DEFAULT 0,
      video_visible INTEGER NULL,
      video_playback_status TEXT NOT NULL DEFAULT 'not_run',
      video_error TEXT NULL,
      message TEXT NULL,
      started_at TEXT NULL,
      completed_at TEXT NULL,
      created_at TEXT NOT NULL
    );
  `);

  migrateToPhase3SchemaIfNeeded(db);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_test_sessions_status ON test_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_test_sessions_created_at ON test_sessions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_test_results_session_id ON test_results(session_id);
  `);
}

export function checkDatabaseHealth(): { connected: boolean; tables: string[] } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('authorized_domains', 'app_settings', 'test_sessions', 'test_results') ORDER BY name`
    )
    .all() as Array<{ name: string }>;

  return {
    connected: rows.length === 4,
    tables: rows.map((row) => row.name),
  };
}

export function getAppSettings(): AppSettings {
  const db = getDb();
  const rows = db.prepare(`SELECT key, value FROM app_settings`).all() as Array<{
    key: string;
    value: string;
  }>;
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const maxActiveRaw = Number(map.get('max_active_instances') ?? DEFAULT_MAX_ACTIVE_INSTANCES);
  const maxQtyRaw = Number(map.get('max_quantity_per_session') ?? DEFAULT_MAX_QUANTITY_PER_SESSION);
  const allowLocalRaw = map.get('allow_local_dev_targets');

  const maxActiveInstances = Number.isInteger(maxActiveRaw)
    ? Math.min(Math.max(maxActiveRaw, 1), HARD_MAX_ACTIVE_INSTANCES)
    : DEFAULT_MAX_ACTIVE_INSTANCES;

  const maxQuantityPerSession = Number.isInteger(maxQtyRaw)
    ? Math.min(Math.max(maxQtyRaw, 1), Math.min(HARD_MAX_QUANTITY_PER_SESSION, maxActiveInstances))
    : Math.min(DEFAULT_MAX_QUANTITY_PER_SESSION, maxActiveInstances);

  const allowLocalDevTargets =
    allowLocalRaw !== undefined ? allowLocalRaw === 'true' : DEFAULT_ALLOW_LOCAL_DEV_TARGETS;

  return {
    maxQuantityPerSession,
    maxActiveInstances,
    allowLocalDevTargets,
  };
}

export function updateAppSettings(patch: Partial<AppSettings>): AppSettings {
  const db = getDb();
  const current = getAppSettings();
  const now = new Date().toISOString();

  const nextMaxActive =
    patch.maxActiveInstances !== undefined
      ? Math.min(Math.max(Math.trunc(patch.maxActiveInstances), 1), HARD_MAX_ACTIVE_INSTANCES)
      : current.maxActiveInstances;

  const nextMaxQty =
    patch.maxQuantityPerSession !== undefined
      ? Math.min(
          Math.max(Math.trunc(patch.maxQuantityPerSession), 1),
          Math.min(HARD_MAX_QUANTITY_PER_SESSION, nextMaxActive)
        )
      : Math.min(current.maxQuantityPerSession, nextMaxActive);

  const nextAllowLocal =
    patch.allowLocalDevTargets !== undefined
      ? Boolean(patch.allowLocalDevTargets)
      : current.allowLocalDevTargets;

  const upsert = db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );

  const tx = db.transaction(() => {
    upsert.run('max_active_instances', String(nextMaxActive), now);
    upsert.run('max_quantity_per_session', String(nextMaxQty), now);
    upsert.run('allow_local_dev_targets', String(nextAllowLocal), now);
  });

  tx();
  return getAppSettings();
}

export function listAuthorizedDomains(): AuthorizedDomain[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, domain, ownership_note, authorized_by, created_at FROM authorized_domains ORDER BY created_at DESC, id DESC`
    )
    .all() as Array<{
    id: number;
    domain: string;
    ownership_note: string;
    authorized_by: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    domain: row.domain,
    ownershipNote: row.ownership_note,
    authorizedBy: row.authorized_by,
    createdAt: row.created_at,
  }));
}

export function addAuthorizedDomain(
  domain: string,
  ownershipNote: string,
  authorizedBy: string
): AuthorizedDomain {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db
    .prepare(
      `SELECT id, domain, ownership_note, authorized_by, created_at FROM authorized_domains WHERE domain = ?`
    )
    .get(domain) as
    | {
        id: number;
        domain: string;
        ownership_note: string;
        authorized_by: string;
        created_at: string;
      }
    | undefined;

  if (existing) {
    return {
      id: existing.id,
      domain: existing.domain,
      ownershipNote: existing.ownership_note,
      authorizedBy: existing.authorized_by,
      createdAt: existing.created_at,
    };
  }

  const info = db
    .prepare(
      `INSERT INTO authorized_domains (domain, ownership_note, authorized_by, created_at) VALUES (?, ?, ?, ?)`
    )
    .run(domain, ownershipNote, authorizedBy, now);

  return {
    id: Number(info.lastInsertRowid),
    domain,
    ownershipNote,
    authorizedBy,
    createdAt: now,
  };
}

export function removeAuthorizedDomain(id: number): boolean {
  const db = getDb();
  const info = db.prepare(`DELETE FROM authorized_domains WHERE id = ?`).run(id);
  return info.changes > 0;
}

export function isDomainAuthorized(hostname: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  const domains = listAuthorizedDomains();
  return domains.some((entry) => {
    const allowed = entry.domain.toLowerCase();
    return normalizedHost === allowed || normalizedHost.endsWith(`.${allowed}`);
  });
}

export function getStatusCounts(): TestStatusCounts {
  const db = getDb();
  const rows = db
    .prepare(`SELECT status, COUNT(*) as count FROM test_sessions GROUP BY status`)
    .all() as Array<{ status: TestStatus; count: number }>;

  const activeResultRow = db
    .prepare(`SELECT COUNT(*) as activeCount FROM test_results WHERE status IN ('pending', 'running')`)
    .get() as { activeCount: number } | undefined;

  const counts: TestStatusCounts = {
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    stopped: 0,
    timed_out: 0,
    total: 0,
    activeInstances: activeResultRow?.activeCount ?? 0,
  };

  for (const row of rows) {
    counts[row.status] = row.count;
    counts.total += row.count;
  }

  return counts;
}

interface RawSessionRow {
  id: number;
  test_type: TestType;
  url: string;
  domain: string;
  browser: 'Chrome';
  quantity: number;
  mode: TestMode;
  status: TestStatus;
  authorization_confirmed: number;
  retry_of_session_id: number | null;
  retry_attempt: number;
  qa_config_json: string;
  agent_payload_json: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface RawResultRow {
  id: number;
  session_id: number;
  instance_index: number;
  instance_uid: string;
  status: TestStatus;
  http_status: number | null;
  load_time_ms: number | null;
  final_url: string | null;
  page_title: string | null;
  page_load_status: PageLoadStatus;
  scroll_status: ScrollStatus;
  scroll_steps: number;
  max_scroll_steps: number;
  scroll_progress_pct: number;
  initial_height: number | null;
  final_height: number | null;
  height_changes: number;
  lazy_loaded_detected: number;
  video_visible: number | null;
  video_playback_status: VideoPlaybackStatus;
  video_error: string | null;
  message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

function mapResultRow(row: RawResultRow): TestResultRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    instanceIndex: row.instance_index,
    instanceUid: row.instance_uid || `bt-${row.session_id}-${row.instance_index}`,
    status: row.status,
    httpStatus: row.http_status,
    loadTimeMs: row.load_time_ms,
    finalUrl: row.final_url,
    pageTitle: row.page_title,
    pageLoadStatus: row.page_load_status || 'pending',
    scrollStatus: row.scroll_status || 'not_run',
    scrollSteps: row.scroll_steps ?? 0,
    maxScrollSteps: row.max_scroll_steps ?? 0,
    scrollProgressPct: row.scroll_progress_pct ?? 0,
    initialHeight: row.initial_height,
    finalHeight: row.final_height,
    heightChanges: row.height_changes ?? 0,
    lazyLoadedDetected: row.lazy_loaded_detected === 1,
    videoVisible: row.video_visible === null ? null : row.video_visible === 1,
    videoPlaybackStatus: row.video_playback_status || 'not_run',
    videoError: row.video_error,
    message: row.message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

function parseQaConfig(raw: string | undefined): QaScrollConfig {
  try {
    const parsed = JSON.parse(raw || '{}') as Partial<QaScrollConfig>;
    return {
      ...DEFAULT_QA_SCROLL_CONFIG,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_QA_SCROLL_CONFIG };
  }
}

function mapSessionRow(row: RawSessionRow, results: TestResultRecord[]): TestSession {
  return {
    id: row.id,
    testType: row.test_type,
    url: row.url,
    domain: row.domain,
    browser: row.browser,
    quantity: row.quantity,
    mode: row.mode,
    status: row.status,
    authorizationConfirmed: row.authorization_confirmed === 1,
    retryOfSessionId: row.retry_of_session_id,
    retryAttempt: row.retry_attempt ?? 0,
    qaConfig: parseQaConfig(row.qa_config_json),
    agentPayload: JSON.parse(row.agent_payload_json) as AgentCommandContract,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    results,
  };
}

export function listTestSessions(options?: { status?: string; search?: string }): TestSession[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Array<string> = [];

  if (
    options?.status &&
    ['pending', 'running', 'completed', 'failed', 'stopped', 'timed_out'].includes(options.status)
  ) {
    conditions.push('status = ?');
    params.push(options.status);
  }

  if (options?.search && options.search.trim().length > 0) {
    conditions.push('(url LIKE ? OR domain LIKE ? OR test_type LIKE ?)');
    const pattern = `%${options.search.trim()}%`;
    params.push(pattern, pattern, pattern);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sessionRows = db
    .prepare(
      `SELECT id, test_type, url, domain, browser, quantity, mode, status, authorization_confirmed,
              retry_of_session_id, retry_attempt, qa_config_json, agent_payload_json, error_message, created_at, updated_at
       FROM test_sessions
       ${whereClause}
       ORDER BY id DESC`
    )
    .all(...params) as RawSessionRow[];

  if (sessionRows.length === 0) {
    return [];
  }

  const sessionIds = sessionRows.map((s) => s.id);
  const placeholders = sessionIds.map(() => '?').join(', ');
  const resultRows = db
    .prepare(
      `SELECT id, session_id, instance_index, instance_uid, status, http_status, load_time_ms,
              final_url, page_title, page_load_status, scroll_status, scroll_steps, max_scroll_steps,
              scroll_progress_pct, initial_height, final_height, height_changes, lazy_loaded_detected,
              video_visible, video_playback_status, video_error, message, started_at, completed_at, created_at
       FROM test_results
       WHERE session_id IN (${placeholders})
       ORDER BY session_id DESC, instance_index ASC`
    )
    .all(...sessionIds) as RawResultRow[];

  const resultsBySession = new Map<number, TestResultRecord[]>();
  for (const row of resultRows) {
    const existing = resultsBySession.get(row.session_id) ?? [];
    existing.push(mapResultRow(row));
    resultsBySession.set(row.session_id, existing);
  }

  return sessionRows.map((row) => mapSessionRow(row, resultsBySession.get(row.id) ?? []));
}

export function getTestSessionById(id: number): TestSession | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, test_type, url, domain, browser, quantity, mode, status, authorization_confirmed,
              retry_of_session_id, retry_attempt, qa_config_json, agent_payload_json, error_message, created_at, updated_at
       FROM test_sessions
       WHERE id = ?`
    )
    .get(id) as RawSessionRow | undefined;

  if (!row) {
    return null;
  }

  const resultRows = db
    .prepare(
      `SELECT id, session_id, instance_index, instance_uid, status, http_status, load_time_ms,
              final_url, page_title, page_load_status, scroll_status, scroll_steps, max_scroll_steps,
              scroll_progress_pct, initial_height, final_height, height_changes, lazy_loaded_detected,
              video_visible, video_playback_status, video_error, message, started_at, completed_at, created_at
       FROM test_results
       WHERE session_id = ?
       ORDER BY instance_index ASC`
    )
    .all(id) as RawResultRow[];

  return mapSessionRow(row, resultRows.map(mapResultRow));
}

export interface CreateSessionParams {
  testType: TestType;
  url: string;
  domain: string;
  quantity: number;
  mode: TestMode;
  qaConfig: QaScrollConfig;
  retryOfSessionId?: number | null;
  retryAttempt?: number;
}

export function createTestSession(params: CreateSessionParams): TestSession {
  const db = getDb();
  const now = new Date().toISOString();

  const insertTx = db.transaction((input: CreateSessionParams): number => {
    const initialContract: AgentCommandContract = {
      phase: '4/4',
      sessionId: 0,
      testType: input.testType,
      url: input.url,
      domain: input.domain,
      browser: 'Chrome',
      quantity: input.quantity,
      mode: input.mode,
      qaConfig: input.qaConfig,
      securityPolicy: {
        bindHost: '127.0.0.1',
        isolatedProfile: true,
        allowPersonalProfileAccess: false,
        allowAdInteraction: false,
        allowArtificialEngagement: false,
      },
      preparedAt: now,
    };

    const sessionInfo = db
      .prepare(
        `INSERT INTO test_sessions (
          test_type, url, domain, browser, quantity, mode, status,
          authorization_confirmed, retry_of_session_id, retry_attempt, qa_config_json,
          agent_payload_json, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, 'Chrome', ?, ?, 'pending', 1, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(
        input.testType,
        input.url,
        input.domain,
        input.quantity,
        input.mode,
        input.retryOfSessionId ?? null,
        input.retryAttempt ?? 0,
        JSON.stringify(input.qaConfig),
        JSON.stringify(initialContract),
        now,
        now
      );

    const sessionId = Number(sessionInfo.lastInsertRowid);
    initialContract.sessionId = sessionId;

    db.prepare(`UPDATE test_sessions SET agent_payload_json = ? WHERE id = ?`).run(
      JSON.stringify(initialContract),
      sessionId
    );

    const insertResult = db.prepare(
      `INSERT INTO test_results (
        session_id, instance_index, instance_uid, status, http_status, load_time_ms,
        page_load_status, scroll_status, max_scroll_steps, video_playback_status,
        message, started_at, completed_at, created_at
      ) VALUES (?, ?, ?, 'pending', NULL, NULL, 'pending', 'not_run', ?, 'not_run', ?, NULL, NULL, ?)`
    );

    for (let index = 1; index <= input.quantity; index += 1) {
      insertResult.run(
        sessionId,
        index,
        `bt-${sessionId}-${index}`,
        input.testType === 'Website Test' && input.qaConfig.scrollEnabled
          ? input.qaConfig.maxScrollCount
          : 0,
        'Awaiting local Chrome agent launch confirmation',
        now
      );
    }

    return sessionId;
  });

  const createdId = insertTx(params);
  const created = getTestSessionById(createdId);
  if (!created) {
    throw new Error('Failed to retrieve newly created test session.');
  }
  return created;
}

export function deleteTestSession(id: number): boolean {
  const db = getDb();
  const info = db.prepare(`DELETE FROM test_sessions WHERE id = ?`).run(id);
  return info.changes > 0;
}

export function clearFinishedHistory(): number {
  const db = getDb();
  const info = db
    .prepare(
      `DELETE FROM test_sessions WHERE status IN ('completed', 'failed', 'stopped', 'timed_out')`
    )
    .run();
  return info.changes;
}

export interface AgentResultReportItem {
  instanceIndex: number;
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
}

function deriveSessionStatusFromInstances(statuses: TestStatus[]): TestStatus {
  if (statuses.some((s) => s === 'running')) return 'running';
  if (statuses.some((s) => s === 'pending')) return 'pending';
  if (statuses.every((s) => s === 'stopped')) return 'stopped';
  if (statuses.some((s) => s === 'timed_out')) return 'timed_out';
  if (statuses.some((s) => s === 'failed')) return 'failed';
  if (statuses.some((s) => s === 'stopped')) return 'stopped';
  return 'completed';
}

export function updateSessionFromAgentReport(
  sessionId: number,
  explicitStatus: TestStatus | undefined,
  results: AgentResultReportItem[],
  errorMessage?: string | null
): TestSession | null {
  const db = getDb();
  const existing = getTestSessionById(sessionId);
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();

  const updateTx = db.transaction(() => {
    const updateResultStmt = db.prepare(
      `UPDATE test_results
       SET status = ?,
           http_status = COALESCE(?, http_status),
           load_time_ms = COALESCE(?, load_time_ms),
           final_url = COALESCE(?, final_url),
           page_title = COALESCE(?, page_title),
           page_load_status = COALESCE(?, page_load_status),
           scroll_status = COALESCE(?, scroll_status),
           scroll_steps = COALESCE(?, scroll_steps),
           max_scroll_steps = COALESCE(?, max_scroll_steps),
           scroll_progress_pct = COALESCE(?, scroll_progress_pct),
           initial_height = COALESCE(?, initial_height),
           final_height = COALESCE(?, final_height),
           height_changes = COALESCE(?, height_changes),
           lazy_loaded_detected = COALESCE(?, lazy_loaded_detected),
           video_visible = COALESCE(?, video_visible),
           video_playback_status = COALESCE(?, video_playback_status),
           video_error = COALESCE(?, video_error),
           message = COALESCE(?, message),
           started_at = CASE WHEN ? IN ('running', 'completed', 'failed', 'stopped', 'timed_out') AND started_at IS NULL THEN ? ELSE started_at END,
           completed_at = CASE WHEN ? IN ('completed', 'failed', 'stopped', 'timed_out') THEN ? ELSE completed_at END
       WHERE session_id = ? AND instance_index = ?`
    );

    for (const item of results) {
      updateResultStmt.run(
        item.status,
        item.httpStatus ?? null,
        item.loadTimeMs ?? null,
        item.finalUrl ?? null,
        item.pageTitle ?? null,
        item.pageLoadStatus ?? null,
        item.scrollStatus ?? null,
        item.scrollSteps ?? null,
        item.maxScrollSteps ?? null,
        item.scrollProgressPct ?? null,
        item.initialHeight ?? null,
        item.finalHeight ?? null,
        item.heightChanges ?? null,
        item.lazyLoadedDetected === undefined ? null : item.lazyLoadedDetected ? 1 : 0,
        item.videoVisible === undefined || item.videoVisible === null
          ? null
          : item.videoVisible
            ? 1
            : 0,
        item.videoPlaybackStatus ?? null,
        item.videoError ?? null,
        item.message ?? null,
        item.status,
        now,
        item.status,
        now,
        sessionId,
        item.instanceIndex
      );
    }

    const updatedRows = db
      .prepare(`SELECT status FROM test_results WHERE session_id = ?`)
      .all(sessionId) as Array<{ status: TestStatus }>;

    const nextSessionStatus =
      explicitStatus ?? deriveSessionStatusFromInstances(updatedRows.map((r) => r.status));

    db.prepare(
      `UPDATE test_sessions SET status = ?, error_message = COALESCE(?, error_message), updated_at = ? WHERE id = ?`
    ).run(nextSessionStatus, errorMessage ?? null, now, sessionId);
  });

  updateTx();
  return getTestSessionById(sessionId);
}

export function markSessionFailed(sessionId: number, errorMessage: string): TestSession | null {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE test_sessions SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`
    ).run(errorMessage, now, sessionId);
    db.prepare(
      `UPDATE test_results
       SET status = 'failed', page_load_status = CASE WHEN page_load_status = 'pending' THEN 'error' ELSE page_load_status END,
           message = ?, completed_at = COALESCE(completed_at, ?)
       WHERE session_id = ? AND status IN ('pending', 'running')`
    ).run(errorMessage, now, sessionId);
  });
  tx();
  return getTestSessionById(sessionId);
}

export function markSessionStopped(sessionId: number, reason: string): TestSession | null {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE test_sessions SET status = 'stopped', error_message = NULL, updated_at = ? WHERE id = ?`
    ).run(now, sessionId);
    db.prepare(
      `UPDATE test_results
       SET status = 'stopped',
           scroll_status = CASE WHEN scroll_status = 'scrolling' THEN 'stopped' ELSE scroll_status END,
           message = ?, completed_at = COALESCE(completed_at, ?)
       WHERE session_id = ? AND status IN ('pending', 'running')`
    ).run(reason, now, sessionId);
  });
  tx();
  return getTestSessionById(sessionId);
}

export function markAllActiveSessionsStopped(reason: string): number {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `UPDATE test_sessions SET status = 'stopped', error_message = NULL, updated_at = ? WHERE status IN ('pending', 'running')`
      )
      .run(now);
    db.prepare(
      `UPDATE test_results
       SET status = 'stopped',
           scroll_status = CASE WHEN scroll_status = 'scrolling' THEN 'stopped' ELSE scroll_status END,
           message = ?, completed_at = COALESCE(completed_at, ?)
       WHERE status IN ('pending', 'running')`
    ).run(reason, now);
    return info.changes;
  });
  return tx();
}

export function reconcileAgentActiveInstances(activeInstanceUids: string[]): number {
  const db = getDb();
  const activeSet = new Set(activeInstanceUids);
  const now = new Date().toISOString();
  const cutoffIso = new Date(Date.now() - 8000).toISOString();

  const staleRows = db
    .prepare(
      `SELECT r.id, r.session_id, r.instance_index, r.instance_uid
       FROM test_results r
       JOIN test_sessions s ON s.id = r.session_id
       WHERE r.status IN ('running', 'pending')
         AND s.updated_at < ?`
    )
    .all(cutoffIso) as Array<{
    id: number;
    session_id: number;
    instance_index: number;
    instance_uid: string;
  }>;

  const missing = staleRows.filter((row) => !activeSet.has(row.instance_uid));
  if (missing.length === 0) return 0;

  const tx = db.transaction(() => {
    const updateRes = db.prepare(
      `UPDATE test_results
       SET status = 'failed',
           message = COALESCE(message, 'Local Chrome agent disconnected or closed instance unexpectedly.'),
           completed_at = COALESCE(completed_at, ?)
       WHERE id = ?`
    );

    const affectedSessions = new Set<number>();
    for (const row of missing) {
      updateRes.run(now, row.id);
      affectedSessions.add(row.session_id);
    }

    for (const sessionId of affectedSessions) {
      const childStatuses = db
        .prepare(`SELECT status FROM test_results WHERE session_id = ?`)
        .all(sessionId) as Array<{ status: TestStatus }>;
      const derived = deriveSessionStatusFromInstances(childStatuses.map((c) => c.status));
      db.prepare(
        `UPDATE test_sessions
         SET status = ?,
             error_message = COALESCE(error_message, 'Recovered after local Chrome agent disconnect/restart.'),
             updated_at = ?
         WHERE id = ?`
      ).run(derived, now, sessionId);
    }

    return missing.length;
  });

  return tx();
}

