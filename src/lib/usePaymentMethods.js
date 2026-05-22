import { useCallback } from 'react'
import { createId } from './id'
import { normalizeMethod } from './schema'
import { usePersistentState } from './store'

export function usePaymentMethods() {
  const [items, setItems] = usePersistentState('stages.expense.paymentMethods', [])

  const addItem = useCallback(
    (method) => {
      const next = normalizeMethod({ ...method, id: createId() })
      setItems((prev) => [...prev, next])
      return next
    },
    [setItems]
  )

  const updateItem = useCallback(
    (id, patch) => {
      setItems((prev) =>
        prev.map((it) => (it.id === id ? normalizeMethod({ ...it, ...patch, id }) : it))
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
      setItems(Array.isArray(next) ? next.map(normalizeMethod) : [])
    },
    [setItems]
  )

  return { items, addItem, updateItem, removeItem, replaceAll }
}
