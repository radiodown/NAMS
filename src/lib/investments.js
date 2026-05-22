// Investment-product math: 예금(lump deposit), 적금(installment savings), 주식(stocks).

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
  const N = Number(p.months) || 0
  const compound = p.method === '복리'
  const inferred = Math.max(0, monthsBetween(p.date, today) + 1)
  const manual = p.round === '' || p.round == null ? null : Number(p.round)
  const roundNow = Math.min(Math.max(manual != null ? manual : inferred, 0), N)

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

// 주식: valuation from fetched prices, falling back to buy price until the first quote arrives.
export function stockMetrics(p) {
  const shares = Number(p.shares) || 0
  const buy = Number(p.buyPrice) || 0
  const cur = Number(p.currentPrice) || buy
  const cost = shares * buy
  const value = shares * cur
  return {
    kind: '주식',
    shares,
    buyPrice: buy,
    currentPrice: cur,
    cost,
    current: value,
    profit: value - cost,
    returnPct: buy > 0 ? (cur / buy - 1) * 100 : 0,
  }
}

export function productMetrics(p, today) {
  if (p.kind === '예금') return depositMetrics(p, today)
  if (p.kind === '적금') return savingsMetrics(p, today)
  return stockMetrics(p)
}

// Totals across all products, plus per-kind current valuation.
export function summarize(products, today) {
  let cost = 0
  let current = 0
  const byKind = { 예금: 0, 적금: 0, 주식: 0 }
  for (const p of products) {
    const m = productMetrics(p, today)
    cost += m.cost
    current += m.current
    byKind[p.kind] = (byKind[p.kind] || 0) + m.current
  }
  return { cost, current, profit: current - cost, byKind }
}

// Monthly total-asset projection: cash held flat, 예금/적금 grow, 주식 held flat.
export function projectAssets(products, cash, today, horizonMonths) {
  const deposits = products
    .filter((p) => p.kind === '예금')
    .map((p) => depositMetrics(p, today))
  const savings = products
    .filter((p) => p.kind === '적금')
    .map((p) => savingsMetrics(p, today))
  const stockTotal = products
    .filter((p) => p.kind === '주식')
    .reduce((s, p) => s + stockMetrics(p).current, 0)

  const points = []
  for (let t = 0; t <= horizonMonths; t++) {
    const 예금 = deposits.reduce((s, d) => s + d.valueAt(d.elapsedRaw + t), 0)
    const 적금 = savings.reduce((s, d) => s + d.valueAtRound(d.round + t).value, 0)
    points.push({
      month: addMonthLabel(today, t),
      현금: cash,
      예금,
      적금,
      주식: stockTotal,
      총자산: cash + 예금 + 적금 + stockTotal,
    })
  }
  return points
}
