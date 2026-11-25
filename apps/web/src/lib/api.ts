export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'UNKNOWN',
    public body: unknown = null,
  ) {
    super(message);
  }
}

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

// Per-tab token: logging in on another tab must not sign this one into a different account.
let authToken: string | null = null;
let unauthorizedHandler: ((message?: string) => void) | null = null;

export function setUnauthorizedHandler(handler: ((message?: string) => void) | null) {
  unauthorizedHandler = handler;
}

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) sessionStorage.setItem('sa_token', token);
  else sessionStorage.removeItem('sa_token');
}

export function storedAuthToken() {
  const token = sessionStorage.getItem('sa_token');
  authToken = token;
  return token;
}

/** Private file URLs need the tab token because media tags cannot send headers. */
export function privateFileUrl(fileId: string) {
  const token = authToken ?? sessionStorage.getItem('sa_token');
  return `${BASE}/api/files/${encodeURIComponent(fileId)}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...options.headers,
    },
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const error = (payload as { error?: { message?: string; code?: string } })?.error;
    const message = error?.message ?? 'حدث خطأ، حاول مرة أخرى';
    if (response.status === 401) unauthorizedHandler?.(message);
    throw new ApiError(response.status, message, error?.code ?? 'UNKNOWN', payload);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  uploadFile: <T>(path: string, file: File, fallbackType = 'application/octet-stream') =>
    request<T>(path, {
      method: 'POST',
      body: file,
      headers: {
        'Content-Type': file.type || fallbackType,
        'X-File-Name': encodeURIComponent(file.name),
      },
    }),
  uploadPdf: <T>(path: string, file: File) => api.uploadFile<T>(path, file, 'application/pdf'),
};

export const queryKeys = {
  subjects: ['subjects'] as const,
  course: (id: string) => ['course', id] as const,
  lesson: (id: string) => ['lesson', id] as const,
  exam: (id: string) => ['exam', id] as const,
  dashboard: ['student-dashboard'] as const,
  payments: ['my-payments'] as const,
  products: ['products'] as const,
  adminOverview: ['admin-overview'] as const,
  adminPayments: ['admin-payments'] as const,
  adminContent: ['admin-content'] as const,
  adminStudents: ['admin-students'] as const,
  adminExams: ['admin-exams'] as const,
  adminProducts: ['admin-products'] as const,
  adminProgress: ['admin-progress'] as const,
};
