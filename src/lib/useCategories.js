import { useCallback, useMemo } from 'react'
import { defaultCategories, uniqueList } from './schema'
import { usePersistentState } from './store'

// Per-stage category lists. They power autocomplete only — users can still
// type any custom category on an entry.
export function useCategories() {
  const [income, setIncome] = usePersistentState('stages.income.categories', () =>
    defaultCategories('수입')
  )
  const [expense, setExpense] = usePersistentState('stages.expense.categories', () =>
    defaultCategories('지출')
  )

  const categories = useMemo(() => ({ 수입: income, 지출: expense }), [income, expense])

  const setterFor = useCallback(
    (type) => (type === '수입' ? setIncome : type === '지출' ? setExpense : null),
    [setIncome, setExpense]
  )

  const addCategory = useCallback(
    (type, name) => {
      const next = String(name || '').trim()
      const setter = setterFor(type)
      if (!next || !setter) return false
      setter((prev) => uniqueList([...(prev || []), next]))
      return true
    },
    [setterFor]
  )

  const updateCategory = useCallback(
    (type, oldName, nextName) => {
      const from = String(oldName || '').trim()
      const to = String(nextName || '').trim()
      const setter = setterFor(type)
      if (!from || !to || !setter) return false
      setter((prev) => uniqueList((prev || []).map((c) => (c === from ? to : c))))
      return true
    },
    [setterFor]
  )

  const removeCategory = useCallback(
    (type, name) => {
      const target = String(name || '').trim()
      const setter = setterFor(type)
      if (!target || !setter) return false
      setter((prev) => (prev || []).filter((c) => c !== target))
      return true
    },
    [setterFor]
  )

  return { categories, addCategory, updateCategory, removeCategory }
}
