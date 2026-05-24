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
  if (s <= 5_000_000) return Math.round(s * 0.7)
  if (s <= 15_000_000) return Math.round(3_500_000 + (s - 5_000_000) * 0.4)
  if (s <= 45_000_000) return Math.round(7_500_000 + (s - 15_000_000) * 0.15)
  if (s <= 100_000_000) return Math.round(12_000_000 + (s - 45_000_000) * 0.05)
  return Math.round(14_750_000 + (s - 100_000_000) * 0.02)
}

// ---------- 근로소득세액공제 한도 ------------------------------------------
function calcEarnedIncomeTaxCredit(calcTax, salary) {
  const credit = calcTax <= 1_300_000
    ? Math.round(calcTax * 0.55)
    : Math.round(715_000 + (calcTax - 1_300_000) * 0.30)
  const cap = salary <= 33_000_000
    ? 740_000
    : salary <= 70_000_000
      ? 660_000
      : 500_000
  return Math.min(Math.max(credit, 0), cap)
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
export function categorizeCardSpending(entries, paymentMethods, year) {
  const methodKind = new Map((paymentMethods || []).map((m) => [m.id, m.kind]))
  const result = {
    신용카드: 0,
    체크카드현금: 0, // 체크카드 + 현금영수증 + 간편결제 + 계좌
    전통시장: 0,
    대중교통: 0,
    도서공연: 0,
    total: 0,
  }
  ;(entries || []).forEach((e) => {
    if (e.type !== '지출') return
    if ((e.date || '').slice(0, 4) !== String(year)) return
    const amount = Number(e.amount) || 0
    if (amount <= 0) return
    result.total += amount

    const bucket = matchTaxBucket(e.category)
    if (bucket === '전통시장') result.전통시장 += amount
    else if (bucket === '대중교통') result.대중교통 += amount
    else if (bucket === '도서공연') result.도서공연 += amount

    const kind = methodKind.get(e.paymentMethodId) || e.paymentMethod || ''
    if (kind === '신용카드') result.신용카드 += amount
    else result.체크카드현금 += amount
  })
  return result
}

function cardDeductionCap(salary) {
  const regular = salary <= 70_000_000 ? 3_000_000 : salary <= 120_000_000 ? 2_500_000 : 2_000_000
  return { regular, extra: 3_000_000, total: regular + 3_000_000 }
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
    전통시장: consume(spending.전통시장),
    대중교통: consume(spending.대중교통),
    도서공연: consume(spending.도서공연),
  }
  const regular = eligible.신용카드 * 0.15 + eligible.체크카드현금 * 0.30
  const special =
    eligible.전통시장 * 0.40 + eligible.대중교통 * 0.40 + eligible.도서공연 * 0.30

  const regularDeduction = Math.min(regular, cap.regular)
  const specialDeduction = Math.min(special, cap.extra)
  return {
    threshold,
    excess: spending.total - threshold,
    regularDeduction: Math.round(regularDeduction),
    specialDeduction: Math.round(specialDeduction),
    total: Math.round(regularDeduction + specialDeduction),
    breakdown: {
      신용카드: Math.round(eligible.신용카드 * 0.15),
      체크카드현금: Math.round(eligible.체크카드현금 * 0.30),
      전통시장: Math.round(eligible.전통시장 * 0.40),
      대중교통: Math.round(eligible.대중교통 * 0.40),
      도서공연: Math.round(eligible.도서공연 * 0.30),
    },
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
  연금저축: { contribution: 6_000_000, label: '연 600만원 한도 · 13.2~16.5% 세액공제' },
  IRP: { contribution: 9_000_000, label: '연금저축 합산 900만원 한도' },
  주택청약: { contribution: 2_400_000, label: '연 240만원 한도 · 40% 소득공제 (무주택·총급여 7천 이하)' },
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
  const annual = Math.min(monthlyRent * 12, 7_500_000)
  const rate = salary <= 55_000_000 ? 0.17 : 0.15
  return { eligible: annual, rate, credit: Math.round(annual * rate) }
}

function calcPensionCredit(pensionContribution, irpContribution, salary) {
  const pension = Math.min(pensionContribution, 6_000_000)
  const total = Math.min(pension + irpContribution, 9_000_000)
  const rate = salary <= 55_000_000 ? 0.165 : 0.132
  return { eligible: total, rate, credit: Math.round(total * rate) }
}

function calcChildrenCredit(children) {
  const n = Math.max(0, Math.round(children || 0))
  if (n === 0) return 0
  if (n === 1) return 150_000
  if (n === 2) return 350_000
  return 350_000 + (n - 2) * 300_000
}

function calcHousingSavingDeduction(contribution, salary, isHomeless) {
  if (!isHomeless || salary > 70_000_000) return 0
  return Math.round(Math.min(contribution, 2_400_000) * 0.4)
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

  const cardSpending = categorizeCardSpending(entries, paymentMethods, year)
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
  const childrenCredit = calcChildrenCredit(settings?.children)

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

  const totalTaxCredit =
    earnedIncomeTaxCredit +
    childrenCredit +
    medical.credit +
    education.credit +
    insurance.credit +
    donation.credit +
    rent.credit +
    pension.credit

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
    childrenCredit,
    categoryBuckets,
    medical,
    education,
    insurance,
    donation,
    rent,
    pension,
    totalTaxCredit,
    determinedTax,
    prepaidTax,
    refund,
    settings,
  }
}

// ---------- 절세 팁 ---------------------------------------------------------
const fmt = (n) => (Number(n) || 0).toLocaleString('ko-KR') + '원'

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

  const pensionRoom = 6_000_000 - products.연금저축.contribution
  if (pensionRoom > 0) {
    const rate = totalSalary <= 55_000_000 ? 0.165 : 0.132
    tips.push({
      level: 'tip',
      title: '연금저축 한도 미사용',
      detail: `${fmt(pensionRoom)} 더 납입하면 약 ${fmt(Math.round(pensionRoom * rate))} 세액공제. (공제율 ${(rate * 100).toFixed(1)}%)`,
    })
  }

  const pensionIrpRoom =
    9_000_000 - products.연금저축.contribution - products.IRP.contribution
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

  if (totalSalary <= 70_000_000 && settings?.isHomeless && products.주택청약.contribution < 2_400_000) {
    tips.push({
      level: 'tip',
      title: '주택청약 한도 미사용',
      detail: '무주택 + 총급여 7천 이하 조건 충족. 연 240만원까지 40% 소득공제.',
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
