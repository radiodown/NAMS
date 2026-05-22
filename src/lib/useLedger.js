import { useState, useEffect, useCallback } from 'react'
import { createId } from './id'

const STORAGE_KEY = 'wal-ledger-entries'

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function useLedger() {
  const [entries, setEntries] = useState(loadEntries)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
    } catch {
      // storage full or unavailable — skip silently
    }
  }, [entries])

  const addEntry = useCallback((entry) => {
    setEntries((prev) => [...prev, { ...entry, id: createId() }])
  }, [])

  const updateEntry = useCallback((id, patch) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }, [])

  const removeEntry = useCallback((id) => {
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }, [])

  const replaceAll = useCallback((next) => {
    setEntries(Array.isArray(next) ? next : [])
  }, [])

  return { entries, addEntry, updateEntry, removeEntry, replaceAll }
}
