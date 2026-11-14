import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSession, isResetTokenValid, login, registerUser, requestPasswordReset, resetPassword } from '@/server/auth/service';
import { closeDb, type DB } from '@/server/db';
import { resetDatabase } from './helpers';

let db: DB;

beforeAll(async () => {
  db = await resetDatabase();
  await registerUser(db, { email: 'reset@example.test', password: 'old password 123', name: 'Ana', orgName: 'Reset SA', orgKind: 'sa' });
});
afterAll(async () => closeDb());

describe('password reset', () => {
  it('returns null for an unknown address (same answer shown to the user)', async () => {
    expect(await requestPasswordReset(db, 'nobody@example.test')).toBeNull();
  });

  it('sets a new password once, burns other links and logs out every session', async () => {
    const { token: session } = await login(db, 'reset@example.test', 'old password 123');
    const first = await requestPasswordReset(db, 'RESET@example.test');
    const second = await requestPasswordReset(db, 'reset@example.test');
    expect(first?.email).toBe('reset@example.test');
    expect(await isResetTokenValid(db, first!.token)).toBe(true);

    await expect(resetPassword(db, first!.token, 'short')).rejects.toThrow();
    await resetPassword(db, first!.token, 'new password 456');

    expect(await getSession(db, session)).toBeNull();
    await expect(login(db, 'reset@example.test', 'old password 123')).rejects.toThrow('invalid_credentials');
    expect((await login(db, 'reset@example.test', 'new password 456')).token).toBeTruthy();

    await expect(resetPassword(db, first!.token, 'another password 7')).rejects.toThrow('reset_link_invalid');
    expect(await isResetTokenValid(db, second!.token)).toBe(false);
    await expect(resetPassword(db, 'made-up-token', 'another password 7')).rejects.toThrow('reset_link_invalid');
  });

  it('limits reset e-mails per address', async () => {
    await requestPasswordReset(db, 'reset@example.test');
    await expect(requestPasswordReset(db, 'reset@example.test')).rejects.toThrow('too_many_attempts');
  });
});
