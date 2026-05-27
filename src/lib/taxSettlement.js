// 연말정산 추정 계산 (참고용).
//
// 입력: 거래 내역(수입/지출), 투자 상품(taxBenefit 태그), 결제수단,
// 사용자 설정(연도, 부양가족, 무주택 여부 등).
// 출력: 산출 단계별 결과(근로소득공제 → 과세표준 → 산출세액 → 세액공제 → 결정세액 → 환급).
//
// 실제 연말정산은 회사 원천징수, 부양가족 구성, 의료비 종류, 기부금 단체 분류 등
// 변수가 많아 100% 정확한 시뮬레이션은 어렵다. 이 모듈은 평균적인 직장인 케이스를
// 단순화해 "대략의 절세 효과"를 보여주는 용도.
import { TAX_CATEGORY_BUCKET, TAX_CATEGORY_KEYWORDS } from './categories'
import { formatKRW } from './format'

const EARNED_INCOME_DEDUCTION_CAP = 20_000_000
const CARD_CULTURE_SALARY_LIMIT = 70_000_000
const HOUSING_SAVING_LIMIT = 3_000_000
const MONTHLY_RENT_ANNUAL_LIMIT = 10_000_000
const STANDARD_TAX_CREDIT = 130_000
const MARRIAGE_CREDIT_START_YEAR = 2024
const MARRIAGE_CREDIT_END_YEAR = 2026

// ---------- 세율표 ----------------------------------------------------------
const INCOME_TAX_BRACKETS = [
  { ceil: 14_000_000, rate: 0.06, base: 0, accum: 0 },
  { ceil: 50_000_000, rate: 0.15, base: 14_000_000, accum: 840_000 },
  { ceil: 88_000_000, rate: 0.24, base: 50_000_000, accum: 6_240_000 },
  { ceil: 150_000_000, rate: 0.35, base: 88_000_000, accum: 15_360_000 },
  { ceil: 300_000_000, rate: 0.38, base: 150_000_000, accum: 37_060_000 },
  { ceil: 500_000_000, rate: 0.40, base: 300_000_000, accum: 94_060_000 },
  { ceil: 1_000_000_000, rate: 0.42, base: 500_000_000, accum: 174_060_000 },
  { ceil: Infinity, rate: 0.45, base: 1_000_000_000, accum: 384_060_000 },
]

export function calcIncomeTax(taxableIncome) {
  const income = Math.max(0, Math.round(taxableIncome))
  for (const bracket of INCOME_TAX_BRACKETS) {
    if (income <= bracket.ceil) {
      return Math.round(bracket.accum + (income - bracket.base) * bracket.rate)
    }
  }
  return 0
}

export function bracketLabel(taxableIncome) {
  const income = Math.max(0, Math.round(taxableIncome))
  for (const b of INCOME_TAX_BRACKETS) {
    if (income <= b.ceil) return `${Math.round(b.rate * 100)}%`
  }
  return ''
}

// ---------- 근로소득공제 ----------------------------------------------------
export function calcEarnedIncomeDeduction(salary) {
  const s = Math.max(0, salary)
  let deduction = 0
  if (s <= 5_000_000) deduction = s * 0.7
  else if (s <= 15_000_000) deduction = 3_500_000 + (s - 5_000_000) * 0.4
  else if (s <= 45_000_000) deduction = 7_500_000 + (s - 15_000_000) * 0.15
  else if (s <= 100_000_000) deduction = 12_000_000 + (s - 45_000_000) * 0.05
  else deduction = 14_750_000 + (s - 100_000_000) * 0.02
  return Math.round(Math.min(s, deduction, EARNED_INCOME_DEDUCTION_CAP))
}

// ---------- 근로소득세액공제 한도 ------------------------------------------
function calcEarnedIncomeTaxCredit(calcTax, salary) {
  const credit = calcTax <= 1_300_000
    ? Math.round(calcTax * 0.55)
    : Math.round(715_000 + (calcTax - 1_300_000) * 0.30)
  let cap = 740_000
  if (salary > 120_000_000) {
    cap = Math.max(200_000, 500_000 - (salary - 120_000_000) * 0.5)
  } else if (salary > 70_000_000) {
    cap = Math.max(500_000, 660_000 - (salary - 70_000_000) * 0.5)
  } else if (salary > 33_000_000) {
    cap = Math.max(660_000, 740_000 - (salary - 33_000_000) * 0.008)
  }
  return Math.min(Math.max(credit, 0), Math.round(cap))
}

