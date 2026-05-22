// Single source of truth for everything persisted to localStorage.
//
// The whole app state lives in one versioned JSON document under `nams-store`.
// Hooks read/write slices of it through `usePersistentState`, replacing the
// per-hook load/save boilerplate.
import { useEffect, useState } from 'react'
import { buildDefaultDoc, normalizeDoc } from './schema'

const STORE_KEY = 'nams-store'

function readRaw(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function persist(next) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next))
  } catch {
    // storage full or unavailable — skip silently
  }
}

function initDoc() {
  const raw = readRaw(STORE_KEY)
  if (raw) {
    try {
      return normalizeDoc(JSON.parse(raw))
    } catch {
      // corrupt store — fall through and rebuild
    }
  }
  const doc = buildDefaultDoc()
  persist(doc)
  return doc
}

// In-memory document — the live source of truth for the session.
let doc = initDoc()

export function getSlice(path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), doc)
}

export function setSlice(path, value) {
  const keys = path.split('.')
  let node = doc
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i]
    if (node[key] == null || typeof node[key] !== 'object') node[key] = {}
    node = node[key]
  }
  node[keys[keys.length - 1]] = value
  persist(doc)
}

// Whole-document access for JSON backup export / import.
export function exportDocument() {
  return doc
}

export function importDocument(raw) {
  doc = normalizeDoc(raw)
  persist(doc)
  return doc
}

// Drop-in replacement for the per-hook useState(load) + useEffect(save) pattern.
export function usePersistentState(path, fallback) {
  const [value, setValue] = useState(() => {
    const stored = getSlice(path)
    if (stored !== undefined) return stored
    return typeof fallback === 'function' ? fallback() : fallback
  })

  useEffect(() => {
    setSlice(path, value)
  }, [path, value])

  return [value, setValue]
}
