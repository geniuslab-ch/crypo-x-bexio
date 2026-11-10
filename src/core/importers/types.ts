import type { ParseResult, SupportLevel } from '../types';

export interface Importer {
  /** Stable id stored with every import batch. */
  id: string;
  /** Bumped whenever parsing behaviour changes, so past imports stay traceable. */
  version: number;
  provider: string;
  label: string;
  support: SupportLevel;
  /** Shown to the user next to the support level. */
  supportNote: string;
  /** Returns true if the file's header row matches this parser. */
  detect(text: string): boolean;
  parse(text: string): ParseResult;
}
