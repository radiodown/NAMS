import * as XLSX from '@e965/xlsx'
import {
  buildDefaultDoc,
  defaultCategories,
  defaultMethods,
  normalizeDoc,
  normalizeEntry,
  normalizeMethod,
} from './schema'
import { CARD_PRODUCT_CATALOG } from './cardProductCatalog.generated'
import { cardProductMethodPatch, findCardProductMatch } from './cardProductMatch'

export const BANKSALAD_SHEET_NAME = '가계부 내역'
export const BANKSALAD_ACCEPT =
  '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const REQUIRED_HEADERS = ['날짜', '타입', '대분류', '소분류', '내용', '금액', '화폐', '결제수단']
const SUPPORTED_TYPES = new Set(['수입', '지출'])
const EMPTY_CATEGORY = '미분류'

function str(value) {
  return String(value ?? '').trim()
}

function uniqueList(values) {
  return [...new Set(values.map(str).filter(Boolean))]
}

function stableHash(parts) {
  let hash = 2166136261
  const text = parts.map((part) => str(part)).join('|')
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function stableId(prefix, parts) {
  return `${prefix}-${stableHash(parts)}`
}

function readWorkbook(input) {
  const options = { cellDates: false }
  if (input instanceof ArrayBuffer) {
    return XLSX.read(new Uint8Array(input), { ...options, type: 'array' })
  }
  if (ArrayBuffer.isView(input)) {
    return XLSX.read(input, { ...options, type: 'array' })
  }
  return XLSX.read(input, options)
}

function sheetRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  })
}

function headerIndex(rows) {
  return rows.findIndex((row) => {
    const headers = new Set(row.map(str))
    return REQUIRED_HEADERS.every((header) => headers.has(header))
  })
}

function findBanksaladSheet(workbook) {
  const preferred = workbook.Sheets[BANKSALAD_SHEET_NAME]
  if (preferred) {
    const rows = sheetRows(preferred)
    if (headerIndex(rows) >= 0) return { name: BANKSALAD_SHEET_NAME, rows }
  }

  for (const name of workbook.SheetNames || []) {
    const rows = sheetRows(workbook.Sheets[name])
    if (headerIndex(rows) >= 0) return { name, rows }
  }

  throw new Error('뱅크샐러드 가계부 내역 시트를 찾지 못했습니다.')
}

function recordsFromRows(rows) {
  const start = headerIndex(rows)
  if (start < 0) throw new Error('뱅크샐러드 가계부 컬럼을 찾지 못했습니다.')

  const headers = rows[start].map(str)
  return rows.slice(start + 1)
    .map((row, index) => {
      const record = { rowNumber: start + index + 2 }
      headers.forEach((header, cellIndex) => {
        if (header) record[header] = row[cellIndex]
      })
      return record
    })
    .filter((record) => REQUIRED_HEADERS.some((header) => str(record[header])))
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function formatDateParts(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate())
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed?.y && parsed?.m && parsed?.d) return formatDateParts(parsed.y, parsed.m, parsed.d)
  }

  const text = str(value)
  const match = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/)
  if (!match) return ''
  return formatDateParts(match[1], match[2], match[3])
}

function parseAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const normalized = str(value)
    .replace(/,/g, '')
    .replace(/\s+/g, '')
  const direct = Number(normalized)
  if (Number.isFinite(direct)) return direct

  const cleaned = Number(normalized.replace(/[^\d.-]/g, ''))
  return Number.isFinite(cleaned) ? cleaned : 0
}

function pickCategory(record) {
  const major = str(record.대분류)
  const minor = str(record.소분류)
  if (minor && minor !== EMPTY_CATEGORY) return minor
  if (major && major !== EMPTY_CATEGORY) return major
  return EMPTY_CATEGORY
}

function buildMemo(record) {
  return uniqueList([record.내용, record.메모]).join(' · ')
}

