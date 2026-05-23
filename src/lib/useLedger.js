import { useCallback, useMemo } from 'react'
import { createId } from './id'
import { normalizeEntry } from './schema'
import { useStoredSlice } from './store'
import { STORE_PATHS } from './storePaths'

// Income and expense transactions live in separate per-stage slices. The
// combined `entries` view re-attaches a `type` for the UI and CSV layer.
export function useLedger() {
  const [income, setIncome] = useStoredSlice(STORE_PATHS.income.entries, [])
  const [expense, setExpense] = useStoredSlice(STORE_PATHS.expense.entries, [])

  const entries = useMemo(
    () => [
      ...income.map((entry) => ({ ...entry, type: '수입' })),
      ...expense.map((entry) => ({ ...entry, type: '지출' })),
    ],
    [income, expense]
  )

  const addEntry = useCallback(
    (entry) => {
      const next = normalizeEntry({ ...entry, id: createId() })
      if (entry?.type === '수입') setIncome((prev) => [...prev, next])
      else setExpense((prev) => [...prev, next])
    },
    [setIncome, setExpense]
  )

  const updateEntry = useCallback(
    (id, patch) => {
      const apply = (list) => {
        let changed = false
        const next = list.map((entry) => {
          if (entry.id !== id) return entry
          changed = true
          return normalizeEntry({ ...entry, ...patch, id })
        })
        return changed ? next : list
      }
      setIncome(apply)
      setExpense(apply)
    },
    [setIncome, setExpense]
  )

  const removeEntry = useCallback(
    (id) => {
      const drop = (list) => {
        const next = list.filter((entry) => entry.id !== id)
        return next.length === list.length ? list : next
      }
      setIncome(drop)
      setExpense(drop)
    },
    [setIncome, setExpense]
  )

  const replaceAll = useCallback(
    (next) => {
      const list = Array.isArray(next) ? next.filter((entry) => entry && !entry.fixedId) : []
      setIncome(list.filter((entry) => entry.type === '수입').map(normalizeEntry))
      setExpense(list.filter((entry) => entry.type !== '수입').map(normalizeEntry))
    },
    [setIncome, setExpense]
  )

  return { entries, addEntry, updateEntry, removeEntry, replaceAll }
}
