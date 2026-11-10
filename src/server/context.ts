import type { DB } from './db';

export type Role = 'owner' | 'accountant' | 'fiduciary' | 'viewer';

/** Authenticated, tenant-scoped context. Every service function requires one. */
export interface Ctx {
  db: DB;
  userId: string;
  orgId: string;
  role: Role;
}

export class AppError extends Error {
  constructor(public code: 'forbidden' | 'not_found' | 'invalid' | 'conflict' | 'external', message: string) {
    super(message);
  }
}

const WRITE_ROLES: ReadonlySet<Role> = new Set(['owner', 'accountant', 'fiduciary']);

export function assertCanWrite(ctx: Ctx): void {
  if (!WRITE_ROLES.has(ctx.role)) throw new AppError('forbidden', 'Read-only access');
}

/** Validating accounting entries is reserved to owners, accountants and fiduciaries. */
export function assertCanValidate(ctx: Ctx): void {
  assertCanWrite(ctx);
}
