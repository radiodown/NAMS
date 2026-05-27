import * as XLSX from '@e965/xlsx'
import {
  buildDefaultDoc,
  defaultCategories,
  defaultMethods,
  normalizeDoc,
  normalizeEntry,
  normalizeInvestment,
  normalizeMethod,
} from './schema'
import { CARD_PRODUCT_CATALOG } from './cardProductCatalog.generated'
import { cardProductMethodPatch, findCardProductMatch } from './cardProductMatch'

export const BANKSALAD_SHEET_NAME = '가계부 내역'
export const BANKSALAD_SUMMARY_SHEET_NAME = '뱅샐현황'
export const BANKSALAD_ACCEPT =
  '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const REQUIRED_HEADERS = ['날짜', '타입', '대분류', '소분류', '내용', '금액', '화폐', '결제수단']
const SUPPORTED_TYPES = new Set(['수입', '지출'])
const EMPTY_CATEGORY = '미분류'
const BANKSALAD_ASSET_ID_PREFIX = 'banksalad-asset'
const SECTION_HEADING_RE = /^\d+\./

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

function isSectionHeading(value) {
  return SECTION_HEADING_RE.test(str(value))
}

function rowsForSection(rows, sectionTitle) {
  const start = rows.findIndex((row) => str(row[0]).startsWith(sectionTitle))
  if (start < 0) return []
  const next = rows.findIndex((row, index) => index > start && isSectionHeading(row[0]))
  return rows.slice(start, next < 0 ? rows.length : next)
}

