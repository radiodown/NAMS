import { monthOf } from './format'

const PAID_DAY_WINDOW = 3

function compactText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '')
}

function amountValue(value) {
  return Math.round(Number(value) || 0)
}

function dayOf(date) {
  const day = Number(String(date || '').slice(8, 10))
  return Number.isFinite(day) && day > 0 ? day : 0
}

function isUnspecifiedPayment(value) {
  const text = compactText(value)
  return !text || text === compactText('미지정')
}

function paymentCompatible(fixed, entry) {
  const fixedId = String(fixed?.paymentMethodId || '')
  const entryId = String(entry?.paymentMethodId || '')
  if (fixedId && entryId) return fixedId === entryId

  const fixedName = String(fixed?.paymentMethod || '')
  const entryName = String(entry?.paymentMethod || '')
  if (!isUnspecifiedPayment(fixedName) && !isUnspecifiedPayment(entryName)) {
    return compactText(fixedName) === compactText(entryName)
  }

  return true
}

function paymentStrongMatch(fixed, entry) {
  const fixedId = String(fixed?.paymentMethodId || '')
  const entryId = String(entry?.paymentMethodId || '')
  if (fixedId && entryId) return fixedId === entryId

  const fixedName = String(fixed?.paymentMethod || '')
  const entryName = String(entry?.paymentMethod || '')
  return (
    !isUnspecifiedPayment(fixedName) &&
    !isUnspecifiedPayment(entryName) &&
    compactText(fixedName) === compactText(entryName)
  )
}

function categoryMatches(fixed, entry) {
  return compactText(fixed?.category || '기타') === compactText(entry?.category || '미분류')
}

function nameMatches(fixed, entry) {
  const fixedName = compactText(fixed?.memo || fixed?.name || '')
  const memo = compactText(entry?.memo || '')
  if (fixedName.length < 2 || memo.length < 2) return false
  return memo.includes(fixedName) || fixedName.includes(memo)
}

function dayDistance(fixed, entry) {
  const fixedDay = dayOf(fixed?.date)
  const entryDay = dayOf(entry?.date)
  if (!fixedDay || !entryDay) return Number.POSITIVE_INFINITY
  return Math.abs(fixedDay - entryDay)
}

function fixedExpenseMatchScore(fixed, entry) {
  if (!fixed || !entry) return 0
  if (entry.type !== '지출' || entry.fixedId) return 0
  if (amountValue(fixed.amount) <= 0 || amountValue(fixed.amount) !== amountValue(entry.amount)) {
    return 0
  }
  if (!fixed.date || !entry.date || monthOf(fixed.date) !== monthOf(entry.date)) return 0
  if (!paymentCompatible(fixed, entry)) return 0

  const category = categoryMatches(fixed, entry)
  const name = nameMatches(fixed, entry)
  const distance = dayDistance(fixed, entry)
  const closeDay = distance <= PAID_DAY_WINDOW
  const strongPayment = paymentStrongMatch(fixed, entry)

  if (!(category && (name || closeDay)) && !(name && (strongPayment || closeDay))) return 0

  return (
    (category ? 40 : 0) +
    (name ? 50 : 0) +
    (strongPayment ? 20 : 0) +
    (closeDay ? 20 - distance : 0)
  )
}

function sortByDate(a, b) {
  return (a.date || '').localeCompare(b.date || '') || String(a.id || '').localeCompare(String(b.id || ''))
}

export function reconcileFixedExpenseEntries(fixedEntries = [], entries = []) {
  const actualEntries = entries
    .filter((entry) => entry?.type === '지출' && !entry.fixedId && Number(entry.amount) > 0)
    .sort(sortByDate)
  const usedEntryIds = new Set()
  const settledEntries = []
  const unsettledEntries = []
  const statusByFixedId = {}

  fixedEntries.filter(Boolean).sort(sortByDate).forEach((fixed) => {
    let best = null
    actualEntries.forEach((entry) => {
      if (usedEntryIds.has(entry.id)) return
      const score = fixedExpenseMatchScore(fixed, entry)
      if (!score) return
      if (!best || score > best.score || (score === best.score && sortByDate(entry, best.entry) < 0)) {
        best = { entry, score }
      }
    })

    if (!best) {
      unsettledEntries.push(fixed)
      return
    }

    usedEntryIds.add(best.entry.id)
    const settled = {
      ...fixed,
      settledByEntryId: best.entry.id,
      settledEntry: best.entry,
    }
    settledEntries.push(settled)
    const fixedId = fixed.fixedId || fixed.sourceId || fixed.id
    if (fixedId) {
      statusByFixedId[fixedId] = {
        fixedId,
        entryId: best.entry.id,
        date: best.entry.date || '',
        amount: Number(best.entry.amount) || 0,
        memo: best.entry.memo || '',
        category: best.entry.category || '',
        paymentMethodId: best.entry.paymentMethodId || '',
        paymentMethod: best.entry.paymentMethod || '',
      }
    }
  })

  return { unsettledEntries, settledEntries, statusByFixedId }
}

export function unsettledFixedExpenseEntries(fixedEntries = [], entries = []) {
  return reconcileFixedExpenseEntries(fixedEntries, entries).unsettledEntries
}
