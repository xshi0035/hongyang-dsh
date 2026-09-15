/**
 * SQLite schema and open sequence for the finance database. Mirrors the
 * repository's `storage-sqlite` open sequence (owner-only file, WAL, foreign
 * keys, `PRAGMA user_version` stamped last) because each package owns its
 * own database identity. Unknown versions reject; known adjacent versions
 * migrate transactionally while preserving existing financial records.
 * @module @deepseek-ai/dsh-hy-finance/provider/db/schema
 */

import { DatabaseSync } from 'node:sqlite'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { FinanceError } from '../../service/errors.ts'

/** Physical layout version stored in `PRAGMA user_version`. */
export const HY_FINANCE_SCHEMA_VERSION = 5

/** `PRAGMA application_id` marking a file as this package's database. */
const APPLICATION_ID = 0x48594649 // "HYFI"

async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await open(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/**
 * Open (creating when missing) the finance database and ensure its tables.
 * @param path - absolute file path, or `:memory:` for tests.
 * @returns the open handle.
 * @throws {FinanceError} `DB_VERSION_MISMATCH` when the file carries another version or application id.
 */
export async function openFinanceDatabase(path: string): Promise<DatabaseSync> {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    await createDatabaseFile(actual)
  }
  const db = new DatabaseSync(actual)
  try {
    configure(db, actual)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

function configure(db: DatabaseSync, path: string): void {
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA journal_mode = WAL')
  const { application_id: appId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (version !== 0 && (![2, 3, 4, HY_FINANCE_SCHEMA_VERSION].includes(version) || appId !== APPLICATION_ID)) {
    throw new FinanceError(
      'DB_VERSION_MISMATCH',
      `finance database at "${path}" has schema version ${String(version)} (app ${String(appId)}), this build expects ${String(HY_FINANCE_SCHEMA_VERSION)}`,
    )
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(SCHEMA)
    if (version !== HY_FINANCE_SCHEMA_VERSION) {
      db.exec(`PRAGMA application_id = ${String(APPLICATION_ID)}`)
      db.exec(`PRAGMA user_version = ${String(HY_FINANCE_SCHEMA_VERSION)}`)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Table layout. Amounts are integer cents; dates ISO text. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS payment_review_allocation (
  submission_id TEXT PRIMARY KEY REFERENCES payment_submission(id),
  review_json TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS payment_reversal (
  original_id TEXT PRIMARY KEY REFERENCES "transaction"(id),
  reversal_id TEXT NOT NULL UNIQUE REFERENCES "transaction"(id),
  request_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS voucher_void (
  voucher_id TEXT PRIMARY KEY REFERENCES voucher(id),
  reason TEXT NOT NULL,
  at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS voucher_receipt (
  receipt_id TEXT PRIMARY KEY,
  voucher_id TEXT NOT NULL REFERENCES voucher(id),
  date TEXT NOT NULL,
  fingerprint TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS allocation_revision (
  request_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS payment_submission (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL UNIQUE,
  submitted_at TEXT NOT NULL,
  submitter TEXT NOT NULL,
  shop_no TEXT NOT NULL,
  merchant_name TEXT NOT NULL,
  summary TEXT NOT NULL,
  text TEXT NOT NULL,
  image TEXT,
  payment_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
  decided_at TEXT,
  transaction_id TEXT REFERENCES "transaction"(id)
) STRICT;
CREATE INDEX IF NOT EXISTS payment_submission_pending ON payment_submission(status, submitted_at);

CREATE TABLE IF NOT EXISTS import_batch (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  file TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  rows INTEGER NOT NULL,
  imported_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS import_batch_sha ON import_batch(sha256);

CREATE TABLE IF NOT EXISTS merchant (
  id TEXT PRIMARY KEY,
  shop_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  floor TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX IF NOT EXISTS merchant_name ON merchant(name);
CREATE INDEX IF NOT EXISTS merchant_brand ON merchant(brand);

CREATE TABLE IF NOT EXISTS receivable (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchant(id),
  fee_type TEXT NOT NULL,
  period TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  due_date TEXT,
  amount_due INTEGER NOT NULL,
  amount_relief INTEGER NOT NULL DEFAULT 0,
  amount_received INTEGER NOT NULL DEFAULT 0,
  amount_unpaid INTEGER NOT NULL DEFAULT 0,
  source_row TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX IF NOT EXISTS receivable_merchant ON receivable(merchant_id, fee_type);

CREATE TABLE IF NOT EXISTS payer_mapping (
  payer_name TEXT NOT NULL,
  payer_account TEXT NOT NULL DEFAULT '',
  merchant_id TEXT NOT NULL REFERENCES merchant(id),
  confirmed INTEGER NOT NULL DEFAULT 0,
  learned_at TEXT NOT NULL,
  PRIMARY KEY (payer_name, payer_account)
) STRICT;

CREATE TABLE IF NOT EXISTS "transaction" (
  id TEXT PRIMARY KEY,
  batch_id TEXT REFERENCES import_batch(id),
  source TEXT NOT NULL,
  channel TEXT NOT NULL,
  txn_time TEXT NOT NULL,
  amount INTEGER NOT NULL,
  payer_name TEXT NOT NULL DEFAULT '',
  payer_account TEXT NOT NULL DEFAULT '',
  remark TEXT NOT NULL DEFAULT '',
  txn_no TEXT NOT NULL DEFAULT '',
  parent_id TEXT REFERENCES "transaction"(id),
  status TEXT NOT NULL,
  merchant_id TEXT REFERENCES merchant(id),
  confidence REAL NOT NULL DEFAULT 0,
  raw TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX IF NOT EXISTS transaction_time ON "transaction"(txn_time);
CREATE INDEX IF NOT EXISTS transaction_status ON "transaction"(status);
CREATE UNIQUE INDEX IF NOT EXISTS transaction_txn_no ON "transaction"(source, txn_no) WHERE txn_no <> '';

CREATE TABLE IF NOT EXISTS platform_txn (
  id TEXT PRIMARY KEY,
  transaction_id TEXT REFERENCES "transaction"(id),
  platform TEXT NOT NULL,
  merchant_account TEXT NOT NULL,
  order_no TEXT NOT NULL,
  txn_time TEXT NOT NULL,
  amount INTEGER NOT NULL,
  fee INTEGER NOT NULL DEFAULT 0,
  net INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  merchant_hint TEXT NOT NULL DEFAULT '',
  shop_no TEXT,
  merchant_id TEXT REFERENCES merchant(id),
  UNIQUE (platform, merchant_account, order_no)
) STRICT;
CREATE INDEX IF NOT EXISTS platform_txn_time ON platform_txn(platform, merchant_account, txn_time);

CREATE TABLE IF NOT EXISTS allocation (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES "transaction"(id),
  platform_txn_id TEXT REFERENCES platform_txn(id),
  merchant_id TEXT REFERENCES merchant(id),
  receivable_id TEXT REFERENCES receivable(id),
  fee_type TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  amount_incl_tax INTEGER NOT NULL,
  tax_rate REAL NOT NULL,
  tax_amount INTEGER NOT NULL,
  origin TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS allocation_txn ON allocation(transaction_id);
CREATE INDEX IF NOT EXISTS allocation_merchant ON allocation(merchant_id, fee_type);
CREATE INDEX IF NOT EXISTS allocation_receivable ON allocation(receivable_id);

CREATE TABLE IF NOT EXISTS ledger_row (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES import_batch(id),
  date TEXT NOT NULL,
  shop_no TEXT NOT NULL DEFAULT '',
  merchant_name TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  subtotal INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  period_start TEXT,
  period_end TEXT,
  amounts TEXT NOT NULL,
  remark TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX IF NOT EXISTS ledger_row_date ON ledger_row(date);

CREATE TABLE IF NOT EXISTS voucher_row (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES import_batch(id),
  date TEXT NOT NULL,
  voucher_no INTEGER NOT NULL,
  line_no INTEGER NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  subject_name TEXT NOT NULL DEFAULT '',
  debit INTEGER NOT NULL DEFAULT 0,
  credit INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX IF NOT EXISTS voucher_row_date ON voucher_row(date, voucher_no);

CREATE TABLE IF NOT EXISTS daily_report (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  built_at TEXT NOT NULL,
  rows_json TEXT NOT NULL,
  xlsx_path TEXT,
  compare_json TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS voucher (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  built_at TEXT NOT NULL,
  lines_json TEXT NOT NULL,
  checks_json TEXT NOT NULL,
  xlsx_path TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  day TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  amount INTEGER,
  detail TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX IF NOT EXISTS activity_log_day ON activity_log(day, at);
`
