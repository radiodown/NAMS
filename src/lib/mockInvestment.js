// Mock investment (paper trading) data model.
// One portfolio per user. Cash is tracked in KRW. Positions store units +
// KRW cost basis so realized P&L survives FX swings without re-fetching
// historical exchange rates.

import { createId } from './id'

export const MOCK_INVEST_COLOR = '#2563eb'

const str = (v) => String(v ?? '').trim()
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const nonNeg = (v) => Math.max(0, num(v))
const arr = (v) => (Array.isArray(v) ? v : [])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const todayStr = () => new Date().toISOString().slice(0, 10)

export const DEFAULT_STARTING_CASH = 10000000

export function defaultMockPortfolio(overrides = {}) {
  return normalizeMockPortfolio({
    startingCash: DEFAULT_STARTING_CASH,
    cash: DEFAULT_STARTING_CASH,
    realizedPnL: 0,
    createdAt: '',
    positions: [],
    trades: [],
    ...overrides,
  })
}

function normalizePosition(value) {
  const source = value && typeof value === 'object' ? value : {}
  return {
    id: str(source.id) || createId(),
    symbol: str(source.symbol).toUpperCase(),
    name: str(source.name) || str(source.symbol).toUpperCase(),
    currency: str(source.currency).toUpperCase() || 'KRW',
    units: nonNeg(source.units),
    costBasisKRW: nonNeg(source.costBasisKRW),
    avgPriceLocal: nonNeg(source.avgPriceLocal),
    firstBuyDate: DATE_RE.test(str(source.firstBuyDate)) ? str(source.firstBuyDate) : '',
  }
}

function normalizeTrade(value) {
  const source = value && typeof value === 'object' ? value : {}
  const type = str(source.type) === 'sell' ? 'sell' : 'buy'
  return {
    id: str(source.id) || createId(),
    date: DATE_RE.test(str(source.date)) ? str(source.date) : todayStr(),
    type,
    symbol: str(source.symbol).toUpperCase(),
    name: str(source.name) || str(source.symbol).toUpperCase(),
    currency: str(source.currency).toUpperCase() || 'KRW',
    units: nonNeg(source.units),
    priceLocal: nonNeg(source.priceLocal),
    fxRate: nonNeg(source.fxRate) || 1,
    totalKRW: nonNeg(source.totalKRW),
    cashAfter: num(source.cashAfter),
    realizedPnLKRW: type === 'sell' ? num(source.realizedPnLKRW) : 0,
  }
}

export function normalizeMockPortfolio(value) {
  const source = value && typeof value === 'object' ? value : {}
  const startingCash = nonNeg(source.startingCash) || DEFAULT_STARTING_CASH
  const cashRaw = source.cash === '' || source.cash == null ? startingCash : num(source.cash)
  const createdAt = DATE_RE.test(str(source.createdAt)) ? str(source.createdAt) : ''
  return {
    startingCash,
    cash: cashRaw,
    realizedPnL: num(source.realizedPnL),
    createdAt,
    positions: arr(source.positions).map(normalizePosition).filter((p) => p.units > 0),
    trades: arr(source.trades).map(normalizeTrade),
  }
}

// --- pure trade application -------------------------------------------------

function findPosition(positions, symbol, currency) {
  return positions.find((p) => p.symbol === symbol && p.currency === currency)
}

