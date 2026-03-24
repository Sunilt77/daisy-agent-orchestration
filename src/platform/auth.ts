import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { getPrisma } from './prisma';
import { HttpError } from './httpErrors';

const COOKIE_NAME = 'sid';

export type AuthedUser = {
  id: string;
  orgId: string;
  email: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __agentopsAuthedUser: AuthedUser | undefined;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthedUser;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export function getSessionDays(): number {
  const raw = process.env.SESSION_DAYS;
  const days = raw ? Number(raw) : 7;
  return Number.isFinite(days) && days > 0 ? days : 7;
}

export function setSessionCookie(res: Response, sessionId: string) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie(COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: getSessionDays() * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export async function requireUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const prisma = getPrisma();
    const sid = req.cookies?.[COOKIE_NAME];
    if (!sid) throw new HttpError(401, 'Not authenticated');

    const session = await prisma.session.findUnique({
      where: { id: sid },
      include: { user: true },
    });
    if (!session) throw new HttpError(401, 'Invalid session');
    if (session.revokedAt) throw new HttpError(401, 'Session revoked');
    if (session.expiresAt.getTime() <= Date.now()) throw new HttpError(401, 'Session expired');

    req.user = { id: session.user.id, orgId: session.user.orgId, email: session.user.email };
    next();
  } catch (e) {
    next(e);
  }
}

