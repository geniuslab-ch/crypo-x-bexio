import { isFiat } from './assets';
import type { Classification, Movement } from './types';

/**
 * DeFi recognition from documented formats only: the public contract addresses that the protocols publish in their
 * own documentation (Ethereum mainnet), and the shape of the movements of one transaction. No guess is ever
 * validated automatically: liquidity and lending operations are proposed with a confidence below the review
 * threshold, so a person confirms them.
 *
 * Accounting treatment applied once confirmed (see engine): a DeFi operation is an exchange of assets at market
 * value, like a swap. Tokens given are disposed of (realised result), tokens received (LP token, aToken, stETH...)
 * are acquired at the same total CHF value. When the received token has no market rate, its value is the value of
 * what was given (valueTransaction, "exchange_implied").
 */
export type DefiKind = 'dex' | 'liquidity' | 'lending' | 'liquid_staking';

export interface DefiProtocol {
  name: string;
  kind: DefiKind;
  /** Where the address is published. */
  doc: string;
}

/** Lower-case contract addresses, Ethereum mainnet. */
export const DEFI_CONTRACTS: Record<string, DefiProtocol> = {
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': { name: 'Uniswap V2 Router', kind: 'dex', doc: 'docs.uniswap.org/contracts/v2/reference/smart-contracts/v2-deployments' },
  '0xe592427a0aece92de3edee1f18e0157c05861564': { name: 'Uniswap V3 SwapRouter', kind: 'dex', doc: 'docs.uniswap.org/contracts/v3/reference/deployments' },
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': { name: 'Uniswap SwapRouter02', kind: 'dex', doc: 'docs.uniswap.org/contracts/v3/reference/deployments' },
  '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': { name: 'Uniswap Universal Router', kind: 'dex', doc: 'docs.uniswap.org/contracts/v3/reference/deployments' },
  '0xc36442b4a4522e871399cd717abdd847ab11fe88': { name: 'Uniswap V3 Positions (NFT)', kind: 'liquidity', doc: 'docs.uniswap.org/contracts/v3/reference/deployments' },
  '0x1111111254eeb25477b68fb85ed929f73a960582': { name: '1inch Router v5', kind: 'dex', doc: 'portal.1inch.dev/documentation/contracts' },
  '0x111111125421ca6dc452d289314280a0f8842a65': { name: '1inch Router v6', kind: 'dex', doc: 'portal.1inch.dev/documentation/contracts' },
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff': { name: '0x Exchange Proxy', kind: 'dex', doc: '0x.org/docs/developer-resources/contract-addresses' },
  '0x9008d19f58aabd9ed0d60971565aa8510560ab41': { name: 'CoW Protocol Settlement', kind: 'dex', doc: 'docs.cow.fi/cow-protocol/reference/contracts/core' },
  '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7': { name: 'Curve 3pool', kind: 'liquidity', doc: 'docs.curve.fi/references/deployed-contracts' },
  '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2': { name: 'Aave V3 Pool', kind: 'lending', doc: 'aave.com/docs/resources/addresses' },
  '0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9': { name: 'Aave V2 LendingPool', kind: 'lending', doc: 'aave.com/docs/resources/addresses' },
  '0xc3d688b66703497daa19211eedff47f25384cdc3': { name: 'Compound V3 cUSDCv3', kind: 'lending', doc: 'docs.compound.finance' },
  '0xae7ab96520de3a18e5e111b5eaab095312d7fe84': { name: 'Lido stETH', kind: 'liquid_staking', doc: 'docs.lido.fi/deployed-contracts' },
};

export function defiProtocol(address: string | null | undefined): DefiProtocol | null {
  return address ? DEFI_CONTRACTS[address.toLowerCase()] ?? null : null;
}

export interface DefiHint { classification: Classification; confidence: number; reason: string; decisive: true }

/** Hint for a transaction sent to a known DeFi contract, from the shape of its movements. */
export function defiHint(protocol: DefiProtocol, movements: Movement[]): DefiHint | null {
  const ins = movements.filter((m) => m.direction === 'in' && !isFiat(m.asset));
  const outs = movements.filter((m) => m.direction === 'out' && !isFiat(m.asset));
  const list = (ms: Movement[]) => ms.map((m) => m.asset).join(' + ');
  if (ins.length === 0 && outs.length === 0) {
    return { classification: 'network_fee', confidence: 0.85, decisive: true, reason: `${protocol.name} : approbation ou interaction sans mouvement de vos actifs, frais de gas` };
  }
  if (ins.length === 0 || outs.length === 0) {
    // One-sided: rewards claimed, or assets sent to the protocol without a receipt token.
    return ins.length
      ? { classification: protocol.kind === 'lending' ? 'lending_interest' : 'unknown', confidence: 0.5, decisive: true, reason: `${protocol.name} : ${list(ins)} reçu sans contrepartie (récompense ou retrait), à vérifier` }
      : { classification: 'unknown', confidence: 0.3, decisive: true, reason: `${protocol.name} : ${list(outs)} envoyé sans contrepartie reçue, à vérifier` };
  }
  if (protocol.kind === 'dex' && ins.length === 1 && outs.length === 1) {
    return { classification: 'swap', confidence: 0.9, decisive: true, reason: `Swap ${outs[0]!.asset} -> ${ins[0]!.asset} via ${protocol.name}` };
  }
  if (protocol.kind === 'liquid_staking') {
    return { classification: 'swap', confidence: 0.85, decisive: true, reason: `${list(outs)} échangé contre ${list(ins)} (${protocol.name}, jeton de staking liquide)` };
  }
  if (protocol.kind === 'lending') {
    return { classification: 'defi', confidence: 0.6, decisive: true, reason: `${protocol.name} : ${list(outs)} -> ${list(ins)} (dépôt ou retrait de prêt, l'écart au retrait est le rendement), à confirmer` };
  }
  return {
    classification: 'liquidity_pool', confidence: 0.6,
    decisive: true, reason: `${protocol.name} : ${outs.length > ins.length ? 'apport' : ins.length > outs.length ? 'retrait' : 'mouvement'} de liquidité, ${list(outs)} -> ${list(ins)}, à confirmer`,
  };
}

/** Classifications booked with the exchange-at-market-value treatment. */
export const DEFI_EXCHANGE_CLASSIFICATIONS: ReadonlySet<Classification> = new Set<Classification>(['defi', 'liquidity_pool']);
