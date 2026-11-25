import { deviceCookieValue } from '../src/lib/auth';

/**
 * Simulates the signed httpOnly device cookie the API issued at login.
 * Tests need it because a Bearer token alone is deliberately not accepted.
 */
export function authHeaders(token: string): Record<string, string> {
  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')) as { did?: string | null };
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (payload.did) headers.Cookie = `sa_device=${deviceCookieValue(payload.did)}`;
  return headers;
}
