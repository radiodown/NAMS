// Single source of truth for everything persisted to localStorage.
//
// The whole app state lives in one versioned JSON document under `wal-store`.
// Hooks read/write slices of it through `usePersistentState`, replacing the
// per-hook load/save boilerplate. Legacy single-purpose keys are migrated once
// and then left untouched as a rollback safety net.
import { useEffect, useState } from 'react'
import { SCHEMA_VERSION, buildDefaultDoc, normalizeDoc, defaultMethods } from './schema'

const STORE_KEY = 'wal-store'

// Pre-standardization keys — read once during migration, never written again.
const LEGACY = {
  entries: 'wal-ledger-entries',
  investments: 'wal-investments',
  methods: 'wal-payment-methods',
  categories: 'wal-categories',
  fixedTemplates: 'wal-fixed-expenses',
  fixedRecords: 'wal-fixed-expense-records',
  fixedMonths: 'wal-fixed-expense-record-months',
  fixedLastMonth: 'wal-fixed-expense-last-active-month',
  stageYaml: 'wal-stage-config-yaml',
  themeYaml: 'wal-theme-settings-yaml',
}

function readRaw(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function readJSON(key, fallback) {
  const raw = readRaw(key)
  if (!raw) return fallback
  try {
    const value = JSON.parse(raw)
    return value == null ? fallback : value
  } catch {
    return fallback
  }
}

function persist(next) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next))
  } catch {
    // storage full or unavailable — skip silently
  }
}

function hasLegacyData() {
  return Object.values(LEGACY).some((key) => readRaw(key) != null)
}

// The old stage config was a hand-rolled YAML string.
function parseLegacyStages(text) {
  const stages = []
  let current = null
  String(text || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('- name:')) {
        if (current) stages.push(current)
        current = { name: trimmed.slice('- name:'.length).trim(), visible: true }
      } else if (trimmed.startsWith('visible:') && current) {
        current.visible = trimmed.slice('visible:'.length).trim() !== 'false'
      }
    })
  if (current) stages.push(current)
  return stages
}

function parseLegacyTheme(text) {
  const line = String(text || '')
    .split(/\r?\n/)
    .find((item) => item.trim().startsWith('theme:'))
  return line?.split(':').slice(1).join(':').trim() === 'dark' ? 'dark' : 'light'
}

// Assemble a v1 document from the legacy keys, then let normalizeDoc clean it.
function migrateFromLegacy() {
  const income = []
  const expense = []
  readJSON(LEGACY.entries, []).forEach((entry) => {
    if (!entry || entry.fixedId) return // drop stale virtual fixed-expense rows
    ;(entry.type === '수입' ? income : expense).push(entry)
  })

  const categories = readJSON(LEGACY.categories, {}) || {}
  const methods = readJSON(LEGACY.methods, null)

  return normalizeDoc({
    schemaVersion: SCHEMA_VERSION,
    settings: {
      theme: parseLegacyTheme(readRaw(LEGACY.themeYaml)),
      stages: parseLegacyStages(readRaw(LEGACY.stageYaml)),
    },
    stages: {
      income: { categories: categories.수입, entries: income },
      expense: {
        categories: categories.지출,
        paymentMethods: methods == null ? defaultMethods() : methods,
        entries: expense,
        fixed: {
          templates: readJSON(LEGACY.fixedTemplates, []),
          records: readJSON(LEGACY.fixedRecords, []),
          closedMonths: readJSON(LEGACY.fixedMonths, []),
          lastActiveMonth: readRaw(LEGACY.fixedLastMonth) || '',
        },
      },
      investment: { products: readJSON(LEGACY.investments, []) },
    },
  })
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
  const doc = hasLegacyData() ? migrateFromLegacy() : buildDefaultDoc()
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
