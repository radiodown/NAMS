import { useCallback } from 'react'
import { createId } from './id'
import { normalizeInvestment } from './schema'
import { usePersistentState } from './store'

// Investment products: 예금 / 적금 / 주식. Each has a `kind` and kind-specific fields.
export function useInvestments() {
  const [items, setItems] = usePersistentState('stages.investment.products', [])

  const addItem = useCallback(
    (item) => {
      setItems((prev) => [...prev, normalizeInvestment({ ...item, id: createId() })])
    },
    [setItems]
  )

  const updateItem = useCallback(
    (id, patch) => {
      setItems((prev) =>
        prev.map((it) => (it.id === id ? normalizeInvestment({ ...it, ...patch, id }) : it))
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
      setItems(Array.isArray(next) ? next.map(normalizeInvestment) : [])
    },
    [setItems]
  )

  return { items, addItem, updateItem, removeItem, replaceAll }
}
