// Browser document store.
//
// GitHub Pages serves this app as static files, so persistence stays local to
// the browser. This module owns the live document and hides localStorage/JSON
// details from domain hooks.
import { useCallback, useSyncExternalStore } from 'react'
import {
  DOCUMENT_STORAGE_KEY,
  clearAppStorage as clearBrowserAppStorage,
  readStorageText,
  writeStorageText,
} from './browserStorage'
import { buildDefaultDoc, normalizeDoc } from './schema'

const listeners = new Set()

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function keysForPath(path) {
  return String(path || '')
    .split('.')
    .map((key) => key.trim())
    .filter(Boolean)
}

function readPath(source, path) {
  return keysForPath(path).reduce((node, key) => (node == null ? undefined : node[key]), source)
}

function writePath(source, path, value) {
  const keys = keysForPath(path)
  if (keys.length === 0) return

  let node = source
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index]
    if (node[key] == null || typeof node[key] !== 'object') node[key] = {}
    node = node[key]
  }
  node[keys[keys.length - 1]] = value
}

function persist(next) {
  writeStorageText(DOCUMENT_STORAGE_KEY, JSON.stringify(next))
}

function initDoc() {
  const raw = readStorageText(DOCUMENT_STORAGE_KEY)
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

function notify() {
  listeners.forEach((listener) => listener())
}

function commitDocument(next, options = {}) {
  doc = options.normalize ? normalizeDoc(next) : next
  persist(doc)
  notify()
  return doc
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function updateSlice(path, updater) {
  const next = clone(doc)
  const current = readPath(next, path)
  const value = typeof updater === 'function' ? updater(current) : updater
  writePath(next, path, value)
  commitDocument(next)
  return clone(readPath(doc, path))
}

export function updateDocument(updater) {
  const next = clone(doc)
  const value = typeof updater === 'function' ? updater(next) : updater
  commitDocument(value === undefined ? next : value)
  return exportDocument()
}

// Whole-document access for JSON backup export / import.
export function exportDocument() {
  return clone(doc)
}

export function importDocument(raw) {
  commitDocument(raw, { normalize: true })
  return exportDocument()
}

export function clearStoredData() {
  clearBrowserAppStorage()
  doc = buildDefaultDoc()
  persist(doc)
  notify()
}

export function useStoredSlice(path, fallback) {
  const getSnapshot = useCallback(() => {
    const stored = readPath(doc, path)
    if (stored !== undefined) return stored
    return typeof fallback === 'function' ? fallback() : fallback
  }, [path, fallback])

  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const setValue = useCallback((nextValue) => {
    updateSlice(path, (current) =>
      typeof nextValue === 'function' ? nextValue(current) : nextValue
    )
  }, [path])

  return [value, setValue]
}
