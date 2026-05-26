// Canonical shapes + normalizers for the versioned browser document.
// Imported backups and older local documents flow through here so the stored
// shape stays consistent.
import { STAGE_META } from './categories'
import { createId } from './id'
import { normalizeSimulationScenario } from './investmentSimulation'
import { isLoanInterestCategory, normalizeLoanMethod } from './loanInterest'

export const SCHEMA_VERSION = 1

// UI tab names in default order. The stage config persists name + visibility.
export const STAGE_TABS = [
  '수입',
  '수입 관리',
  '지출',
  '지출 관리',
  '그래프요약',
  '투자',
  '연말정산',
  '투자 시뮬레이션',
]

const DEFAULT_VISIBLE_STAGES = new Set([
  '수입',
  '수입 관리',
  '지출',
  '지출 관리',
  '그래프요약',
  '투자',
  '연말정산',
])

// Tax-benefit tags an investment product can claim. Drives 연말정산 stage matching.
export const TAX_BENEFIT_TAGS = ['없음', 'ISA', '연금저축', 'IRP', '주택청약', '청년도약계좌']

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

function normalizeLoanCalculator(source, category) {
  if (!isLoanInterestCategory(category)) return {}
  return {
    loanMethod: normalizeLoanMethod(str(source?.loanMethod)),
    loanPrincipal: num(source?.loanPrincipal),
    loanRate: num(source?.loanRate),
    loanMonths: optNum(source?.loanMonths) || 1,
    loanRound: optNum(source?.loanRound) || 1,
    loanGraceMonths: optNum(source?.loanGraceMonths),
  }
}

// --- transactions -----------------------------------------------------------
export function normalizeEntry(entry) {
  const category = str(entry?.category) || '미분류'
  return {
    id: str(entry?.id) || createId(),
    date: str(entry?.date),
    category,
    amount: num(entry?.amount),
    memo: str(entry?.memo),
    paymentMethodId: str(entry?.paymentMethodId),
    paymentMethod: str(entry?.paymentMethod),
    ...normalizeLoanCalculator(entry, category),
  }
}

// --- investments ------------------------------------------------------------
const INVEST_KINDS = ['예금', '적금', '주식', '환율']

function currencyCode(value, fallback = 'KRW') {
  const code = str(value || fallback).toUpperCase().replace(/[^A-Z]/g, '')
  return code || fallback
}

function normalizeTaxBenefit(value) {
  const tag = str(value)
  return TAX_BENEFIT_TAGS.includes(tag) ? tag : '없음'
}

