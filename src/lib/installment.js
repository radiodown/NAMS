export const INSTALLMENT_CATEGORY = '할부'

export function isInstallmentCategory(value) {
  return String(value || '').replace(/\s+/g, '') === INSTALLMENT_CATEGORY
}

// Whole days from today to `dateStr` (YYYY-MM-DD). null if unset/invalid.
export function daysUntilInstallmentDue(dateStr) {
  if (!dateStr) return null
  const target = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((target - now) / 86400000)
}
