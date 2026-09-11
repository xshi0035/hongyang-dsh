/**
 * Finance Service Definition and Provider in one class: `ctx.hyFinance`. Owns
 * the SQLite handle for the plugin's lifetime and exposes the domain
 * operations the tools, the DingTalk bridge, and the HTTP routes consume.
 * The provider modules under `provider/` implement each operation against the
 * handle this class owns; nothing else opens the database.
 * @module @deepseek-ai/dsh-hy-finance/service/finance-service
 */

import type { DatabaseSync } from 'node:sqlite'
import { Context, Service } from '@deepseek-ai/cordis'
import { resolveConfig, type Config, type ResolvedConfig } from '../config.ts'
import { openFinanceDatabase } from '../provider/db/schema.ts'
import type { FinanceCounts } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Hongyang finance domain: master data, receipts, claims, reports, vouchers. */
    hyFinance: HyFinanceService
  }
}

/**
 * The finance domain service. Constructed by the root plugin; the database
 * opens during `[Service.init]` and closes with the fiber.
 */
export class HyFinanceService extends Service {
  /** Resolved plugin configuration; replaced when the settings section changes. */
  config: ResolvedConfig
  private handle: DatabaseSync | undefined

  /**
   * @param ctx - owning context.
   * @param config - validated plugin configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'hyFinance')
    this.config = resolveConfig(config)
  }

  /** Open the database and register its disposal. */
  protected async [Service.init](): Promise<void> {
    const db = await openFinanceDatabase(this.config.dbPath)
    this.handle = db
    this.ctx.effect(() => () => {
      db.close()
      this.handle = undefined
    }, 'hy-finance: close database')
  }

  /**
   * The open database. Provider modules borrow it for one operation at a time.
   * @returns the handle.
   * @throws when called before init or after disposal.
   */
  db(): DatabaseSync {
    if (this.handle === undefined) throw new Error('hy-finance: database is not open')
    return this.handle
  }

  /**
   * Replace the live configuration (settings section change).
   * @param config - the new validated configuration.
   */
  reconfigure(config: Config): void {
    this.config = resolveConfig(config)
  }

  /**
   * Row counts across the main tables.
   * @returns the counts.
   */
  counts(): FinanceCounts {
    const db = this.db()
    const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n
    return {
      batches: count('SELECT COUNT(*) AS n FROM import_batch'),
      merchants: count('SELECT COUNT(*) AS n FROM merchant'),
      receivables: count('SELECT COUNT(*) AS n FROM receivable'),
      transactions: count('SELECT COUNT(*) AS n FROM "transaction"'),
      pending: count('SELECT COUNT(*) AS n FROM "transaction" WHERE status = \'pending\''),
      platformTxns: count('SELECT COUNT(*) AS n FROM platform_txn'),
      allocations: count('SELECT COUNT(*) AS n FROM allocation'),
    }
  }
}
