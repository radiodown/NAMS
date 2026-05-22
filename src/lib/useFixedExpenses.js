import { useCallback } from 'react'
import { createId } from './id'
import { normalizeRecord, normalizeTemplate } from './schema'
import { fixedExpenseEntriesForMonth } from './fixedExpenseEntries'
import { usePersistentState } from './store'

const MONTH_RE = /^\d{4}-\d{2}$/

function recordsForMonth(items, month, paymentMethods) {
  return fixedExpenseEntriesForMonth(items, month, paymentMethods).map((entry) =>
    normalizeRecord({
      id: `fixed-record-${entry.fixedId || createId()}-${month}`,
      month,
      sourceId: entry.fixedId,
      name: entry.memo,
      category: entry.category,
      amount: entry.amount,
      day: entry.date?.slice(8),
      color: entry.color,
      paymentMethodId: entry.paymentMethodId,
      paymentMethod: entry.paymentMethod,
      loanMethod: entry.loanMethod,
      loanPrincipal: entry.loanPrincipal,
      loanRate: entry.loanRate,
      loanMonths: entry.loanMonths,
      loanRound: entry.loanRound,
      loanGraceMonths: entry.loanGraceMonths,
    })
  )
}

// Recurring expense templates (rent, subscriptions, ...) plus the finalized
// monthly snapshots ("records") kept once a month rolls over.
export function useFixedExpenses() {
  const [items, setItems] = usePersistentState('stages.expense.fixed.templates', [])
  const [records, setRecords] = usePersistentState('stages.expense.fixed.records', [])
  const [closedMonths, setClosedMonths] = usePersistentState(
    'stages.expense.fixed.closedMonths',
    []
  )
  const [lastActiveMonth, setLastActiveMonth] = usePersistentState(
    'stages.expense.fixed.lastActiveMonth',
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
    (month, paymentMethods = []) => {
      if (!MONTH_RE.test(String(month || ''))) return
      if (closedMonths.includes(month)) return
      setRecords((prev) =>
        prev.some((record) => record.month === month)
          ? prev
          : [...prev, ...recordsForMonth(items, month, paymentMethods)]
      )
      setClosedMonths((prev) => (prev.includes(month) ? prev : [...prev, month].sort()))
    },
    [closedMonths, items, setRecords, setClosedMonths]
  )

  const replaceRecords = useCallback(
    (next) => {
      const list = Array.isArray(next)
        ? next.map(normalizeRecord).filter((record) => record.month)
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
