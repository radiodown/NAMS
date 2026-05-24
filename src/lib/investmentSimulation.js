import { addMonthLabel } from './investments'

export const INVEST_SIM_COLOR = '#2563eb'

export const INVEST_SIM_STRATEGIES = [
  '일시 투자',
  '적립식 투자',
  '목표 비중 리밸런싱',
  '이동평균선',
  '손절/익절',
]

const DEFAULT_SCENARIO = {
  id: '',
  name: '기본 시나리오',
  assetName: '성장형 포트폴리오',
  startDate: '',
  years: 10,
  initialCapital: 10000000,
  monthlyContribution: 500000,
  annualReturn: 7,
  annualVolatility: 12,
  cashAnnualReturn: 2,
  benchmarkAnnualReturn: 6,
  riskFreeRate: 2,
  riskAssetWeight: 80,
  strategy: '적립식 투자',
  rebalanceMonths: 12,
  movingAverageMonths: 10,
  stopLossPct: 20,
  takeProfitPct: 35,
  feeRate: 0.05,
  taxRate: 15.4,
  slippageRate: 0.03,
}

const str = (value) => String(value ?? '').trim()
const num = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const pct = (value) => clamp(num(value), 0, 100)

function monthDateLabel(startDate, month) {
  return addMonthLabel(startDate || new Date().toISOString().slice(0, 10), month)
}

function geometricMonthlyRate(annualPct) {
  return Math.pow(1 + num(annualPct) / 100, 1 / 12) - 1
}

function annualizedIrr(cashFlows) {
  if (!cashFlows.some((flow) => flow < 0) || !cashFlows.some((flow) => flow > 0)) return 0

  let low = -0.95
  let high = 1
  const npv = (rate) =>
    cashFlows.reduce((sum, flow, index) => sum + flow / Math.pow(1 + rate, index), 0)

  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2
    if (npv(mid) > 0) low = mid
    else high = mid
  }

  return (Math.pow(1 + (low + high) / 2, 12) - 1) * 100
}