export function applyBuy(portfolio, params) {
  const symbol = str(params.symbol).toUpperCase()
  const currency = str(params.currency).toUpperCase() || 'KRW'
  const name = str(params.name) || symbol
  const units = nonNeg(params.units)
  const priceLocal = nonNeg(params.priceLocal)
  const fxRate = currency === 'KRW' ? 1 : nonNeg(params.fxRate) || 1
  const date = DATE_RE.test(str(params.date)) ? str(params.date) : todayStr()
  if (units <= 0 || priceLocal <= 0) {
    throw new Error('수량과 가격을 입력하세요.')
  }
  const totalKRW = units * priceLocal * fxRate
  if (totalKRW > portfolio.cash + 0.5) {
    throw new Error('가용 현금이 부족합니다.')
  }

  const positions = [...portfolio.positions]
  const existing = findPosition(positions, symbol, currency)
  if (existing) {
    const updated = normalizePosition({
      ...existing,
      units: existing.units + units,
      costBasisKRW: existing.costBasisKRW + totalKRW,
      avgPriceLocal:
        (existing.units * existing.avgPriceLocal + units * priceLocal) /
        (existing.units + units),
      firstBuyDate: existing.firstBuyDate || date,
      name: existing.name || name,
    })
    const idx = positions.indexOf(existing)
    positions[idx] = updated
  } else {
    positions.push(
      normalizePosition({
        symbol,
        name,
        currency,
        units,
        costBasisKRW: totalKRW,
        avgPriceLocal: priceLocal,
        firstBuyDate: date,
      })
    )
  }

  const cashAfter = portfolio.cash - totalKRW
  const trade = normalizeTrade({
    date,
    type: 'buy',
    symbol,
    name,
    currency,
    units,
    priceLocal,
    fxRate,
    totalKRW,
    cashAfter,
    realizedPnLKRW: 0,
  })

  return {
    ...portfolio,
    cash: cashAfter,
    createdAt: portfolio.createdAt || date,
    positions,
    trades: [...portfolio.trades, trade],
  }
}

export function applySell(portfolio, params) {
  const symbol = str(params.symbol).toUpperCase()
  const currency = str(params.currency).toUpperCase() || 'KRW'
  const units = nonNeg(params.units)
  const priceLocal = nonNeg(params.priceLocal)
  const fxRate = currency === 'KRW' ? 1 : nonNeg(params.fxRate) || 1
  const date = DATE_RE.test(str(params.date)) ? str(params.date) : todayStr()
  if (units <= 0 || priceLocal <= 0) {
    throw new Error('수량과 가격을 입력하세요.')
  }

  const existing = findPosition(portfolio.positions, symbol, currency)
  if (!existing || existing.units < units - 1e-6) {
    throw new Error('보유 수량을 초과해 매도할 수 없습니다.')
  }

  const portion = units / existing.units
  const costBasisSold = existing.costBasisKRW * portion
  const proceedsKRW = units * priceLocal * fxRate
  const realizedPnLKRW = proceedsKRW - costBasisSold

  const remainingUnits = existing.units - units
  const remainingCost = existing.costBasisKRW - costBasisSold
  const positions = portfolio.positions.flatMap((p) => {
    if (p !== existing) return [p]
    if (remainingUnits <= 1e-6) return []
    return [
      normalizePosition({
        ...p,
        units: remainingUnits,
        costBasisKRW: remainingCost,
      }),
    ]
  })

  const cashAfter = portfolio.cash + proceedsKRW
  const trade = normalizeTrade({
    date,
    type: 'sell',
    symbol,
    name: existing.name,
    currency,
    units,
    priceLocal,
    fxRate,
    totalKRW: proceedsKRW,
    cashAfter,
    realizedPnLKRW,
  })

  return {
    ...portfolio,
    cash: cashAfter,
    positions,
    realizedPnL: portfolio.realizedPnL + realizedPnLKRW,
    trades: [...portfolio.trades, trade],
  }
}

// --- valuation --------------------------------------------------------------

// quotes: Map symbol -> { price, currency }
// fxRates: Map currency -> rate to KRW (rate * priceLocal = KRW)
export function valuePosition(position, quotes, fxRates) {
  const quote = quotes?.get?.(position.symbol)
  if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) {
    return {
      ...position,
      currentPriceLocal: 0,
      fxRate: 1,
      marketValueKRW: 0,
      unrealizedPnLKRW: -position.costBasisKRW,
      unrealizedPnLPct: 0,
      stale: true,
    }
  }
  const fx =
    position.currency === 'KRW'
      ? 1
      : nonNeg(fxRates?.get?.(position.currency)) || 1
  const marketValueKRW = position.units * quote.price * fx
  const unrealizedPnLKRW = marketValueKRW - position.costBasisKRW
  const unrealizedPnLPct =
    position.costBasisKRW > 0
      ? (unrealizedPnLKRW / position.costBasisKRW) * 100
      : 0
  return {
    ...position,
    currentPriceLocal: quote.price,
    fxRate: fx,
    marketValueKRW,
    unrealizedPnLKRW,
    unrealizedPnLPct,
    stale: false,
  }
}

