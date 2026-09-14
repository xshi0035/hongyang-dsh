/**
 * Spreadsheet reading shared by every importer: SheetJS for `.xls`/`.xlsx`,
 * GBK-aware CSV decoding for the WeChat statements, Excel serial dates, and
 * the cell coercions the client's files need. Importers never touch SheetJS
 * directly; they receive plain row arrays.
 * @module @deepseek-ai/dsh-hy-finance/provider/import/read-sheet
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import iconv from 'iconv-lite'
import * as XLSX from 'xlsx'
import { FinanceError } from '../../service/errors.ts'

/** A sheet as arrays of cell values; `null` for blanks. */
export type Row = readonly (string | number | boolean | null)[]

/** One workbook reduced to named sheets of rows. */
export interface Workbook {
  readonly file: string
  readonly sha256: string
  readonly sheets: ReadonlyMap<string, readonly Row[]>
}

/**
 * Read a workbook or CSV file. CSVs are decoded as UTF-8 when valid, else GBK
 * (the WeChat merchant platform exports GBK); a single sheet named `csv`.
 * @param file - absolute path.
 * @returns the reduced workbook plus the file's SHA-256.
 * @throws {FinanceError} `FILE_NOT_FOUND` / `UNSUPPORTED_FILE`.
 */
export async function readWorkbook(file: string): Promise<Workbook> {
  let buffer: Buffer
  try {
    buffer = await readFile(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new FinanceError('FILE_NOT_FOUND', `file not found: ${file}`)
    throw error
  }
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const ext = extname(file).toLowerCase()
  let wb: XLSX.WorkBook
  if (ext === '.csv' || ext === '.txt') {
    wb = XLSX.read(decodeText(buffer), { type: 'string', raw: true })
    wb.SheetNames = ['csv']
    const only = Object.values(wb.Sheets)[0]
    if (only === undefined) throw new FinanceError('UNSUPPORTED_FILE', `empty csv: ${file}`)
    wb.Sheets = { csv: only }
  } else if (ext === '.xls' || ext === '.xlsx' || ext === '.xlsm') {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: true })
  } else {
    throw new FinanceError('UNSUPPORTED_FILE', `unsupported file type ${ext}: ${file}`)
  }
  const sheets = new Map<string, Row[]>()
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (ws === undefined) continue
    const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(
      ws, { header: 1, raw: true, defval: null, blankrows: false },
    )
    sheets.set(name, rows.map(row => row.map(cleanCell)))
  }
  return { file, sha256, sheets }
}

function decodeText(buffer: Buffer): string {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) return buffer.subarray(3).toString('utf8')
  const utf8 = buffer.toString('utf8')
  if (!utf8.includes('�')) return utf8
  return iconv.decode(buffer, 'gbk')
}

/** Strip the WeChat export's leading backtick and surrounding whitespace. */
function cleanCell(value: Row[number] | undefined): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'boolean') return value
  const text = value.replace(/^`/, '').trim()
  return text.length === 0 ? null : text
}

/**
 * Locate the header row: the first row whose cells include every required label.
 * @param rows - sheet rows.
 * @param required - labels that must all be present (after trimming and newline removal).
 * @returns the row index and a label → column index map.
 * @throws {FinanceError} `SHEET_NOT_FOUND` when no row qualifies.
 */
export function findHeader(rows: readonly Row[], required: readonly string[]): { index: number; columns: Map<string, number> } {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const row = rows[i]
    if (row === undefined) continue
    const columns = new Map<string, number>()
    row.forEach((cell, col) => {
      if (typeof cell === 'string') columns.set(normalizeLabel(cell), col)
    })
    if (required.every(label => columns.has(normalizeLabel(label)))) return { index: i, columns }
  }
  throw new FinanceError('SHEET_NOT_FOUND', `header with columns ${required.join(', ')} not found`)
}

/**
 * Collapse whitespace and newlines inside a header label.
 * @param label - Column heading to normalize and look up.
 * @returns Normalized heading for lookup.
 */
export function normalizeLabel(label: string): string {
  return label.replace(/\s+/g, '')
}

/**
 * Read a cell by header label, with the label normalized the same way.
 * @param row - Decoded worksheet row.
 * @param columns - Normalized heading-to-column-index map.
 * @param label - Column heading to normalize and look up.
 * @returns The cell value, or null when absent.
 */
export function cell(row: Row, columns: Map<string, number>, label: string): string | number | boolean | null {
  const col = columns.get(normalizeLabel(label))
  if (col === undefined) return null
  return row[col] ?? null
}

/**
 * Cell as trimmed text; blanks and nulls become the empty string.
 * @param row - Decoded worksheet row.
 * @param columns - Normalized heading-to-column-index map.
 * @param label - Column heading to normalize and look up.
 * @returns Trimmed cell text, with an empty string for blanks.
 */
export function text(row: Row, columns: Map<string, number>, label: string): string {
  const value = cell(row, columns, label)
  if (value === null) return ''
  return typeof value === 'number' ? String(value) : String(value).trim()
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)

/**
 * Convert an Excel serial or a date-like string to ISO `YYYY-MM-DD`.
 * @param value - `46113`, `2026-04-01 00:00`, `2026/4/1`, `20260401`, `2026.4.1`.
 * @returns the ISO date, or `undefined` when unparseable.
 */
export function isoDate(value: string | number | boolean | null): string | undefined {
  if (value === null || typeof value === 'boolean') return undefined
  if (typeof value === 'number') {
    if (value > 20000000 && value < 21000000) return isoDate(String(value))
    if (value < 20000 || value > 80000) return undefined
    const date = new Date(EXCEL_EPOCH_MS + Math.floor(value) * 86_400_000)
    return date.toISOString().slice(0, 10)
  }
  const s = value.trim()
  let m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(s)
  if (m === null) m = /^(\d{4})(\d{2})(\d{2})/.exec(s)
  if (m === null) return undefined
  const [, y, mo, d] = m
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Convert a date-time cell to `YYYY-MM-DD HH:mm:ss`.
 * @param value - `20260401 14:48:05`, `2026-04-01 12:18:00`, an Excel serial with fraction.
 * @returns the timestamp, or `undefined`.
 */
export function isoDateTime(value: string | number | boolean | null): string | undefined {
  if (value === null || typeof value === 'boolean') return undefined
  if (typeof value === 'number') {
    if (value < 20000 || value > 80000) return isoDateTime(String(value))
    const date = new Date(EXCEL_EPOCH_MS + Math.round(value * 86_400_000))
    return date.toISOString().slice(0, 19).replace('T', ' ')
  }
  const s = value.trim()
  const date = isoDate(s)
  if (date === undefined) return undefined
  const time = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s.slice(8))
  if (time === null) return `${date} 00:00:00`
  const [, h, mi, sec] = time
  return `${date} ${String(h).padStart(2, '0')}:${mi}:${sec ?? '00'}`
}

/**
 * Parse a `2025-07-01~2025-07-31` style period.
 * @param value - the cell text.
 * @returns start and end ISO dates, or `undefined`s.
 */
export function periodRange(value: string): { start: string | undefined; end: string | undefined } {
  const parts = value.split(/[~～至]/)
  return { start: isoDate(parts[0] ?? null), end: isoDate(parts[1] ?? null) }
}

/**
 * First day of the month of an ISO date, used as the accounting period key.
 * @param iso - `YYYY-MM-DD`.
 * @returns `YYYY-MM-01`.
 */
export function monthOf(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}