function standardDeviation(values) {
  if (values.length < 2) return 0
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function deterministicMarketReturn(month, annualReturn, annualVolatility) {
  const base = geometricMonthlyRate(annualReturn)
  const monthlyVol = Math.max(0, num(annualVolatility) / 100) / Math.sqrt(12)
  const wave =
    Math.sin(month * 0.82 + 0.4) * monthlyVol * 0.72 +
    Math.sin(month * 0.31 + 1.9) * monthlyVol * 0.46 -
    Math.sin(month * 0.13) * monthlyVol * 0.24
  return clamp(base + wave, -0.35, 0.35)
}

export function defaultSimulationScenario(overrides = {}) {
  return normalizeSimulationScenario({ ...DEFAULT_SCENARIO, ...overrides })
}

export function normalizeSimulationScenario(value) {
  const source = value && typeof value === 'object' ? value : {}
  const valueOrDefault = (key) =>
    Object.prototype.hasOwnProperty.call(source, key) ? source[key] : DEFAULT_SCENARIO[key]
  const strategy = INVEST_SIM_STRATEGIES.includes(str(source.strategy))
    ? str(source.strategy)
    : DEFAULT_SCENARIO.strategy

  return {
    id: str(source.id),
    name: str(source.name) || DEFAULT_SCENARIO.name,
    assetName: str(source.assetName) || DEFAULT_SCENARIO.assetName,
    startDate: str(source.startDate),
    years: clamp(num(valueOrDefault('years')) || DEFAULT_SCENARIO.years, 1, 40),
    initialCapital: Math.max(0, num(valueOrDefault('initialCapital'))),
    monthlyContribution: Math.max(0, num(valueOrDefault('monthlyContribution'))),
    annualReturn: clamp(num(valueOrDefault('annualReturn')), -40, 80),
    annualVolatility: clamp(num(valueOrDefault('annualVolatility')), 0, 80),
    cashAnnualReturn: clamp(num(valueOrDefault('cashAnnualReturn')), -10, 30),
    benchmarkAnnualReturn: clamp(num(valueOrDefault('benchmarkAnnualReturn')), -40, 80),
    riskFreeRate: clamp(num(valueOrDefault('riskFreeRate')), -10, 30),
    riskAssetWeight: pct(valueOrDefault('riskAssetWeight')),
    strategy,
    rebalanceMonths: clamp(Math.round(num(valueOrDefault('rebalanceMonths')) || 12), 1, 60),
    movingAverageMonths: clamp(Math.round(num(valueOrDefault('movingAverageMonths')) || 10), 2, 36),
    stopLossPct: pct(valueOrDefault('stopLossPct')),
    takeProfitPct: pct(valueOrDefault('takeProfitPct')),
    feeRate: pct(valueOrDefault('feeRate')),
    taxRate: pct(valueOrDefault('taxRate')),
    slippageRate: pct(valueOrDefault('slippageRate')),
  }
}

export function buildBenchmarkScenario(scenario) {
  const base = normalizeSimulationScenario(scenario)
  return normalizeSimulationScenario({
    ...base,
    id: 'benchmark',
    name: '벤치마크',
    assetName: '벤치마크',
    annualReturn: base.benchmarkAnnualReturn,
    annualVolatility: base.annualVolatility * 0.55,
    cashAnnualReturn: 0,
    riskAssetWeight: 100,
    strategy: base.strategy === '일시 투자' ? '일시 투자' : '적립식 투자',
    feeRate: 0,
    taxRate: 0,
    slippageRate: 0,
  })
}

export function simulateInvestmentScenario(rawScenario, options = {}) {
  const scenario = normalizeSimulationScenario(rawScenario)
  const months = Math.max(1, Math.round(scenario.years * 12))
  const tradeCostRate = (scenario.feeRate + scenario.slippageRate) / 100
  const taxRate = scenario.taxRate / 100
  const targetWeight = scenario.riskAssetWeight / 100
  const cashMonthlyRate = geometricMonthlyRate(scenario.cashAnnualReturn)
  const monthlyContribution = scenario.strategy === '일시 투자' ? 0 : scenario.monthlyContribution

  let cash = scenario.initialCapital
  let riskUnits = 0
  let riskCostBasis = 0
  let riskPrice = 100
  let peakValue = scenario.initialCapital
  let totalContributed = scenario.initialCapital
  let totalFees = 0
  let totalTaxes = 0
  let active = true
  let pausedUntil = 0
  let entryPrice = riskPrice
  let previousValue = scenario.initialCapital
  let trendRiskOn = true

  const points = []
  const events = []
  const monthlyReturns = []
  const cashFlows = [-scenario.initialCapital]
  const priceHistory = [riskPrice]
  const addEvent = (month, type, label, amount = 0) => {
    events.push({
      month,
      date: monthDateLabel(scenario.startDate, month),
      type,
      label,
      amount,
    })
  }

  function riskValue() {
    return riskUnits * riskPrice
  }

  function portfolioValue() {
    return cash + riskValue()
  }

  function buy(amount, month, label) {
    const wanted = Math.max(0, amount)
    const affordable = cash / (1 + tradeCostRate)
    const tradeValue = Math.min(wanted, affordable)
    if (tradeValue < 1) return 0
    const cost = tradeValue * tradeCostRate
    riskUnits += tradeValue / riskPrice
    riskCostBasis += tradeValue
    cash -= tradeValue + cost
    totalFees += cost
    addEvent(month, '매수', label, tradeValue)
    return tradeValue
  }

  function sell(amount, month, label) {
    const currentRiskValue = riskValue()
    const tradeValue = Math.min(Math.max(0, amount), currentRiskValue)
    if (tradeValue < 1 || riskUnits <= 0) return 0
    const unitsSold = tradeValue / riskPrice
    const basisSold = riskCostBasis * (unitsSold / riskUnits)
    const taxableGain = Math.max(0, tradeValue - basisSold)
    const tax = taxableGain * taxRate
    const cost = tradeValue * tradeCostRate
    riskUnits -= unitsSold
    riskCostBasis = Math.max(0, riskCostBasis - basisSold)
    cash += tradeValue - tax - cost
    totalTaxes += tax
    totalFees += cost
    addEvent(month, '매도', label, tradeValue)
    return tradeValue
  }

  function rebalanceTo(weight, month, label, allowSell = true) {
    const value = portfolioValue()
    const desiredRiskValue = value * clamp(weight, 0, 1)
    const diff = desiredRiskValue - riskValue()
    if (diff > 1) return buy(diff, month, label)
    if (diff < -1 && allowSell) return sell(Math.abs(diff), month, label)
    return 0
  }

  function movingAverageTarget(month) {
    const lookback = scenario.movingAverageMonths
    if (priceHistory.length < lookback) return targetWeight
    const sample = priceHistory.slice(-lookback)
    const average = sample.reduce((sum, value) => sum + value, 0) / sample.length
    const nextRiskOn = riskPrice >= average
    if (nextRiskOn !== trendRiskOn) {
      addEvent(
        month,
        nextRiskOn ? '진입' : '대기',
        nextRiskOn ? '이동평균 상향 돌파' : '이동평균 하향 이탈',
        riskValue()
      )
      trendRiskOn = nextRiskOn
    }
    return nextRiskOn ? targetWeight : 0
  }

  function stopLossTarget(month) {
    if (!active && month >= pausedUntil) {
      active = true
      entryPrice = riskPrice
      addEvent(month, '진입', '휴식 기간 종료 후 재진입', portfolioValue() * targetWeight)
    }

    if (!active) return 0

    const entryReturn = entryPrice > 0 ? (riskPrice / entryPrice - 1) * 100 : 0
    if (entryReturn <= -scenario.stopLossPct) {
      active = false
      pausedUntil = month + scenario.rebalanceMonths
      addEvent(month, '대기', `손절 조건 도달 (${entryReturn.toFixed(1)}%)`, riskValue())
      return 0
    }
    if (entryReturn >= scenario.takeProfitPct) {
      active = false
      pausedUntil = month + scenario.rebalanceMonths
      addEvent(month, '대기', `익절 조건 도달 (${entryReturn.toFixed(1)}%)`, riskValue())
      return 0
    }

    return targetWeight
  }

  function strategyTarget(month) {
    if (scenario.strategy === '이동평균선') return movingAverageTarget(month)
    if (scenario.strategy === '손절/익절') return stopLossTarget(month)
    return targetWeight
  }

  function recordPoint(month, flow = 0) {
    const value = portfolioValue()
    peakValue = Math.max(peakValue, value)
    const drawdownPct = peakValue > 0 ? (value / peakValue - 1) * 100 : 0
    const risk = riskValue()
    const point = {
      month,
      date: monthDateLabel(scenario.startDate, month),
      asset: Math.round(value),
      cash: Math.round(cash),
      riskAsset: Math.round(risk),
      riskWeightPct: value > 0 ? (risk / value) * 100 : 0,
      cashWeightPct: value > 0 ? (cash / value) * 100 : 0,
      contributed: Math.round(totalContributed),
      returnPct: totalContributed > 0 ? (value / totalContributed - 1) * 100 : 0,
      drawdownPct,
      marketPrice: riskPrice,
    }
    points.push(point)

    if (month > 0 && previousValue > 0) {
      monthlyReturns.push((value - flow) / previousValue - 1)
    }
    previousValue = value
  }

  if (options.includeBenchmarkEvent !== false) addEvent(0, '시작', '시뮬레이션 시작', scenario.initialCapital)
  const initialWeight = strategyTarget(0)
  rebalanceTo(initialWeight, 0, '초기 배분')
  recordPoint(0, 0)

  for (let month = 1; month <= months; month += 1) {
    riskPrice *= 1 + deterministicMarketReturn(month, scenario.annualReturn, scenario.annualVolatility)
    priceHistory.push(riskPrice)
    cash *= 1 + cashMonthlyRate

    let flow = 0
    if (monthlyContribution > 0) {
      cash += monthlyContribution
      totalContributed += monthlyContribution
      cashFlows[month] = -monthlyContribution
      flow = monthlyContribution
    } else {
      cashFlows[month] = 0
    }

    const currentTarget = strategyTarget(month)
    if (scenario.strategy === '적립식 투자') {
      rebalanceTo(currentTarget, month, '월 적립 매수', false)
    } else if (scenario.strategy === '목표 비중 리밸런싱') {
      const shouldRebalance = month % scenario.rebalanceMonths === 0
      rebalanceTo(currentTarget, month, shouldRebalance ? '정기 리밸런싱' : '월 적립 매수', shouldRebalance)
    } else {
      rebalanceTo(currentTarget, month, '전략 조건 반영', true)
    }

    recordPoint(month, flow)
  }

  const finalValue = portfolioValue()
  cashFlows[months] = (cashFlows[months] || 0) + finalValue
  const annualizedReturnPct = annualizedIrr(cashFlows)
  const volatilityPct = standardDeviation(monthlyReturns) * Math.sqrt(12) * 100
  const maxDrawdownPct = points.reduce((min, point) => Math.min(min, point.drawdownPct), 0)
  const sharpeRatio =
    volatilityPct > 0 ? (annualizedReturnPct - scenario.riskFreeRate) / volatilityPct : 0

  return {
    scenario,
    points,
    events,
    metrics: {
      finalValue,
      totalContributed,
      profit: finalValue - totalContributed,
      totalReturnPct: totalContributed > 0 ? (finalValue / totalContributed - 1) * 100 : 0,
      annualizedReturnPct,
      maxDrawdownPct,
      volatilityPct,
      sharpeRatio,
      totalFees,
      totalTaxes,
    },
  }
}
