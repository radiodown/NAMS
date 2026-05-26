import { useCallback } from 'react'
import { createId } from './id'
import { normalizeIncomeRecord, normalizeTemplate } from './schema'
import { fixedIncomeEntriesForMonth } from './fixedExpenseEntries'
import { useStoredSlice } from './store'
import { STORE_PATHS } from './storePaths'

const MONTH_RE = /^\d{4}-\d{2}$/

function recordsForMonth(items, month) {
  return fixedIncomeEntriesForMonth(items, month).map((entry) =>
    normalizeIncomeRecord({
      id: `fixed-income-record-${entry.fixedId || createId()}-${month}`,
      month,
      sourceId: entry.fixedId,
      name: entry.memo,
      category: entry.category,
      amount: entry.amount,
      day: entry.date?.slice(8),
      color: entry.color,
    })
  )
}

// Recurring income templates (salary, allowance, rent income, ...) plus
// finalized monthly snapshots kept once a month rolls over.
export function useFixedIncomes() {
  const [items, setItems] = useStoredSlice(STORE_PATHS.income.fixedTemplates, [])
  const [records, setRecords] = useStoredSlice(STORE_PATHS.income.fixedRecords, [])
  const [closedMonths, setClosedMonths] = useStoredSlice(
    STORE_PATHS.income.fixedClosedMonths,
    []
  )
  const [lastActiveMonth, setLastActiveMonth] = useStoredSlice(
    STORE_PATHS.income.fixedLastActiveMonth,
    ''
  )

  const addItem = useCallback(
    (item) => {
      const next = normalizeTemplate({ ...item, id: createId() })
      setItems((prev) => [...prev, next])
      return next
    },
    [setItems]
  )

  const updateItem = useCallback(
    (id, patch) => {
      setItems((prev) =>
        prev.map((it) => (it.id === id ? normalizeTemplate({ ...it, ...patch, id }) : it))
      )
    },
    [setItems]
  )

  const removeItem = useCallback(
    (id) => {
      setItems((prev) => prev.filter((it) => it.id !== id))
    },
    [setItems]
  )

  const replaceAll = useCallback(
    (next) => {
      setItems(Array.isArray(next) ? next.map(normalizeTemplate) : [])
    },
    [setItems]
  )

  const recordMonth = useCallback(
    (month) => {
      if (!MONTH_RE.test(String(month || ''))) return
      if (closedMonths.includes(month)) return
      setRecords((prev) =>
        prev.some((record) => record.month === month)
          ? prev
          : [...prev, ...recordsForMonth(items, month)]
      )
      setClosedMonths((prev) => (prev.includes(month) ? prev : [...prev, month].sort()))
    },
    [closedMonths, items, setRecords, setClosedMonths]
  )

  const replaceRecords = useCallback(
    (next) => {
      const list = Array.isArray(next)
        ? next.map(normalizeIncomeRecord).filter((record) => record.month)
        : []
      setRecords(list)
      setClosedMonths([...new Set(list.map((record) => record.month))].sort())
    },
    [setRecords, setClosedMonths]
  )

  return {
    items,
    records,
    closedMonths,
    lastActiveMonth,
    addItem,
    updateItem,
    removeItem,
    replaceAll,
    recordMonth,
    replaceRecords,
    setLastActiveMonth,
  }
}
