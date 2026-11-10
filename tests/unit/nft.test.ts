import { describe, expect, it } from 'vitest';
import { mapEthereum } from '@/integrations/sources/ethereum';
import { classifyTransactions, DEFAULT_CLASSIFICATION_OPTIONS } from '@/core/classification/engine';

const me = '0x1111111111111111111111111111111111111111';
const market = '0x3333333333333333333333333333333333333333';
const base = { blockNumber: '1', timeStamp: '1700000000', gasPrice: '0', gasUsed: '0' };

describe('Ethereum NFTs and DeFi', () => {
  it('maps an NFT bought with ETH and always sends it to review', () => {
    const r = mapEthereum([me], [
      { ...base, kind: 'txlist', hash: '0xa', from: me, to: market, value: '500000000000000000', isError: '0' },
      { ...base, kind: 'tokennfttx', hash: '0xa', from: market, to: me, value: '', contractAddress: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', tokenID: '42' } as never,
    ]);
    expect(r.transactions[0]!.movements).toEqual([
      { direction: 'out', asset: 'ETH', quantity: '0.5' },
      { direction: 'in', asset: 'NFT.bc4ca0#42', quantity: '1' },
    ]);
    const tx = { id: 't', sourceId: 's', provider: 'ethereum', occurredAt: new Date(), rawType: 'x', txHash: '0xa', movements: r.transactions[0]!.movements, hint: r.transactions[0]!.hint ?? null, manual: null };
    const c = classifyTransactions([tx], [], DEFAULT_CLASSIFICATION_OPTIONS).get('t')!;
    expect(c.needsReview).toBe(true);
  });

  it('counts ERC-1155 quantities and flags multi-asset DeFi transactions', () => {
    const r = mapEthereum([me], [
      { ...base, kind: 'token1155tx', hash: '0xb', from: market, to: me, value: '', contractAddress: '0x4444444444444444444444444444444444444444', tokenID: '7', tokenValue: '3' } as never,
      { ...base, kind: 'tokentx', hash: '0xc', from: me, to: market, value: '1000000', contractAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7', tokenSymbol: 'USDT', tokenDecimal: '6' } as never,
      { ...base, kind: 'tokentx', hash: '0xc', from: me, to: market, value: '1000000', contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', tokenSymbol: 'USDC', tokenDecimal: '6' } as never,
      { ...base, kind: 'tokentx', hash: '0xc', from: market, to: me, value: '5', contractAddress: '0x6b175474e89094c44da98b954eedeac495271d0f', tokenSymbol: 'DAI', tokenDecimal: '0' } as never,
    ]);
    expect(r.transactions.find((t) => t.txHash === '0xb')!.movements).toEqual([{ direction: 'in', asset: 'NFT.444444#7', quantity: '3' }]);
    expect(r.transactions.find((t) => t.txHash === '0xc')!.hint?.reason).toMatch(/pool de liquidité/);
  });
});
