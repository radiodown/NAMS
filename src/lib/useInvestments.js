import { useCallback } from 'react'
import { createId } from './id'
import { normalizeInvestment } from './schema'
import { useStoredSlice } from './store'
import { STORE_PATHS } from './storePaths'

// Investment products: 예금 / 적금 / 주식 / 환율. Each has a `kind` and kind-specific fields.
export function useInvestments() {
  const [items, setItems] = useStoredSlice(STORE_PATHS.investment.products, [])

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

  // Move the `fromId` product into the slot held by `toId`, shifting the rest.
  const moveItem = useCallback(
    (fromId, toId) => {
      setItems((prev) => {
        const from = prev.findIndex((it) => it.id === fromId)
        const to = prev.findIndex((it) => it.id === toId)
        if (from < 0 || to < 0 || from === to) return prev
        const next = [...prev]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        return next
      })
    },
    [setItems]
  )

  const replaceAll = useCallback(
    (next) => {
      setItems(Array.isArray(next) ? next.map(normalizeInvestment) : [])
    },
    [setItems]
  )

  return { items, addItem, updateItem, removeItem, moveItem, replaceAll }
}
