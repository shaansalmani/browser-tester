import type {
  AppSettings,
  AuthorizedDomain,
  ConcurrencyLimits,
  HealthResponse,
  QaScrollConfig,
  TestMode,
  TestSession,
  TestStatusCounts,
  TestType,
} from '../types/testing.ts';

async function handleResponse<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }
  return data;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  return handleResponse<HealthResponse>(res);
}

export async function fetchSettings(): Promise<{
  settings: AppSettings;
  bounds: { hardMaxQuantityPerSession: number; hardMaxActiveInstances: number };
}> {
  const res = await fetch('/api/settings');
  return handleResponse(res);
}

export async function updateSettingsRequest(
  patch: Partial<AppSettings>
): Promise<{ settings: AppSettings }> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return handleResponse<{ settings: AppSettings }>(res);
}

export async function fetchAuthorizedDomains(): Promise<{ domains: AuthorizedDomain[] }> {
  const res = await fetch('/api/domains');
  return handleResponse<{ domains: AuthorizedDomain[] }>(res);
}

export async function addAuthorizedDomainRequest(payload: {
  domain: string;
  ownershipNote: string;
  ownershipConfirmed: boolean;
}): Promise<{ domain: AuthorizedDomain }> {
  const res = await fetch('/api/domains', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse<{ domain: AuthorizedDomain }>(res);
}

export async function removeAuthorizedDomainRequest(id: number): Promise<{ deleted: boolean }> {
  const res = await fetch(`/api/domains/${id}`, {
    method: 'DELETE',
  });
  return handleResponse<{ deleted: boolean }>(res);
}

export async function fetchTestSessions(params?: {
  status?: string;
  q?: string;
}): Promise<{
  counts: TestStatusCounts;
  sessions: TestSession[];
  limits: ConcurrencyLimits;
}> {
  const query = new URLSearchParams();
  if (params?.status && params.status !== 'all') {
    query.set('status', params.status);
  }
  if (params?.q && params.q.trim()) {
    query.set('q', params.q.trim());
  }
  const qs = query.toString();
  const res = await fetch(`/api/tests${qs ? `?${qs}` : ''}`);
  return handleResponse(res);
}

export async function createTestSessionRequest(payload: {
  testType: TestType;
  url: string;
  browser: 'Chrome';
  quantity: number;
  mode: TestMode;
  authorizationConfirmed: boolean;
  qaConfig: QaScrollConfig;
}): Promise<{
  session: TestSession;
  message: string;
}> {
  const res = await fetch('/api/tests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function retryTestSessionRequest(id: number): Promise<{
  session: TestSession;
  message: string;
}> {
  const res = await fetch(`/api/tests/${id}/retry`, {
    method: 'POST',
  });
  return handleResponse(res);
}

export async function stopTestSessionRequest(id: number): Promise<{
  stopped: boolean;
  stoppedInstances: number;
  session: TestSession | null;
}> {
  const res = await fetch(`/api/tests/${id}/stop`, {
    method: 'POST',
  });
  return handleResponse(res);
}

export async function stopTestInstanceRequest(
  sessionId: number,
  instanceIndex: number
): Promise<{
  stopped: boolean;
  instanceUid: string;
  session: TestSession;
}> {
  const res = await fetch(`/api/tests/${sessionId}/instances/${instanceIndex}/stop`, {
    method: 'POST',
  });
  return handleResponse(res);
}

export async function stopAllTestSessionsRequest(): Promise<{
  stopped: boolean;
  stoppedInstances: number;
  updatedSessions: number;
}> {
  const res = await fetch('/api/tests/stop-all', {
    method: 'POST',
  });
  return handleResponse(res);
}

export async function deleteTestSessionRequest(id: number): Promise<{ deleted: boolean }> {
  const res = await fetch(`/api/tests/${id}`, {
    method: 'DELETE',
  });
  return handleResponse<{ deleted: boolean }>(res);
}

export async function clearFinishedHistoryRequest(): Promise<{
  cleared: boolean;
  deletedCount: number;
}> {
  const res = await fetch('/api/tests', {
    method: 'DELETE',
  });
  return handleResponse<{ cleared: boolean; deletedCount: number }>(res);
}
