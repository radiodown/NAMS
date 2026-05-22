import { useState, useEffect, useCallback } from 'react'
import { createId } from './id'

const STORAGE_KEY = 'wal-investments'

function loadItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// Investment products: 예금 / 적금 / 주식. Each has a `kind` and kind-specific fields.
export function useInvestments() {
  const [items, setItems] = useState(loadItems)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch {
      // storage full or unavailable — skip silently
    }
  }, [items])

  const addItem = useCallback((item) => {
    setItems((prev) => [...prev, { ...item, id: createId() }])
  }, [])

  const updateItem = useCallback((id, patch) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }, [])

  const removeItem = useCallback((id) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }, [])

  const replaceAll = useCallback((next) => {
    setItems(Array.isArray(next) ? next : [])
  }, [])

  return { items, addItem, updateItem, removeItem, replaceAll }
}