// ---------- 카테고리 → 공제 버킷 매칭 --------------------------------------
function matchTaxBucket(category) {
  const name = String(category || '').trim()
  if (!name) return null
  if (TAX_CATEGORY_BUCKET[name]) return TAX_CATEGORY_BUCKET[name]
  const lower = name.toLowerCase()
  for (const { bucket, keywords } of TAX_CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return bucket
  }
  return null
}

// ---------- 카드 사용액 분류 ------------------------------------------------
function cardPaymentBucket(kind) {
  const value = String(kind || '').trim()
  if (!value) return null
  if (value === '신용카드' || value === '카드' || value.includes('신용')) return '신용카드'
  if (
    value === '체크카드' ||
    value === '현금' ||
    value.includes('체크') ||
    value.includes('직불') ||
    value.includes('선불') ||
    value.includes('현금영수증') ||
    value.includes('제로페이')
  ) {
    return '체크카드현금'
  }
  return null
}

export function categorizeCardSpending(entries, paymentMethods, year, salary = 0) {
  const methodKind = new Map((paymentMethods || []).map((m) => [m.id, m.kind]))
  const result = {
    신용카드: 0,
    체크카드현금: 0, // 체크카드 + 현금영수증
    전통시장: 0,
    대중교통: 0,
    도서공연: 0,
    total: 0,
    excluded: 0,
  }
  ;(entries || []).forEach((e) => {
    if (e.type !== '지출') return
    if ((e.date || '').slice(0, 4) !== String(year)) return
    const amount = Number(e.amount) || 0
    if (amount <= 0) return

    const bucket = matchTaxBucket(e.category)
    const kind = methodKind.get(e.paymentMethodId) || e.paymentMethod || ''
    const paymentBucket = cardPaymentBucket(kind)
    if (!paymentBucket) {
      result.excluded += amount
      return
    }

    result.total += amount
    if (bucket === '전통시장') result.전통시장 += amount
    else if (bucket === '대중교통') result.대중교통 += amount
    else if (bucket === '도서공연' && salary <= CARD_CULTURE_SALARY_LIMIT) {
      result.도서공연 += amount
    } else {
      result[paymentBucket] += amount
    }
  })
  return result
}

function cardDeductionCap(salary) {
  const regular = salary <= 70_000_000 ? 3_000_000 : 2_500_000
  const extra = salary <= 70_000_000 ? 3_000_000 : 2_000_000
  return { regular, extra, total: regular + extra }
}

function capBreakdown(raw, total) {
  const entries = Object.entries(raw)
  const rawTotal = entries.reduce((sum, [, value]) => sum + value, 0)
  const empty = Object.fromEntries(entries.map(([key]) => [key, 0]))
  if (rawTotal <= 0 || total <= 0) return empty

  const scaled = Object.fromEntries(
    entries.map(([key, value]) => [key, Math.round((value / rawTotal) * total)])
  )
  const diff = Math.round(total) - Object.values(scaled).reduce((sum, value) => sum + value, 0)
  if (diff !== 0) {
    const [largestKey] = entries.reduce((max, item) => (item[1] > max[1] ? item : max), entries[0])
    scaled[largestKey] += diff
  }
  return scaled
}

