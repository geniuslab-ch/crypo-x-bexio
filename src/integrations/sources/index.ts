import { binanceApiConnector } from './binance';
import { bitcoinConnector } from './bitcoin';
import { cardanoConnector } from './cardano';
import { coinbaseApiConnector } from './coinbase';
import { ethereumConnector } from './ethereum';
import { icpConnector } from './icp';
import { krakenApiConnector } from './kraken';
import { solanaConnector } from './solana';
import type { SourceConnector } from './types';

export const CONNECTORS: SourceConnector[] = [krakenApiConnector, coinbaseApiConnector, binanceApiConnector, bitcoinConnector, ethereumConnector, solanaConnector, cardanoConnector, icpConnector];

export function connectorFor(provider: string): SourceConnector | undefined {
  return CONNECTORS.find((c) => c.provider === provider);
}

export { ConnectorError, type SourceConnector } from './types';