export function summarizePortfolio(portfolio, quotes, fxRates) {
  const valuedPositions = portfolio.positions.map((p) =>
    valuePosition(p, quotes, fxRates)
  )
  const positionsValueKRW = valuedPositions.reduce(
    (sum, p) => sum + (p.marketValueKRW || 0),
    0
  )
  const unrealizedPnL = valuedPositions.reduce(
    (sum, p) => sum + (p.unrealizedPnLKRW || 0),
    0
  )
  const totalValueKRW = portfolio.cash + positionsValueKRW
  const totalReturnKRW = totalValueKRW - portfolio.startingCash
  const totalReturnPct =
    portfolio.startingCash > 0
      ? (totalReturnKRW / portfolio.startingCash) * 100
      : 0
  return {
    valuedPositions,
    positionsValueKRW,
    unrealizedPnL,
    totalValueKRW,
    totalReturnKRW,
    totalReturnPct,
  }
}

// --- time series ------------------------------------------------------------

// Reconstruct positions + cash as they were on each calendar day in
// [startDate, today]. Returns array of { date, cash, positions: [{symbol,
// currency, units, costBasisKRW}], snapshots: [{symbol, currency, units}] }.
export function replayPortfolioByDay(portfolio) {
  if (!portfolio.createdAt) return []
  const start = portfolio.createdAt
  const today = todayStr()
  if (start > today) return []

  const trades = [...portfolio.trades].sort((a, b) =>
    (a.date || '').localeCompare(b.date || '')
  )
  let cash = portfolio.startingCash
  let realized = 0
  const heldMap = new Map() // key = symbol|currency
  const days = []

  const consume = (untilDate) => {
    while (trades.length && trades[0].date <= untilDate) {
      const trade = trades.shift()
      const key = `${trade.symbol}|${trade.currency}`
      const held = heldMap.get(key) || {
        symbol: trade.symbol,
        currency: trade.currency,
        units: 0,
        costBasisKRW: 0,
      }
      if (trade.type === 'buy') {
        held.units += trade.units
        held.costBasisKRW += trade.totalKRW
        cash -= trade.totalKRW
      } else {
        const portion = held.units > 0 ? trade.units / held.units : 0
        const costSold = held.costBasisKRW * portion
        held.units -= trade.units
        held.costBasisKRW -= costSold
        realized += trade.totalKRW - costSold
        cash += trade.totalKRW
        if (held.units <= 1e-6) {
          heldMap.delete(key)
        }
      }
      if (held.units > 1e-6) heldMap.set(key, held)
    }
  }

  let cursor = start
  while (cursor <= today) {
    consume(cursor)
    days.push({
      date: cursor,
      cash,
      realized,
      holdings: [...heldMap.values()].map((h) => ({
        symbol: h.symbol,
        currency: h.currency,
        units: h.units,
        costBasisKRW: h.costBasisKRW,
      })),
    })
    cursor = addDays(cursor, 1)
  }
  return days
}

function addDays(date, count) {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + count)
  return d.toISOString().slice(0, 10)
}

// Build daily value time series given price and FX history maps.
// priceHistory: Map symbol -> Map(date -> price)
// fxHistory:    Map currency -> Map(date -> rate)
export function portfolioValueSeries(portfolio, priceHistory, fxHistory) {
  const days = replayPortfolioByDay(portfolio)
  return days.map((day) => {
    let invested = 0
    let stale = false
    day.holdings.forEach((h) => {
      const priceMap = priceHistory?.get?.(h.symbol)
      const fxMap = h.currency === 'KRW' ? null : fxHistory?.get?.(h.currency)
      const price = priceMap ? findOnOrBefore(priceMap, day.date) : 0
      const fx = h.currency === 'KRW' ? 1 : fxMap ? findOnOrBefore(fxMap, day.date) : 0
      if (!price || (h.currency !== 'KRW' && !fx)) {
        stale = true
        invested += h.costBasisKRW
        return
      }
      invested += h.units * price * fx
    })
    return {
      date: day.date,
      cash: day.cash,
      invested,
      total: day.cash + invested,
      stale,
    }
  })
}

function findOnOrBefore(map, date) {
  if (map.has(date)) return map.get(date)
  const keys = [...map.keys()].sort()
  let lastValue = 0
  for (const key of keys) {
    if (key > date) break
    lastValue = map.get(key)
  }
  return lastValue
}
