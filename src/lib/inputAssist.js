import { monthOf, todayStr } from './format'
import { parseAmountInput } from './numberInput'
import {
  DATE_KEYWORDS,
  PAYMENT_METHOD_KEYWORDS,
  TRANSACTION_CATEGORY_KEYWORDS,
} from './inputAssistMappings'

const DAY_MS = 86400000

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, '')
}

function paymentKey(source) {
  const key = compactText(source?.paymentMethodId || source?.paymentMethod || '')
  return key === '미지정' ? '' : key
}

function recurringMemoKey(source) {
  const raw = String(source?.memo || source?.name || '').trim()
  if (!raw) return ''

  const withoutVariableFragments = raw
    .replace(/\b20\d{2}[./-]\d{1,2}(?:[./-]\d{1,2})?\b/g, ' ')
    .replace(/\b\d{1,2}[./-]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}\.\d{1,2}\b(?!\s*[억만천km원])/gi, ' ')
    .replace(/20\d{2}\s*년/g, ' ')
    .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, ' ')
    .replace(/\d{1,2}\s*월(?:분)?/g, ' ')
    .replace(/\d{1,2}\s*일/g, ' ')
    .replace(/\d+\s*(?:회차|차수|차|번째)/g, ' ')

  const memo = compactText(withoutVariableFragments)
  const category = compactText(source?.category || '')
  return memo && memo !== category ? memo : ''
}

function findKeywordMapping(mappings, normalizedText) {
  return mappings
    .map((item) => ({
      item,
      keyword: item.keywords.find((keyword) => normalizedText.includes(compactText(keyword))),
    }))
    .find((match) => match.keyword)
}

function categoryFromMappingInCurrentList(mapping, categories = []) {
  if (!mapping) return ''
  const target = compactText(mapping.category)
  const exact = categories.find((category) => compactText(category) === target)
  if (exact) return exact

  return (
    categories.find((category) => {
      const current = compactText(category)
      if (!current) return false
      return mapping.keywords.some((keyword) => {
        const mapped = compactText(keyword)
        return current.includes(mapped) || mapped.includes(current)
      })
    }) || ''
  )
}

function paymentMethodFromMappingInCurrentList(mapping, paymentMethods = []) {
  if (!mapping) return ''
  const byNameKeyword = paymentMethods.find((method) => {
    const name = compactText(method.name)
    return name && mapping.keywords.some((keyword) => name.includes(compactText(keyword)))
  })
  if (byNameKeyword) return byNameKeyword.id

  const byKind = paymentMethods.find((method) => method.kind === mapping.kind)
  return byKind?.id || ''
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function formatDate(date) {
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10)
}

function stripDateFragments(text) {
  return String(text || '')
    .replace(/\b20\d{2}[./-]\d{1,2}[./-]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}[/-]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}\.\d{1,2}\b(?!\s*[억만천km원])/gi, ' ')
    .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, ' ')
    .replace(/\d{1,2}\s*일/g, ' ')
}

