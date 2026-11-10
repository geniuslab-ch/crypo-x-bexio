import { HDKey } from '@scure/bip32';
import { bech32, createBase58check } from '@scure/base';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Derives the public receive/change addresses of a wallet from its extended PUBLIC key (xpub/ypub/zpub).
 * An extended public key cannot spend funds; private keys (xprv…) and seed phrases are refused.
 * Version bytes from SLIP-0132; address formats from BIP-44 (P2PKH), BIP-49 (P2SH-P2WPKH), BIP-84 (P2WPKH).
 */
export type AddressType = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh';

const VERSIONS: Record<string, { public: number; private: number; types: AddressType[] }> = {
  xpub: { public: 0x0488b21e, private: 0x0488ade4, types: ['p2wpkh', 'p2sh-p2wpkh', 'p2pkh'] },
  ypub: { public: 0x049d7cb2, private: 0x049d7878, types: ['p2sh-p2wpkh'] },
  zpub: { public: 0x04b24746, private: 0x04b2430c, types: ['p2wpkh'] },
};

const b58c = createBase58check(sha256);
const hash160 = (b: Uint8Array) => ripemd160(sha256(b));

export function isExtendedPublicKey(s: string): boolean {
  return /^[xyz]pub[1-9A-HJ-NP-Za-km-z]{100,112}$/.test(s);
}

export function isExtendedPrivateKey(s: string): boolean {
  return /^[xyzXYZtuvTUV]prv[1-9A-HJ-NP-Za-km-z]{100,112}$/.test(s);
}

/** Address types to scan for this key. A plain "xpub" does not say which script the wallet uses, so all three are scanned. */
export function addressTypesFor(xpub: string): AddressType[] {
  return VERSIONS[xpub.slice(0, 4)]?.types ?? [];
}

export function parseExtendedKey(xpub: string): HDKey {
  const v = VERSIONS[xpub.slice(0, 4)];
  if (!v) throw new Error('unsupported extended key');
  const key = HDKey.fromExtendedKey(xpub, { public: v.public, private: v.private });
  if (key.privateKey) throw new Error('private key refused');
  return key;
}

function encode(pub: Uint8Array, type: AddressType): string {
  const h = hash160(pub);
  if (type === 'p2wpkh') return bech32.encode('bc', [0, ...bech32.toWords(h)]);
  if (type === 'p2sh-p2wpkh') {
    const redeem = new Uint8Array([0x00, 0x14, ...h]);
    return b58c.encode(new Uint8Array([0x05, ...hash160(redeem)]));
  }
  return b58c.encode(new Uint8Array([0x00, ...h]));
}

/** Address at <account key>/chain/index (chain 0 = receive, 1 = change). */
export function deriveAddress(key: HDKey, type: AddressType, chain: 0 | 1, index: number): string {
  const child = key.deriveChild(chain).deriveChild(index);
  if (!child.publicKey) throw new Error('derivation failed');
  return encode(child.publicKey, type);
}