// 25% 임계선까지는 신용카드 사용액부터 소진, 나머지에 공제율을 적용한다.
export function calcCardDeduction(spending, salary) {
  const threshold = Math.round(salary * 0.25)
  const cap = cardDeductionCap(salary)
  if (salary <= 0 || spending.total <= threshold) {
    return {
      threshold,
      excess: 0,
      regularDeduction: 0,
      specialDeduction: 0,
      total: 0,
      breakdown: { 신용카드: 0, 체크카드현금: 0, 전통시장: 0, 대중교통: 0, 도서공연: 0 },
      cap,
    }
  }
  let remain = threshold
  function consume(value) {
    const used = Math.min(value, remain)
    remain -= used
    return value - used // = 공제대상 금액
  }
  const eligible = {
    신용카드: consume(spending.신용카드),
    체크카드현금: consume(spending.체크카드현금),
    도서공연: consume(spending.도서공연),
    전통시장: consume(spending.전통시장),
    대중교통: consume(spending.대중교통),
  }
  const rawBreakdown = {
    신용카드: eligible.신용카드 * 0.15,
    체크카드현금: eligible.체크카드현금 * 0.30,
    전통시장: eligible.전통시장 * 0.40,
    대중교통: eligible.대중교통 * 0.40,
    도서공연: eligible.도서공연 * 0.30,
  }
  const regular = rawBreakdown.신용카드 + rawBreakdown.체크카드현금
  const special = rawBreakdown.전통시장 + rawBreakdown.대중교통 + rawBreakdown.도서공연
  const rawTotal = regular + special

  const regularDeduction = Math.min(rawTotal, cap.regular)
  const specialDeduction = Math.min(
    Math.max(0, rawTotal - cap.regular),
    special,
    cap.extra
  )
  const total = Math.round(regularDeduction + specialDeduction)
  return {
    threshold,
    excess: spending.total - threshold,
    regularDeduction: Math.round(regularDeduction),
    specialDeduction: Math.round(specialDeduction),
    total,
    rawTotal: Math.round(rawTotal),
    breakdown: capBreakdown(rawBreakdown, total),
    cap,
  }
}

// ---------- 카테고리 공제 항목 집계 ----------------------------------------
export function aggregateDeductibleCategories(entries, year) {
  const buckets = { 의료비: 0, 교육비: 0, 보장성보험: 0, 기부금: 0 }
  ;(entries || []).forEach((e) => {
    if (e.type !== '지출') return
    if ((e.date || '').slice(0, 4) !== String(year)) return
    const bucket = matchTaxBucket(e.category)
    if (bucket && buckets[bucket] != null) buckets[bucket] += Number(e.amount) || 0
  })
  return buckets
}

// ---------- 세제혜택 상품 ---------------------------------------------------
export const PRODUCT_LIMITS = {
  ISA: { contribution: 20_000_000, label: '연 2,000만원 한도 · 만기시 200~400만원 비과세' },
  연금저축: { contribution: 6_000_000, label: '연 600만원 한도 · 12~15% 세액공제' },
  IRP: { contribution: 9_000_000, label: '연금저축 합산 900만원 한도' },
  주택청약: { contribution: HOUSING_SAVING_LIMIT, label: '연 300만원 한도 · 40% 소득공제 (무주택·총급여 7천 이하)' },
  청년도약계좌: { contribution: 8_400_000, label: '연 840만원 한도 · 정부 기여금 + 비과세' },
}

function estimateAnnualContribution(p, year) {
  const startYear = (p.date || '').slice(0, 4)
  if (p.kind === '적금') {
    const monthly = Number(p.monthly) || 0
    if (startYear === String(year)) {
      const startMonth = Number((p.date || '').slice(5, 7)) || 1
      const monthsThisYear = Math.min(
        Math.max(13 - startMonth, 0),
        Number(p.months) || 12
      )
      return monthly * monthsThisYear
    }
    return monthly * 12
  }
  if (p.kind === '예금' && startYear === String(year)) {
    return Number(p.principal) || 0
  }
  if (p.kind === '주식' && startYear === String(year)) {
    return (Number(p.shares) || 0) * (Number(p.buyPrice) || 0)
  }
  return 0
}

export function summarizeProductBenefits(investments, year) {
  const out = {}
  Object.keys(PRODUCT_LIMITS).forEach((key) => {
    out[key] = { contribution: 0, products: [], limit: PRODUCT_LIMITS[key].contribution }
  })
  ;(investments || []).forEach((p) => {
    const tag = p.taxBenefit
    if (!tag || !out[tag]) return
    const contribution = Math.round(estimateAnnualContribution(p, year))
    out[tag].contribution += contribution
    out[tag].products.push({ id: p.id, name: p.name, kind: p.kind, contribution })
  })
  return out
}

