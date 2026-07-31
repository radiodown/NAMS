import { useCallback, useMemo } from 'react'
import { normalizeCategoryIcon } from './categoryPresentation'
import { defaultCategories, uniqueList } from './schema'
import { useStoredSlice } from './store'
import { STORE_PATHS } from './storePaths'

// Per-stage category lists. They power autocomplete only — users can still
// type any custom category on an entry.
export function useCategories() {
  const [income, setIncome] = useStoredSlice(STORE_PATHS.income.categories, () =>
    defaultCategories('수입')
  )
  const [expense, setExpense] = useStoredSlice(STORE_PATHS.expense.categories, () =>
    defaultCategories('지출')
  )
  const [incomeIcons, setIncomeIcons] = useStoredSlice(STORE_PATHS.income.categoryIcons, {})
  const [expenseIcons, setExpenseIcons] = useStoredSlice(STORE_PATHS.expense.categoryIcons, {})

  const categories = useMemo(() => ({ 수입: income, 지출: expense }), [income, expense])
  const icons = useMemo(
    () => ({ 수입: incomeIcons || {}, 지출: expenseIcons || {} }),
    [expenseIcons, incomeIcons]
  )

  const setterFor = useCallback(
    (type) => (type === '수입' ? setIncome : type === '지출' ? setExpense : null),
    [setIncome, setExpense]
  )
  const iconSetterFor = useCallback(
    (type) => (type === '수입' ? setIncomeIcons : type === '지출' ? setExpenseIcons : null),
    [setExpenseIcons, setIncomeIcons]
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
      const iconSetter = iconSetterFor(type)
      if (!from || !to || !setter || !iconSetter) return false
      setter((prev) => uniqueList((prev || []).map((c) => (c === from ? to : c))))
      if (from !== to) {
        iconSetter((prev) => {
          const next = { ...(prev || {}) }
          if (Object.prototype.hasOwnProperty.call(next, from)) {
            if (!Object.prototype.hasOwnProperty.call(next, to)) next[to] = next[from]
            delete next[from]
          }
          return next
        })
      }
      return true
    },
    [iconSetterFor, setterFor]
  )

  const removeCategory = useCallback(
    (type, name) => {
      const target = String(name || '').trim()
      const setter = setterFor(type)
      const iconSetter = iconSetterFor(type)
      if (!target || !setter || !iconSetter) return false
      setter((prev) => (prev || []).filter((c) => c !== target))
      iconSetter((prev) => {
        const next = { ...(prev || {}) }
        delete next[target]
        return next
      })
      return true
    },
    [iconSetterFor, setterFor]
  )

  const setCategoryIcon = useCallback(
    (type, name, icon) => {
      const target = String(name || '').trim()
      const setter = iconSetterFor(type)
      if (!target || !setter) return false
      setter((prev) => ({
        ...(prev || {}),
        [target]: normalizeCategoryIcon(icon),
      }))
      return true
    },
    [iconSetterFor]
  )

  return {
    categories,
    icons,
    addCategory,
    updateCategory,
    removeCategory,
    setCategoryIcon,
  }
}
