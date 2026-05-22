import { useCallback, useEffect, useState } from 'react'
import { createId } from './id'

const STORAGE_KEY = 'wal-payment-methods'

const defaultMethods = () => [
  { id: createId(), name: '현금', kind: '현금', annualFee: '', monthlyLimit: '', monthlyTarget: '' },
  { id: createId(), name: '신용카드', kind: '신용카드', annualFee: '', monthlyLimit: '', monthlyTarget: '' },
  { id: createId(), name: '체크카드', kind: '체크카드', annualFee: '', monthlyLimit: '', monthlyTarget: '' },
]

function normalizeKind(kind, name = '') {
  const value = String(kind || '').trim()
  if (value === '카드') return String(name).includes('체크') ? '체크카드' : '신용카드'
  return ['신용카드', '체크카드', '현금', '계좌', '간편결제', '기타'].includes(value)
    ? value
    : '신용카드'
}

function normalizeMethod(method) {
  const name = String(method?.name || '').trim() || '결제수단'
  return {
    id: method?.id || createId(),
    name,
    kind: normalizeKind(method?.kind, name),
    annualFee: method?.annualFee === '' || method?.annualFee == null ? '' : Number(method.annualFee) || 0,
    monthlyLimit: method?.monthlyLimit === '' || method?.monthlyLimit == null ? '' : Number(method.monthlyLimit) || 0,
    monthlyTarget: method?.monthlyTarget === '' || method?.monthlyTarget == null ? '' : Number(method.monthlyTarget) || 0,
  }
}

function loadMethods() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultMethods()
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(normalizeMethod) : defaultMethods()
  } catch {
    return defaultMethods()
  }
}

export function usePaymentMethods() {
  const [items, setItems] = useState(loadMethods)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch {
      // skip silently
    }
  }, [items])

  const addItem = useCallback((method) => {
    const next = normalizeMethod({ ...method, id: createId() })
    setItems((prev) => [...prev, next])
    return next
  }, [])

  const updateItem = useCallback((id, patch) => {
    setItems((prev) => prev.map((it) => (it.id === id ? normalizeMethod({ ...it, ...patch, id }) : it)))
  }, [])

  const removeItem = useCallback((id) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }, [])

  const replaceAll = useCallback((next) => {
    setItems(Array.isArray(next) ? next.map(normalizeMethod) : [])
  }, [])

  return { items, addItem, updateItem, removeItem, replaceAll }
}