// ---------- 세액공제 세부 계산 ----------------------------------------------
function calcMedicalCredit(amount, salary) {
  const threshold = Math.round(salary * 0.03)
  const eligible = Math.max(0, amount - threshold)
  return { amount, threshold, eligible, credit: Math.round(eligible * 0.15) }
}

function calcInsuranceCredit(amount) {
  const eligible = Math.min(amount, 1_000_000)
  return { amount, eligible, credit: Math.round(eligible * 0.12) }
}

function calcEducationCredit(amount) {
  return { amount, eligible: amount, credit: Math.round(amount * 0.15) }
}

function calcDonationCredit(amount) {
  if (amount <= 0) return { amount, eligible: 0, credit: 0 }
  if (amount <= 10_000_000) return { amount, eligible: amount, credit: Math.round(amount * 0.15) }
  return {
    amount,
    eligible: amount,
    credit: Math.round(10_000_000 * 0.15 + (amount - 10_000_000) * 0.30),
  }
}

function calcRentCredit(monthlyRent, salary, isHomeless) {
  if (!isHomeless || monthlyRent <= 0 || salary > 80_000_000) {
    return { eligible: 0, rate: 0, credit: 0 }
  }
  const annual = Math.min(monthlyRent * 12, MONTHLY_RENT_ANNUAL_LIMIT)
  const rate = salary <= 55_000_000 ? 0.17 : 0.15
  return { eligible: annual, rate, credit: Math.round(annual * rate) }
}

function calcPensionCredit(pensionContribution, irpContribution, salary) {
  const pension = Math.min(pensionContribution, 6_000_000)
  const total = Math.min(pension + irpContribution, 9_000_000)
  const rate = salary <= 55_000_000 ? 0.15 : 0.12
  return { eligible: total, rate, credit: Math.round(total * rate) }
}

export function childCreditAgeThreshold(year) {
  const y = Number(year) || new Date().getFullYear()
  if (y <= 2025) return 8
  if (y === 2026) return 9
  if (y === 2027) return 10
  if (y === 2028) return 11
  if (y === 2029) return 12
  return 13
}

function calcChildrenCredit(children, year) {
  const y = Number(year) || new Date().getFullYear()
  const n = Math.max(0, Math.round(children || 0))
  if (n === 0) return 0
  if (y >= 2025) {
    if (n === 1) return 250_000
    if (n === 2) return 550_000
    return 550_000 + (n - 2) * 400_000
  }
  if (y <= 2023) {
    if (n === 1) return 150_000
    if (n === 2) return 300_000
    return 300_000 + (n - 2) * 300_000
  }
  if (n === 1) return 150_000
  if (n === 2) return 350_000
  return 350_000 + (n - 2) * 300_000
}

function calcHousingSavingDeduction(contribution, salary, isHomeless) {
  if (!isHomeless || salary > 70_000_000) return 0
  return Math.round(Math.min(contribution, HOUSING_SAVING_LIMIT) * 0.4)
}

function calcStandardTaxCredit({ medical, education, insurance, donation, rent }) {
  const hasSpecialCredit =
    medical.credit > 0 ||
    education.credit > 0 ||
    insurance.credit > 0 ||
    donation.credit > 0 ||
    rent.credit > 0
  return hasSpecialCredit ? 0 : STANDARD_TAX_CREDIT
}

function calcMarriageCredit(enabled, year) {
  const y = Number(year) || 0
  if (!enabled || y < MARRIAGE_CREDIT_START_YEAR || y > MARRIAGE_CREDIT_END_YEAR) return 0
  return 500_000
}

// ---------- 메인 계산 -------------------------------------------------------
export function autoSalaryFromEntries(entries, year) {
  let sum = 0
  ;(entries || []).forEach((e) => {
    if (e.type !== '수입') return
    if ((e.category || '').trim() !== '급여') return
    if ((e.date || '').slice(0, 4) !== String(year)) return
    sum += Number(e.amount) || 0
  })
  return sum
}