export function dateFromTransactionText(text) {
  const raw = String(text || '')
  const today = todayStr()
  const base = new Date(`${today}T00:00:00`)
  const keyword = DATE_KEYWORDS.find((item) => raw.includes(item.keyword))
  if (keyword) return formatDate(new Date(base.getTime() + keyword.offsetDays * DAY_MS))

  const full = raw.match(/\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/)
  if (full) return `${full[1]}-${pad2(full[2])}-${pad2(full[3])}`

  const koreanMonthDay = raw.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (koreanMonthDay) {
    return `${base.getFullYear()}-${pad2(koreanMonthDay[1])}-${pad2(koreanMonthDay[2])}`
  }

  const slashMonthDay = raw.match(/\b(\d{1,2})[/-](\d{1,2})\b/)
  if (slashMonthDay) {
    return `${base.getFullYear()}-${pad2(slashMonthDay[1])}-${pad2(slashMonthDay[2])}`
  }

  const dotMonthDay = raw.match(/\b(\d{1,2})\.(\d{1,2})\b(?!\s*[억만천km원])/i)
  if (dotMonthDay) {
    return `${base.getFullYear()}-${pad2(dotMonthDay[1])}-${pad2(dotMonthDay[2])}`
  }

  const dayOnly = raw.match(/(?:^|\s)(\d{1,2})\s*일(?:\s|$)/)
  if (dayOnly) return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(dayOnly[1])}`

  return ''
}

export function amountFromTransactionText(text) {
  const withoutDates = stripDateFragments(text)
  const candidates = []
  const pattern =
    /((?:\d+(?:\.\d+)?\s*(?:억|만|천))+|\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?\s*(?:k|m)?|\d+(?:\.\d+)?)\s*원?/gi
  let match = pattern.exec(withoutDates)
  while (match) {
    const token = match[0]
    const amount = parseAmountInput(token)
    if (amount > 0) {
      const hasUnit = /[억만천km]/i.test(token)
      const hasComma = token.includes(',')
      const hasWon = /원/.test(token)
      candidates.push({
        amount,
        score: (hasUnit ? 3 : 0) + (hasComma ? 2 : 0) + (hasWon ? 2 : 0) + match.index / 100000,
      })
    }
    match = pattern.exec(withoutDates)
  }
  if (!candidates.length) return 0
  candidates.sort((a, b) => b.score - a.score || b.amount - a.amount)
  return candidates[0].amount
}

export function categoryFromTransactionText(type, text, categories = [], entries = []) {
  const normalized = compactText(text)
  const exact = categories.find((category) => normalized.includes(compactText(category)))
  if (exact) return exact

  const mappings = TRANSACTION_CATEGORY_KEYWORDS[type] || []
  const mapping = findKeywordMapping(mappings, normalized)?.item
  const existingMappedCategory = categoryFromMappingInCurrentList(mapping, categories)
  if (existingMappedCategory) return existingMappedCategory

  const recent = entries.find((entry) => {
    const memo = compactText(entry.memo)
    return memo && normalized.includes(memo)
  })
  if (recent?.category) return recent.category

  return mapping?.category || ''
}

export function paymentMethodFromTransactionText(text, paymentMethods = []) {
  const normalized = compactText(text)
  const exact = paymentMethods.find((method) => normalized.includes(compactText(method.name)))
  if (exact) return exact.id

  const mapping = findKeywordMapping(PAYMENT_METHOD_KEYWORDS, normalized)?.item
  return paymentMethodFromMappingInCurrentList(mapping, paymentMethods)
}

export function parseTransactionText(
  text,
  { type, categories = [], paymentMethods = [], entries = [] } = {}
) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim()
  if (!raw) return {}
  return {
    date: dateFromTransactionText(raw),
    category: categoryFromTransactionText(type, raw, categories, entries),
    paymentMethodId: type === '지출' ? paymentMethodFromTransactionText(raw, paymentMethods) : '',
    amount: amountFromTransactionText(raw),
    memo: raw,
  }
}

export function recentEntrySuggestions(entries, limit = 6) {
  const seen = new Set()
  return [...entries]
    .filter((entry) => !entry.fixedId && Number(entry.amount) > 0)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .filter((entry) => {
      const key = [
        compactText(entry.category),
        Math.round(Number(entry.amount) || 0),
        compactText(entry.memo),
        entry.paymentMethodId || entry.paymentMethod || '',
      ].join('|')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
}

function recurringKey(entry) {
  return [
    compactText(entry.category || '기타'),
    Math.round(Number(entry.amount) || 0),
    recurringMemoKey(entry) || compactText(entry.memo || entry.category || ''),
    paymentKey(entry),
  ].join('|')
}

export function recurringTransactionKey(source, type = source?.type) {
  return [type || '', recurringKey(source)].join('|')
}

function fixedKey(item) {
  return [
    compactText(item.category || '기타'),
    Math.round(Number(item.amount) || 0),
    recurringMemoKey(item) || compactText(item.name || item.memo || item.category || ''),
    paymentKey(item),
  ].join('|')
}

export function fixedTransactionKey(source, type = '') {
  return [type || '', fixedKey(source)].join('|')
}

function mostCommonDay(rows) {
  const counts = new Map()
  rows.forEach((row) => {
    const day = Number(String(row.date || '').slice(-2))
    if (!Number.isFinite(day) || day < 1) return
    counts.set(day, (counts.get(day) || 0) + 1)
  })
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || ''
}

export function detectRecurringTransaction(entries, type, fixedItems = [], ignoredKeys = []) {
  const fixedKeys = new Set(fixedItems.filter(Boolean).map(fixedKey))
  const ignored = new Set(Array.isArray(ignoredKeys) ? ignoredKeys : [])
  const groups = new Map()
  entries
    .filter((entry) => entry?.type === type && !entry.fixedId && Number(entry.amount) > 0)
    .forEach((entry) => {
      const key = recurringKey(entry)
      if (fixedKeys.has(key)) return
      const recommendationKey = recurringTransactionKey(entry, type)
      if (ignored.has(recommendationKey)) return
      if (!groups.has(key)) groups.set(key, { rows: [], months: new Set() })
      const group = groups.get(key)
      group.key = recommendationKey
      group.rows.push(entry)
      const month = monthOf(entry.date)
      if (month) group.months.add(month)
    })

  const candidates = [...groups.values()]
    .filter((group) => group.rows.length >= 2 && group.months.size >= 2)
    .map((group) => {
      const rows = group.rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      const latest = rows[0]
      return {
        key: group.key,
        type,
        category: latest.category || '기타',
        amount: Number(latest.amount) || 0,
        memo: latest.memo || latest.category || '',
        paymentMethodId: latest.paymentMethodId || '',
        paymentMethod: latest.paymentMethod || '',
        day: mostCommonDay(rows),
        count: rows.length,
        months: group.months.size,
        latestDate: latest.date || '',
      }
    })
    .sort(
      (a, b) =>
        b.months - a.months ||
        b.count - a.count ||
        (b.latestDate || '').localeCompare(a.latestDate || '')
    )

  return candidates[0] || null
}