function inferPaymentKind(name) {
  const compact = str(name).toLowerCase().replace(/\s+/g, '')
  if (!compact) return '기타'
  if (compact.includes('현금')) return '현금'
  if (
    compact.includes('간편결제') ||
    compact.includes('페이') ||
    compact.includes('pay') ||
    compact.includes('머니')
  ) {
    return '간편결제'
  }
  if (compact.includes('통장') || compact.includes('저축예금') || compact.includes('계좌')) {
    return '계좌'
  }
  if (compact.includes('체크') || compact.includes('check')) return '체크카드'
  return '신용카드'
}

function mergePaymentMethods(importedMethods) {
  const byName = new Map()
  defaultMethods().forEach((method) => byName.set(method.name, method))
  importedMethods.forEach((method) => byName.set(method.name, method))
  return [...byName.values()]
}

function addSkip(skipped, reason, record) {
  skipped.push({ reason, rowNumber: record.rowNumber })
}

function convertRecords(records) {
  const incomeEntries = []
  const expenseEntries = []
  const incomeCategories = new Set()
  const expenseCategories = new Set()
  const methodMap = new Map()
  const cardProductMatches = new Map()
  const skippedRows = []

  records.forEach((record) => {
    const type = str(record.타입)
    if (!SUPPORTED_TYPES.has(type)) {
      addSkip(skippedRows, 'unsupportedType', record)
      return
    }

    const currency = str(record.화폐 || 'KRW').toUpperCase()
    if (currency && currency !== 'KRW') {
      addSkip(skippedRows, 'unsupportedCurrency', record)
      return
    }

    const date = parseDate(record.날짜)
    if (!date) {
      addSkip(skippedRows, 'invalidDate', record)
      return
    }

    const amount = Math.abs(parseAmount(record.금액))
    if (!amount) {
      addSkip(skippedRows, 'zeroAmount', record)
      return
    }

    const category = pickCategory(record)
    const entry = {
      id: stableId('banksalad-entry', [
        record.rowNumber,
        record.날짜,
        record.시간,
        type,
        record.대분류,
        record.소분류,
        record.내용,
        record.금액,
        record.결제수단,
      ]),
      date,
      category,
      amount,
      memo: buildMemo(record),
    }

    if (type === '지출') {
      expenseCategories.add(category)
      const paymentName = str(record.결제수단)
      if (paymentName) {
        if (!methodMap.has(paymentName)) {
          const cardMatch = findCardProductMatch(paymentName, CARD_PRODUCT_CATALOG)
          if (cardMatch) cardProductMatches.set(paymentName, cardMatch)
          methodMap.set(
            paymentName,
            normalizeMethod({
              id: stableId('banksalad-method', [paymentName]),
              name: paymentName,
              kind: cardMatch?.product?.kind || inferPaymentKind(paymentName),
              ...cardProductMethodPatch(cardMatch?.product),
            })
          )
        }
        const method = methodMap.get(paymentName)
        entry.paymentMethodId = method.id
        entry.paymentMethod = method.name
      }
      expenseEntries.push(normalizeEntry(entry))
      return
    }

    incomeCategories.add(category)
    incomeEntries.push(normalizeEntry(entry))
  })

  const paymentMethods = mergePaymentMethods([...methodMap.values()])
  return {
    incomeEntries,
    expenseEntries,
    incomeCategories: uniqueList([...defaultCategories('수입'), ...incomeCategories]),
    expenseCategories: uniqueList([...defaultCategories('지출'), ...expenseCategories]),
    paymentMethods,
    cardProductMatchCount: cardProductMatches.size,
    skippedRows,
  }
}

function mergeCategories(existing, added) {
  return uniqueList([...existing, ...added])
}

// Adds imported entries to the existing list, keyed by id so re-importing an
// already-imported row (e.g. overlapping month ranges) updates it in place
// instead of duplicating it.
function mergeEntries(existing, added) {
  const byId = new Map(existing.map((entry) => [entry.id, entry]))
  added.forEach((entry) => byId.set(entry.id, entry))
  return [...byId.values()]
}

