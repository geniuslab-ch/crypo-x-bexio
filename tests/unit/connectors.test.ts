import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { binanceApiConnector, binanceSign, mapBinance } from '@/integrations/sources/binance';
import { bitcoinConnector, mapBitcoin } from '@/integrations/sources/bitcoin';
import { coinbaseJwt, mapCoinbase } from '@/integrations/sources/coinbase';
import { mapEthereum } from '@/integrations/sources/ethereum';
import { krakenApiConnector, krakenEntriesToRows, krakenSign } from '@/integrations/sources/kraken';
import { parseKrakenLedgerRows } from '@/core/importers/kraken';
import type { FetchContext } from '@/integrations/sources/types';

/** Synthetic data only: these tests never call a real platform. */

function fakeFx(handler: (url: string, init?: RequestInit) => unknown, opts: { budgetMs?: number; clock?: { t: number } } = {}): FetchContext {
  const clock = opts.clock ?? { t: Date.UTC(2026, 0, 1) };
  return {
    fetch: (async (url: string, init?: RequestInit) => {
      clock.t += 1_000;
      const body = handler(String(url), init);
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch,
    deadline: clock.t + (opts.budgetMs ?? 600_000),
    now: () => clock.t,
    sleep: async (ms) => { clock.t += ms; },
    env: { ETHERSCAN_API_KEY: 'test' },
  };
}

describe('request signing', () => {
  it('Kraken API-Sign matches the example of the Kraken documentation', () => {
    const secret = 'kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg==';
    const body = 'nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25';
    expect(krakenSign('/0/private/AddOrder', body, '1616492376594', secret))
      .toBe('4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ==');
  });

  it('Binance signature matches the example of the Binance documentation', () => {
    const secret = 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j';
    const q = 'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559';
    expect(binanceSign(q, secret)).toBe('c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71');
  });

  it('Coinbase JWT is ES256-signed with the documented header and claims', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pem = privateKey.export({ type: 'sec1', format: 'pem' }).toString();
    const jwt = coinbaseJwt('organizations/o/apiKeys/k', pem, 'GET', '/v2/accounts', 1_700_000_000);
    const [h, p, s] = jwt.split('.');
    const header = JSON.parse(Buffer.from(h!, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
    expect(header).toMatchObject({ alg: 'ES256', kid: 'organizations/o/apiKeys/k' });
    expect(header.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(payload).toEqual({ iss: 'cdp', sub: 'organizations/o/apiKeys/k', nbf: 1_700_000_000, exp: 1_700_000_120, uri: 'GET api.coinbase.com/v2/accounts' });
    const ok = createVerify('sha256').update(`${h}.${p}`).verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s!, 'base64url'));
    expect(ok).toBe(true);
  });
});

describe('Kraken API', () => {
  const entries = {
    L1: { refid: 'T1', time: 1704103200.1234, type: 'trade', subtype: '', aclass: 'currency', asset: 'ZCHF', amount: '-1000.0000', fee: '2.6000', balance: '0' },
    L2: { refid: 'T1', time: 1704103200.1234, type: 'trade', subtype: '', aclass: 'currency', asset: 'XXBT', amount: '0.0250000000', fee: '0', balance: '0.025' },
    L3: { refid: 'D1', time: 1704016800, type: 'deposit', subtype: '', aclass: 'currency', asset: 'ZCHF', amount: '1002.6', fee: '0', balance: '1002.6' },
  };

  it('API entries go through the same parser as the CSV export', () => {
    const { rows, lines } = krakenEntriesToRows(entries);
    const r = parseKrakenLedgerRows(rows, lines);
    expect(r.issues).toEqual([]);
    const trade = r.transactions.find((t) => t.externalId === 'T1')!;
    expect(trade.movements).toEqual(expect.arrayContaining([
      { direction: 'in', asset: 'BTC', quantity: '0.025' },
      { direction: 'out', asset: 'CHF', quantity: '1000' },
      { direction: 'fee', asset: 'CHF', quantity: '2.6' },
    ]));
    expect(trade.occurredAt.toISOString()).toBe('2024-01-01T10:00:00.123Z');
  });

  it('keeps reading over several runs and only produces transactions when the history is complete', async () => {
    const pages = [{ L1: entries.L1 }, { L2: entries.L2, L3: entries.L3 }];
    const seen: string[] = [];
    const handler = (_url: string, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      seen.push(body.get('cursor') ?? 'first');
      const i = body.get('cursor') ? 1 : 0;
      return { error: [], result: { ledger: pages[i], count: null, cursor: { next: i === 0 ? 'c2' : null } } };
    };
    const creds = { apiKey: 'k', apiSecret: Buffer.from('secret').toString('base64') };
    // A budget of 9 s leaves room for exactly one request (8 s reserve).
    const clock = { t: Date.UTC(2026, 0, 1) };
    const first = await krakenApiConnector.sync(creds, {}, fakeFx(handler, { budgetMs: 9_500, clock }));
    expect(first.complete).toBe(false);
    expect(first.transactions).toEqual([]);
    const second = await krakenApiConnector.sync(creds, first.state, fakeFx(handler, { clock }));
    expect(second.complete).toBe(true);
    expect(seen).toEqual(['first', 'c2']);
    expect(second.transactions.map((t) => t.externalId).sort()).toEqual(['D1', 'T1']);
    expect(second.transactions.find((t) => t.externalId === 'T1')!.movements).toHaveLength(3);
    expect(second.state.start).toBe(Math.floor(1704103200.1234) - 3600);
  });
});

describe('Binance API', () => {
  it('refuses keys that can trade or withdraw', async () => {
    const fx = fakeFx(() => ({ enableReading: true, enableWithdrawals: true, enableSpotAndMarginTrading: false }));
    await expect(binanceApiConnector.verify({ apiKey: 'k', apiSecret: 's' }, fx)).rejects.toThrow('api_key_not_read_only');
    const fx2 = fakeFx(() => ({ enableReading: true, enableWithdrawals: false, enableSpotAndMarginTrading: true }));
    await expect(binanceApiConnector.verify({ apiKey: 'k', apiSecret: 's' }, fx2)).rejects.toThrow('api_key_not_read_only');
    const fx3 = fakeFx(() => ({ enableReading: true, enableWithdrawals: false, enableSpotAndMarginTrading: false }));
    await expect(binanceApiConnector.verify({ apiKey: 'k', apiSecret: 's' }, fx3)).resolves.toEqual({ readOnly: 'verified' });
  });

  it('maps trades, completed withdrawals and credited deposits', () => {
    const r = mapBinance({
      symbols: [{ symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT' }],
      deposits: [
        { id: 'd1', amount: '500', coin: 'USDT', status: 1, txId: '0xabc', insertTime: Date.UTC(2024, 0, 1) },
        { id: 'd2', amount: '9', coin: 'USDT', status: 0, insertTime: Date.UTC(2024, 0, 2) },
      ],
      withdrawals: [
        { id: 'w1', amount: '0.01', transactionFee: '0.0002', coin: 'BTC', status: 6, txId: 'h', applyTime: '2024-02-01 08:00:00' },
        { id: 'w2', amount: '1', transactionFee: '0', coin: 'BTC', status: 3, applyTime: '2024-02-02 08:00:00' },
      ],
      trades: [{ symbol: 'BTCUSDT', id: 7, orderId: 1, price: '40000', qty: '0.01', quoteQty: '400', commission: '0.00001', commissionAsset: 'BTC', time: Date.UTC(2024, 0, 5), isBuyer: true }],
    });
    expect(r.issues).toEqual([]);
    expect(r.transactions.map((t) => t.externalId)).toEqual(['deposit:d1', 'trade:BTCUSDT:7', 'withdrawal:w1']);
    expect(r.transactions[1]!.movements).toEqual([
      { direction: 'in', asset: 'BTC', quantity: '0.01' },
      { direction: 'out', asset: 'USDT', quantity: '400' },
      { direction: 'fee', asset: 'BTC', quantity: '0.00001' },
    ]);
    expect(r.transactions[2]!.occurredAt.toISOString()).toBe('2024-02-01T08:00:00.000Z');
    expect(r.transactions[2]!.movements).toContainEqual({ direction: 'fee', asset: 'BTC', quantity: '0.0002' });
  });
});

describe('Binance Earn rewards', () => {
  it('books flexible and locked Simple Earn rewards as staking income', () => {
    const r = mapBinance({
      symbols: [], deposits: [], withdrawals: [], trades: [],
      flexRewards: [{ asset: 'USDC', rewards: '0.0123', projectId: 'USDC001', type: 'REALTIME', time: Date.UTC(2024, 5, 1) }],
      lockedRewards: [
        { positionId: 42, time: Date.UTC(2024, 5, 2), asset: 'DOT', lockPeriod: '30', amount: '0.5', type: 'Locked Rewards' },
        { positionId: 42, time: Date.UTC(2024, 5, 3), asset: 'DOT', lockPeriod: '30', amount: '0', type: 'Locked Rewards' },
      ],
    });
    expect(r.transactions.map((t) => [t.movements, t.hint?.classification])).toEqual([
      [[{ direction: 'in', asset: 'USDC', quantity: '0.0123' }], 'staking_reward'],
      [[{ direction: 'in', asset: 'DOT', quantity: '0.5' }], 'staking_reward'],
    ]);
  });

  it('reads transfers, trades and both reward histories in one complete pass', async () => {
    const paths: string[] = [];
    const clock = { t: Date.UTC(2023, 2, 1) };
    const fx = fakeFx((url) => {
      const u = new URL(url);
      paths.push(u.pathname);
      switch (u.pathname) {
        case '/sapi/v1/account/apiRestrictions': return { enableReading: true };
        case '/sapi/v1/capital/deposit/hisrec': return [];
        case '/sapi/v1/capital/withdraw/history': return [];
        case '/api/v3/account': return { balances: [{ asset: 'SOL', free: '1', locked: '0' }] };
        case '/api/v3/exchangeInfo': return { symbols: [{ symbol: 'SOLUSDT', baseAsset: 'SOL', quoteAsset: 'USDT' }] };
        case '/api/v3/myTrades': return [];
        case '/sapi/v1/simple-earn/flexible/history/rewardsRecord': return { rows: [], total: 0 };
        case '/sapi/v1/simple-earn/locked/history/rewardsRecord':
          return Number(u.searchParams.get('startTime')) === Date.UTC(2023, 0, 1)
            ? { rows: [{ positionId: 1, time: Date.UTC(2023, 0, 5), asset: 'SOL', lockPeriod: '60', amount: '0.01' }], total: 1 } : { rows: [], total: 0 };
        default: throw new Error(`unexpected ${u.pathname}`);
      }
    }, { clock });
    const r = await binanceApiConnector.sync({ apiKey: 'k', apiSecret: 's' }, {}, fx);
    expect(r.complete).toBe(true);
    expect(paths).toContain('/api/v3/myTrades');
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0]!.movements).toEqual([{ direction: 'in', asset: 'SOL', quantity: '0.01' }]);
    expect(r.state.nextRewardsFrom).toBeGreaterThan(Date.UTC(2023, 0, 1));
  });
});

describe('Coinbase API', () => {
  it('pairs the two legs of an advanced trade fill and leaves a lone leg for review', () => {
    const fill = { order_id: 'o1', product_id: 'BTC-CHF', fill_price: '40000', commission: '2', order_side: 'BUY' };
    const r = mapCoinbase([
      { id: 'a', type: 'advanced_trade_fill', status: 'completed', amount: { amount: '0.01', currency: 'BTC' }, native_amount: { amount: '400', currency: 'CHF' }, created_at: '2024-01-01T10:00:00Z', advanced_trade_fill: fill },
      { id: 'b', type: 'advanced_trade_fill', status: 'completed', amount: { amount: '-402', currency: 'CHF' }, created_at: '2024-01-01T10:00:00Z', advanced_trade_fill: fill },
      { id: 'c', type: 'buy', status: 'completed', amount: { amount: '0.5', currency: 'ETH' }, created_at: '2024-01-02T10:00:00Z' },
      { id: 'd', type: 'send', status: 'pending', amount: { amount: '-1', currency: 'ETH' }, created_at: '2024-01-03T10:00:00Z' },
    ]);
    expect(r.transactions).toHaveLength(2);
    const t = r.transactions[0]!;
    expect(t.movements).toEqual(expect.arrayContaining([
      { direction: 'in', asset: 'BTC', quantity: '0.01' },
      { direction: 'out', asset: 'CHF', quantity: '402' },
    ]));
    expect(t.sourceChfValue).toBe('400');
    expect(r.transactions[1]!.hint?.classification).toBe('unknown');
  });
});

describe('Bitcoin addresses', () => {
  const me = 'bc1qmyaddress0000000000000000000000000000';
  const other = 'bc1qother00000000000000000000000000000000';

  it('nets inputs and outputs of own addresses and books the fee', () => {
    const r = mapBitcoin([me], [
      { txid: 'r1', fee: 500, vin: [{ prevout: { scriptpubkey_address: other, value: 200_500 } }], vout: [{ scriptpubkey_address: me, value: 200_000 }], status: { confirmed: true, block_time: 1_700_000_000 } },
      { txid: 's1', fee: 300, vin: [{ prevout: { scriptpubkey_address: me, value: 200_000 } }], vout: [{ scriptpubkey_address: other, value: 150_000 }, { scriptpubkey_address: me, value: 49_700 }], status: { confirmed: true, block_time: 1_700_000_100 } },
      { txid: 'u1', fee: 300, vin: [], vout: [{ scriptpubkey_address: me, value: 1 }], status: { confirmed: false } },
    ]);
    expect(r.transactions.map((t) => t.movements)).toEqual([
      [{ direction: 'in', asset: 'BTC', quantity: '0.002' }],
      [{ direction: 'out', asset: 'BTC', quantity: '0.0015' }, { direction: 'fee', asset: 'BTC', quantity: '0.000003' }],
    ]);
  });

  it('rejects anything that is not a public address', async () => {
    await expect(bitcoinConnector.verify({ addresses: 'abandon abandon abandon' }, fakeFx(() => ({})))).rejects.toThrow('invalid_address');
  });
});

describe('Ethereum addresses', () => {
  const me = '0x1111111111111111111111111111111111111111';
  const dex = '0x2222222222222222222222222222222222222222';

  it('groups ETH, gas and token legs of one transaction; unknown tokens go to review', () => {
    const r = mapEthereum([me], [
      { kind: 'txlist', hash: '0xh1', timeStamp: '1700000000', from: me, to: dex, value: '1000000000000000000', gasPrice: '20000000000', gasUsed: '100000', isError: '0', blockNumber: '1' },
      { kind: 'tokentx', hash: '0xh1', timeStamp: '1700000000', from: dex, to: me, value: '2000000000', contractAddress: '0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', tokenSymbol: 'USDC', tokenDecimal: '6', blockNumber: '1' },
      { kind: 'tokentx', hash: '0xh2', timeStamp: '1700000100', from: dex, to: me, value: '1000', contractAddress: '0x9999999999999999999999999999999999999999', tokenSymbol: 'USDT', tokenDecimal: '0', blockNumber: '2' },
      { kind: 'txlist', hash: '0xh3', timeStamp: '1700000200', from: me, to: dex, value: '5', gasPrice: '1000000000', gasUsed: '21000', isError: '1', blockNumber: '3' },
    ]);
    const [swap, spam, failed] = r.transactions;
    expect(swap!.movements).toEqual([
      { direction: 'out', asset: 'ETH', quantity: '1' },
      { direction: 'in', asset: 'USDC', quantity: '2000' },
      { direction: 'fee', asset: 'ETH', quantity: '0.002' },
    ]);
    expect(spam!.movements[0]!.asset).toBe('USDT.999999');
    expect(spam!.hint?.classification).toBe('unknown');
    expect(failed!.movements).toEqual([{ direction: 'fee', asset: 'ETH', quantity: '0.000021' }]);
    expect(failed!.hint?.classification).toBe('network_fee');
  });
});
