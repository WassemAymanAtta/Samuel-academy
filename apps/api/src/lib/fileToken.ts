import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { User } from '@prisma/client';
import { config } from './config';

export const FILE_TOKEN_QUERY = 'ftoken';
const FILE_TOKEN_TTL_SECONDS = 10 * 60;

type FileTokenPayload = {
  sub: string;
  fid: string;
  sv: number;
  did: string | null;
  purpose: 'file';
};

/** Short-lived, single-purpose capability for one private file. */
export function signFileToken(fileId: string, user: User): string {
  const payload: FileTokenPayload = {
    sub: user.id,
    fid: fileId,
    sv: user.sessionVersion,
    did: user.sessionDeviceId,
    purpose: 'file',
  };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: FILE_TOKEN_TTL_SECONDS,
    jwtid: randomUUID(),
  });
}

export function verifyFileToken(token: string): FileTokenPayload | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as Partial<FileTokenPayload>;
    if (
      payload.purpose !== 'file' ||
      typeof payload.sub !== 'string' ||
      typeof payload.fid !== 'string' ||
      typeof payload.sv !== 'number'
    ) {
      return null;
    }
    return payload as FileTokenPayload;
  } catch {
    return null;
  }
}