// Keeps the user's existing payment methods (so their ids/settings survive)
// and only appends methods that don't already exist by name. Returns the
// merged list plus a name -> id map used to repoint imported entries at the
// existing method id when one already exists.
function reconcilePaymentMethods(existing, imported) {
  const methods = [...existing]
  const idByName = new Map(existing.map((method) => [method.name, method.id]))
  imported.forEach((method) => {
    if (idByName.has(method.name)) return
    idByName.set(method.name, method.id)
    methods.push(method)
  })
  return { methods, idByName }
}

function repointPaymentMethod(entry, idByName) {
  if (!entry.paymentMethod) return entry
  const id = idByName.get(entry.paymentMethod)
  if (!id || id === entry.paymentMethodId) return entry
  return { ...entry, paymentMethodId: id }
}

function buildMigrationDocument(baseDocument, converted) {
  const doc = normalizeDoc(baseDocument || buildDefaultDoc())
  const { methods: paymentMethods, idByName } = reconcilePaymentMethods(
    doc.stages.expense.paymentMethods,
    converted.paymentMethods
  )
  const expenseEntries = converted.expenseEntries.map((entry) => repointPaymentMethod(entry, idByName))

  return normalizeDoc({
    ...doc,
    stages: {
      ...doc.stages,
      income: {
        ...doc.stages.income,
        categories: mergeCategories(doc.stages.income.categories, converted.incomeCategories),
        entries: mergeEntries(doc.stages.income.entries, converted.incomeEntries),
      },
      expense: {
        ...doc.stages.expense,
        categories: mergeCategories(doc.stages.expense.categories, converted.expenseCategories),
        paymentMethods,
        entries: mergeEntries(doc.stages.expense.entries, expenseEntries),
      },
    },
  })
}

export function parseBanksaladWorkbook(input) {
  const workbook = readWorkbook(input)
  const sheet = findBanksaladSheet(workbook)
  const records = recordsFromRows(sheet.rows)
  return {
    sheetName: sheet.name,
    records,
  }
}

function recordMonth(record) {
  return parseDate(record.날짜).slice(0, 7)
}

// Summarizes how many income/expense rows fall in each month, so an import
// picker can let the user pick a subset of months before committing.
export function summarizeBanksaladMonths(records) {
  const converted = convertRecords(records)
  const byMonth = new Map()
  const bump = (date, key) => {
    const month = str(date).slice(0, 7)
    if (!month) return
    if (!byMonth.has(month)) {
      byMonth.set(month, { month, incomeCount: 0, expenseCount: 0 })
    }
    byMonth.get(month)[key] += 1
  }
  converted.incomeEntries.forEach((entry) => bump(entry.date, 'incomeCount'))
  converted.expenseEntries.forEach((entry) => bump(entry.date, 'expenseCount'))
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
}

export function buildBanksaladMigration(parsed, baseDocument, months) {
  const records = months
    ? parsed.records.filter((record) => months.has(recordMonth(record)))
    : parsed.records
  const converted = convertRecords(records)
  const importedCount = converted.incomeEntries.length + converted.expenseEntries.length
  if (!importedCount) {
    throw new Error('가져올 수입·지출 내역이 없습니다. 선택한 월의 내용을 확인해 주세요.')
  }

  const document = buildMigrationDocument(baseDocument, converted)
  const skippedByReason = converted.skippedRows.reduce((acc, row) => {
    acc[row.reason] = (acc[row.reason] || 0) + 1
    return acc
  }, {})

  return {
    document,
    summary: {
      sheetName: parsed.sheetName,
      sourceRows: parsed.records.length,
      importedCount,
      incomeCount: converted.incomeEntries.length,
      expenseCount: converted.expenseEntries.length,
      skippedCount: converted.skippedRows.length,
      skippedByReason,
      paymentMethodCount: converted.paymentMethods.length,
      cardProductMatchCount: converted.cardProductMatchCount,
      incomeCategoryCount: converted.incomeCategories.length,
      expenseCategoryCount: converted.expenseCategories.length,
    },
  }
}

export function migrateBanksaladWorkbook(input, baseDocument) {
  const parsed = parseBanksaladWorkbook(input)
  return buildBanksaladMigration(parsed, baseDocument)
}