export function normalizeInvestment(product) {
  const kind = INVEST_KINDS.includes(str(product?.kind)) ? str(product.kind) : '예금'
  const base = {
    id: str(product?.id) || createId(),
    kind,
    name: str(product?.name) || '(이름 없음)',
    date: str(product?.date),
    memo: str(product?.memo),
    color: str(product?.color),
    taxBenefit: normalizeTaxBenefit(product?.taxBenefit),
  }
  if (kind === '주식') {
    return {
      ...base,
      shares: num(product?.shares),
      buyPrice: num(product?.buyPrice),
      currency: currencyCode(product?.currency || product?.quoteCurrency),
      quoteSymbol: str(product?.quoteSymbol || product?.symbol),
      quoteCurrency: str(product?.quoteCurrency),
      quoteTime: str(product?.quoteTime),
      currentPrice: num(product?.currentPrice),
      exchangeRate: num(product?.exchangeRate),
      exchangeRateTime: str(product?.exchangeRateTime),
    }
  }
  if (kind === '환율') {
    const baseCurrency = currencyCode(product?.baseCurrency || product?.currency || product?.name, 'USD')
    const targetCurrency = currencyCode(product?.targetCurrency, 'KRW')
    return {
      ...base,
      name: str(product?.name) || `${baseCurrency}/${targetCurrency}`,
      baseCurrency,
      targetCurrency,
      quoteSymbol: str(product?.quoteSymbol),
      currentRate: num(product?.currentRate || product?.rate),
      quoteTime: str(product?.quoteTime),
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
  const category = str(template?.category) || '기타'
  return {
    id: str(template?.id) || createId(),
    name: str(template?.name) || '(이름 없음)',
    category,
    color: str(template?.color),
    amount: num(template?.amount),
    day: optNum(template?.day),
    paymentMethodId: str(template?.paymentMethodId),
    paymentMethod: str(template?.paymentMethod) || '미지정',
    groupId: str(template?.groupId),
    ...normalizeLoanCalculator(template, category),
  }
}

// --- fixed expense monthly record ------------------------------------------
export function normalizeRecord(record) {
  return normalizeRecurringRecord(record, '고정지출')
}

export function normalizeIncomeRecord(record) {
  return normalizeRecurringRecord(record, '고정수입')
}

function normalizeRecurringRecord(record, fallbackName) {
  const category = str(record?.category) || '기타'
  return {
    id: str(record?.id) || createId(),
    month: str(record?.month || record?.date).slice(0, 7),
    sourceId: str(record?.sourceId || record?.fixedId),
    name: str(record?.name || record?.memo) || fallbackName,
    category,
    amount: num(record?.amount),
    day: optNum(record?.day),
    color: str(record?.color),
    paymentMethodId: str(record?.paymentMethodId),
    paymentMethod: str(record?.paymentMethod) || '미지정',
    ...normalizeLoanCalculator(record, category),
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
  return STAGE_TABS.map((name) => ({ name, visible: DEFAULT_VISIBLE_STAGES.has(name) }))
}

export function defaultTaxSettings() {
  return {
    year: new Date().getFullYear(),
    manualSalary: '',
    dependents: 0,
    children: 0,
    isHomeless: false,
    extraMedical: 0,
    extraEducation: 0,
    extraDonation: 0,
    extraInsurance: 0,
    monthlyRent: 0,
    prepaidTax: 0,
  }
}

export function defaultFixedSectionSettings() {
  return {
    incomeCollapsed: false,
    expenseCollapsed: false,
  }
}

export function normalizeFixedSectionSettings(value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    incomeCollapsed: source.incomeCollapsed === true,
    expenseCollapsed: source.expenseCollapsed === true,
  }
}

export function normalizeTaxSettings(value) {
  const source = value && typeof value === 'object' ? value : {}
  const year = Number(source.year)
  return {
    year: Number.isFinite(year) && year > 2000 ? Math.round(year) : new Date().getFullYear(),
    manualSalary: source.manualSalary === '' || source.manualSalary == null ? '' : num(source.manualSalary),
    dependents: Math.max(0, Math.round(num(source.dependents))),
    children: Math.max(0, Math.round(num(source.children))),
    isHomeless: Boolean(source.isHomeless),
    extraMedical: Math.max(0, num(source.extraMedical)),
    extraEducation: Math.max(0, num(source.extraEducation)),
    extraDonation: Math.max(0, num(source.extraDonation)),
    extraInsurance: Math.max(0, num(source.extraInsurance)),
    monthlyRent: Math.max(0, num(source.monthlyRent)),
    prepaidTax: Math.max(0, num(source.prepaidTax)),
  }
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
    if (!used.has(name)) ordered.push({ name, visible: DEFAULT_VISIBLE_STAGES.has(name) })
  })
  if (!ordered.some((stage) => stage.visible)) ordered[0].visible = true
  return ordered
}

// --- whole document ---------------------------------------------------------
export function buildDefaultDoc() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      theme: 'light',
      stages: defaultStageConfig(),
      fixedSections: defaultFixedSectionSettings(),
      taxSettlement: defaultTaxSettings(),
    },
    stages: {
      income: {
        categories: defaultCategories('수입'),
        entries: [],
        fixed: { templates: [], records: [], closedMonths: [], lastActiveMonth: '' },
      },
      expense: {
        categories: defaultCategories('지출'),
        paymentMethods: defaultMethods(),
        entries: [],
        fixed: { templates: [], records: [], closedMonths: [], lastActiveMonth: '' },
      },
      investment: { products: [], simulations: [] },
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
  const incomeFixed = income.fixed || {}
  const expense = source.stages?.expense || {}
  const fixed = expense.fixed || {}
  const investment = source.stages?.investment || {}
  const incomeLastActiveMonth = str(incomeFixed.lastActiveMonth).slice(0, 7)
  const lastActiveMonth = str(fixed.lastActiveMonth).slice(0, 7)

  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      theme: source.settings?.theme === 'dark' ? 'dark' : 'light',
      stages: normalizeStageConfig(source.settings?.stages),
      fixedSections: normalizeFixedSectionSettings(source.settings?.fixedSections),
      taxSettlement: normalizeTaxSettings(source.settings?.taxSettlement),
    },
    stages: {
      income: {
        categories: categoriesOrDefault(income.categories, '수입'),
        entries: arr(income.entries).map(normalizeEntry),
        fixed: {
          templates: arr(incomeFixed.templates).map(normalizeTemplate),
          records: arr(incomeFixed.records).map(normalizeIncomeRecord).filter((record) => record.month),
          closedMonths: closedMonthList(incomeFixed.closedMonths, incomeFixed.records),
          lastActiveMonth: MONTH_RE.test(incomeLastActiveMonth) ? incomeLastActiveMonth : '',
        },
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
        simulations: arr(investment.simulations).map(normalizeSimulationScenario),
      },
    },
  }
}
