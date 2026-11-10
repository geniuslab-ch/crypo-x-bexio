import { describe, expect, it } from 'vitest';
import { flashText } from '@/components/Flash';

describe('flashText', () => {
  it('shows the platform error next to the known message', () => {
    expect(flashText('credentials_rejected|platform=EAPI:Invalid key')).toBe(
      'La plateforme a refusé la clé (clé, secret ou droits incorrects). · Réponse de la plateforme : « EAPI:Invalid key »');
  });
});
