import { describe, expect, it } from 'vitest';
import { flashText } from '@/components/Flash';

describe('flashText', () => {
  it('shows the platform error next to the known message', () => {
    expect(flashText('credentials_rejected|platform=EAPI:Invalid key')).toBe(
      'La plateforme a refusé la clé (clé, secret ou droits incorrects). · Réponse de la plateforme : « EAPI:Invalid key »');
  });
});

describe('asAppError', () => {
  it('passes the platform response but never details that echo user input', async () => {
    const { asAppError } = await import('@/server/services/sync');
    const { ConnectorError } = await import('@/integrations/sources/types');
    const message = (e: unknown) => { try { asAppError(e); } catch (x) { return (x as Error).message; } return ''; };
    expect(message(new ConnectorError('credentials_rejected', 'EAPI:Invalid key'))).toBe('credentials_rejected|platform=EAPI:Invalid key');
    expect(message(new ConnectorError('invalid_address', 'abandon, ability, able'))).toBe('invalid_address');
  });
});
