import { useCallback, useEffect, useState } from 'react'
import { STAGE_META } from './categories'

const STORAGE_KEY = 'wal-categories'

const defaultCategories = () => ({
  수입: [...STAGE_META.수입.categories],
  지출: [...STAGE_META.지출.categories],
})

function uniqueList(list) {
  return [...new Set(list.map((v) => String(v || '').trim()).filter(Boolean))]
}

function listOrDefault(list, fallback) {
  const normalized = uniqueList(Array.isArray(list) ? list : [])
  return normalized.length > 0 ? normalized : [...fallback]
}

function loadCategories() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultCategories()
    const parsed = JSON.parse(raw)
    return {
      수입: listOrDefault(parsed?.수입, STAGE_META.수입.categories),
      지출: listOrDefault(parsed?.지출, STAGE_META.지출.categories),
    }
  } catch {
    return defaultCategories()
  }
}

export function useCategories() {
  const [categories, setCategories] = useState(loadCategories)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(categories))
    } catch {
      // skip silently
    }
  }, [categories])

  const addCategory = useCallback((type, name) => {
    const nextName = String(name || '').trim()
    if (!nextName) return false
    setCategories((prev) => ({
      ...prev,
      [type]: uniqueList([...(prev[type] || []), nextName]),
    }))
    return true
  }, [])

  const updateCategory = useCallback((type, oldName, nextName) => {
    const from = String(oldName || '').trim()
    const to = String(nextName || '').trim()
    if (!from || !to) return false
    setCategories((prev) => ({
      ...prev,
      [type]: uniqueList((prev[type] || []).map((c) => (c === from ? to : c))),
    }))
    return true
  }, [])

  const removeCategory = useCallback((type, name) => {
    const target = String(name || '').trim()
    if (!target) return false
    setCategories((prev) => ({
      ...prev,
      [type]: (prev[type] || []).filter((c) => c !== target),
    }))
    return true
  }, [])

  return { categories, addCategory, updateCategory, removeCategory }
}
