import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Sector,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { INVEST_META, INVEST_KINDS } from '../lib/categories'
import { normalizeInvestmentTaxBenefit, taxBenefitOptionsForKind } from '../lib/schema'
import { compactKRW, formatKRW, todayStr } from '../lib/format'
import { exchangeRateMap, productMetrics, stockMetrics, summarize } from '../lib/investments'
import { parseAmountInput, parseNumberInput } from '../lib/numberInput'
import {
  fetchExchangeRate,
  fetchStockHistory,
  fetchStockQuote,
  fetchStockSearch,
  normalizeCurrencyCode,
  normalizeStockSymbol,
} from '../lib/quotes'
import CalendarInput from './CalendarInput'
import NumberInput from './NumberInput'
import PlusIcon from './PlusIcon'

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  )
}

const INVEST_COLORS = [
  '#d97706', '#dc2626', '#16a34a', '#0891b2', '#2563eb',
  '#7c3aed', '#db2777', '#0d9488',
]

const defaultColor = (kind) => INVEST_META[kind]?.color || INVEST_COLORS[0]

function hexToRgb(hex) {
  const s = String(hex || '').trim().replace(/^#/, '')
  const full = s.length === 3 ? s.replace(/./g, (c) => c + c) : s
  if (full.length !== 6) return null
  const n = Number.parseInt(full, 16)
  return Number.isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex([r, g, b]) {
  const h = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function productColor(product) {
  return String(product?.color || '').trim() || defaultColor(product?.kind)
}

function averageProductColor(products) {
  let r = 0
  let g = 0
  let b = 0
  let count = 0

  products.forEach((product) => {
    const rgb = hexToRgb(productColor(product))
    if (!rgb) return
    r += rgb[0]
    g += rgb[1]
    b += rgb[2]
    count += 1
  })

  if (count === 0) return productColor(products[0])
  return rgbToHex([r / count, g / count, b / count])
}

// Representative FX pairs shown in the rotating top widget.
const REP_FX_PAIRS = [
  { base: 'USD', target: 'KRW', label: '미국 달러' },
  { base: 'JPY', target: 'KRW', label: '일본 엔' },
  { base: 'EUR', target: 'KRW', label: '유로' },
  { base: 'CNY', target: 'KRW', label: '중국 위안' },
  { base: 'GBP', target: 'KRW', label: '영국 파운드' },
]
const REP_FX_INTERVAL_MS = 2800
const STOCK_QUOTE_REFRESH_MS = 1000 * 60
const FX_QUOTE_REFRESH_MS = 1000 * 60 * 60
const REP_FX_REFRESH_MS = FX_QUOTE_REFRESH_MS
const STOCK_CHART_RANGES = [
  { label: '1개월', value: '1mo', interval: '1d' },
  { label: '3개월', value: '3mo', interval: '1d' },
  { label: '1년', value: '1y', interval: '1wk' },
]
const REPORT_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#0891b2', '#7c3aed']
const PORTFOLIO_BUCKETS = {
  safe: { id: 'safe', label: '안전자산', color: '#16a34a', desc: '예금, 적금, 현금성·채권 자산' },
  risk: { id: 'risk', label: '위험자산', color: '#dc2626', desc: '주식, 비트코인처럼 가격 변동이 큰 자산' },
  alt: { id: 'alt', label: '대체자산', color: '#d97706', desc: '금, 부동산, 기타 실물·대체 자산' },
}
const SAFE_ASSET_GROUPS = {
  deposit: { id: 'deposit', label: '예금', color: '#16a34a' },
  saving: { id: 'saving', label: '적금', color: '#0891b2' },
  cash: { id: 'cash', label: '현금', color: '#2563eb' },
  bond: { id: 'bond', label: '채권', color: '#0d9488' },
  foreign: { id: 'foreign', label: '외화', color: '#0284c7' },
  other: { id: 'other', label: '기타 안전자산', color: '#65a30d' },
}
const STALE_QUOTE_MS = 1000 * 60 * 60 * 72
const QUOTE_REFRESH_MS = STOCK_QUOTE_REFRESH_MS
const QUOTE_STAGGER_MS = 1400
const QUOTE_FRESH_MS = STOCK_QUOTE_REFRESH_MS
const QUOTE_RETRY_BACKOFF_MS = 1000 * 60 * 20
const QUOTE_EMPTY_RETRY_BACKOFF_MS = 1000 * 60 * 5
const BITCOIN_SYMBOL = 'BTC-KRW'
const ASSET_TYPE_OPTIONS = ['현금성자산', '금', '외화', '채권', '부동산', '기타']
const STABLE_ASSET_KINDS = new Set(['예금', '적금', '자산'])
const MARKET_ASSET_KINDS = new Set(['주식', '비트코인'])

// Long-press duration before a touch becomes a widget drag, and how far the
// finger may stray during that wait before it counts as a scroll instead.
const LONG_PRESS_MS = 300
const TOUCH_MOVE_CANCEL = 12

const blankForm = (kind = '예금') => ({
  kind,
  name: kind === '비트코인' ? '비트코인' : '',
  date: todayStr(),
  memo: '',
  principal: '',
  rate: '',
  months: '',
  method: '단리',
  monthly: '',
  round: '',
  shares: '',
  buyPrice: '',
  addShares: '',
  addBuyPrice: '',
  currency: 'KRW',
  color: defaultColor(kind),
  quoteSymbol: kind === '비트코인' ? BITCOIN_SYMBOL : '',
  currentPrice: '',
  bitcoinAmount: '',
  bitcoinBuyPrice: '',
  assetType: '',
  assetValue: '',
  assetCost: '',
  taxBenefit: '없음',
})

function formFromProduct(p) {
  return {
    ...blankForm(p.kind),
    name: p.name || '',
    date: p.date || todayStr(),
    memo: p.memo || '',
    method: p.method || '단리',
    principal: p.principal != null ? String(p.principal) : '',
    rate: p.rate != null ? String(p.rate) : '',
    months: p.months != null ? String(p.months) : '',
    monthly: p.monthly != null ? String(p.monthly) : '',
    round: p.round === '' || p.round == null ? '' : String(p.round),
    shares: p.shares != null ? String(p.shares) : '',
    buyPrice: p.buyPrice != null ? String(p.buyPrice) : '',
    bitcoinAmount: p.quantity != null ? String(p.quantity) : '',
    bitcoinBuyPrice: p.kind === '비트코인' && p.buyPrice != null ? String(p.buyPrice) : '',
    currency: p.currency || p.quoteCurrency || 'KRW',
    color: p.color || defaultColor(p.kind),
    quoteSymbol: p.quoteSymbol || (p.kind === '비트코인' ? BITCOIN_SYMBOL : ''),
    currentPrice: p.currentPrice != null ? String(p.currentPrice) : '',
    assetType: p.assetType || '',
    assetValue: p.assetValue != null ? String(p.assetValue) : '',
    assetCost: p.assetCost != null ? String(p.assetCost) : '',
    taxBenefit: normalizeInvestmentTaxBenefit(p.kind, p.taxBenefit),
  }
}

const signedKRW = (n) => (n >= 0 ? '+' : '') + formatKRW(n)
const profitClass = (n) => (n >= 0 ? 'profit-pos' : 'profit-neg')
const formatRate = (n) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 4 })
const formatCurrency = (n, currency) =>
  currency === 'KRW'
    ? formatKRW(n)
    : `${(Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ${currency}`
const signedCurrency = (n, currency) => `${n >= 0 ? '+' : ''}${formatCurrency(n, currency)}`
const compactCurrency = (n, currency) =>
  currency === 'KRW'
    ? compactKRW(n)
    : (Number(n) || 0).toLocaleString('ko-KR', {
        notation: 'compact',
        maximumFractionDigits: 1,
      })
const formatChartDate = (value) => {
  const [, month, day] = String(value || '').split('-')
  if (!month || !day) return value
  return `${Number(month)}/${Number(day)}`
}
const formatPct = (value, digits = 1) => `${(Number(value) || 0).toFixed(digits)}%`

function marketLabel(symbol, currency) {
  const code = String(symbol || '').toUpperCase()
  if (code.endsWith('.KS')) return '코스피'
  if (code.endsWith('.KQ')) return '코스닥'
  if (currency === 'USD') return '미국'
  if (currency === 'JPY') return '일본'
  if (currency === 'EUR') return '유럽'
  return currency === 'KRW' ? '국내' : currency || '미분류'
}

function riskLevel(level) {
  if (level === 'high') return { label: '높음', tone: 'high' }
  if (level === 'mid') return { label: '보통', tone: 'mid' }
  return { label: '낮음', tone: 'low' }
}

function isQuoteStale(time) {
  const ts = Date.parse(time)
  return Number.isFinite(ts) && Date.now() - ts > STALE_QUOTE_MS
}

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

function isQuoteFresh(time, maxAgeMs = QUOTE_FRESH_MS) {
  const ts = Date.parse(time)
  return Number.isFinite(ts) && Date.now() - ts < maxAgeMs
}

function quoteSymbolForProduct(product) {
  if (product?.kind === '비트코인') return product.quoteSymbol || BITCOIN_SYMBOL
  return product?.quoteSymbol || product?.symbol || ''
}

function hasLiveQuote(product) {
  return (product?.kind === '주식' || product?.kind === '비트코인') && quoteSymbolForProduct(product)
}

function isBitcoinText(value) {
  return /비트코인|bitcoin|btc/i.test(String(value || ''))
}

function compactLookupText(value) {
  return String(value || '').toLowerCase().replace(/[^0-9a-z가-힣]+/g, '')
}

function chooseStockLookupResult(query, results) {
  const items = results || []
  if (items.length === 0) return null
  const normalizedQuery = normalizeStockSymbol(query)
  const symbolMatch = items.find((item) => normalizeStockSymbol(item.symbol) === normalizedQuery)
  if (symbolMatch) return symbolMatch

  const compactQuery = compactLookupText(query)
  const nameMatch = items.find((item) => compactLookupText(item.name) === compactQuery)
  if (nameMatch) return nameMatch

  return items.length === 1 ? items[0] : null
}

function needsQuoteRefresh(product) {
  if (!isQuoteFresh(product?.quoteTime, STOCK_QUOTE_REFRESH_MS)) return true
  const currency = normalizeCurrencyCode(product?.currency || product?.quoteCurrency, 'KRW')
  return currency !== 'KRW' && !isQuoteFresh(product?.exchangeRateTime, FX_QUOTE_REFRESH_MS)
}

function portfolioBucketForProduct(product) {
  if (product?.kind === '주식' || product?.kind === '비트코인') return PORTFOLIO_BUCKETS.risk
  if (product?.kind === '예금' || product?.kind === '적금') return PORTFOLIO_BUCKETS.safe
  if (product?.kind === '자산') {
    const type = String(product.assetType || product.name || '').toLowerCase()
    if (/현금|cash|예금|적금|채권|bond|외화|달러|usd|엔화|jpy/.test(type)) return PORTFOLIO_BUCKETS.safe
    return PORTFOLIO_BUCKETS.alt
  }
  return PORTFOLIO_BUCKETS.alt
}

function safeAssetGroupForProduct(product) {
  if (product?.kind === '예금') return SAFE_ASSET_GROUPS.deposit
  if (product?.kind === '적금') return SAFE_ASSET_GROUPS.saving

  const type = String(product?.assetType || product?.name || '').toLowerCase()
  if (/예금/.test(type)) return SAFE_ASSET_GROUPS.deposit
  if (/적금/.test(type)) return SAFE_ASSET_GROUPS.saving
  if (/현금|cash|파킹|입출금/.test(type)) return SAFE_ASSET_GROUPS.cash
  if (/채권|bond/.test(type)) return SAFE_ASSET_GROUPS.bond
  if (/외화|달러|usd|엔화|jpy|유로|eur/.test(type)) return SAFE_ASSET_GROUPS.foreign
  return SAFE_ASSET_GROUPS.other
}

function buildSafeAssetPositions(items, total) {
  const map = new Map()
  ;(items || []).forEach((item) => {
    const group = item.safeGroup || SAFE_ASSET_GROUPS.other
    const prev =
      map.get(group.id) || {
        id: `safe-${group.id}`,
        name: group.label,
        color: group.color,
        current: 0,
        cost: 0,
        profit: 0,
        count: 0,
        weight: 0,
      }
    prev.current += item.current
    prev.cost += item.cost
    prev.profit += item.profit
    prev.count += 1
    map.set(group.id, prev)
  })

  return [...map.values()]
    .map((pos) => ({ ...pos, weight: total > 0 ? (pos.current / total) * 100 : 0 }))
    .sort((a, b) => b.current - a.current)
}

function buildPortfolioAllocation(products, today, rates) {
  const items = (products || [])
    .filter((p) => p.kind !== '환율')
    .map((p, index) => {
      const metrics = productMetrics(p, today, rates)
      const bucket = portfolioBucketForProduct(p)
      return {
        id: p.id || `${p.kind}-${index}`,
        name: p.name || p.kind,
        kind: p.kind,
        current: metrics.current,
        cost: metrics.cost,
        profit: metrics.profit,
        bucket,
        safeGroup: bucket.id === 'safe' ? safeAssetGroupForProduct(p) : null,
      }
    })
    .filter((item) => item.current > 0 || item.cost > 0)

  const total = items.reduce((sum, item) => sum + item.current, 0)
  const buckets = Object.values(PORTFOLIO_BUCKETS).map((bucket) => {
    const bucketItems = items.filter((item) => item.bucket.id === bucket.id)
    const value = bucketItems.reduce((sum, item) => sum + item.current, 0)
    return {
      ...bucket,
      value,
      count: bucketItems.length,
      weight: total > 0 ? (value / total) * 100 : 0,
      items: bucketItems,
    }
  })
  const byId = Object.fromEntries(buckets.map((bucket) => [bucket.id, bucket]))
  const safeWeight = byId.safe?.weight || 0
  const riskWeight = byId.risk?.weight || 0
  const altWeight = byId.alt?.weight || 0
  const summarizeItems = (list) => ({
    current: list.reduce((sum, item) => sum + item.current, 0),
    cost: list.reduce((sum, item) => sum + item.cost, 0),
    profit: list.reduce((sum, item) => sum + item.profit, 0),
    count: list.length,
  })
  const breakdown = {
    safe: summarizeItems(items.filter((item) => item.bucket.id === 'safe')),
    variable: summarizeItems(items.filter((item) => item.bucket.id !== 'safe')),
  }
  const allocationLevel = riskWeight >= 70 ? 'high' : riskWeight >= 45 ? 'mid' : 'low'
  const summary =
    total > 0
      ? `전체 투자 포트폴리오는 안전자산 ${formatPct(safeWeight)}, 위험자산 ${formatPct(riskWeight)}, 대체자산 ${formatPct(altWeight)}로 구성되어 있습니다.`
      : '투자 포트폴리오 데이터가 없습니다.'

  return { items, total, buckets, byId, breakdown, safeWeight, riskWeight, altWeight, allocationLevel, summary }
}

function buildMarketReport(products, today) {
  const rates = exchangeRateMap(products)
  const allocation = buildPortfolioAllocation(products, today, rates)
  const positions = (products || [])
    .filter((p) => p.kind === '주식' || p.kind === '비트코인')
    .map((p, index) => {
      const metrics = p.kind === '주식' ? stockMetrics(p, rates) : productMetrics(p, today, rates)
      const currency = metrics.currency
      const symbol = quoteSymbolForProduct(p)
      const missingFx = currency !== 'KRW' && !metrics.exchangeRate
      const missingQuote = !symbol || !p.quoteTime || metrics.currentPrice <= 0
      const staleQuote = p.quoteTime ? isQuoteStale(p.quoteTime) : false
      return {
        id: p.id,
        kind: p.kind,
        name: p.name || p.kind,
        symbol,
        color: p.color || REPORT_COLORS[index % REPORT_COLORS.length],
        currency,
        market: p.kind === '비트코인' ? '가상자산' : marketLabel(symbol, currency),
        current: metrics.current,
        cost: metrics.cost,
        profit: metrics.profit,
        returnPct: metrics.returnPct,
        missingFx,
        missingQuote,
        staleQuote,
        weight: 0,
      }
    })
    .sort((a, b) => b.current - a.current)

  const totalCurrent = positions.reduce((sum, pos) => sum + pos.current, 0)
  const totalCost = positions.reduce((sum, pos) => sum + pos.cost, 0)
  positions.forEach((pos) => {
    pos.weight = totalCurrent > 0 ? (pos.current / totalCurrent) * 100 : 0
  })

  const totalProfit = totalCurrent - totalCost
  const totalReturnPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0
  const topWeight = positions[0]?.weight || 0
  const top3Weight = positions.slice(0, 3).reduce((sum, pos) => sum + pos.weight, 0)
  const fxWeight =
    totalCurrent > 0
      ? (positions
          .filter((pos) => pos.currency !== 'KRW')
          .reduce((sum, pos) => sum + pos.current, 0) /
          totalCurrent) *
        100
      : 0
  const lossWeight =
    totalCurrent > 0
      ? (positions
          .filter((pos) => pos.profit < 0)
          .reduce((sum, pos) => sum + pos.current, 0) /
          totalCurrent) *
        100
      : 0
  const lossCurrent = positions
    .filter((pos) => pos.profit < 0)
    .reduce((sum, pos) => sum + pos.current, 0)
  const lossAmount = positions
    .filter((pos) => pos.profit < 0)
    .reduce((sum, pos) => sum + Math.abs(pos.profit), 0)

  const missingFxCount = positions.filter((pos) => pos.missingFx).length
  const missingQuoteCount = positions.filter((pos) => pos.missingQuote).length
  const staleQuoteCount = positions.filter((pos) => pos.staleQuote).length
  const winningCount = positions.filter((pos) => pos.profit >= 0).length
  const losingCount = positions.length - winningCount
  const concentrationLevel =
    topWeight >= 50 || top3Weight >= 75 ? 'high' : topWeight >= 35 || top3Weight >= 60 ? 'mid' : 'low'
  const fxLevel = fxWeight >= 50 ? 'high' : fxWeight >= 25 ? 'mid' : 'low'
  const lossLevel =
    lossWeight >= 50 || totalReturnPct <= -15 ? 'high' : lossWeight >= 25 || totalReturnPct < 0 ? 'mid' : 'low'
  const risks = [
    {
      name: '전체 배분',
      value: `위험 ${formatPct(allocation.riskWeight)} · 안전 ${formatPct(allocation.safeWeight)}`,
      detail:
        allocation.riskWeight >= 70
          ? '위험자산 비중이 높아 시장 변동에 민감한 구조입니다.'
          : allocation.riskWeight >= 45
            ? '위험자산과 안전자산의 균형을 주기적으로 점검할 구간입니다.'
            : '안전자산 비중이 비교적 높은 구조입니다.',
      ...riskLevel(allocation.allocationLevel),
    },
    {
      name: '집중도',
      value: `1위 ${formatPct(topWeight)} · 상위3 ${formatPct(top3Weight)}`,
      detail: positions[0] ? `${positions[0].name} 비중이 가장 큽니다.` : '종목 데이터 없음',
      ...riskLevel(concentrationLevel),
    },
    {
      name: '외화 노출',
      value: formatPct(fxWeight),
      detail: fxWeight > 0 ? '환율 변동이 평가액에 반영됩니다.' : '원화 종목 중심입니다.',
      ...riskLevel(fxLevel),
    },
    {
      name: '손실 노출',
      value: `${formatPct(lossWeight)} · ${formatKRW(lossCurrent)}`,
      detail:
        lossAmount > 0
          ? `손실 중인 자산 ${losingCount}개, 평가손실 합계는 ${formatKRW(lossAmount)}입니다.`
          : '손실 중인 자산이 없습니다.',
      ...riskLevel(lossLevel),
    },
  ]
  const highCount = risks.filter((risk) => risk.tone === 'high').length
  const midCount = risks.filter((risk) => risk.tone === 'mid').length
  const rating =
    highCount >= 2
      ? { label: '위험', tone: 'high' }
      : highCount || midCount >= 2
        ? { label: '주의', tone: 'mid' }
        : { label: '양호', tone: 'low' }
  const best = positions.length ? [...positions].sort((a, b) => b.profit - a.profit)[0] : null
  const worst = positions.length ? [...positions].sort((a, b) => a.profit - b.profit)[0] : null
  const assetBreakdown = allocation.breakdown
  const safeTotal = allocation.byId.safe?.value || 0
  const safePositions = buildSafeAssetPositions(allocation.byId.safe?.items || [], safeTotal)
  const variableWeight = allocation.riskWeight + allocation.altWeight
  const portfolioItems = [...allocation.items].sort((a, b) => b.current - a.current)
  const topPortfolioAsset = portfolioItems[0] || null
  const topPortfolioWeight =
    allocation.total > 0 && topPortfolioAsset ? (topPortfolioAsset.current / allocation.total) * 100 : 0
  const notes = []
  if (assetBreakdown.safe.count === 0) {
    notes.push('예금·적금·현금성 자산이 없어 변동성 완충 자산이 부족합니다.')
  } else if (allocation.safeWeight >= 70) {
    notes.push(`안전자산 비중이 ${formatPct(allocation.safeWeight)}로 높아 변동성은 낮지만 기대수익은 제한될 수 있습니다.`)
  } else if (allocation.safeWeight >= 30 && variableWeight >= 30) {
    notes.push('안전자산과 변동자산이 함께 있어 포트폴리오 완충 구조가 있습니다.')
  }
  if (assetBreakdown.variable.count === 0) {
    notes.push('주식·비트코인·대체자산 같은 변동자산은 아직 등록되지 않았습니다.')
  } else if (variableWeight >= 70) {
    notes.push(`변동자산 비중이 ${formatPct(variableWeight)}로 높아 시장 변화에 민감합니다.`)
  } else if (positions.length > 0 && positions.length < 3) {
    notes.push('시장성 자산 수가 적어 변동자산 내부 분산 효과는 제한적입니다.')
  }
  if (topPortfolioWeight >= 35) notes.push(`${topPortfolioAsset?.name || '상위 자산'}이 전체의 ${formatPct(topPortfolioWeight)}입니다.`)
  if (fxWeight >= 25) notes.push(`외화 자산 비중이 ${formatPct(fxWeight)}입니다.`)
  if (best) notes.push(`변동자산 수익 기여 1위는 ${best.name}입니다.`)
  if (worst && worst.profit < 0) notes.push(`변동자산 손실 기여 1위는 ${worst.name}입니다.`)
  if (notes.length === 0) notes.push('분산이 비교적 안정적입니다.')
  const actions = []
  if (topPortfolioWeight >= 50) {
    actions.push({
      title: '단일 자산 집중',
      detail: `${topPortfolioAsset?.name || '상위 자산'} 하나가 전체 포트폴리오의 절반 이상입니다. 안전자산과 변동자산 전체 기준으로 비중 조절을 먼저 보세요.`,
    })
  } else if (topPortfolioWeight >= 35) {
    actions.push({
      title: '상위 비중 주의',
      detail: `${topPortfolioAsset?.name || '상위 자산'} 비중이 높은 편입니다. 같은 방향으로 움직이는 자산과 현금성 완충 비중을 함께 확인하세요.`,
    })
  } else if (variableWeight >= 70) {
    actions.push({
      title: '변동성 완충 확인',
      detail: `변동자산 비중이 ${formatPct(variableWeight)}입니다. 예금·적금·현금성 자산을 목표 비중으로 둘지 정하면 흔들림을 줄이기 좋습니다.`,
    })
  } else if (allocation.safeWeight >= 75) {
    actions.push({
      title: '수익 기회 점검',
      detail: `안전자산 비중이 ${formatPct(allocation.safeWeight)}입니다. 장기 목표가 있다면 일부를 성장자산으로 배분할지 검토해볼 수 있습니다.`,
    })
  } else {
    actions.push({
      title: '배분 균형 유지',
      detail: '안전자산과 변동자산이 한쪽으로 크게 쏠리지는 않았습니다. 신규 편입은 목표 비중에서 부족한 쪽을 우선 비교하기 좋습니다.',
    })
  }
  if (fxWeight >= 25) {
    actions.push({
      title: '환율 영향 확인',
      detail: `외화 노출이 ${formatPct(fxWeight)}라 환율 변동이 수익률을 흔들 수 있습니다.`,
    })
  }
  if (lossWeight >= 25 || totalReturnPct < 0) {
    actions.push({
      title: '변동자산 손실 점검',
      detail: `변동자산 안에서 손실 자산 비중은 ${formatPct(lossWeight)}입니다. 전체 자산 여력과 보유 이유를 함께 확인하세요.`,
    })
  } else if (best) {
    actions.push({
      title: '수익 기여 확인',
      detail: `${best.name}이 변동자산 수익에 가장 크게 기여합니다. 전체 포트폴리오에서 비중이 과도해졌는지도 함께 보세요.`,
    })
  }
  if (missingFxCount || missingQuoteCount || staleQuoteCount) {
    actions.push({
      title: '데이터 보완',
      detail: '시세나 환율이 비어 있거나 오래된 항목이 있어 분석 정확도가 낮아질 수 있습니다.',
    })
  }

  return {
    positions,
    totalCurrent,
    totalCost,
    totalProfit,
    totalReturnPct,
    portfolioTotal: allocation.total,
    assetBreakdown,
    safePositions,
    safeTotal,
    allocationBuckets: allocation.buckets,
    allocationSummary: allocation.summary,
    safeWeight: allocation.safeWeight,
    riskWeight: allocation.riskWeight,
    altWeight: allocation.altWeight,
    lossAmount,
    lossCurrent,
    lossWeight,
    losingCount,
    risks,
    rating,
    notes,
    actions,
    summary: '',
  }
}

function additionalBuyPreview(form) {
  const shares = parseNumberInput(form.shares)
  const buyPrice = parseNumberInput(form.buyPrice)
  const addShares = parseNumberInput(form.addShares)
  const addBuyPrice = parseNumberInput(form.addBuyPrice)
  if (shares <= 0 || buyPrice <= 0 || addShares <= 0 || addBuyPrice <= 0) return null

  const nextShares = shares + addShares
  return {
    shares: nextShares,
    buyPrice: (shares * buyPrice + addShares * addBuyPrice) / nextShares,
  }
}

function savingsPreviewFromForm(form, today) {
  const monthly = parseNumberInput(form.monthly)
  const months = parseNumberInput(form.months)
  const round = form.round === '' ? '' : parseNumberInput(form.round)
  if (monthly <= 0 || months <= 0) return null

  return productMetrics(
    {
      kind: '적금',
      date: form.date || today,
      monthly,
      rate: parseNumberInput(form.rate) || 0,
      months,
      method: form.method,
      round,
    },
    today
  )
}

export default function InvestmentStage({ investments }) {
  const {
    items: rawItems,
    groups: rawGroups,
    addItem,
    updateItem,
    removeItem,
    moveItem,
    groupItems,
    renameGroup,
    dissolveGroup,
    setItemGroup,
    pruneEmptyGroups,
  } = investments
  const safeRawItems = Array.isArray(rawItems) ? rawItems : []
  const safeRawGroups = Array.isArray(rawGroups) ? rawGroups : []
  // Legacy 환율 items from older data are persisted but hidden from the grid —
  // representative FX rates now live in the top widget. The full list still
  // feeds summarize/exchangeRateMap so any saved rate keeps converting stocks.
  const items = useMemo(() => safeRawItems.filter((p) => p.kind !== '환율'), [safeRawItems])
  const today = todayStr()
  const [form, setForm] = useState(() => blankForm('예금'))
  const [editingId, setEditingId] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [quoteStatus, setQuoteStatus] = useState({})
  const [activeChartId, setActiveChartId] = useState(null)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [stockSearch, setStockSearch] = useState({ state: 'idle', query: '', items: [], error: '' })
  const [stockSearchOpen, setStockSearchOpen] = useState(false)
  const [stockSearchLockedQuery, setStockSearchLockedQuery] = useState('')
  const stockSymbolLookupRef = useRef('')
  const stockSearchRunRef = useRef(0)
  const quoteFailuresRef = useRef({})

  // rawItems feeds summarize/exchangeRateMap so legacy 환율 widgets keep
  // providing FX rates for stock conversion. 환율 items contribute 0 to totals
  // so including them does not skew the numbers.
  const totals = useMemo(() => summarize(safeRawItems, today), [safeRawItems, today])
  const rates = useMemo(() => exchangeRateMap(safeRawItems), [safeRawItems])
  const marketReport = useMemo(() => buildMarketReport(safeRawItems, today), [safeRawItems, today])
  const groupNameById = useMemo(() => {
    const map = new Map()
    safeRawGroups.forEach((g) => map.set(g.id, g.name))
    return map
  }, [safeRawGroups])

  // Build the section → inline cards tree the grid renders. A user group is
  // represented as one widget-card in the same position as its first member.
  const widgetSections = useMemo(() => {
    const sectionMeta = [
      {
        id: 'stable',
        title: '예금 · 적금 · 현금자산',
        desc: '원금과 현금 흐름 중심',
        color: '#0f766e',
        sectionKind: STABLE_ASSET_KINDS,
      },
      {
        id: 'market',
        title: '주식 · 비트코인',
        desc: '가격 변동 자산',
        color: '#d97706',
        sectionKind: MARKET_ASSET_KINDS,
      },
    ]
    const sectionOf = (kind) => {
      if (STABLE_ASSET_KINDS.has(kind)) return 'stable'
      if (MARKET_ASSET_KINDS.has(kind)) return 'market'
      return null
    }

    // Decide where a group lives by its first member; later members of a
    // different kind still render inside the same sub-section.
    const groupSection = new Map()
    items.forEach((p) => {
      const sec = sectionOf(p.kind)
      if (!sec) return
      if (p.groupId && !groupSection.has(p.groupId)) {
        groupSection.set(p.groupId, sec)
      }
    })

    return sectionMeta.map((meta) => {
      const sectionItems = items.filter((p) => meta.sectionKind.has(p.kind))
      const groupBuckets = new Map()
      const groupOrder = []
      sectionItems.forEach((p) => {
        const gid = p.groupId
        const homeSection = gid ? groupSection.get(gid) : null
        if (gid && homeSection === meta.id) {
          if (!groupBuckets.has(gid)) {
            groupBuckets.set(gid, [])
            groupOrder.push(gid)
          }
          groupBuckets.get(gid).push(p)
        }
      })

      const groupById = new Map(groupOrder.map((gid) => {
        const members = groupBuckets.get(gid)
        const total = members.reduce((sum, p) => sum + productMetrics(p, today, rates).current, 0)
        const cost = members.reduce((sum, p) => sum + productMetrics(p, today, rates).cost, 0)
        const profit = total - cost
        return [gid, {
          id: gid,
          name: groupNameById.get(gid) || '새 그룹',
          items: members,
          color: averageProductColor(members),
          total,
          cost,
          profit,
        }]
      }))

      const seenGroups = new Set()
      const displayCards = []
      sectionItems.forEach((p) => {
        const gid = p.groupId
        if (gid && groupSection.get(gid) === meta.id && groupById.has(gid)) {
          if (seenGroups.has(gid)) return
          seenGroups.add(gid)
          displayCards.push({ type: 'group', id: gid, group: groupById.get(gid) })
          return
        }
        displayCards.push({ type: 'item', id: p.id, item: p })
      })

      return {
        ...meta,
        items: sectionItems,
        displayCards,
        total: sectionItems.reduce((sum, p) => sum + productMetrics(p, today, rates).current, 0),
        monthlyOutflow: sectionItems.reduce((sum, p) => {
          if (p.kind !== '적금') return sum
          return sum + (Number(p.monthly) || 0)
        }, 0),
      }
    })
  }, [items, rates, today, groupNameById])

  // Auto-cleanup: drop group metadata that has no members left after edits.
  useEffect(() => {
    if (!pruneEmptyGroups) return
    pruneEmptyGroups()
  }, [items, pruneEmptyGroups])

  useEffect(() => {
    if (!activeChartId) return
    if (!items.some((p) => p.id === activeChartId && MARKET_ASSET_KINDS.has(p.kind))) {
      setActiveChartId(null)
    }
  }, [activeChartId, items])

  useEffect(() => {
    if (form.kind !== '주식') {
      setStockSearch({ state: 'idle', query: '', items: [], error: '' })
      setStockSearchOpen(false)
      return undefined
    }

    const query = form.name.trim()
    if (query.length < 2 || query === stockSearchLockedQuery) {
      setStockSearch((prev) =>
        prev.query === query ? prev : { state: 'idle', query, items: [], error: '' }
      )
      return undefined
    }

    let cancelled = false
    const runId = ++stockSearchRunRef.current
    setStockSearch({ state: 'loading', query, items: [], error: '', mode: 'local' })
    const timer = window.setTimeout(async () => {
      try {
        const results = await fetchStockSearch(query, { limit: 7, localOnly: true })
        if (cancelled || stockSearchRunRef.current !== runId) return
        setStockSearch({ state: 'done', query, items: results, error: '', mode: 'local' })
        const autoResult = chooseStockLookupResult(query, results)
        if (autoResult) applyStockLookupResult(autoResult)
        setStockSearchOpen(true)
      } catch (error) {
        if (cancelled || stockSearchRunRef.current !== runId) return
        setStockSearch({
          state: 'error',
          query,
          items: [],
          error: error?.message || '검색 실패',
          mode: 'local',
        })
        setStockSearchOpen(true)
      }
    }, 260)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [form.kind, form.name, stockSearchLockedQuery])

  useEffect(() => {
    if (form.kind !== '주식') return undefined
    const raw = form.quoteSymbol.trim()
    if (raw.length < 2) return undefined
    const normalized = normalizeStockSymbol(raw)
    if (!normalized) return undefined
    if (stockSymbolLookupRef.current === normalized && form.name.trim()) return undefined

    let cancelled = false
    const timer = window.setTimeout(async () => {
      stockSymbolLookupRef.current = normalized
      const results = await fetchStockSearch(raw, { limit: 7, localOnly: true }).catch(() => [])
      if (cancelled) return
      const match = chooseStockLookupResult(normalized, results) || chooseStockLookupResult(raw, results)
      if (match) applyStockLookupResult(match, { lockName: true })
    }, 420)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [form.kind, form.quoteSymbol, form.name])

  const [draggingId, setDraggingId] = useState(null)
  const [dropId, setDropId] = useState(null)
  const [touchDragging, setTouchDragging] = useState(false)
  // Touch long-press drag bookkeeping kept in refs so the document listeners
  // can read live values without re-subscribing on every render.
  const touchRef = useRef({
    id: null,
    startX: 0,
    startY: 0,
    x: 0,
    y: 0,
    timer: 0,
    active: false,
    dropId: null,
    dropGroupId: null,
  })
  const ghostRef = useRef(null)
  const moveItemRef = useRef(moveItem)

  const quoteKey = useMemo(
    () =>
      items
        .filter(hasLiveQuote)
        .map(
          (p) =>
            `${p.id}:${p.kind}:${quoteSymbolForProduct(p)}:${p.currency || p.quoteCurrency || ''}`
        )
        .join('|'),
    [items]
  )

  useEffect(() => {
    const quoteItems = items.filter(hasLiveQuote)
    if (quoteItems.length === 0) return

    let cancelled = false

    function hasPreviousQuote(p) {
      return Number(p.currentPrice) > 0
    }

    function hasPreviousFx(p, currency) {
      return currency === 'KRW' || Number(p.exchangeRate) > 0
    }

    function quoteFailureKey(p) {
      return `${quoteSymbolForProduct(p)}:${p.currency || p.quoteCurrency || ''}`
    }

    function canRetryQuote(p) {
      const failure = quoteFailuresRef.current[p.id]
      if (!failure || failure.key !== quoteFailureKey(p)) return true
      const backoff = hasPreviousQuote(p) ? QUOTE_RETRY_BACKOFF_MS : QUOTE_EMPTY_RETRY_BACKOFF_MS
      return Date.now() - failure.time > backoff
    }

    async function fetchQuoteItem(p) {
      try {
        const quote = await fetchStockQuote(quoteSymbolForProduct(p))
        const currency = normalizeCurrencyCode(quote.currency || p.currency || p.quoteCurrency, 'KRW')
        if (currency === 'KRW') return { p, quote, currency }
        if (isQuoteFresh(p.exchangeRateTime, FX_QUOTE_REFRESH_MS)) return { p, quote, currency }

        try {
          const exchangeQuote = await fetchExchangeRate(currency, 'KRW')
          return { p, quote, currency, exchangeQuote }
        } catch (exchangeError) {
          return { p, quote, currency, exchangeError }
        }
      } catch (error) {
        return { p, error }
      }
    }

    function applyQuoteResult({ p, quote, currency, exchangeQuote, exchangeError, error }) {
      const previousQuote = hasPreviousQuote(p)
      const previousFx = hasPreviousFx(p, currency)
      const usedPrevious = quote?.stale || exchangeQuote?.stale || (exchangeError && previousFx)
      const failed = !quote || quote?.stale || exchangeError

      if (failed) {
        quoteFailuresRef.current[p.id] = { key: quoteFailureKey(p), time: Date.now() }
      } else {
        delete quoteFailuresRef.current[p.id]
      }

      setQuoteStatus((prev) => ({
        ...prev,
        [p.id]: quote
          ? usedPrevious
            ? { state: 'idle', text: '이전값' }
            : quote.cached || exchangeQuote?.cached
            ? { state: 'ok', text: '최근' }
            : exchangeError
            ? { state: 'error', text: '환율 실패' }
            : { state: 'ok', text: '갱신됨' }
          : previousQuote
            ? { state: 'idle', text: '이전값' }
            : { state: 'error', text: error?.message || '조회 실패' },
      }))

      if (!quote) return
      updateItem(p.id, {
        currentPrice: quote.price,
        currency,
        quoteSymbol: quote.symbol || quoteSymbolForProduct(p),
        quoteCurrency: currency || quote.currency,
        quoteTime: quote.fetchedAt || quote.cachedAt || quote.time,
        ...(exchangeQuote
          ? {
              exchangeRate: exchangeQuote.price,
              exchangeRateTime: exchangeQuote.fetchedAt || exchangeQuote.cachedAt || exchangeQuote.time,
            }
          : {}),
      })
    }

    async function refreshQuotes() {
      setQuoteStatus((prev) => {
        const next = { ...prev }
        quoteItems.forEach((p) => {
          if (!needsQuoteRefresh(p)) next[p.id] = { state: 'ok', text: '최근' }
          else if (!canRetryQuote(p) && hasPreviousQuote(p)) next[p.id] = { state: 'idle', text: '이전값' }
        })
        return next
      })

      const targets = quoteItems.filter((p) => needsQuoteRefresh(p) && canRetryQuote(p))
      for (let index = 0; index < targets.length; index += 1) {
        const p = targets[index]
        if (cancelled) return
        setQuoteStatus((prev) => ({
          ...prev,
          [p.id]: { state: 'loading', text: '조회중' },
        }))
        const result = await fetchQuoteItem(p)
        if (cancelled) return
        applyQuoteResult(result)
        if (index < targets.length - 1) await wait(QUOTE_STAGGER_MS)
      }
    }

    refreshQuotes()
    const timer = window.setInterval(refreshQuotes, QUOTE_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [quoteKey, updateItem])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  function selectKind(kind) {
    stockSearchRunRef.current += 1
    setForm((f) => ({
      ...f,
      kind,
      name: kind === '비트코인' ? '비트코인' : f.kind === '비트코인' ? '' : f.name,
      color: defaultColor(kind),
      currency: kind === '비트코인' || f.kind === '비트코인' ? 'KRW' : f.currency,
      quoteSymbol: kind === '비트코인' ? BITCOIN_SYMBOL : f.kind === '비트코인' ? '' : f.quoteSymbol,
      currentPrice: kind === '비트코인' || f.kind === '비트코인' ? '' : f.currentPrice,
      bitcoinAmount: kind === '비트코인' ? f.bitcoinAmount : '',
      bitcoinBuyPrice: kind === '비트코인' ? f.bitcoinBuyPrice : '',
      taxBenefit: normalizeInvestmentTaxBenefit(kind, f.taxBenefit),
    }))
    setStockSearchLockedQuery('')
    setStockSearchOpen(false)
  }

  function setStockName(value) {
    setStockSearchLockedQuery('')
    stockSymbolLookupRef.current = ''
    setStockSearchOpen(true)
    set('name', value)
  }

  async function runStockRemoteSearch() {
    if (form.kind !== '주식') return
    const query = (form.name.trim() || form.quoteSymbol.trim()).trim()
    if (query.length < 2) return

    setStockSearchLockedQuery('')
    setStockSearchOpen(true)
    const runId = ++stockSearchRunRef.current
    setStockSearch({ state: 'loading', query, items: [], error: '', mode: 'remote' })
    try {
      const results = await fetchStockSearch(query, { limit: 7 })
      if (stockSearchRunRef.current !== runId) return
      setStockSearch({ state: 'done', query, items: results, error: '', mode: 'remote' })
    } catch (error) {
      if (stockSearchRunRef.current !== runId) return
      setStockSearch({
        state: 'error',
        query,
        items: [],
        error: error?.message || '검색 실패',
        mode: 'remote',
      })
    }
  }

  function applyStockLookupResult(result, { lockName = false, fetchQuote = false } = {}) {
    const symbol = normalizeStockSymbol(result.symbol)
    if (!symbol) return
    const name = result.name || symbol
    setForm((prev) => {
      if (prev.kind !== '주식') return prev
      const currency = normalizeCurrencyCode(result.currency, prev.currency || 'KRW')
      return {
        ...prev,
        name:
          lockName ||
          !prev.name.trim() ||
          normalizeStockSymbol(prev.name) === symbol ||
          compactLookupText(prev.name) === compactLookupText(prev.quoteSymbol)
            ? name
            : prev.name,
        quoteSymbol: symbol,
        currency,
        quoteCurrency: currency,
        ...(result.currentPrice ? { currentPrice: String(result.currentPrice) } : {}),
      }
    })
    stockSymbolLookupRef.current = symbol
    if (lockName) {
      setStockSearchLockedQuery(name)
      setStockSearchOpen(false)
    }

    if (!fetchQuote) return
    const currency = normalizeCurrencyCode(result.currency, form.currency || 'KRW')
    fetchStockQuote(symbol)
      .then((quote) => {
        const quoteCurrency = normalizeCurrencyCode(quote.currency || currency, currency)
        setForm((prev) =>
          prev.kind === '주식' && normalizeStockSymbol(prev.quoteSymbol) === symbol
            ? {
                ...prev,
                quoteSymbol: quote.symbol || symbol,
                currency: quoteCurrency,
                quoteCurrency,
                currentPrice: String(quote.price || ''),
              }
            : prev
        )
      })
      .catch(() => {})
  }

  function applyStockSearchResult(result) {
    stockSearchRunRef.current += 1
    const name = result.name || normalizeStockSymbol(result.symbol)
    applyStockLookupResult(result, { lockName: true, fetchQuote: true })
    setStockSearchLockedQuery(name)
    setStockSearchOpen(false)
  }

  async function submit(e) {
    e.preventDefault()
    const { kind } = form
    if (!form.name.trim()) {
      alert(
        kind === '주식'
          ? '종목명을 입력하세요.'
          : kind === '비트코인'
            ? '코인명을 입력하세요.'
            : kind === '자산'
              ? '자산명을 입력하세요.'
              : '상품명을 입력하세요.'
      )
      return
    }
    if (!form.date) {
      alert('날짜를 입력하세요.')
      return
    }
    const taxBenefit = normalizeInvestmentTaxBenefit(kind, form.taxBenefit)
    let product
    if (kind === '예금') {
      const principal = parseNumberInput(form.principal)
      const months = parseNumberInput(form.months)
      if (!principal || principal <= 0) return alert('원금을 입력하세요.')
      if (!months || months <= 0) return alert('만기(개월)를 입력하세요.')
      product = {
        kind,
        name: form.name.trim(),
        date: form.date,
        memo: form.memo.trim(),
        color: form.color || defaultColor(kind),
        principal,
        rate: parseNumberInput(form.rate) || 0,
        months,
        method: form.method,
        taxBenefit,
      }
    } else if (kind === '적금') {
      const monthly = parseNumberInput(form.monthly)
      const months = parseNumberInput(form.months)
      const round = form.round === '' ? '' : parseNumberInput(form.round)
      if (!monthly || monthly <= 0) return alert('월 납입액을 입력하세요.')
      if (!months || months <= 0) return alert('만기 회차(개월)를 입력하세요.')
      if (round !== '' && round > months) return alert('납입 회차는 만기 회차보다 클 수 없습니다.')
      product = {
        kind,
        name: form.name.trim(),
        date: form.date,
        memo: form.memo.trim(),
        color: form.color || defaultColor(kind),
        monthly,
        rate: parseNumberInput(form.rate) || 0,
        months,
        method: form.method,
        round,
        taxBenefit,
      }
    } else if (kind === '비트코인') {
      const quantity = parseNumberInput(form.bitcoinAmount)
      const buyPrice = parseAmountInput(form.bitcoinBuyPrice)
      if (!quantity || quantity <= 0) return alert('보유 수량을 입력하세요.')
      if (!buyPrice || buyPrice <= 0) return alert('평균 매수가를 입력하세요.')
      const quote =
        form.currentPrice === ''
          ? await fetchStockQuote(BITCOIN_SYMBOL).catch(() => null)
          : null
      const currentPrice = form.currentPrice === '' ? Number(quote?.price) || buyPrice : parseAmountInput(form.currentPrice)
      product = {
        kind,
        name: form.name.trim(),
        date: form.date,
        memo: form.memo.trim(),
        color: form.color || defaultColor(kind),
        quantity,
        buyPrice,
        currency: 'KRW',
        quoteSymbol: BITCOIN_SYMBOL,
        quoteCurrency: 'KRW',
        currentPrice,
        ...(quote ? { quoteTime: quote.fetchedAt || quote.cachedAt || quote.time } : {}),
        taxBenefit,
      }
    } else if (kind === '자산') {
      const assetValue = parseAmountInput(form.assetValue)
      const assetCost = form.assetCost === '' ? assetValue : parseAmountInput(form.assetCost)
      if (isBitcoinText(form.name) || isBitcoinText(form.assetType)) {
        return alert('비트코인은 비트코인 탭에서 추가하세요.')
      }
      if (!assetValue || assetValue <= 0) return alert('현재 평가액을 입력하세요.')
      product = {
        kind,
        name: form.name.trim(),
        date: form.date,
        memo: form.memo.trim(),
        color: form.color || defaultColor(kind),
        assetType: form.assetType.trim() || '기타',
        assetValue,
        assetCost,
        taxBenefit,
      }
    } else {
      const shares = parseNumberInput(form.shares)
      const buyPrice = parseNumberInput(form.buyPrice)
      const addShares = parseNumberInput(form.addShares)
      const addBuyPrice = parseNumberInput(form.addBuyPrice)
      const quoteSymbol = normalizeStockSymbol(form.quoteSymbol)
      const currency = normalizeCurrencyCode(form.currency, 'KRW')
      if (!shares || shares <= 0) return alert('보유 수량을 입력하세요.')
      if (!buyPrice || buyPrice <= 0) return alert('평균 매수가를 입력하세요.')
      if (addShares < 0 || addBuyPrice < 0) return alert('추가 매수 값은 0 이상이어야 합니다.')
      if ((addShares > 0 && addBuyPrice <= 0) || (addBuyPrice > 0 && addShares <= 0)) {
        return alert('추가 매수 수량과 단가를 함께 입력하세요.')
      }
      if (!quoteSymbol) return alert('종목 코드 또는 티커를 입력하세요.')
      const preview = additionalBuyPreview(form)
      const nextShares = preview ? preview.shares : shares
      const nextBuyPrice = preview ? preview.buyPrice : buyPrice
      product = {
        kind,
        name: form.name.trim(),
        date: form.date,
        memo: form.memo.trim(),
        shares: nextShares,
        buyPrice: nextBuyPrice,
        currency,
        color: form.color || defaultColor(kind),
        quoteSymbol,
        quoteCurrency: currency,
        currentPrice: form.currentPrice === '' ? nextBuyPrice : parseNumberInput(form.currentPrice),
        taxBenefit,
      }
    }
    if (editingId) {
      updateItem(editingId, product)
      setEditingId(null)
    } else {
      addItem(product)
    }
    setForm(blankForm(kind))
    setFormOpen(false)
  }

  function openAdd() {
    stockSearchRunRef.current += 1
    setEditingId(null)
    setForm(blankForm(form.kind))
    setStockSearch({ state: 'idle', query: '', items: [], error: '' })
    setStockSearchLockedQuery('')
    stockSymbolLookupRef.current = ''
    setStockSearchOpen(false)
    setFormOpen(true)
  }

  function startEdit(p) {
    stockSearchRunRef.current += 1
    const nextForm = formFromProduct(p)
    setEditingId(p.id)
    setForm(nextForm)
    if (p.kind === '주식') {
      const query = nextForm.name.trim()
      setStockSearch({ state: 'idle', query, items: [], error: '' })
      setStockSearchLockedQuery(query)
      stockSymbolLookupRef.current = normalizeStockSymbol(nextForm.quoteSymbol)
      setStockSearchOpen(false)
    } else {
      setStockSearch({ state: 'idle', query: '', items: [], error: '' })
      setStockSearchLockedQuery('')
      stockSymbolLookupRef.current = ''
      setStockSearchOpen(false)
    }
    setFormOpen(true)
  }

  function cancelEdit() {
    stockSearchRunRef.current += 1
    setEditingId(null)
    setForm(blankForm(form.kind))
    setStockSearch({ state: 'idle', query: '', items: [], error: '' })
    setStockSearchLockedQuery('')
    stockSymbolLookupRef.current = ''
    setStockSearchOpen(false)
    setFormOpen(false)
  }

  function handleRemove(p) {
    if (window.confirm(`투자 상품 '${p.name}'을(를) 삭제할까요?`)) {
      removeItem(p.id)
      if (editingId === p.id) cancelEdit()
      if (activeChartId === p.id) setActiveChartId(null)
    }
  }

  function togglePriceChart(p) {
    if (!MARKET_ASSET_KINDS.has(p.kind)) return
    setActiveChartId((id) => (id === p.id ? null : p.id))
  }

  const draggingItem = draggingId ? items.find((it) => it.id === draggingId) || null : null
  const [dropGroupId, setDropGroupId] = useState(null)

  function sectionKindOf(p) {
    if (!p) return null
    if (STABLE_ASSET_KINDS.has(p.kind)) return 'stable'
    if (MARKET_ASSET_KINDS.has(p.kind)) return 'market'
    return null
  }

  // Cross-section drops are blocked so a user group never straddles the
  // safe/market split that the report relies on.
  function dropAcceptsTarget(source, target) {
    if (!source || !target || source.id === target.id) return false
    return sectionKindOf(source) === sectionKindOf(target)
  }

  // Drop a card onto another card. Same-group drop reorders the items array so
  // the user can rearrange siblings; every other case rewrites groupId so the
  // gesture forms / joins / leaves a group.
  function applyCardDrop(source, target) {
    if (!dropAcceptsTarget(source, target)) return
    const sameGroup = source.groupId && source.groupId === target.groupId
    if (sameGroup) {
      moveItem(source.id, target.id)
      return
    }
    if (!source.groupId && !target.groupId) {
      groupItems(source.id, target.id, '새 그룹')
      return
    }
    setItemGroup(source.id, target.groupId || '')
  }

  function applyGroupHeaderDrop(source, groupId) {
    if (!source || !groupId) return
    if (source.groupId === groupId) return
    setItemGroup(source.id, groupId)
  }

  function handleDragStart(e, p) {
    setDraggingId(p.id)
    e.dataTransfer.effectAllowed = 'move'
    try {
      e.dataTransfer.setData('text/plain', p.id)
    } catch {
      // some browsers restrict setData during dragstart — draggingId covers it
    }
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDropId(null)
    setDropGroupId(null)
  }

  function handleDragOver(e, p) {
    if (!draggingItem || p.id === draggingId) return
    if (!dropAcceptsTarget(draggingItem, p)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropId !== p.id) setDropId(p.id)
    if (dropGroupId) setDropGroupId(null)
  }

  function handleDragLeave(e, p) {
    if (e.currentTarget.contains(e.relatedTarget)) return
    if (dropId === p.id) setDropId(null)
  }

  function handleDrop(e, p) {
    e.preventDefault()
    const source = draggingItem
    setDraggingId(null)
    setDropId(null)
    setDropGroupId(null)
    applyCardDrop(source, p)
  }

  // Drag a card onto a group's header to add the card to that group, even when
  // the group's card grid is empty / off-screen.
  function handleGroupDragOver(e, groupId) {
    if (!draggingItem) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropGroupId !== groupId) setDropGroupId(groupId)
    if (dropId) setDropId(null)
  }

  function handleGroupDragLeave(e, groupId) {
    if (e.currentTarget.contains(e.relatedTarget)) return
    if (dropGroupId === groupId) setDropGroupId(null)
  }

  function handleGroupDrop(e, groupId) {
    e.preventDefault()
    const source = draggingItem
    setDraggingId(null)
    setDropId(null)
    setDropGroupId(null)
    applyGroupHeaderDrop(source, groupId)
  }

  function positionGhost(x, y) {
    const el = ghostRef.current
    if (el) el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -130%)`
  }

  function handleTouchStart(e, p) {
    if (e.touches.length !== 1) return
    if (e.target.closest?.('button')) return // keep the edit/delete buttons tappable
    const t = e.touches[0]
    const s = touchRef.current
    clearTimeout(s.timer)
    s.id = p.id
    s.startX = t.clientX
    s.startY = t.clientY
    s.x = t.clientX
    s.y = t.clientY
    s.active = false
    s.dropId = null
    s.timer = setTimeout(() => {
      s.active = true
      setDraggingId(p.id)
      setTouchDragging(true)
      navigator.vibrate?.(12)
    }, LONG_PRESS_MS)
  }

  // Keep the latest drag-merge logic reachable from the one-time touch listeners.
  const dragActionRef = useRef({ items: [], applyCard: () => {}, applyGroup: () => {} })
  useEffect(() => {
    moveItemRef.current = moveItem
    dragActionRef.current = {
      items,
      applyCard: applyCardDrop,
      applyGroup: applyGroupHeaderDrop,
    }
  })

  // Drop the ghost at the finger the instant a long-press promotes to a drag.
  useEffect(() => {
    if (touchDragging) positionGhost(touchRef.current.x, touchRef.current.y)
  }, [touchDragging])

  useEffect(() => {
    function endSession() {
      const s = touchRef.current
      clearTimeout(s.timer)
      s.id = null
      s.active = false
      s.dropId = null
      s.dropGroupId = null
      setDraggingId(null)
      setDropId(null)
      setDropGroupId(null)
      setTouchDragging(false)
    }

    function onTouchMove(e) {
      const s = touchRef.current
      if (s.id == null) return
      const t = e.touches[0]
      if (!t) return
      s.x = t.clientX
      s.y = t.clientY
      if (!s.active) {
        // Within the long-press wait a real move means the user is scrolling —
        // cancel the pending pickup and let the page scroll normally.
        const moved = Math.abs(t.clientX - s.startX) + Math.abs(t.clientY - s.startY)
        if (moved > TOUCH_MOVE_CANCEL) {
          clearTimeout(s.timer)
          s.id = null
        }
        return
      }
      e.preventDefault() // dragging now — suppress page scroll
      positionGhost(t.clientX, t.clientY)
      const el = document.elementFromPoint(t.clientX, t.clientY)
      // Group header has priority over a card so dropping on a header always
      // means "join this group" even when the header sits on top of cards.
      const groupEl = el && el.closest('[data-drop-group-id]')
      const cardEl = el && el.closest('[data-card-id]')
      const live = dragActionRef.current
      const source = live.items.find((it) => it.id === s.id) || null

      let validCardId = null
      let validGroupId = null
      if (groupEl) {
        validGroupId = groupEl.getAttribute('data-drop-group-id')
      } else if (cardEl) {
        const id = cardEl.getAttribute('data-card-id')
        const target = id ? live.items.find((it) => it.id === id) : null
        if (id && id !== s.id && dropAcceptsTarget(source, target)) {
          validCardId = id
        }
      }

      if (s.dropId !== validCardId) {
        s.dropId = validCardId
        setDropId(validCardId)
      }
      if (s.dropGroupId !== validGroupId) {
        s.dropGroupId = validGroupId
        setDropGroupId(validGroupId)
      }
    }

    function onTouchEnd(e) {
      const s = touchRef.current
      if (s.id == null) return
      if (s.active) {
        if (e.cancelable) e.preventDefault() // swallow the trailing click
        const live = dragActionRef.current
        const source = live.items.find((it) => it.id === s.id) || null
        if (source) {
          if (s.dropGroupId) {
            live.applyGroup(source, s.dropGroupId)
          } else if (s.dropId && s.dropId !== s.id) {
            const target = live.items.find((it) => it.id === s.dropId)
            if (target) live.applyCard(source, target)
          }
        }
      }
      endSession()
    }

    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd)
    document.addEventListener('touchcancel', onTouchEnd)
    return () => {
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchEnd)
      clearTimeout(touchRef.current.timer)
    }
  }, [])

  const nameLabel =
    form.kind === '주식' ? '종목명' : form.kind === '비트코인' ? '코인명' : form.kind === '자산' ? '자산명' : '상품명'
  const namePlaceholder =
    form.kind === '주식'
      ? '예: 삼성전자'
      : form.kind === '비트코인'
        ? '비트코인'
      : form.kind === '자산'
        ? '예: 금 10g, 외화 예치금, 파킹통장'
        : '예: OO은행 정기예금'
  const dateLabel = form.kind === '예금' ? '가입일' : form.kind === '적금' ? '시작일' : form.kind === '자산' ? '평가기준일' : '매수일'
  const stockBuyPreview = form.kind === '주식' ? additionalBuyPreview(form) : null
  const savingsPreview = form.kind === '적금' ? savingsPreviewFromForm(form, today) : null
  const taxBenefitOptions = taxBenefitOptionsForKind(form.kind)
  const activeTaxBenefit = normalizeInvestmentTaxBenefit(form.kind, form.taxBenefit)

  return (
    <div className="stage" style={{ '--accent': INVEST_META[form.kind].color }}>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">투자 원금 합계</div>
          <div className="value">
            {formatKRW(totals.cost)}
            <InvestStatBreakdown breakdown={marketReport.assetBreakdown} field="cost" />
          </div>
        </div>
        <div className="stat-card">
          <div className="label">현재 평가액</div>
          <div className="value accent">
            {formatKRW(totals.current)}
            <InvestStatBreakdown breakdown={marketReport.assetBreakdown} field="current" />
          </div>
        </div>
        <div className="stat-card">
          <div className="label">평가손익</div>
          <div className={`value ${profitClass(totals.profit)}`}>
            {signedKRW(totals.profit)}
            {totals.cost > 0 && (
              <span className="value-sub">
                {' '}
                ({totals.profit >= 0 ? '+' : ''}
                {((totals.profit / totals.cost) * 100).toFixed(2)}%)
              </span>
            )}
            <InvestStatBreakdown breakdown={marketReport.assetBreakdown} field="profit" signed />
          </div>
        </div>
        <RepresentativeFXCard />
      </div>

      {formOpen && (
        <div className="fixed-modal-backdrop" onClick={cancelEdit}>
          <div
            className="fixed-modal invest-modal"
            role="dialog"
            aria-modal="true"
            style={{ '--accent': INVEST_META[form.kind].color }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fixed-modal-head">
              <h3>{editingId ? '투자 위젯 수정' : '투자 위젯 추가'}</h3>
              <button className="fixed-modal-close" onClick={cancelEdit} aria-label="닫기">
                ×
              </button>
            </div>

        <div className="seg invest-kind-seg">
          {INVEST_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={form.kind === kind ? 'on' : ''}
              style={form.kind === kind ? { '--accent': INVEST_META[kind].color } : undefined}
              onClick={() => selectKind(kind)}
              disabled={editingId != null && form.kind !== kind}
            >
              {kind}
            </button>
          ))}
        </div>
        <p className="invest-kind-desc">{INVEST_META[form.kind].desc}</p>

        <form className="invest-form" onSubmit={submit}>
          <div
            className={`field${form.kind === '주식' ? ' stock-search-field' : ''}`}
            onBlur={(e) => {
              if (form.kind === '주식' && !e.currentTarget.contains(e.relatedTarget)) {
                setStockSearchOpen(false)
              }
            }}
          >
            <label>{nameLabel}</label>
            <div className={form.kind === '주식' ? 'stock-search-control' : undefined}>
              <input
                type="text"
                placeholder={namePlaceholder}
                value={form.name}
                onFocus={() => {
                  if (
                    form.kind === '주식' &&
                    stockSearch.items.length > 0 &&
                    form.name.trim() !== stockSearchLockedQuery
                  ) {
                    setStockSearchOpen(true)
                  }
                }}
                onChange={(e) =>
                  form.kind === '주식' ? setStockName(e.target.value) : set('name', e.target.value)
                }
              />
              {form.kind === '주식' && (
                <button
                  type="button"
                  className="stock-search-button"
                  onClick={runStockRemoteSearch}
                  disabled={
                    (form.name.trim() || form.quoteSymbol.trim()).length < 2 ||
                    (stockSearch.state === 'loading' && stockSearch.mode === 'remote')
                  }
                  aria-label="외부 종목 검색"
                  title="외부 종목 검색"
                >
                  <SearchIcon />
                </button>
              )}
            </div>
            {form.kind === '주식' &&
              stockSearchOpen &&
              stockSearch.query.trim().length >= 2 && (
                <div className="stock-search-results">
                  {stockSearch.state === 'loading' ? (
                    <div className="stock-search-empty">
                      {stockSearch.mode === 'remote' ? '종목 검색중' : '자동완성 확인중'}
                    </div>
                  ) : stockSearch.items.length > 0 ? (
                    stockSearch.items.map((result) => (
                      <button
                        type="button"
                        className="stock-search-option"
                        key={result.symbol}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyStockSearchResult(result)}
                      >
                        <b>{result.name}</b>
                        <span>
                          {result.symbol} · {result.exchange || result.type || '주식'} ·{' '}
                          {result.currency || '통화'}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="stock-search-empty">
                      {stockSearch.state === 'error'
                        ? stockSearch.error
                        : stockSearch.mode === 'remote'
                          ? '검색 결과 없음'
                          : '자동완성 결과 없음'}
                    </div>
                  )}
                </div>
              )}
          </div>
          <div className="field">
            <label>{dateLabel}</label>
            <CalendarInput value={form.date} onChange={(value) => set('date', value)} />
          </div>

          {form.kind === '예금' && (
            <>
              <div className="field">
                <label>원금 (원)</label>
                <NumberInput
                  min="0"
                  decimal={false}
                  placeholder="0"
                  value={form.principal}
                  onChange={(value) => set('principal', value)}
                />
              </div>
              <div className="field">
                <label>연이율 (%)</label>
                <NumberInput
                  min="0"
                  step="0.01"
                  placeholder="예: 3.5"
                  value={form.rate}
                  onChange={(value) => set('rate', value)}
                />
              </div>
              <div className="field">
                <label>만기 (개월)</label>
                <NumberInput
                  min="1"
                  decimal={false}
                  placeholder="예: 12"
                  value={form.months}
                  onChange={(value) => set('months', value)}
                />
              </div>
            </>
          )}

          {form.kind === '적금' && (
            <>
              <div className="field">
                <label>월 납입액 (원)</label>
                <NumberInput
                  min="0"
                  decimal={false}
                  placeholder="0"
                  value={form.monthly}
                  onChange={(value) => set('monthly', value)}
                />
              </div>
              <div className="field">
                <label>연이율 (%)</label>
                <NumberInput
                  min="0"
                  step="0.01"
                  placeholder="예: 4.0"
                  value={form.rate}
                  onChange={(value) => set('rate', value)}
                />
              </div>
              <div className="field">
                <label>만기 회차 (개월)</label>
                <NumberInput
                  min="1"
                  decimal={false}
                  placeholder="예: 24"
                  value={form.months}
                  onChange={(value) => set('months', value)}
                />
              </div>
              <div className="field">
                <label>납입 회차</label>
                <NumberInput
                  min="0"
                  decimal={false}
                  placeholder="예: 6"
                  value={form.round}
                  onChange={(value) => set('round', value)}
                />
              </div>
              {savingsPreview && (
                <div className="field field-wide invest-savings-preview">
                  <label>현재 자산</label>
                  <div className="invest-savings-preview-box">
                    <strong>{formatKRW(savingsPreview.current)}</strong>
                    <span>
                      {savingsPreview.round}회차 · 납입원금 {formatKRW(savingsPreview.cost)}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          {form.kind === '주식' && (
            <>
              <div className="field">
                <label>보유 수량 (주)</label>
                <NumberInput
                  min="0"
                  step="any"
                  placeholder="0"
                  value={form.shares}
                  onChange={(value) => set('shares', value)}
                />
              </div>
              <div className="field">
                <label>종목 코드/고유번호/티커</label>
                <input
                  type="text"
                  placeholder="예: 005930, 0183J0, AAPL"
                  value={form.quoteSymbol}
                  onChange={(e) => {
                    stockSymbolLookupRef.current = ''
                    set('quoteSymbol', e.target.value)
                  }}
                />
              </div>
              <div className="field">
                <label>평균 매수가 ({form.currency || '통화'})</label>
                <NumberInput
                  min="0"
                  placeholder="0"
                  value={form.buyPrice}
                  onChange={(value) => set('buyPrice', value)}
                />
              </div>
              <div className="field">
                <label>거래 통화</label>
                <input
                  type="text"
                  placeholder="KRW, USD, JPY"
                  value={form.currency}
                  onChange={(e) => set('currency', normalizeCurrencyCode(e.target.value, ''))}
                />
              </div>
              {editingId && (
                <>
                  <div className="field">
                    <label>추가 매수 수량 (주)</label>
                    <NumberInput
                      min="0"
                      step="any"
                      placeholder="0"
                      value={form.addShares}
                      onChange={(value) => set('addShares', value)}
                    />
                  </div>
                  <div className="field">
                    <label>추가 매수 단가 ({form.currency || '통화'})</label>
                    <NumberInput
                      min="0"
                      placeholder="0"
                      value={form.addBuyPrice}
                      onChange={(value) => set('addBuyPrice', value)}
                    />
                  </div>
                  {stockBuyPreview && (
                    <div className="field field-wide invest-buy-preview">
                      저장 후 {stockBuyPreview.shares.toLocaleString('ko-KR')}주 · 평단{' '}
                      {formatCurrency(stockBuyPreview.buyPrice, form.currency || 'KRW')}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {form.kind === '비트코인' && (
            <>
              <div className="field">
                <label>보유 수량 (BTC)</label>
                <NumberInput
                  min="0"
                  step="any"
                  placeholder="예: 0.05"
                  value={form.bitcoinAmount}
                  onChange={(value) => set('bitcoinAmount', value)}
                />
              </div>
              <div className="field">
                <label>평균 매수가 (원/BTC)</label>
                <NumberInput
                  amount
                  min="0"
                  decimal={false}
                  placeholder="예: 9,000만원"
                  value={form.bitcoinBuyPrice}
                  onChange={(value) => set('bitcoinBuyPrice', value)}
                />
              </div>
              <div className="field">
                <label>현재 BTC 가격 (원)</label>
                <NumberInput
                  amount
                  min="0"
                  decimal={false}
                  placeholder="저장 후 자동 조회"
                  value={form.currentPrice}
                  onChange={(value) => set('currentPrice', value)}
                />
              </div>
            </>
          )}

          {form.kind === '자산' && (
            <>
              <div className="field">
                <label>자산 종류</label>
                <input
                  type="text"
                  list="invest-asset-type-options"
                  placeholder="예: 현금성자산, 금, 외화"
                  value={form.assetType}
                  onChange={(e) => set('assetType', e.target.value)}
                />
                <datalist id="invest-asset-type-options">
                  {ASSET_TYPE_OPTIONS.map((option) => (
                    <option value={option} key={option} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <label>현재 평가액 (원)</label>
                <NumberInput
                  amount
                  min="0"
                  decimal={false}
                  placeholder="예: 500만원"
                  value={form.assetValue}
                  onChange={(value) => set('assetValue', value)}
                />
              </div>
              <div className="field">
                <label>취득원가 (원)</label>
                <NumberInput
                  amount
                  min="0"
                  decimal={false}
                  placeholder="미입력 시 현재 평가액"
                  value={form.assetCost}
                  onChange={(value) => set('assetCost', value)}
                />
              </div>
            </>
          )}

          {(form.kind === '예금' || form.kind === '적금') && (
            <div className="field">
              <label>이자 방식</label>
              <div className="seg seg-sm">
                <button
                  type="button"
                  className={form.method === '단리' ? 'on' : ''}
                  onClick={() => set('method', '단리')}
                >
                  단리
                </button>
                <button
                  type="button"
                  className={form.method === '복리' ? 'on' : ''}
                  onClick={() => set('method', '복리')}
                >
                  복리
                </button>
              </div>
            </div>
          )}

          <div className="field field-wide">
            <label>연말정산 세제혜택</label>
            <div className="seg seg-sm tax-benefit-seg">
              {taxBenefitOptions.map((tag) => (
                <button
                  type="button"
                  key={tag}
                  className={activeTaxBenefit === tag ? 'on' : ''}
                  onClick={() => set('taxBenefit', tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="field field-wide">
            <label>색상</label>
            <div className="fixed-color-control">
              <div className="fixed-color-swatches">
                {INVEST_COLORS.map((color) => (
                  <button
                    type="button"
                    className={`fixed-color-swatch${form.color === color ? ' on' : ''}`}
                    key={color}
                    style={{ '--swatch': color }}
                    onClick={() => set('color', color)}
                    aria-label={`${color} 선택`}
                  />
                ))}
              </div>
              <input
                type="color"
                value={form.color || defaultColor(form.kind)}
                onChange={(e) => set('color', e.target.value)}
                aria-label="투자 위젯 색상 선택"
              />
            </div>
          </div>

          <div className="field field-wide">
            <label>메모</label>
            <input
              type="text"
              placeholder="선택 입력"
              value={form.memo}
              onChange={(e) => set('memo', e.target.value)}
            />
          </div>

          <div className="field form-actions">
            <button type="submit" className="btn btn-accent">
              {editingId ? '수정 완료' : '추가'}
            </button>
            {editingId && (
              <button type="button" className="btn" onClick={cancelEdit}>
                취소
              </button>
            )}
          </div>
        </form>
          </div>
        </div>
      )}

      <div className="invest-toolbar">
        <div>
          <h2 className="section-title">투자 위젯</h2>
          <div className="invest-summary">
            {items.length}개 상품 · 평가액 {formatKRW(totals.current)}
          </div>
        </div>
        <div className="invest-toolbar-actions">
          <button
            type="button"
            className={`invest-analysis-toggle${analysisOpen ? ' on' : ''}`}
            onClick={() => setAnalysisOpen((open) => !open)}
            aria-pressed={analysisOpen}
          >
            <span className="invest-analysis-toggle-track">
              <span className="invest-analysis-toggle-thumb" />
            </span>
            <span>분석</span>
          </button>
          <button className="invest-add-btn" onClick={openAdd} aria-label="투자 위젯 추가">
            <PlusIcon />
          </button>
        </div>
      </div>

      {analysisOpen && <InvestmentReport report={marketReport} />}

      {items.length === 0 ? (
        <div className="invest-empty-widget">
          <strong>등록된 투자 위젯 없음</strong>
          <span>+ 버튼으로 예금, 적금, 주식, 비트코인, 자산을 추가하세요.</span>
        </div>
      ) : (
        <div className="invest-section-stack">
          {widgetSections
            .filter((section) => section.items.length > 0)
            .map((section) => {
              const renderCard = (p) => (
                <Fragment key={p.id}>
                  <ProductCard
                    product={p}
                    today={today}
                    rates={rates}
                    editing={editingId === p.id}
                    selected={activeChartId === p.id}
                    dragging={draggingId === p.id}
                    dropTarget={dropId === p.id}
                    quoteStatus={quoteStatus[p.id]}
                    onClick={() => togglePriceChart(p)}
                    onEdit={() => startEdit(p)}
                    onRemove={() => handleRemove(p)}
                    onDragStart={(e) => handleDragStart(e, p)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, p)}
                    onDragLeave={(e) => handleDragLeave(e, p)}
                    onDrop={(e) => handleDrop(e, p)}
                    onTouchStart={(e) => handleTouchStart(e, p)}
                  />
                  {activeChartId === p.id && MARKET_ASSET_KINDS.has(p.kind) && (
                    <StockChartPanel product={p} onClose={() => setActiveChartId(null)} />
                  )}
                </Fragment>
              )

              return (
                <section
                  className={`invest-section invest-section-${section.id}`}
                  key={section.id}
                  style={{ '--accent': section.color }}
                >
                  <div className="invest-section-head">
                    <div className="invest-section-headline">
                      <div className="invest-section-title">
                        <span className="invest-dot" style={{ background: section.color }} />
                        {section.title}
                        <span className="invest-section-count">{section.items.length}</span>
                      </div>
                      <div className="invest-section-desc">{section.desc}</div>
                    </div>
                    <div className="invest-section-meta">
                      {section.monthlyOutflow > 0 && (
                        <span className="invest-section-monthly">월 납입 {formatKRW(section.monthlyOutflow)}</span>
                      )}
                      <span className="invest-section-total">{formatKRW(section.total)}</span>
                    </div>
                  </div>

                  <div className="invest-widget-grid">
                    {section.displayCards.map((entry) =>
                      entry.type === 'group' ? (
                        <InvestmentGroupCard
                          key={entry.id}
                          group={entry.group}
                          accent={entry.group.color}
                          today={today}
                          rates={rates}
                          dropActive={dropGroupId === entry.id}
                          onRename={(name) => renameGroup(entry.id, name)}
                          onDissolve={() => dissolveGroup(entry.id)}
                          onDragOver={(e) => handleGroupDragOver(e, entry.id)}
                          onDragLeave={(e) => handleGroupDragLeave(e, entry.id)}
                          onDrop={(e) => handleGroupDrop(e, entry.id)}
                        />
                      ) : (
                        renderCard(entry.item)
                      )
                    )}
                  </div>
                </section>
              )
            })}
        </div>
      )}

      {touchDragging && draggingItem && (
        <div
          className="invest-drag-ghost"
          ref={ghostRef}
          aria-hidden="true"
          style={{
            '--accent': draggingItem.color || INVEST_META[draggingItem.kind].color,
          }}
        >
          <span className="invest-drag-ghost-kind">{draggingItem.kind}</span>
          <span className="invest-drag-ghost-name">{draggingItem.name || '(이름 없음)'}</span>
        </div>
      )}
    </div>
  )
}

function ActivePieSlice(props) {
  const {
    cx,
    cy,
    innerRadius,
    outerRadius,
    startAngle,
    endAngle,
    fill,
    stroke,
    strokeWidth,
  } = props

  return (
    <g className="invest-pie-active-slice">
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 8}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    </g>
  )
}

function compactAssetAmount(value, { signed = false } = {}) {
  const raw = Math.round(Number(value) || 0)
  const abs = Math.abs(raw)
  const sign = raw < 0 ? '-' : signed && raw > 0 ? '+' : ''
  if (abs >= 100000000) {
    const eok = Math.floor(abs / 100000000)
    const man = Math.round((abs % 100000000) / 10000)
    if (man >= 1000) {
      const cheon = man / 1000
      return `${sign}${eok}억${cheon.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}천`
    }
    return `${sign}${eok}억${man > 0 ? `${man.toLocaleString('ko-KR')}만` : ''}`
  }
  if (abs >= 10000000) {
    return `${sign}${(abs / 10000000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}천`
  }
  if (abs >= 10000) return `${sign}${Math.round(abs / 10000).toLocaleString('ko-KR')}만`
  return `${sign}${abs.toLocaleString('ko-KR')}`
}

function InvestStatBreakdown({ breakdown, field, signed = false }) {
  const safe = breakdown?.safe?.[field] || 0
  const variable = breakdown?.variable?.[field] || 0
  const safeText = compactAssetAmount(safe, { signed })
  const variableText = compactAssetAmount(variable, { signed })

  return (
    <span
      className="invest-stat-breakdown"
      title={`안전자산 ${signed ? signedKRW(safe) : formatKRW(safe)} / 변동자산 ${signed ? signedKRW(variable) : formatKRW(variable)}`}
      aria-label={`안전자산 ${safeText}, 변동자산 ${variableText}`}
    >
      <b className="safe">{safeText}</b>
      <i>/</i>
      <b className={`risk${signed ? ` ${profitClass(variable)}` : ''}`}>{variableText}</b>
    </span>
  )
}

function InvestmentReport({ report }) {
  const [activePie, setActivePie] = useState(null)

  if (report.portfolioTotal <= 0) {
    return (
      <section className="invest-report">
        <div className="invest-report-empty">
          <strong>투자 리포트 없음</strong>
          <span>투자 위젯이 추가되면 안전자산과 위험자산 분석이 표시됩니다.</span>
        </div>
      </section>
    )
  }

  const safePiePositions = report.safePositions.filter((pos) => pos.current > 0)
  const marketPiePositions = report.positions.filter((pos) => pos.current > 0)
  const activePiePosition =
    activePie?.group === 'safe'
      ? safePiePositions[activePie.index]
      : activePie?.group === 'market'
        ? marketPiePositions[activePie.index]
        : null

  return (
    <section className="invest-report">
      <div className="invest-report-head">
        <div>
          <div className="invest-report-kicker">전체 투자 포트폴리오</div>
          <h3>투자 리포트</h3>
        </div>
        <span className={`invest-risk-pill ${report.rating.tone}`}>{report.rating.label}</span>
      </div>

      <div className="invest-report-grid">
        <div className="invest-report-card invest-report-card-full">
          <h4>안전 · 위험 자산 구성</h4>
          <p className="invest-report-summary">{report.allocationSummary}</p>
          <div className="invest-allocation-track" aria-label="안전자산 위험자산 대체자산 비중">
            {report.allocationBuckets
              .filter((bucket) => bucket.value > 0)
              .map((bucket) => (
                <span
                  key={bucket.id}
                  style={{
                    '--alloc': bucket.color,
                    width: `${Math.max(4, bucket.weight)}%`,
                  }}
                  title={`${bucket.label} ${formatPct(bucket.weight)} · ${formatKRW(bucket.value)}`}
                />
              ))}
          </div>
          <div className="invest-allocation-grid">
            {report.allocationBuckets.map((bucket) => (
              <div className={`invest-allocation-item ${bucket.id}`} key={bucket.id}>
                <div className="invest-allocation-item-head">
                  <span className="invest-dot" style={{ background: bucket.color }} />
                  <strong>{bucket.label}</strong>
                  <b>{formatPct(bucket.weight)}</b>
                </div>
                <div className="invest-allocation-value">{formatKRW(bucket.value)}</div>
                <p>{bucket.count}개 · {bucket.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="invest-report-card invest-report-card-wide" onMouseLeave={() => setActivePie(null)}>
          <h4>자산 비중</h4>
          <div className="invest-report-pie-grid">
            <InvestmentPieBlock
              title="예금 · 적금 · 현금"
              ariaLabel="안전자산 비중 파이 차트"
              centerLabel="안전자산"
              positions={safePiePositions}
              total={report.safeTotal}
              activeIndex={activePie?.group === 'safe' ? activePie.index : null}
              onActiveIndexChange={(index) => setActivePie({ group: 'safe', index })}
              emptyText="예금, 적금, 현금성 자산이 입력되면 차트가 표시됩니다."
            />
            <InvestmentPieBlock
              title="주식 · 비트코인"
              ariaLabel="시장성 자산 비중 파이 차트"
              centerLabel="시장성자산"
              positions={marketPiePositions}
              total={report.totalCurrent}
              activeIndex={activePie?.group === 'market' ? activePie.index : null}
              onActiveIndexChange={(index) => setActivePie({ group: 'market', index })}
              emptyText="평가액이 입력되면 차트가 표시됩니다."
            />
          </div>
          <InvestmentPieHoverPanel position={activePiePosition} />
        </div>

        <div className="invest-report-card">
          <h4>위험도</h4>
          <div className="invest-risk-list">
            {report.risks.map((risk) => (
              <div className="invest-risk-row" key={risk.name}>
                <div className="invest-risk-row-main">
                  <span>{risk.name}</span>
                  <span className={`invest-risk-pill ${risk.tone}`}>{risk.label}</span>
                </div>
                <strong>{risk.value}</strong>
                <p>{risk.detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="invest-report-card invest-report-card-portfolio">
          <h4>포트폴리오 평가</h4>
          {report.summary && <p className="invest-report-summary">{report.summary}</p>}
          <div className="invest-report-notes">
            {report.notes.map((note) => (
              <span key={note}>{note}</span>
            ))}
          </div>
          <div className="invest-report-actions">
            {report.actions.map((action) => (
              <div className="invest-report-action" key={action.title}>
                <strong>{action.title}</strong>
                <span>{action.detail}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  )
}

function InvestmentPieBlock({
  title,
  ariaLabel,
  centerLabel,
  positions,
  total,
  activeIndex,
  onActiveIndexChange,
  emptyText,
}) {
  return (
    <div className="invest-report-pie-block">
      <div className="invest-report-pie-block-head">
        <strong>{title}</strong>
        <span>{formatKRW(total)}</span>
      </div>
      <div className="invest-report-pie-wrap">
        <div className="invest-report-pie-chart" aria-label={ariaLabel}>
          {positions.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={positions}
                    dataKey="current"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius="48%"
                    outerRadius="76%"
                    paddingAngle={2}
                    stroke="#fff"
                    strokeWidth={2}
                    label={({ percent }) => (percent >= 0.08 ? `${Math.round(percent * 100)}%` : '')}
                    labelLine={false}
                    activeIndex={activeIndex ?? undefined}
                    activeShape={ActivePieSlice}
                    onMouseEnter={(_, index) => onActiveIndexChange(index)}
                    rootTabIndex={-1}
                  >
                    {positions.map((pos, index) => (
                      <Cell
                        key={pos.id}
                        fill={pos.color || REPORT_COLORS[index % REPORT_COLORS.length]}
                        focusable="false"
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="invest-report-pie-center">
                <span>{centerLabel}</span>
                <strong>{compactKRW(total)}</strong>
              </div>
            </>
          ) : (
            <div className="invest-report-pie-empty">{emptyText}</div>
          )}
        </div>
      </div>
    </div>
  )
}

function InvestmentPieHoverPanel({ position }) {
  return (
    <div className={`invest-report-pie-hover invest-report-pie-hover-common${position ? ' active' : ''}`}>
      {position ? (
        <>
          <div className="invest-report-pie-hover-head">
            <i style={{ background: position.color }} />
            <strong>{position.name}</strong>
            <span>{formatPct(position.weight)}</span>
          </div>
          <dl>
            <div>
              <dt>평가액</dt>
              <dd>{formatKRW(position.current)}</dd>
            </div>
            {position.count != null && (
              <div>
                <dt>항목</dt>
                <dd>{position.count}개</dd>
              </div>
            )}
            <div>
              <dt>손익</dt>
              <dd className={profitClass(position.profit)}>
                {signedKRW(position.profit)}
              </dd>
            </div>
          </dl>
        </>
      ) : (
        <span>파이 조각에 커서를 올리면 상세 비중이 표시됩니다.</span>
      )}
    </div>
  )
}

function InvestmentGroupCard({
  group,
  accent,
  today,
  rates,
  dropActive,
  onRename,
  onDissolve,
  onDragOver,
  onDragLeave,
  onDrop,
}) {
  const [editing, setEditing] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [draft, setDraft] = useState(group.name)
  const inputRef = useRef(null)
  const memberNames = group.items.map((item) => item.name || item.kind).filter(Boolean)
  const memberText =
    memberNames.length > 3
      ? `${memberNames.slice(0, 3).join(', ')} 외 ${memberNames.length - 3}개`
      : memberNames.join(', ')
  const previewItems = group.items.slice(0, 1)
  const previewExtraCount = Math.max(0, group.items.length - previewItems.length)
  const returnPct = group.cost > 0 ? (group.profit / group.cost) * 100 : 0

  useEffect(() => {
    if (!editing) setDraft(group.name)
  }, [group.name, editing])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function commit() {
    const next = draft.trim() || group.name
    if (next !== group.name) onRename?.(next)
    setEditing(false)
  }

  return (
    <>
      <div
        className={`invest-card invest-group-card${dropActive ? ' drop-target' : ''}`}
        style={{ '--accent': accent }}
        data-drop-group-id={group.id}
        role="button"
        tabIndex={0}
        aria-label={`${group.name} 그룹 열기`}
        onClick={() => {
          if (!editing) setFolderOpen(true)
        }}
        onKeyDown={(e) => {
          if (editing) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setFolderOpen(true)
          }
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="invest-card-head">
          <span className="invest-card-name invest-folder-tab">
            <span className="invest-dot" style={{ background: accent }} />
            <b>{group.items.length}개</b>
          </span>
          <div className="invest-card-tools">
            <button
              type="button"
              className="icon-btn"
              onClick={(e) => {
                e.stopPropagation()
                setEditing(true)
              }}
              aria-label={`${group.name} 그룹 이름 수정`}
              title="이름 수정"
            >
              ✎
            </button>
            <button
              type="button"
              className="icon-btn danger"
              onClick={(e) => {
                e.stopPropagation()
                onDissolve()
              }}
              aria-label={`${group.name} 그룹 해제`}
              title="그룹 해제"
            >
              ×
            </button>
          </div>
        </div>
        <div className="invest-widget-body">
          {editing ? (
            <input
              ref={inputRef}
              className="invest-group-name-input"
              value={draft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') {
                  setDraft(group.name)
                  setEditing(false)
                }
              }}
              maxLength={24}
            />
          ) : (
            <div className="invest-group-name">
              <strong>{group.name}</strong>
            </div>
          )}
          <div className="invest-widget-value">{formatKRW(group.total)}</div>
          <div className={`invest-widget-profit ${profitClass(group.profit)}`}>
            {signedKRW(group.profit)}
            {group.cost > 0 && (
              <span>
                {' '}
                ({returnPct >= 0 ? '+' : ''}
                {returnPct.toFixed(2)}%)
              </span>
            )}
          </div>
          <div className="invest-folder-preview" aria-label={memberText || '그룹 항목 없음'}>
            {previewItems.length > 0 ? (
              <>
                {previewItems.map((item) => (
                  <span key={item.id}>{item.name || item.kind}</span>
                ))}
                {previewExtraCount > 0 && <span className="more">+{previewExtraCount}</span>}
              </>
            ) : (
              <span>그룹 항목 없음</span>
            )}
          </div>
        </div>
      </div>
      {folderOpen && (
        <InvestmentGroupFolder
          group={group}
          accent={accent}
          today={today}
          rates={rates}
          onClose={() => setFolderOpen(false)}
        />
      )}
    </>
  )
}

function InvestmentGroupFolder({ group, accent, today, rates, onClose }) {
  const returnPct = group.cost > 0 ? (group.profit / group.cost) * 100 : 0

  return (
    <div className="fixed-modal-backdrop invest-folder-backdrop" onClick={onClose}>
      <div
        className="invest-folder-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${group.name} 그룹`}
        style={{ '--accent': accent }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="invest-folder-head">
          <div>
            <div className="invest-folder-title">
              <span className="invest-dot" style={{ background: accent }} />
              <h3>{group.name}</h3>
              <span>{group.items.length}개</span>
            </div>
            <div className="invest-folder-summary">
              <strong>{formatKRW(group.total)}</strong>
              <b className={profitClass(group.profit)}>
                {signedKRW(group.profit)}
                {group.cost > 0 && (
                  <>
                    {' '}
                    ({returnPct >= 0 ? '+' : ''}
                    {returnPct.toFixed(2)}%)
                  </>
                )}
              </b>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="그룹 닫기" title="닫기">
            ×
          </button>
        </div>

        <div className="invest-folder-list">
          {group.items.map((item) => {
            const metrics = productMetrics(item, today, rates)
            const color = item.color || INVEST_META[item.kind]?.color || accent
            return (
              <div className="invest-folder-item" key={item.id} style={{ '--accent': color }}>
                <div className="invest-folder-item-main">
                  <span className="invest-dot" style={{ background: color }} />
                  <div>
                    <strong>{item.name || item.kind}</strong>
                    <span>{item.kind}</span>
                  </div>
                </div>
                <div className="invest-folder-item-value">
                  <strong>{formatKRW(metrics.current)}</strong>
                  <span className={profitClass(metrics.profit)}>{signedKRW(metrics.profit)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ProfitPill({ profit, returnPct, label, showPct = true, costForPct = 0 }) {
  const tone = profit > 0 ? 'pos' : profit < 0 ? 'neg' : 'flat'
  const pct = Number.isFinite(returnPct)
    ? returnPct
    : costForPct > 0
      ? (profit / costForPct) * 100
      : null
  const strong = pct != null && Math.abs(pct) >= 10 ? ' strong' : ''
  const arrow = tone === 'pos' ? '▲' : tone === 'neg' ? '▼' : ''
  return (
    <span className={`invest-profit-pill ${tone}${strong}`}>
      {arrow && <span className="invest-profit-arrow" aria-hidden="true">{arrow}</span>}
      <b>{signedKRW(profit)}</b>
      {showPct && pct != null && (
        <i>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</i>
      )}
      {label && <em>{label}</em>}
    </span>
  )
}

function ProgressBar({ value, total, accent }) {
  const denom = Number(total) || 0
  const pct = denom > 0 ? Math.min(100, Math.max(0, (Number(value) / denom) * 100)) : 0
  return (
    <span className="invest-progress" aria-hidden="true">
      <i style={{ width: `${pct}%`, background: accent }} />
    </span>
  )
}

function daysUntilMaturity(dateStr, months) {
  if (!dateStr || !Number.isFinite(months) || months <= 0) return null
  const [y, m, d] = String(dateStr).split('-').map(Number)
  if (!y || !m) return null
  const start = new Date(y, (m || 1) - 1, d || 1)
  if (Number.isNaN(start.getTime())) return null
  const maturity = new Date(start.getFullYear(), start.getMonth() + months, start.getDate())
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((maturity - today) / (1000 * 60 * 60 * 24))
}

function ProductCard({
  product: p,
  today,
  rates,
  editing,
  selected,
  dragging,
  dropTarget,
  quoteStatus,
  onClick,
  onEdit,
  onRemove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onTouchStart,
}) {
  const color = p.color || INVEST_META[p.kind].color
  const m = productMetrics(p, today, rates)
  const status =
    p.kind === '주식' || p.kind === '비트코인' || p.kind === '환율'
      ? quoteStatus || { state: 'idle', text: p.kind === '환율' || quoteSymbolForProduct(p) ? '대기' : '코드 없음' }
      : null
  const clickable = MARKET_ASSET_KINDS.has(p.kind)
  const missingFx = p.kind === '주식' && m.currency !== 'KRW' && !m.exchangeRate

  let valueText = formatKRW(m.current)
  let valueSub = null
  let metaNode = null
  let pillNode = null

  if (p.kind === '예금') {
    const dday = daysUntilMaturity(p.date, m.months)
    const dLabel =
      m.elapsed >= m.months
        ? '만기'
        : dday != null && dday > 0
          ? `D-${dday}`
          : null
    pillNode = (
      <ProfitPill profit={m.profit} costForPct={m.cost} showPct={m.cost > 0} />
    )
    metaNode = (
      <>
        <ProgressBar value={m.elapsed} total={m.months} accent={color} />
        <span className="invest-meta-text">{m.elapsed}/{m.months}개월</span>
        {dLabel && <span className="invest-meta-chip">{dLabel}</span>}
      </>
    )
  } else if (p.kind === '적금') {
    pillNode = (
      <ProfitPill
        profit={m.profit}
        costForPct={m.cost}
        showPct={m.cost > 0}
        label={`납입 ${formatKRW(m.cost)}`}
      />
    )
    metaNode = (
      <>
        <ProgressBar value={m.round} total={m.totalRounds} accent={color} />
        <span className="invest-meta-text">{m.round}/{m.totalRounds}회차</span>
        {m.monthly > 0 && (
          <span className="invest-meta-chip">월 {formatKRW(m.monthly)}</span>
        )}
      </>
    )
  } else if (p.kind === '비트코인') {
    pillNode = <ProfitPill profit={m.profit} returnPct={m.returnPct} />
    valueSub = (
      <span className="invest-value-sub">
        {m.quantity.toLocaleString('ko-KR', { maximumFractionDigits: 8 })} BTC
      </span>
    )
    metaNode = (
      <span className="invest-meta-text">현재 {formatKRW(m.currentPrice)}</span>
    )
  } else if (p.kind === '자산') {
    pillNode = (
      <ProfitPill profit={m.profit} costForPct={m.cost} showPct={m.cost > 0} />
    )
    metaNode = (
      <>
        <span className="invest-meta-chip">{m.assetType || '기타'}</span>
        <span className="invest-meta-text">{p.date}</span>
      </>
    )
  } else if (p.kind === '환율') {
    valueText = `${formatRate(m.rate)} ${m.targetCurrency}`
    metaNode = (
      <span className="invest-meta-text">
        1 {m.baseCurrency} = {formatRate(m.rate)} {m.targetCurrency}
      </span>
    )
  } else if (missingFx) {
    valueText = '환율 필요'
    pillNode = (
      <span className="invest-profit-pill warn">
        <b>{m.currency}/KRW 환율 조회 필요</b>
      </span>
    )
    valueSub = (
      <span className="invest-value-sub">
        현재 {formatCurrency(m.currentPrice, m.currency)}
      </span>
    )
    metaNode = (
      <>
        {p.quoteSymbol && <span className="invest-meta-chip">{p.quoteSymbol}</span>}
        {m.currency && <span className="invest-meta-chip ghost">{m.currency}</span>}
      </>
    )
  } else {
    pillNode = <ProfitPill profit={m.profit} returnPct={m.returnPct} />
    valueSub = (
      <span className="invest-value-sub">
        현재 {formatCurrency(m.currentPrice, m.currency)}
      </span>
    )
    metaNode = (
      <>
        {p.quoteSymbol && <span className="invest-meta-chip">{p.quoteSymbol}</span>}
        {m.currency && m.currency !== 'KRW' && (
          <span className="invest-meta-chip ghost">
            {m.currency} · {formatRate(m.exchangeRate)}
          </span>
        )}
      </>
    )
  }

  return (
    <div
      className={`invest-card${clickable ? ' chart-clickable' : ''}${editing ? ' editing' : ''}${
        selected ? ' selected' : ''
      }${dragging ? ' dragging' : ''}${
        dropTarget ? ' drop-target' : ''
      }`}
      style={{ '--accent': color }}
      data-card-id={p.id}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-expanded={clickable ? selected : undefined}
      aria-label={clickable ? `${p.name} 시세 그래프 ${selected ? '닫기' : '보기'}` : undefined}
      draggable
      onClick={clickable ? onClick : undefined}
      onKeyDown={(e) => {
        if (!clickable || e.target.closest?.('button')) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onTouchStart={onTouchStart}
    >
      <div className="invest-card-head">
        <span className="invest-kind-chip">{p.kind}</span>
        <div className="invest-card-tools">
          {status && (
            <span className={`quote-badge ${status.state}`}>{status.text}</span>
          )}
          <button
            className="icon-btn"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            aria-label={`${p.name} 수정`}
            title="수정"
          >
            ✎
          </button>
          <button
            className="icon-btn danger"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            aria-label={`${p.name} 삭제`}
            title="삭제"
          >
            ×
          </button>
        </div>
      </div>

      <div className="invest-card-body">
        <div className="invest-card-name" title={p.name}>{p.name}</div>
        <div className="invest-card-value">
          <strong>{valueText}</strong>
          {valueSub}
        </div>
        {pillNode}
      </div>

      {metaNode && <div className="invest-card-meta">{metaNode}</div>}
    </div>
  )
}

function StockChartPanel({ product: p, onClose }) {
  const [range, setRange] = useState(STOCK_CHART_RANGES[1].value)
  const chartSymbol = p.kind === '비트코인' ? BITCOIN_SYMBOL : p.quoteSymbol || p.symbol || ''
  const chartCurrency = p.kind === '비트코인' ? 'KRW' : p.quoteCurrency || p.currency || 'KRW'
  const [chart, setChart] = useState({
    state: 'loading',
    points: [],
    currency: chartCurrency,
    symbol: chartSymbol,
    error: '',
  })
  const activeRange =
    STOCK_CHART_RANGES.find((option) => option.value === range) || STOCK_CHART_RANGES[1]
  const color = p.color || INVEST_META[p.kind].color

  useEffect(() => {
    const symbol = chartSymbol
    if (!symbol) {
      setChart((prev) => ({
        ...prev,
        state: 'error',
        points: [],
        error: '종목 코드가 없습니다.',
      }))
      return undefined
    }

    let cancelled = false
    setChart((prev) => ({ ...prev, state: 'loading', error: '' }))
    fetchStockHistory(symbol, activeRange)
      .then((history) => {
        if (cancelled) return
        setChart({
          state: 'ok',
          points: history.points,
          currency: normalizeCurrencyCode(history.currency || chartCurrency, 'KRW'),
          symbol: history.symbol || symbol,
          error: '',
        })
      })
      .catch((error) => {
        if (cancelled) return
        setChart((prev) => ({
          ...prev,
          state: 'error',
          points: [],
          error: error?.message || '그래프 조회 실패',
        }))
      })

    return () => {
      cancelled = true
    }
  }, [activeRange, chartCurrency, chartSymbol])

  const points = chart.points
  const currency = chart.currency || chartCurrency
  const first = points[0]?.price || 0
  const last = points[points.length - 1]?.price || 0
  const change = first > 0 && last > 0 ? last - first : 0
  const changePct = first > 0 && last > 0 ? (change / first) * 100 : 0
  const buyPrice = Number(p.buyPrice) || 0

  return (
    <div className="invest-stock-chart-card" style={{ '--accent': color }}>
      <div className="invest-stock-chart-head">
        <div>
          <div className="invest-stock-chart-kicker">{chart.symbol || chartSymbol || p.kind}</div>
          <h3>{p.name} 현재가 추이</h3>
          <p className={`invest-stock-chart-change ${profitClass(change)}`}>
            {last > 0 ? formatCurrency(last, currency) : '조회중'}
            {first > 0 && last > 0 && (
              <span>
                {' '}
                {signedCurrency(change, currency)} ({changePct >= 0 ? '+' : ''}
                {changePct.toFixed(2)}%)
              </span>
            )}
          </p>
        </div>
        <div className="invest-stock-chart-actions">
          <div className="stock-range-toggle" aria-label="그래프 기간">
            {STOCK_CHART_RANGES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={range === option.value ? 'on' : ''}
                onClick={() => setRange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="그래프 닫기" title="닫기">
            ×
          </button>
        </div>
      </div>

      {chart.state === 'loading' ? (
        <div className="invest-chart-state">그래프 조회중</div>
      ) : chart.state === 'error' ? (
        <div className="invest-chart-state error">{chart.error}</div>
      ) : (
        <div className="invest-stock-chart-plot">
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
              <XAxis
                dataKey="date"
                tickFormatter={formatChartDate}
                fontSize={12}
                tickMargin={8}
                minTickGap={22}
              />
              <YAxis
                tickFormatter={(value) => compactCurrency(value, currency)}
                fontSize={12}
                width={54}
                domain={['auto', 'auto']}
              />
              <Tooltip
                formatter={(value) => [formatCurrency(value, currency), '종가']}
                labelFormatter={(value) => value}
              />
              {buyPrice > 0 && (
                <ReferenceLine
                  y={buyPrice}
                  stroke="#94a3b8"
                  strokeDasharray="4 4"
                  label={{ value: '평단', position: 'insideTopRight', fill: '#64748b', fontSize: 12 }}
                />
              )}
              <Line
                type="monotone"
                dataKey="price"
                stroke={color}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// Rotating top-of-stage widget that cycles through representative FX rates
// (USD/KRW, JPY/KRW, …) with their day-over-day change. Rates refresh on a
// timer so the card stays live without user interaction.
function RepresentativeFXCard() {
  const [quotes, setQuotes] = useState([])
  const [index, setIndex] = useState(0)
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const results = await Promise.all(
        REP_FX_PAIRS.map(async (pair) => {
          try {
            const quote = await fetchExchangeRate(pair.base, pair.target)
            return { ...pair, ...quote }
          } catch {
            return null
          }
        })
      )
      if (cancelled) return
      const ok = results.filter(Boolean)
      setQuotes(ok)
      setStatus(ok.length > 0 ? 'ok' : 'error')
    }
    load()
    const timer = window.setInterval(load, REP_FX_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (quotes.length <= 1) return undefined
    const timer = window.setInterval(() => {
      setIndex((i) => (i + 1) % quotes.length)
    }, REP_FX_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [quotes.length])

  const active = quotes.length ? quotes[index % quotes.length] : null
  const change = active ? Number(active.changePercent) || 0 : 0
  const tone = change > 0 ? 'up' : change < 0 ? 'down' : ''
  const mark = change > 0 ? '▲' : change < 0 ? '▼' : '–'

  return (
    <div className="stat-card category-stat-card">
      <div className="fx-stat-roll" key={active ? `${active.base}${active.target}` : 'empty'}>
        <div className="label">
          {active ? `${active.label} (${active.base}/${active.target})` : '대표 환율'}
        </div>
        <div className="value fx-rate-value">
          {active ? (
            <>
              <span>{formatRate(active.price)}</span>
              <span className={`month-change fx-rate-change ${tone}`}>
                ({mark} {Math.abs(change).toFixed(2)}%)
              </span>
            </>
          ) : status === 'loading' ? (
            '조회중'
          ) : (
            '조회 실패'
          )}
        </div>
      </div>
    </div>
  )
}
