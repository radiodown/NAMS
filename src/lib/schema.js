// Canonical shapes + normalizers for the single versioned `wal-store` document.
// Everything persisted to localStorage flows through here so the on-disk format
// stays consistent and is straightforward to export later.
import { STAGE_META } from './categories'
import { createId } from './id'

export const SCHEMA_VERSION = 1

// UI tab names in default order. The stage config persists name + visibility.
export const STAGE_TABS = ['수입', '지출', '지출 관리', '투자', '그래프요약']

// --- scalar coercion --------------------------------------------------------
const str = (v) => String(v ?? '').trim()
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const optNum = (v) => (v === '' || v == null ? '' : num(v))
const arr = (v) => (Array.isArray(v) ? v : [])
const MONTH_RE = /^\d{4}-\d{2}$/

export function uniqueList(list) {
  return [...new Set(arr(list).map((v) => str(v)).filter(Boolean))]
}

// --- transactions -----------------------------------------------------------
export function normalizeEntry(entry) {
  return {
    id: str(entry?.id) || createId(),
    date: str(entry?.date),
    category: str(entry?.category) || '미분류',
    amount: num(entry?.amount),
    memo: str(entry?.memo),
    paymentMethodId: str(entry?.paymentMethodId),
    paymentMethod: str(entry?.paymentMethod),
  }
}

// --- investments ------------------------------------------------------------
const INVEST_KINDS = ['예금', '적금', '주식']

export function normalizeInvestment(product) {
  const kind = INVEST_KINDS.includes(str(product?.kind)) ? str(product.kind) : '예금'
  const base = {
    id: str(product?.id) || createId(),
    kind,
    name: str(product?.name) || '(이름 없음)',
    date: str(product?.date),
    memo: str(product?.memo),
  }
  if (kind === '주식') {
    return {
      ...base,
      shares: num(product?.shares),
      buyPrice: num(product?.buyPrice),
      quoteSymbol: str(product?.quoteSymbol || product?.symbol),
      quoteCurrency: str(product?.quoteCurrency),
      quoteTime: str(product?.quoteTime),
      currentPrice: num(product?.currentPrice),
    }
  }
  const interest = {
    ...base,
    rate: num(product?.rate),
    months: num(product?.months),
    method: str(product?.method) === '복리' ? '복리' : '단리',
  }
  return kind === '예금'
    ? { ...interest, principal: num(product?.principal) }
    : { ...interest, monthly: num(product?.monthly), round: optNum(product?.round) }
}

// --- fixed expense template -------------------------------------------------
export function normalizeTemplate(template) {
  return {
    id: str(template?.id) || createId(),
    name: str(template?.name) || '(이름 없음)',
    category: str(template?.category) || '기타',
    color: str(template?.color),
    amount: num(template?.amount),
    day: optNum(template?.day),
    paymentMethodId: str(template?.paymentMethodId),
    paymentMethod: str(template?.paymentMethod) || '미지정',
    groupId: str(template?.groupId),
  }
}

// --- fixed expense monthly record ------------------------------------------
export function normalizeRecord(record) {
  return {
    id: str(record?.id) || createId(),
    month: str(record?.month || record?.date).slice(0, 7),
    sourceId: str(record?.sourceId || record?.fixedId),
    name: str(record?.name || record?.memo) || '고정지출',
    category: str(record?.category) || '기타',
    amount: num(record?.amount),
    day: optNum(record?.day),
    color: str(record?.color),
    paymentMethodId: str(record?.paymentMethodId),
    paymentMethod: str(record?.paymentMethod) || '미지정',
  }
}

// --- payment method ---------------------------------------------------------
const METHOD_KINDS = ['신용카드', '체크카드', '현금', '계좌', '간편결제', '기타']

function normalizeKind(kind, name) {
  const value = str(kind)
  if (value === '카드') return String(name).includes('체크') ? '체크카드' : '신용카드'
  return METHOD_KINDS.includes(value) ? value : '신용카드'
}

export function normalizeMethod(method) {
  const name = str(method?.name) || '결제수단'
  return {
    id: str(method?.id) || createId(),
    name,
    kind: normalizeKind(method?.kind, name),
    annualFee: optNum(method?.annualFee),
    monthlyLimit: optNum(method?.monthlyLimit),
    monthlyTarget: optNum(method?.monthlyTarget),
  }
}

// --- defaults ---------------------------------------------------------------
export function defaultCategories(stage) {
  return [...(STAGE_META[stage]?.categories || [])]
}

export function defaultMethods() {
  return ['현금', '신용카드', '체크카드'].map((name) => normalizeMethod({ name, kind: name }))
}

export function defaultStageConfig() {
  return STAGE_TABS.map((name) => ({ name, visible: true }))
}

export function normalizeStageConfig(value) {
  const used = new Set()
  const ordered = []
  arr(value).forEach((stage) => {
    const name = typeof stage === 'string' ? stage : stage?.name
    if (!STAGE_TABS.includes(name) || used.has(name)) return
    used.add(name)
    ordered.push({ name, visible: stage?.visible !== false })
  })
  STAGE_TABS.forEach((name) => {
    if (!used.has(name)) ordered.push({ name, visible: true })
  })
  if (!ordered.some((stage) => stage.visible)) ordered[0].visible = true
  return ordered
}

// --- whole document ---------------------------------------------------------
export function buildDefaultDoc() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { theme: 'light', stages: defaultStageConfig() },
    stages: {
      income: { categories: defaultCategories('수입'), entries: [] },
      expense: {
        categories: defaultCategories('지출'),
        paymentMethods: defaultMethods(),
        entries: [],
        fixed: { templates: [], records: [], closedMonths: [], lastActiveMonth: '' },
      },
      investment: { products: [] },
    },
  }
}

function categoriesOrDefault(list, stage) {
  const normalized = uniqueList(list)
  return normalized.length > 0 ? normalized : defaultCategories(stage)
}

function closedMonthList(saved, records) {
  const fromRecords = arr(records).map((record) => str(record?.month).slice(0, 7))
  return [...new Set([...arr(saved).map((month) => str(month)), ...fromRecords])]
    .filter((month) => MONTH_RE.test(month))
    .sort()
}

// Coerce any parsed object into a complete, valid v1 document.
export function normalizeDoc(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const income = source.stages?.income || {}
  const expense = source.stages?.expense || {}
  const fixed = expense.fixed || {}
  const investment = source.stages?.investment || {}
  const lastActiveMonth = str(fixed.lastActiveMonth).slice(0, 7)

  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      theme: source.settings?.theme === 'dark' ? 'dark' : 'light',
      stages: normalizeStageConfig(source.settings?.stages),
    },
    stages: {
      income: {
        categories: categoriesOrDefault(income.categories, '수입'),
        entries: arr(income.entries).map(normalizeEntry),
      },
      expense: {
        categories: categoriesOrDefault(expense.categories, '지출'),
        paymentMethods: arr(expense.paymentMethods).map(normalizeMethod),
        entries: arr(expense.entries).map(normalizeEntry),
        fixed: {
          templates: arr(fixed.templates).map(normalizeTemplate),
          records: arr(fixed.records).map(normalizeRecord).filter((record) => record.month),
          closedMonths: closedMonthList(fixed.closedMonths, fixed.records),
          lastActiveMonth: MONTH_RE.test(lastActiveMonth) ? lastActiveMonth : '',
        },
      },
      investment: {
        products: arr(investment.products).map(normalizeInvestment),
      },
    },
  }
}
