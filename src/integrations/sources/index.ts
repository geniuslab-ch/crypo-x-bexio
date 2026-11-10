import { binanceApiConnector } from './binance';
import { bitcoinConnector } from './bitcoin';
import { coinbaseApiConnector } from './coinbase';
import { ethereumConnector } from './ethereum';
import { krakenApiConnector } from './kraken';
import type { SourceConnector } from './types';

export const CONNECTORS: SourceConnector[] = [krakenApiConnector, coinbaseApiConnector, binanceApiConnector, bitcoinConnector, ethereumConnector];

export function connectorFor(provider: string): SourceConnector | undefined {
  return CONNECTORS.find((c) => c.provider === provider);
}

export { ConnectorError, type SourceConnector } from './types';
