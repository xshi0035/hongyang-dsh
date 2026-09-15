/** Receipt dates used by reports and vouchers; bank arrival timestamps remain unchanged. */

/** Resolve an explicitly stated parking business day, otherwise the receipt day.
 * @param time - Original receipt or platform timestamp.
 * @param channel - Imported bank channel.
 * @param remark - Original bank remark.
 * @returns ISO reporting day and whether the parking business day supplied it.
 */
export function receiptDate(time: string, channel: string, remark: string): { date: string; businessDay: boolean } {
  const match = channel === 'parking' ? /@(\d{4})(\d{2})(\d{2})#停车费/u.exec(remark) : null
  if (match !== null) {
    const date = `${match[1]}-${match[2]}-${match[3]}`
    const instant = new Date(`${date}T00:00:00Z`)
    if (!Number.isNaN(instant.getTime()) && instant.toISOString().slice(0, 10) === date) return { date, businessDay: true }
  }
  return { date: time.slice(0, 10), businessDay: false }
}
