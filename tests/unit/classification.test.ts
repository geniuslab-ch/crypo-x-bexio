import { describe, expect, it } from 'vitest';
import { classifyTransactions, type ClassifiableTx } from '@/core/classification/engine';

const tx = (p: Partial<ClassifiableTx> & Pick<ClassifiableTx, 'id' | 'movements'>): ClassifiableTx => ({
  sourceId: 'kraken', provider: 'kraken', occurredAt: new Date('2024-01-01T00:00:00Z'), rawType: 'trade', ...p,
});

describe('classification', () => {
  it('classifies by structure with confidence', () => {
    const r = classifyTransactions([
      tx({ id: 'b', movements: [{ direction: 'in', asset: 'BTC', quantity: '1' }, { direction: 'out', asset: 'CHF', quantity: '1' }] }),
      tx({ id: 's', movements: [{ direction: 'out', asset: 'BTC', quantity: '1' }, { direction: 'in', asset: 'EUR', quantity: '1' }] }),
      tx({ id: 'x', movements: [{ direction: 'out', asset: 'BTC', quantity: '1' }, { direction: 'in', asset: 'ETH', quantity: '1' }] }),
      tx({ id: 'd', movements: [{ direction: 'in', asset: 'BTC', quantity: '1' }] }),
      tx({ id: 'f', movements: [{ direction: 'in', asset: 'CHF', quantity: '1' }] }),
    ], []);
    expect(r.get('b')).toMatchObject({ classification: 'buy', needsReview: false });
    expect(r.get('s')).toMatchObject({ classification: 'sell', needsReview: false });
    expect(r.get('x')).toMatchObject({ classification: 'swap', needsReview: false });
    expect(r.get('d')).toMatchObject({ classification: 'deposit', needsReview: true });
    expect(r.get('f')).toMatchObject({ classification: 'fiat_deposit', needsReview: false });
  });

  it('matches own-wallet transfers across sources and derives the network fee', () => {
    const r = classifyTransactions([
      tx({ id: 'w', sourceId: 'kraken', occurredAt: new Date('2024-03-02T12:00:00Z'), movements: [{ direction: 'out', asset: 'BTC', quantity: '0.02' }] }),
      tx({ id: 'd', sourceId: 'ledger', provider: 'generic', occurredAt: new Date('2024-03-02T12:40:00Z'), movements: [{ direction: 'in', asset: 'BTC', quantity: '0.0199' }] }),
      tx({ id: 'other', sourceId: 'ledger', provider: 'generic', occurredAt: new Date('2024-03-10T12:40:00Z'), movements: [{ direction: 'in', asset: 'BTC', quantity: '0.02' }] }),
    ], []);
    expect(r.get('w')).toMatchObject({ classification: 'internal_transfer', origin: 'transfer_match', implicitFee: { asset: 'BTC', quantity: '0.0001' } });
    expect(r.get('d')).toMatchObject({ classification: 'internal_transfer', transferGroupId: 'tg_w' });
    expect(r.get('other')).toMatchObject({ classification: 'deposit', needsReview: true });
  });

  it('does not match when the received amount exceeds the tolerance or comes from the same source', () => {
    const r = classifyTransactions([
      tx({ id: 'w', movements: [{ direction: 'out', asset: 'BTC', quantity: '1' }] }),
      tx({ id: 'd1', sourceId: 'other', movements: [{ direction: 'in', asset: 'BTC', quantity: '0.9' }] }),
      tx({ id: 'd2', movements: [{ direction: 'in', asset: 'BTC', quantity: '1' }] }),
    ], []);
    expect(r.get('w')!.classification).toBe('withdrawal');
  });

  it('applies user rules and manual corrections before anything else', () => {
    const r = classifyTransactions([
      tx({ id: 'a', rawType: 'transfer', movements: [{ direction: 'in', asset: 'DOT', quantity: '1' }] }),
      tx({ id: 'b', rawType: 'transfer', manual: 'mining_reward', movements: [{ direction: 'in', asset: 'DOT', quantity: '1' }] }),
    ], [{ id: 'r1', provider: 'kraken', rawType: 'transfer', classification: 'airdrop' }]);
    expect(r.get('a')).toMatchObject({ classification: 'airdrop', origin: 'user_rule', confidence: 1 });
    expect(r.get('b')).toMatchObject({ classification: 'mining_reward', origin: 'user' });
  });
});

describe('transfer gap with a recorded fee', () => {
  it('does not derive a second fee when the source already records it', () => {
    const r = classifyTransactions([
      tx({ id: 'w', sourceId: 'a', movements: [{ direction: 'out', asset: 'BTC', quantity: '0.02' }, { direction: 'fee', asset: 'BTC', quantity: '0.00005' }] }),
      tx({ id: 'd', sourceId: 'b', movements: [{ direction: 'in', asset: 'BTC', quantity: '0.01995' }] }),
    ], []);
    expect(r.get('w')).toMatchObject({ classification: 'internal_transfer', implicitFee: null });
  });
});