export function computeTaxSettlement({ entries, investments, paymentMethods, settings }) {
  const year = settings?.year || new Date().getFullYear()
  const autoSalary = autoSalaryFromEntries(entries, year)
  const manualSalary = settings?.manualSalary
  const totalSalary =
    manualSalary !== '' && manualSalary != null && Number.isFinite(Number(manualSalary))
      ? Math.max(0, Number(manualSalary))
      : autoSalary

  const earnedDeduction = calcEarnedIncomeDeduction(totalSalary)
  const earnedIncome = Math.max(0, totalSalary - earnedDeduction)

  const personalDeduction = 1_500_000 * (1 + (settings?.dependents || 0))

  const cardSpending = categorizeCardSpending(entries, paymentMethods, year, totalSalary)
  const cardDeduction = calcCardDeduction(cardSpending, totalSalary)

  const products = summarizeProductBenefits(investments, year)

  const housingDeduction = calcHousingSavingDeduction(
    products.주택청약.contribution,
    totalSalary,
    settings?.isHomeless
  )

  const totalIncomeDeduction =
    personalDeduction + cardDeduction.total + housingDeduction

  const taxableIncome = Math.max(0, earnedIncome - totalIncomeDeduction)
  const calculatedTax = calcIncomeTax(taxableIncome)
  const bracket = bracketLabel(taxableIncome)

  const earnedIncomeTaxCredit = calcEarnedIncomeTaxCredit(calculatedTax, totalSalary)
  const childCreditAge = childCreditAgeThreshold(year)
  const childrenCredit = calcChildrenCredit(settings?.children, year)

  const categoryBuckets = aggregateDeductibleCategories(entries, year)
  const medical = calcMedicalCredit(
    categoryBuckets.의료비 + (settings?.extraMedical || 0),
    totalSalary
  )
  const education = calcEducationCredit(
    categoryBuckets.교육비 + (settings?.extraEducation || 0)
  )
  const insurance = calcInsuranceCredit(
    categoryBuckets.보장성보험 + (settings?.extraInsurance || 0)
  )
  const donation = calcDonationCredit(
    categoryBuckets.기부금 + (settings?.extraDonation || 0)
  )
  const rent = calcRentCredit(
    settings?.monthlyRent || 0,
    totalSalary,
    settings?.isHomeless
  )
  const pension = calcPensionCredit(
    products.연금저축.contribution,
    products.IRP.contribution,
    totalSalary
  )
  const standardTaxCredit = calcStandardTaxCredit({ medical, education, insurance, donation, rent })
  const marriageCredit = calcMarriageCredit(settings?.marriageCredit, year)

  const totalTaxCredit =
    earnedIncomeTaxCredit +
    childrenCredit +
    medical.credit +
    education.credit +
    insurance.credit +
    donation.credit +
    rent.credit +
    pension.credit +
    standardTaxCredit +
    marriageCredit

  const determinedTax = Math.max(0, calculatedTax - totalTaxCredit)
  const prepaidTax = settings?.prepaidTax || 0
  const refund = prepaidTax - determinedTax

  return {
    year,
    totalSalary,
    autoSalary,
    salaryIsManual: manualSalary !== '' && manualSalary != null,
    earnedDeduction,
    earnedIncome,
    personalDeduction,
    cardSpending,
    cardDeduction,
    products,
    housingDeduction,
    totalIncomeDeduction,
    taxableIncome,
    calculatedTax,
    bracket,
    earnedIncomeTaxCredit,
    childCreditAge,
    childrenCredit,
    categoryBuckets,
    medical,
    education,
    insurance,
    donation,
    rent,
    pension,
    standardTaxCredit,
    marriageCredit,
    totalTaxCredit,
    determinedTax,
    prepaidTax,
    refund,
    settings,
  }
}

// ---------- 절세 팁 ---------------------------------------------------------
const fmt = formatKRW

