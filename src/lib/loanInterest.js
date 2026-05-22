import { parseNumberInput } from './numberInput'

export const LOAN_INTEREST_CATEGORY = '대출이자'
export const LOAN_REPAYMENT_METHODS = [
  '만기일시상환',
  '원금균등상환',
  '원리금균등상환',
  '거치 후 원리금균등상환',
]

export function normalizeLoanInterestCategory(value) {
  return String(value || '').replace(/\s+/g, '')
}

export function isLoanInterestCategory(value) {
  return normalizeLoanInterestCategory(value) === LOAN_INTEREST_CATEGORY
}

export function normalizeLoanMethod(value) {
  return LOAN_REPAYMENT_METHODS.includes(value) ? value : LOAN_REPAYMENT_METHODS[0]
}

function positiveInt(value, fallback) {
  const n = Math.floor(parseNumberInput(value))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function roundKRW(value) {
  return Math.round(Number.isFinite(value) ? value : 0)
}

function equalPayment(principal, monthlyRate, months, round) {
  if (principal <= 0 || months <= 0) return { interest: 0, principalPayment: 0, totalPayment: 0 }
  const payment = monthlyRate > 0
    ? principal * monthlyRate * Math.pow(1 + monthlyRate, months) /
      (Math.pow(1 + monthlyRate, months) - 1)
    : principal / months
  const paidRounds = round - 1
  const remainingBefore = monthlyRate > 0
    ? principal * Math.pow(1 + monthlyRate, paidRounds) -
      payment * ((Math.pow(1 + monthlyRate, paidRounds) - 1) / monthlyRate)
    : principal - payment * paidRounds
  const interest = remainingBefore * monthlyRate
  const principalPayment = round >= months ? remainingBefore : Math.min(payment - interest, remainingBefore)
  return {
    interest: roundKRW(interest),
    principalPayment: roundKRW(principalPayment),
    totalPayment: roundKRW(principalPayment + interest),
  }
}

export function calculateLoanPayment({ principal, rate, months, round, method, graceMonths }) {
  const p = parseNumberInput(principal) || 0
  const monthlyRate = ((parseNumberInput(rate) || 0) / 100) / 12
  const totalMonths = positiveInt(months, 1)
  const currentRound = clamp(positiveInt(round, 1), 1, totalMonths)
  const repaymentMethod = normalizeLoanMethod(method)
  const grace = repaymentMethod === '거치 후 원리금균등상환'
    ? clamp(Math.floor(parseNumberInput(graceMonths) || 0), 0, totalMonths - 1)
    : 0

  if (p <= 0) {
    return {
      method: repaymentMethod,
      round: currentRound,
      graceMonths: grace,
      interest: 0,
      principalPayment: 0,
      totalPayment: 0,
      phase: grace && currentRound <= grace ? '거치' : '상환',
    }
  }

  if (repaymentMethod === '만기일시상환') {
    const interest = roundKRW(p * monthlyRate)
    const principalPayment = currentRound >= totalMonths ? p : 0
    return {
      method: repaymentMethod,
      round: currentRound,
      graceMonths: grace,
      interest,
      principalPayment: roundKRW(principalPayment),
      totalPayment: roundKRW(principalPayment + interest),
      phase: '상환',
    }
  }

  if (repaymentMethod === '원금균등상환') {
    const monthlyPrincipal = p / totalMonths
    const remainingBefore = Math.max(p - monthlyPrincipal * (currentRound - 1), 0)
    const principalPayment = currentRound >= totalMonths
      ? remainingBefore
      : Math.min(monthlyPrincipal, remainingBefore)
    const interest = remainingBefore * monthlyRate
    return {
      method: repaymentMethod,
      round: currentRound,
      graceMonths: grace,
      interest: roundKRW(interest),
      principalPayment: roundKRW(principalPayment),
      totalPayment: roundKRW(principalPayment + interest),
      phase: '상환',
    }
  }

  if (repaymentMethod === '거치 후 원리금균등상환' && currentRound <= grace) {
    const interest = roundKRW(p * monthlyRate)
    return {
      method: repaymentMethod,
      round: currentRound,
      graceMonths: grace,
      interest,
      principalPayment: 0,
      totalPayment: interest,
      phase: '거치',
    }
  }

  const amortizedMonths = repaymentMethod === '거치 후 원리금균등상환'
    ? totalMonths - grace
    : totalMonths
  const amortizedRound = repaymentMethod === '거치 후 원리금균등상환'
    ? currentRound - grace
    : currentRound
  const result = equalPayment(p, monthlyRate, amortizedMonths, amortizedRound)
  return {
    method: repaymentMethod,
    round: currentRound,
    graceMonths: grace,
    ...result,
    phase: '상환',
  }
}

export function calculateLoanInterest(input) {
  return calculateLoanPayment(input).interest
}
