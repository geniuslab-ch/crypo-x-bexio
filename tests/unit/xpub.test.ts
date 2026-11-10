import { describe, expect, it } from 'vitest';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { bitcoinConnector } from '@/integrations/sources/bitcoin';
import { deriveAddress, parseExtendedKey } from '@/integrations/sources/xpub';
import type { FetchContext } from '@/integrations/sources/types';

// Test vectors from BIP-44/49/84 (mnemonic "abandon … about", account 0).
const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const YPUB = 'ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP';
const XPUB = 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('extended public keys', () => {
  it('derives the BIP-84, BIP-49 and BIP-44 reference addresses', () => {
    expect(deriveAddress(parseExtendedKey(ZPUB), 'p2wpkh', 0, 0)).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    expect(deriveAddress(parseExtendedKey(ZPUB), 'p2wpkh', 1, 0)).toBe('bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el');
    expect(deriveAddress(parseExtendedKey(YPUB), 'p2sh-p2wpkh', 0, 0)).toBe('37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf');
    expect(deriveAddress(parseExtendedKey(XPUB), 'p2pkh', 0, 0)).toBe('1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA');
  });

  it('matches keys derived from the seed', () => {
    const root = HDKey.fromMasterSeed(mnemonicToSeedSync(MNEMONIC));
    expect(parseExtendedKey(ZPUB).publicKey).toEqual(root.derive("m/84'/0'/0'").publicKey);
  });

  it('refuses private keys', async () => {
    const xprv = HDKey.fromMasterSeed(mnemonicToSeedSync(MNEMONIC)).derive("m/84'/0'/0'").privateExtendedKey;
    await expect(bitcoinConnector.verify({ addresses: xprv }, {} as FetchContext)).rejects.toThrow('private_key_refused');
  });

  it('discovers used addresses up to the gap limit and reads their history', async () => {
    const key = parseExtendedKey(ZPUB);
    const used = new Set([deriveAddress(key, 'p2wpkh', 0, 0), deriveAddress(key, 'p2wpkh', 0, 3), deriveAddress(key, 'p2wpkh', 1, 0)]);
    const asked: string[] = [];
    const clock = { t: 0 };
    const fx: FetchContext = {
      fetch: (async (url: string) => {
        clock.t += 100;
        const u = String(url);
        const m = /address\/([^/]+)(\/txs\/chain)?/.exec(u)!;
        if (!m[2]) { asked.push(m[1]!); return new Response(JSON.stringify({ chain_stats: { tx_count: used.has(m[1]!) ? 1 : 0 } })); }
        return new Response(JSON.stringify(used.has(m[1]!) ? [{ txid: `t-${m[1]}`, fee: 100, vin: [{ prevout: { scriptpubkey_address: 'bc1qsomeoneelse0000000000000000000000000', value: 10_100 } }], vout: [{ scriptpubkey_address: m[1], value: 10_000 }], status: { confirmed: true, block_time: 1_700_000_000 } }] : []));
      }) as typeof fetch,
      deadline: 10_000_000, now: () => clock.t, sleep: async (ms) => { clock.t += ms; }, env: {},
    };
    const r = await bitcoinConnector.sync({ addresses: ZPUB }, {}, fx);
    expect(r.complete).toBe(true);
    expect(asked.length).toBe(24 + 21); // receive: index 0..23 (last used 3 + 20), change: 0..20
    expect(r.transactions).toHaveLength(3);
    expect(r.transactions.every((t) => t.movements[0]!.direction === 'in')).toBe(true);
  });
});