export function generateTaxTips(result) {
  const tips = []
  if (!result || result.totalSalary <= 0) {
    tips.push({
      level: 'info',
      title: '총급여를 먼저 설정하세요',
      detail: '수입 탭에서 "급여" 카테고리로 입력하거나, 상단에서 직접 입력하면 추정이 시작됩니다.',
    })
    return tips
  }
  const { cardSpending, cardDeduction, products, totalSalary, settings } = result

  if (cardSpending.total < cardDeduction.threshold) {
    tips.push({
      level: 'warn',
      title: '카드 공제 임계선 미달',
      detail: `총급여 25%인 ${fmt(cardDeduction.threshold)}을 넘어야 공제가 시작됩니다. ${fmt(cardDeduction.threshold - cardSpending.total)} 부족.`,
    })
  } else {
    const sum = cardSpending.신용카드 + cardSpending.체크카드현금
    const debitShare = sum > 0 ? cardSpending.체크카드현금 / sum : 0
    if (cardSpending.신용카드 > 0 && debitShare < 0.4) {
      tips.push({
        level: 'tip',
        title: '체크카드·현금영수증 비중 늘리기',
        detail:
          '체크카드와 현금영수증은 신용카드(15%)의 2배인 30% 공제율. 임계선 초과분은 체크카드로 쓰면 공제 효과가 더 커집니다.',
      })
    }
  }

  if (cardSpending.excluded > 0) {
    tips.push({
      level: 'info',
      title: '미확인 결제수단은 카드 공제에서 제외',
      detail: `${fmt(cardSpending.excluded)}은 신용카드·체크카드·현금영수증 등으로 확인되지 않아 카드 사용액에서 제외했습니다.`,
    })
  }

  const pensionTotalRoom =
    9_000_000 - products.연금저축.contribution - products.IRP.contribution
  const pensionRoom = Math.min(6_000_000 - products.연금저축.contribution, pensionTotalRoom)
  if (pensionRoom > 0) {
    const rate = totalSalary <= 55_000_000 ? 0.15 : 0.12
    tips.push({
      level: 'tip',
      title: '연금저축 한도 미사용',
      detail: `${fmt(pensionRoom)} 더 납입하면 약 ${fmt(Math.round(pensionRoom * rate))} 세액공제. (공제율 ${(rate * 100).toFixed(1)}%)`,
    })
  }

  const pensionIrpRoom = pensionTotalRoom
  if (pensionIrpRoom > 0) {
    tips.push({
      level: 'tip',
      title: 'IRP 추가 납입 여지',
      detail: `연금저축 + IRP 합산 900만원 한도까지 ${fmt(pensionIrpRoom)} 여유. IRP에 추가 납입 가능.`,
    })
  }

  const isaRoom = 20_000_000 - products.ISA.contribution
  if (isaRoom > 0) {
    tips.push({
      level: 'tip',
      title: 'ISA 한도 활용',
      detail: '연 2,000만원까지 납입 가능. 만기 시 200~400만원 비과세 + 초과분 9.9% 분리과세.',
    })
  }

  if (totalSalary <= 70_000_000 && settings?.isHomeless && products.주택청약.contribution < HOUSING_SAVING_LIMIT) {
    tips.push({
      level: 'tip',
      title: '주택청약 한도 미사용',
      detail: '무주택 + 총급여 7천 이하 조건 충족. 연 300만원까지 40% 소득공제.',
    })
  }

  if (
    !settings?.marriageCredit &&
    result.year >= MARRIAGE_CREDIT_START_YEAR &&
    result.year <= MARRIAGE_CREDIT_END_YEAR
  ) {
    tips.push({
      level: 'info',
      title: '혼인세액공제 확인',
      detail: '2024~2026년에 혼인신고를 했다면 생애 1회 50만원 세액공제 대상일 수 있습니다.',
    })
  }

  if (result.refund > 0) {
    tips.push({
      level: 'good',
      title: `예상 환급액 ${fmt(result.refund)}`,
      detail: '기납부세액 입력값 기준. 실제 환급은 회사 제출 자료에 따라 달라집니다.',
    })
  } else if (result.refund < 0) {
    tips.push({
      level: 'warn',
      title: `추가 납부 예상 ${fmt(Math.abs(result.refund))}`,
      detail: '기납부세액이 결정세액보다 작습니다. 세액공제 항목 추가 활용을 검토하세요.',
    })
  }

  return tips
}