function findBanksaladSummarySheet(workbook) {
  const preferred = workbook.Sheets[BANKSALAD_SUMMARY_SHEET_NAME]
  if (preferred) {
    const rows = sheetRows(preferred)
    if (rowsForSection(rows, '3.재무현황').length > 0) {
      return { name: BANKSALAD_SUMMARY_SHEET_NAME, rows }
    }
  }

  for (const name of workbook.SheetNames || []) {
    const rows = sheetRows(workbook.Sheets[name])
    if (rowsForSection(rows, '3.재무현황').length > 0) return { name, rows }
  }

  return { name: '', rows: [] }
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

function latestRecordDate(records) {
  return records
    .map((record) => parseDate(record.날짜))
    .filter(Boolean)
    .sort()
    .at(-1) || ''
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

function emptyFixedState() {
  return { templates: [], records: [], closedMonths: [], lastActiveMonth: '' }
}

function addSkip(skipped, reason, record) {
  skipped.push({ reason, rowNumber: record.rowNumber })
}

function investmentDetailsByName(rows) {
  const section = rowsForSection(rows, '5.투자현황')
  const headerIndex = section.findIndex(
    (row) => str(row[0]) === '투자상품종류' && str(row[2]) === '상품명'
  )
  if (headerIndex < 0) return new Map()

  const map = new Map()
  section.slice(headerIndex + 1).forEach((row) => {
    const productType = str(row[0])
    const name = str(row[2])
    if (!name || productType === '총계') return
    map.set(name, {
      productType,
      institution: str(row[1]),
      assetCost: parseAmount(row[4]),
      assetValue: parseAmount(row[5]),
      returnPct: str(row[6]),
    })
  })
  return map
}

function financialAssetRows(rows) {
  const section = rowsForSection(rows, '3.재무현황')
  const headerIndex = section.findIndex(
    (row) => str(row[0]) === '항목' && str(row[1]) === '상품명' && str(row[3]) === '금액'
  )
  if (headerIndex < 0) return []

  const assets = []
  let currentCategory = ''
  section.slice(headerIndex + 1).some((row) => {
    const categoryCell = str(row[0])
    const name = str(row[1])
    const amount = parseAmount(row[3])

    if (categoryCell === '총자산' || categoryCell === '순자산') return true
    if (categoryCell) currentCategory = categoryCell

    if (!name) return false
    if (amount <= 0) return false

    assets.push({
      category: currentCategory || '기타 자산',
      name,
      amount,
    })
    return false
  })
  return assets
}

function buildAssetMemo(asset, detail) {
  return uniqueList([
    '뱅크샐러드 재무현황',
    detail?.institution,
    detail?.productType,
    detail?.returnPct ? `수익률 ${detail.returnPct}%` : '',
    asset.category,
  ]).join(' · ')
}

function convertAssets(rows, valuationDate) {
  const details = investmentDetailsByName(rows)
  return financialAssetRows(rows).map((asset) => {
    const detail = details.get(asset.name)
    const assetValue = detail?.assetValue > 0 ? detail.assetValue : asset.amount
    const assetCost = detail?.assetCost > 0 ? detail.assetCost : assetValue
    return normalizeInvestment({
      id: stableId(BANKSALAD_ASSET_ID_PREFIX, [asset.category, asset.name]),
      kind: '자산',
      name: asset.name,
      date: valuationDate,
      memo: buildAssetMemo(asset, detail),
      assetType: asset.category,
      assetValue,
      assetCost,
    })
  })
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

function isBanksaladAssetProduct(product) {
  return str(product?.id).startsWith(`${BANKSALAD_ASSET_ID_PREFIX}-`)
}

function buildMigrationDocument(baseDocument, converted, assetProducts) {
  const doc = normalizeDoc(baseDocument || buildDefaultDoc())
  const existingProducts = doc.stages.investment.products.filter(
    (product) => !isBanksaladAssetProduct(product)
  )
  return normalizeDoc({
    ...doc,
    stages: {
      ...doc.stages,
      income: {
        ...doc.stages.income,
        categories: converted.incomeCategories,
        entries: converted.incomeEntries,
        fixed: emptyFixedState(),
      },
      expense: {
        ...doc.stages.expense,
        categories: converted.expenseCategories,
        paymentMethods: converted.paymentMethods,
        entries: converted.expenseEntries,
        fixed: emptyFixedState(),
      },
      investment: {
        ...doc.stages.investment,
        products: [...existingProducts, ...assetProducts],
      },
    },
  })
}

export function parseBanksaladWorkbook(input) {
  const workbook = readWorkbook(input)
  const sheet = findBanksaladSheet(workbook)
  const summarySheet = findBanksaladSummarySheet(workbook)
  const records = recordsFromRows(sheet.rows)
  return {
    sheetName: sheet.name,
    records,
    assetSheetName: summarySheet.name,
    assetProducts: convertAssets(summarySheet.rows, latestRecordDate(records)),
  }
}

export function migrateBanksaladWorkbook(input, baseDocument) {
  const parsed = parseBanksaladWorkbook(input)
  const converted = convertRecords(parsed.records)
  const importedCount = converted.incomeEntries.length + converted.expenseEntries.length
  if (!importedCount) {
    throw new Error('가져올 수입·지출 내역이 없습니다. 뱅크샐러드 파일 내용을 확인해 주세요.')
  }

  const document = buildMigrationDocument(baseDocument, converted, parsed.assetProducts)
  const skippedByReason = converted.skippedRows.reduce((acc, row) => {
    acc[row.reason] = (acc[row.reason] || 0) + 1
    return acc
  }, {})
  const assetValueTotal = parsed.assetProducts.reduce(
    (sum, product) => sum + (Number(product.assetValue) || 0),
    0
  )
  const assetCostTotal = parsed.assetProducts.reduce(
    (sum, product) => sum + (Number(product.assetCost) || 0),
    0
  )

  return {
    document,
    summary: {
      sheetName: parsed.sheetName,
      assetSheetName: parsed.assetSheetName,
      sourceRows: parsed.records.length,
      importedCount,
      incomeCount: converted.incomeEntries.length,
      expenseCount: converted.expenseEntries.length,
      assetCount: parsed.assetProducts.length,
      assetValueTotal,
      assetCostTotal,
      skippedCount: converted.skippedRows.length,
      skippedByReason,
      paymentMethodCount: converted.paymentMethods.length,
      cardProductMatchCount: converted.cardProductMatchCount,
      incomeCategoryCount: converted.incomeCategories.length,
      expenseCategoryCount: converted.expenseCategories.length,
    },
  }
}
