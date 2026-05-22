import { useState, useEffect, useCallback } from 'react'
import { createId } from './id'
import { fixedExpenseEntriesForMonth } from './fixedExpenseEntries'

const STORAGE_KEY = 'wal-fixed-expenses'
const RECORDS_STORAGE_KEY = 'wal-fixed-expense-records'
const CLOSED_MONTHS_STORAGE_KEY = 'wal-fixed-expense-record-months'

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

function normalizeRecord(record) {
  const month = String(record?.month || record?.date || '').slice(0, 7)
  return {
    id: record?.id || createId(),
    month,
    sourceId: String(record?.sourceId || record?.fixedId || ''),
    name: String(record?.name || record?.memo || '고정지출'),
    category: String(record?.category || '기타'),
    amount: Number(record?.amount) || 0,
    day: record?.day === '' || record?.day == null ? '' : Number(record.day) || '',
    color: String(record?.color || ''),
    paymentMethodId: String(record?.paymentMethodId || ''),
    paymentMethod: String(record?.paymentMethod || '미지정'),
  }
}

function loadRecords() {
  try {
    const raw = localStorage.getItem(RECORDS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(normalizeRecord).filter((record) => record.month) : []
  } catch {
    return []
  }
}

function loadClosedMonths() {
  try {
    const raw = localStorage.getItem(CLOSED_MONTHS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    const saved = Array.isArray(parsed) ? parsed : []
    const recordMonths = loadRecords().map((record) => record.month)
    return [...new Set([...saved, ...recordMonths])]
      .filter((month) => /^\d{4}-\d{2}$/.test(String(month || '')))
      .sort()
  } catch {
    return []
  }
}

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
    })
  )
}

// Recurring expense templates (rent, subscriptions, ...). Stored separately
// from ledger entries — these are configuration, not transactions.
export function useFixedExpenses() {
  const [items, setItems] = useState(loadItems)
  const [records, setRecords] = useState(loadRecords)
  const [closedMonths, setClosedMonths] = useState(loadClosedMonths)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch {
      // storage full or unavailable — skip silently
    }
  }, [items])

  useEffect(() => {
    try {
      localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(records))
    } catch {
      // storage full or unavailable — skip silently
    }
  }, [records])

  useEffect(() => {
    try {
      localStorage.setItem(CLOSED_MONTHS_STORAGE_KEY, JSON.stringify(closedMonths))
    } catch {
      // storage full or unavailable — skip silently
    }
  }, [closedMonths])

  const addItem = useCallback((item) => {
    const next = { ...item, id: createId() }
    setItems((prev) => [...prev, next])
    return next
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

  const recordMonth = useCallback((month, paymentMethods = []) => {
    if (!/^\d{4}-\d{2}$/.test(String(month || ''))) return
    if (closedMonths.includes(month)) return
    setRecords((prev) => {
      if (prev.some((record) => record.month === month)) return prev
      return [...prev, ...recordsForMonth(items, month, paymentMethods)]
    })
    setClosedMonths((prev) => (prev.includes(month) ? prev : [...prev, month].sort()))
  }, [closedMonths, items])

  const replaceRecords = useCallback((next) => {
    const records = Array.isArray(next) ? next.map(normalizeRecord).filter((record) => record.month) : []
    setRecords(records)
    setClosedMonths([...new Set(records.map((record) => record.month))].sort())
  }, [])

  return { items, records, addItem, updateItem, removeItem, replaceAll, recordMonth, replaceRecords }
}
