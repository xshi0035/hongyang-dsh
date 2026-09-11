/**
 * Plugin configuration for the Hongyang finance assistant. Every deployment-
 * varying choice lives here so the cordis.yml row and the settings card can
 * change it; business rules that are fixed by the client's chart of accounts
 * live in `rules/`.
 * @module @deepseek-ai/dsh-hy-finance/config
 */

import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** Settings namespace shared by the Host section and the browser card. */
export const HY_FINANCE_NS = 'hy-finance'

/** Raw configuration as validated by the schema. */
export interface Config {
  /** SQLite file for the finance database; empty selects `$DSH_HOME/hongyang/finance.db`. */
  dbPath: string
  /** Whether review cards open expanded in the conversation. */
  autoOpenCards: boolean
  /** Amount tolerance, in cents, when comparing generated rows with the client's ledger. */
  compareToleranceCents: number
  /** Output-VAT ledger account for 13% items (electricity); empty means still unconfirmed with the client. */
  outputTaxSubject13: string
  /** Output-VAT ledger account for 3% items (water); empty means still unconfirmed with the client. */
  outputTaxSubject3: string
  /** Legal entity that receives every payment; used to validate payment screenshots. */
  companyName: string
}

/** Schemastery schema; defaults describe the demo deployment. */
export const Config: z<Config> = z.object({
  dbPath: z.string().default(''),
  autoOpenCards: z.boolean().default(true),
  compareToleranceCents: z.number().step(1).min(0).default(1),
  outputTaxSubject13: z.string().default(''),
  outputTaxSubject3: z.string().default(''),
  companyName: z.string().default('衡阳诚远商业管理有限公司'),
})

/** Configuration after explicit defaulting: the database path is always absolute. */
export interface ResolvedConfig extends Config {
  dbPath: string
}

/**
 * Resolve the raw configuration into the values the provider runs with.
 * @param config - validated raw configuration.
 * @returns the same fields with an absolute database path.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    ...config,
    dbPath: config.dbPath.trim().length > 0 ? config.dbPath : dshHomePath('hongyang', 'finance.db'),
  }
}
