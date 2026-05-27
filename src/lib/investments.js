// Investment-product math: 예금(lump deposit), 적금(installment savings), 주식(stocks), 비트코인, 자산(manual assets), 환율(FX).

function parseYMD(s) {
  const [y, m, d] = String(s || '').split('-').map(Number)
  if (!y || !m) return null
  return { y, m, d: d || 1 }
}

// Whole months elapsed from `from` to `to` (both YYYY-MM-DD).
export function monthsBetween(from, to) {
  const f = parseYMD(from)
  const t = parseYMD(to)
  if (!f || !t) return 0
  let m = (t.y - f.y) * 12 + (t.m - f.m)
  if (t.d < f.d) m -= 1
  return m
}

// "YYYY-MM" label `n` months after `fromYMD`.
export function addMonthLabel(fromYMD, n) {
  const f = parseYMD(fromYMD) || { y: new Date().getFullYear(), m: 1 }
  const total = f.y * 12 + (f.m - 1) + n
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

// 예금: principal grows by interest until maturity, then holds flat.
export function depositMetrics(p, today) {
  const P = Number(p.principal) || 0
  const r = (Number(p.rate) || 0) / 100
  const M = Number(p.months) || 0
  const compound = p.method === '복리'
  const elapsedRaw = Math.max(0, monthsBetween(p.date, today))

  const valueAt = (e) => {
    const t = Math.min(Math.max(e, 0), M)
    if (compound) return P * Math.pow(1 + r / 12, t)
    return P * (1 + r * (t / 12))
  }

  const current = valueAt(elapsedRaw)
  const maturity = valueAt(M)
  return {
    kind: '예금',
    cost: P,
    current,
    profit: current - P,
    maturity,
    maturityProfit: maturity - P,
    elapsed: Math.min(elapsedRaw, M),
    elapsedRaw,
    months: M,
    valueAt,
  }
}

// 적금: a deposit of `monthly` every round; value is a function of round count.
export function savingsMetrics(p, today) {
  const A = Number(p.monthly) || 0
  const r = (Number(p.rate) || 0) / 100
  const N = Math.max(0, Math.floor(Number(p.months) || 0))
  const compound = p.method === '복리'
  const inferred = Math.max(0, monthsBetween(p.date, today) + 1)
  const rawManual = p.round === '' || p.round == null ? null : Number(p.round)
  const manual = Number.isFinite(rawManual) ? rawManual : null
  const roundNow = Math.min(Math.max(Math.floor(manual != null ? manual : inferred), 0), N)

  const valueAtRound = (cRaw) => {
    const c = Math.min(Math.max(Math.floor(cRaw), 0), N)
    const principal = A * c
    if (c <= 0) return { principal: 0, interest: 0, value: 0 }
    if (compound) {
      const mr = r / 12
      const value = mr > 0 ? A * (1 + mr) * (Math.pow(1 + mr, c) - 1) / mr : A * c
      return { principal, interest: value - principal, value }
    }
    const interest = A * (r / 12) * (c * (c + 1) / 2)
    return { principal, interest, value: principal + interest }
  }

  const now = valueAtRound(roundNow)
  const maturity = valueAtRound(N)
  return {
    kind: '적금',
    monthly: A,
    cost: now.principal,
    current: now.value,
    profit: now.interest,
    round: roundNow,
    totalRounds: N,
    maturity: maturity.value,
    maturityProfit: maturity.interest,
    valueAtRound,
  }
}

function currencyCode(value, fallback = 'KRW') {
  const code = String(value || fallback).trim().toUpperCase().replace(/[^A-Z]/g, '')
  return code || fallback
}

export function exchangeRateMetrics(p) {
  const baseCurrency = currencyCode(p.baseCurrency || p.currency || 'USD', 'USD')
  const targetCurrency = currencyCode(p.targetCurrency || 'KRW')
  const rate = Number(p.currentRate || p.rate) || 0
  return {
    kind: '환율',
    baseCurrency,
    targetCurrency,
    rate,
    cost: 0,
    current: 0,
    profit: 0,
  }
}

export function exchangeRateMap(products) {
  const rates = { KRW: 1 }
  for (const p of products || []) {
    if (p?.kind !== '환율') continue
    const m = exchangeRateMetrics(p)
    if (m.rate <= 0) continue
    if (m.targetCurrency === 'KRW') rates[m.baseCurrency] = m.rate
    if (m.baseCurrency === 'KRW') rates[m.targetCurrency] = 1 / m.rate
  }
  return rates
}

// 주식: valuation from fetched prices, converted to KRW with a widget rate or auto-fetched stock rate.
export function stockMetrics(p, rates = {}) {
  const shares = Number(p.shares) || 0
  const buy = Number(p.buyPrice) || 0
  const cur = Number(p.currentPrice) || buy
  const currency = currencyCode(p.quoteCurrency || p.currency)
  const exchangeRate = currency === 'KRW' ? 1 : Number(rates[currency] || p.exchangeRate) || 0
  const cost = shares * buy * exchangeRate
  const value = shares * cur * exchangeRate
  return {
    kind: '주식',
    shares,
    buyPrice: buy,
    currentPrice: cur,
    currency,
    exchangeRate,
    costInCurrency: shares * buy,
    currentInCurrency: shares * cur,
    cost,
    current: value,
    profit: value - cost,
    returnPct: buy > 0 ? (cur / buy - 1) * 100 : 0,
  }
}

export function bitcoinMetrics(p) {
  const quantity = Number(p.quantity ?? p.bitcoinAmount ?? p.btcAmount ?? p.shares) || 0
  const buy = Number(p.buyPrice ?? p.bitcoinBuyPrice) || 0
  const cur = Number(p.currentPrice) || buy
  const cost = quantity * buy
  const value = quantity * cur
  return {
    kind: '비트코인',
    quantity,
    buyPrice: buy,
    currentPrice: cur,
    currency: 'KRW',
    exchangeRate: 1,
    cost,
    current: value,
    profit: value - cost,
    returnPct: buy > 0 ? (cur / buy - 1) * 100 : 0,
  }
}

export function assetMetrics(p) {
  const current = Number(p.assetValue ?? p.currentValue ?? p.value) || 0
  const cost = Number(p.assetCost ?? p.cost) || current
  return {
    kind: '자산',
    assetType: p.assetType || '기타',
    cost,
    current,
    profit: current - cost,
  }
}

export function productMetrics(p, today, rates = {}) {
  if (p.kind === '예금') return depositMetrics(p, today)
  if (p.kind === '적금') return savingsMetrics(p, today)
  if (p.kind === '비트코인') return bitcoinMetrics(p)
  if (p.kind === '자산') return assetMetrics(p)
  if (p.kind === '환율') return exchangeRateMetrics(p)
  return stockMetrics(p, rates)
}

// Totals across all products, plus per-kind current valuation.
export function summarize(products, today) {
  const rates = exchangeRateMap(products)
  let cost = 0
  let current = 0
  const byKind = { 예금: 0, 적금: 0, 주식: 0, 비트코인: 0, 자산: 0, 환율: 0 }
  for (const p of products) {
    const m = productMetrics(p, today, rates)
    cost += m.cost
    current += m.current
    byKind[p.kind] = (byKind[p.kind] || 0) + m.current
  }
  return { cost, current, profit: current - cost, byKind }
}

function projectedReturnMultiplier(returnPct, months) {
  const annualRate = Math.max(-0.99, (Number(returnPct) || 0) / 100)
  return Math.pow(1 + annualRate, Math.max(0, months) / 12)
}

// Monthly total-asset projection: cash held flat, 예금/적금 grow,
// 주식 follows current return rate, 비트코인/자산 held flat.
export function projectAssets(products, cash, today, horizonMonths, options = {}) {
  if (options.scenario) {
    const baseAmount = Math.max(0, Number(options.scenario.baseAmount) || 0)
    const investmentWeight = Math.min(100, Math.max(0, Number(options.scenario.investmentWeight) || 0))
    const annualReturn = Number(options.scenario.annualReturn) || 0
    const monthlyIncome = Math.max(0, Number(options.scenario.monthlyIncome) || 0)
    const monthlyIncomeInvestmentWeight = Math.min(
      100,
      Math.max(0, Number(options.scenario.monthlyIncomeInvestmentWeight) || 0)
    )
    const investmentBase = baseAmount * (investmentWeight / 100)
    const cashBase = baseAmount - investmentBase
    const monthlyInvestment = monthlyIncome * (monthlyIncomeInvestmentWeight / 100)
    const monthlyCash = monthlyIncome - monthlyInvestment
    const points = []

    for (let t = 0; t <= horizonMonths; t++) {
      const recurringInvestment = Array.from({ length: t }, (_, index) => index).reduce(
        (sum, index) => sum + monthlyInvestment * projectedReturnMultiplier(annualReturn, t - index - 1),
        0
      )
      const 투자 = investmentBase * projectedReturnMultiplier(annualReturn, t) + recurringInvestment
      const 현금 = cashBase + monthlyCash * t
      points.push({
        month: addMonthLabel(today, t),
        현금,
        투자,
        총자산: 현금 + 투자,
      })
    }
    return points
  }

  const rates = exchangeRateMap(products)
  const deposits = products
    .filter((p) => p.kind === '예금')
    .map((p) => depositMetrics(p, today))
  const savings = products
    .filter((p) => p.kind === '적금')
    .map((p) => savingsMetrics(p, today))
  const stocks = products
    .filter((p) => p.kind === '주식')
    .map((p) => stockMetrics(p, rates))
  const bitcoinTotal = products
    .filter((p) => p.kind === '비트코인')
    .reduce((s, p) => s + bitcoinMetrics(p).current, 0)
  const assetTotal = products
    .filter((p) => p.kind === '자산')
    .reduce((s, p) => s + assetMetrics(p).current, 0)

  const points = []
  for (let t = 0; t <= horizonMonths; t++) {
    const 예금 = deposits.reduce((s, d) => s + d.valueAt(d.elapsedRaw + t), 0)
    const 적금 = savings.reduce((s, d) => s + d.valueAtRound(d.round + t).value, 0)
    const 주식 = stocks.reduce(
      (s, stock) => s + stock.current * projectedReturnMultiplier(stock.returnPct, t),
      0
    )
    points.push({
      month: addMonthLabel(today, t),
      현금: cash,
      예금,
      적금,
      주식,
      비트코인: bitcoinTotal,
      자산: assetTotal,
      총자산: cash + 예금 + 적금 + 주식 + bitcoinTotal + assetTotal,
    })
  }
  return points
}
