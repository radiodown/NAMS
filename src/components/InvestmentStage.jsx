import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
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

const INVEST_COLORS = [
  '#d97706', '#dc2626', '#16a34a', '#0891b2', '#2563eb',
  '#7c3aed', '#db2777', '#0d9488',
]

const defaultColor = (kind) => INVEST_META[kind]?.color || INVEST_COLORS[0]

// Representative FX pairs shown in the rotating top widget.
const REP_FX_PAIRS = [
  { base: 'USD', target: 'KRW', label: '미국 달러' },
  { base: 'JPY', target: 'KRW', label: '일본 엔' },
  { base: 'EUR', target: 'KRW', label: '유로' },
  { base: 'CNY', target: 'KRW', label: '중국 위안' },
  { base: 'GBP', target: 'KRW', label: '영국 파운드' },
]
const REP_FX_INTERVAL_MS = 2800
const REP_FX_REFRESH_MS = 60000
const STOCK_CHART_RANGES = [
  { label: '1개월', value: '1mo', interval: '1d' },
  { label: '3개월', value: '3mo', interval: '1d' },
  { label: '1년', value: '1y', interval: '1wk' },
]
const REPORT_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#0891b2', '#7c3aed']
const STALE_QUOTE_MS = 1000 * 60 * 60 * 72
const QUOTE_REFRESH_MS = 1000 * 60 * 10
const QUOTE_STAGGER_MS = 1400
const QUOTE_FRESH_MS = 1000 * 60 * 10
const BITCOIN_SYMBOL = 'BTC-KRW'
const ASSET_TYPE_OPTIONS = ['현금성자산', '금', '외화', '채권', '부동산', '기타']

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

function isQuoteFresh(time) {
  const ts = Date.parse(time)
  return Number.isFinite(ts) && Date.now() - ts < QUOTE_FRESH_MS
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
  if (!isQuoteFresh(product?.quoteTime)) return true
  const currency = normalizeCurrencyCode(product?.currency || product?.quoteCurrency, 'KRW')
  return currency !== 'KRW' && !isQuoteFresh(product?.exchangeRateTime)
}

function groupedBy(positions, total, keyFn) {
  const map = new Map()
  positions.forEach((pos) => {
    const key = keyFn(pos)
    const prev = map.get(key) || { label: key, value: 0, count: 0 }
    prev.value += pos.current
    prev.count += 1
    map.set(key, prev)
  })
  return [...map.values()]
    .map((group) => ({ ...group, weight: total > 0 ? (group.value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value)
}

function buildStockReport(products) {
  const rates = exchangeRateMap(products)
  const positions = (products || [])
    .filter((p) => p.kind === '주식')
    .map((p, index) => {
      const metrics = stockMetrics(p, rates)
      const currency = metrics.currency
      const missingFx = currency !== 'KRW' && !metrics.exchangeRate
      const missingQuote = !(p.quoteSymbol || p.symbol) || !p.quoteTime || metrics.currentPrice <= 0
      const staleQuote = p.quoteTime ? isQuoteStale(p.quoteTime) : false
      return {
        id: p.id,
        name: p.name,
        symbol: p.quoteSymbol || p.symbol || '',
        color: p.color || REPORT_COLORS[index % REPORT_COLORS.length],
        currency,
        market: marketLabel(p.quoteSymbol || p.symbol, currency),
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

  const missingFxCount = positions.filter((pos) => pos.missingFx).length
  const missingQuoteCount = positions.filter((pos) => pos.missingQuote).length
  const staleQuoteCount = positions.filter((pos) => pos.staleQuote).length
  const concentrationLevel =
    topWeight >= 50 || top3Weight >= 75 ? 'high' : topWeight >= 35 || top3Weight >= 60 ? 'mid' : 'low'
  const fxLevel = fxWeight >= 50 ? 'high' : fxWeight >= 25 ? 'mid' : 'low'
  const lossLevel =
    lossWeight >= 50 || totalReturnPct <= -15 ? 'high' : lossWeight >= 25 || totalReturnPct < 0 ? 'mid' : 'low'
  const dataLevel = missingFxCount || missingQuoteCount ? 'high' : staleQuoteCount ? 'mid' : 'low'
  const risks = [
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
      value: formatPct(lossWeight),
      detail: totalProfit >= 0 ? '전체 평가손익은 플러스입니다.' : '전체 평가손익은 마이너스입니다.',
      ...riskLevel(lossLevel),
    },
    {
      name: '데이터 상태',
      value: `${missingFxCount + missingQuoteCount + staleQuoteCount}건`,
      detail: missingFxCount || missingQuoteCount ? '시세 또는 환율 보완이 필요합니다.' : '시세 데이터가 연결되어 있습니다.',
      ...riskLevel(dataLevel),
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
  const notes = []
  if (positions.length < 3) notes.push('보유 종목 수가 적어 분산 효과가 제한적입니다.')
  if (topWeight >= 35) notes.push(`${positions[0]?.name || '상위 종목'} 비중이 ${formatPct(topWeight)}입니다.`)
  if (fxWeight >= 25) notes.push(`외화 자산 비중이 ${formatPct(fxWeight)}입니다.`)
  if (best) notes.push(`수익 기여 1위는 ${best.name}입니다.`)
  if (worst && worst.profit < 0) notes.push(`손실 기여 1위는 ${worst.name}입니다.`)
  if (notes.length === 0) notes.push('분산과 데이터 상태가 비교적 안정적입니다.')

  return {
    positions,
    totalCurrent,
    totalCost,
    totalProfit,
    totalReturnPct,
    currencyGroups: groupedBy(positions, totalCurrent, (pos) => pos.currency),
    marketGroups: groupedBy(positions, totalCurrent, (pos) => pos.market),
    risks,
    rating,
    notes,
    summary:
      totalProfit >= 0
        ? `현재 주식 포트폴리오는 ${formatKRW(totalProfit)} 평가이익 구간입니다.`
        : `현재 주식 포트폴리오는 ${formatKRW(Math.abs(totalProfit))} 평가손실 구간입니다.`,
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
  const { items: rawItems, addItem, updateItem, removeItem, moveItem } = investments
  // Legacy 환율 items from older data are persisted but hidden from the grid —
  // representative FX rates now live in the top widget. The full list still
  // feeds summarize/exchangeRateMap so any saved rate keeps converting stocks.
  const items = useMemo(() => rawItems.filter((p) => p.kind !== '환율'), [rawItems])
  const today = todayStr()
  const [form, setForm] = useState(() => blankForm('예금'))
  const [editingId, setEditingId] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [quoteStatus, setQuoteStatus] = useState({})
  const [activeStockId, setActiveStockId] = useState(null)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [stockSearch, setStockSearch] = useState({ state: 'idle', query: '', items: [], error: '' })
  const [stockSearchOpen, setStockSearchOpen] = useState(false)
  const [stockSearchLockedQuery, setStockSearchLockedQuery] = useState('')
  const stockSymbolLookupRef = useRef('')

  // rawItems feeds summarize/exchangeRateMap so legacy 환율 widgets keep
  // providing FX rates for stock conversion. 환율 items contribute 0 to totals
  // so including them does not skew the numbers.
  const totals = useMemo(() => summarize(rawItems, today), [rawItems, today])
  const rates = useMemo(() => exchangeRateMap(rawItems), [rawItems])
  const stockReport = useMemo(() => buildStockReport(rawItems), [rawItems])

  useEffect(() => {
    if (!activeStockId) return
    if (!items.some((p) => p.id === activeStockId && p.kind === '주식')) {
      setActiveStockId(null)
    }
  }, [activeStockId, items])

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
    setStockSearch({ state: 'loading', query, items: [], error: '' })
    const timer = window.setTimeout(async () => {
      try {
        const results = await fetchStockSearch(query, { limit: 7 })
        if (cancelled) return
        setStockSearch({ state: 'done', query, items: results, error: '' })
        const autoResult = chooseStockLookupResult(query, results)
        if (autoResult) applyStockLookupResult(autoResult)
        setStockSearchOpen(true)
      } catch (error) {
        if (cancelled) return
        setStockSearch({
          state: 'error',
          query,
          items: [],
          error: error?.message || '검색 실패',
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
      const results = await fetchStockSearch(raw, { limit: 7 }).catch(() => [])
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

    async function fetchQuoteItem(p) {
      try {
        const quote = await fetchStockQuote(quoteSymbolForProduct(p))
        const currency = normalizeCurrencyCode(quote.currency || p.currency || p.quoteCurrency, 'KRW')
        if (currency === 'KRW') return { p, quote, currency }

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
      setQuoteStatus((prev) => ({
        ...prev,
        [p.id]: quote
          ? exchangeError
            ? { state: 'error', text: '환율 실패' }
            : { state: 'ok', text: '갱신됨' }
          : { state: 'error', text: error?.message || '조회 실패' },
      }))

      if (!quote) return
      updateItem(p.id, {
        currentPrice: quote.price,
        currency,
        quoteSymbol: quote.symbol || quoteSymbolForProduct(p),
        quoteCurrency: currency || quote.currency,
        quoteTime: quote.time,
        ...(exchangeQuote
          ? { exchangeRate: exchangeQuote.price, exchangeRateTime: exchangeQuote.time }
          : {}),
      })
    }

    async function refreshQuotes() {
      setQuoteStatus((prev) => {
        const next = { ...prev }
        quoteItems.forEach((p) => {
          if (!needsQuoteRefresh(p)) next[p.id] = { state: 'ok', text: '최근' }
        })
        return next
      })

      const targets = quoteItems.filter(needsQuoteRefresh)
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
    const name = result.name || normalizeStockSymbol(result.symbol)
    applyStockLookupResult(result, { lockName: true, fetchQuote: true })
    setStockSearchLockedQuery(name)
    setStockSearchOpen(false)
  }

  function submit(e) {
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
      const currentPrice = form.currentPrice === '' ? buyPrice : parseAmountInput(form.currentPrice)
      if (!quantity || quantity <= 0) return alert('보유 수량을 입력하세요.')
      if (!buyPrice || buyPrice <= 0) return alert('평균 매수가를 입력하세요.')
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
    setEditingId(null)
    setForm(blankForm(form.kind))
    setFormOpen(true)
  }

  function startEdit(p) {
    setEditingId(p.id)
    setForm(formFromProduct(p))
    setFormOpen(true)
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(blankForm(form.kind))
    setFormOpen(false)
  }

  function handleRemove(p) {
    if (window.confirm(`투자 상품 '${p.name}'을(를) 삭제할까요?`)) {
      removeItem(p.id)
      if (editingId === p.id) cancelEdit()
      if (activeStockId === p.id) setActiveStockId(null)
    }
  }

  function toggleStockChart(p) {
    if (p.kind !== '주식') return
    setActiveStockId((id) => (id === p.id ? null : p.id))
  }

  const draggingItem = draggingId ? items.find((it) => it.id === draggingId) || null : null

  // ---- widget reordering: drag a card onto another to drop it into that slot ----
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
  }

  function handleDragOver(e, p) {
    if (!draggingId || p.id === draggingId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropId !== p.id) setDropId(p.id)
  }

  function handleDragLeave(e, p) {
    if (e.currentTarget.contains(e.relatedTarget)) return
    if (dropId === p.id) setDropId(null)
  }

  function handleDrop(e, p) {
    e.preventDefault()
    const source = draggingId
    setDraggingId(null)
    setDropId(null)
    if (source && source !== p.id) moveItem(source, p.id)
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

  // Keep the latest reorder action reachable from the one-time touch listeners.
  useEffect(() => {
    moveItemRef.current = moveItem
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
      setDraggingId(null)
      setDropId(null)
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
      const cardEl = el && el.closest('[data-card-id]')
      const id = cardEl ? cardEl.getAttribute('data-card-id') : null
      const validId = id && id !== s.id ? id : null
      if (s.dropId !== validId) {
        s.dropId = validId
        setDropId(validId)
      }
    }

    function onTouchEnd(e) {
      const s = touchRef.current
      if (s.id == null) return
      if (s.active) {
        if (e.cancelable) e.preventDefault() // swallow the trailing click
        if (s.dropId && s.dropId !== s.id) moveItemRef.current(s.id, s.dropId)
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
          <div className="value">{formatKRW(totals.cost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">현재 평가액</div>
          <div className="value accent">{formatKRW(totals.current)}</div>
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
            <input
              type="text"
              placeholder={namePlaceholder}
              value={form.name}
              onFocus={() => {
                if (form.kind === '주식' && stockSearch.items.length > 0) setStockSearchOpen(true)
              }}
              onChange={(e) =>
                form.kind === '주식' ? setStockName(e.target.value) : set('name', e.target.value)
              }
            />
            {form.kind === '주식' &&
              stockSearchOpen &&
              stockSearch.query.trim().length >= 2 && (
                <div className="stock-search-results">
                  {stockSearch.state === 'loading' ? (
                    <div className="stock-search-empty">종목 검색중</div>
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
                      {stockSearch.state === 'error' ? stockSearch.error : '검색 결과 없음'}
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

      {analysisOpen && <InvestmentReport report={stockReport} />}

      {items.length === 0 ? (
        <div className="invest-empty-widget">
          <strong>등록된 투자 위젯 없음</strong>
          <span>+ 버튼으로 예금, 적금, 주식, 비트코인, 자산을 추가하세요.</span>
        </div>
      ) : (
        <div className="invest-widget-grid">
          {items.map((p) => (
            <Fragment key={p.id}>
              <ProductCard
                product={p}
                today={today}
                rates={rates}
                editing={editingId === p.id}
                selected={activeStockId === p.id}
                dragging={draggingId === p.id}
                dropTarget={dropId === p.id}
                quoteStatus={quoteStatus[p.id]}
                onClick={() => toggleStockChart(p)}
                onEdit={() => startEdit(p)}
                onRemove={() => handleRemove(p)}
                onDragStart={(e) => handleDragStart(e, p)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, p)}
                onDragLeave={(e) => handleDragLeave(e, p)}
                onDrop={(e) => handleDrop(e, p)}
                onTouchStart={(e) => handleTouchStart(e, p)}
              />
              {activeStockId === p.id && p.kind === '주식' && (
                <StockChartPanel product={p} onClose={() => setActiveStockId(null)} />
              )}
            </Fragment>
          ))}
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

function InvestmentReport({ report }) {
  if (report.positions.length === 0) {
    return (
      <section className="invest-report">
        <div className="invest-report-empty">
          <strong>주식 리포트 없음</strong>
          <span>주식 위젯이 추가되면 포트폴리오 분석이 표시됩니다.</span>
        </div>
      </section>
    )
  }

  return (
    <section className="invest-report">
      <div className="invest-report-head">
        <div>
          <div className="invest-report-kicker">주식 포트폴리오</div>
          <h3>투자 리포트</h3>
        </div>
        <span className={`invest-risk-pill ${report.rating.tone}`}>{report.rating.label}</span>
      </div>

      <div className="invest-report-stat-grid">
        <div className="invest-report-stat">
          <span>주식 평가액</span>
          <strong>{formatKRW(report.totalCurrent)}</strong>
        </div>
        <div className="invest-report-stat">
          <span>주식 원금</span>
          <strong>{formatKRW(report.totalCost)}</strong>
        </div>
        <div className="invest-report-stat">
          <span>평가손익</span>
          <strong className={profitClass(report.totalProfit)}>{signedKRW(report.totalProfit)}</strong>
        </div>
        <div className="invest-report-stat">
          <span>전체 수익률</span>
          <strong className={profitClass(report.totalProfit)}>
            {report.totalReturnPct >= 0 ? '+' : ''}
            {report.totalReturnPct.toFixed(2)}%
          </strong>
        </div>
      </div>

      <div className="invest-report-grid">
        <div className="invest-report-card invest-report-card-wide">
          <h4>종목 분포</h4>
          <div className="invest-report-bars">
            {report.positions.map((pos, index) => (
              <ReportBar
                key={pos.id}
                color={pos.color || REPORT_COLORS[index % REPORT_COLORS.length]}
                label={pos.name}
                meta={`${pos.symbol || pos.market} · ${formatKRW(pos.current)}`}
                value={formatPct(pos.weight)}
                weight={pos.weight}
              />
            ))}
          </div>
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

        <div className="invest-report-card">
          <h4>포트폴리오 평가</h4>
          <p className="invest-report-summary">{report.summary}</p>
          <div className="invest-report-notes">
            {report.notes.map((note) => (
              <span key={note}>{note}</span>
            ))}
          </div>
        </div>

        <div className="invest-report-card">
          <h4>통화 · 시장</h4>
          <div className="invest-report-mini-columns">
            <div className="invest-report-bars compact">
              {report.currencyGroups.map((group, index) => (
                <ReportBar
                  key={group.label}
                  color={REPORT_COLORS[index % REPORT_COLORS.length]}
                  label={group.label}
                  meta={`${group.count}개`}
                  value={formatPct(group.weight)}
                  weight={group.weight}
                />
              ))}
            </div>
            <div className="invest-report-bars compact">
              {report.marketGroups.map((group, index) => (
                <ReportBar
                  key={group.label}
                  color={REPORT_COLORS[(index + 3) % REPORT_COLORS.length]}
                  label={group.label}
                  meta={`${group.count}개`}
                  value={formatPct(group.weight)}
                  weight={group.weight}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function ReportBar({ color, label, meta, value, weight }) {
  return (
    <div className="invest-report-bar" style={{ '--bar': color }}>
      <div className="invest-report-bar-head">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="invest-report-bar-track">
        <i style={{ width: `${Math.max(2, Math.min(100, weight))}%` }} />
      </div>
      <div className="invest-report-bar-meta">{meta}</div>
    </div>
  )
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
  let kindDetail = ''
  let profitText = `수익 ${signedKRW(m.profit)}`
  let valueText = formatKRW(m.current)
  const clickable = p.kind === '주식'

  if (p.kind === '예금') {
    kindDetail = `예금 · ${m.elapsed}/${m.months}개월`
  } else if (p.kind === '적금') {
    kindDetail = `적금 · ${m.round}/${m.totalRounds}회차`
  } else if (p.kind === '비트코인') {
    kindDetail = `${m.quantity.toLocaleString('ko-KR', { maximumFractionDigits: 8 })} BTC · 현재 ${formatKRW(m.currentPrice)}`
    profitText = `${signedKRW(m.profit)} (${m.returnPct >= 0 ? '+' : ''}${m.returnPct.toFixed(2)}%)`
  } else if (p.kind === '자산') {
    kindDetail = `${m.assetType || '기타'} · ${p.date}`
    profitText = `평가손익 ${signedKRW(m.profit)}`
  } else if (p.kind === '환율') {
    kindDetail = `${m.baseCurrency}/${m.targetCurrency} · ${formatRate(m.rate)}`
    profitText = `1 ${m.baseCurrency} = ${formatRate(m.rate)} ${m.targetCurrency}`
    valueText = `${formatRate(m.rate)} ${m.targetCurrency}`
  } else if (m.currency !== 'KRW' && !m.exchangeRate) {
    kindDetail = `${p.quoteSymbol || '코드 없음'} · 현재 ${formatCurrency(m.currentPrice, m.currency)} · ${m.currency}/KRW 환율 조회 필요`
    profitText = `${m.currency}/KRW 환율 조회 필요`
    valueText = '환율 필요'
  } else {
    const fxText = m.currency === 'KRW' ? '' : ` · 환율 ${formatRate(m.exchangeRate)}`
    kindDetail = `${p.quoteSymbol || '코드 없음'} · 현재 ${formatCurrency(m.currentPrice, m.currency)}${fxText}`
    profitText = `${signedKRW(m.profit)} (${m.returnPct >= 0 ? '+' : ''}${m.returnPct.toFixed(2)}%)`
  }

  return (
    <div
      className={`invest-card${clickable ? ' stock-clickable' : ''}${editing ? ' editing' : ''}${
        selected ? ' selected' : ''
      }${dragging ? ' dragging' : ''}${
        dropTarget ? ' drop-target' : ''
      }`}
      style={{ '--accent': color }}
      data-card-id={p.id}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-expanded={clickable ? selected : undefined}
      aria-label={clickable ? `${p.name} 주식 그래프 ${selected ? '닫기' : '보기'}` : undefined}
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
        <span className="invest-card-name">
          <span className="invest-dot" style={{ background: color }} />
          {p.kind}
        </span>
        <div className="invest-card-tools">
          {status ? (
            <span className={`quote-badge ${status.state}`}>{status.text}</span>
          ) : (
            <span className="invest-card-date">{p.date}</span>
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

      <div className="invest-widget-body">
        <div className="invest-widget-name">{p.name}</div>
        <div className="invest-widget-value">{valueText}</div>
        <div className={`invest-widget-profit ${profitClass(m.profit)}`}>{profitText}</div>
        <div className="invest-widget-detail">{kindDetail}</div>
      </div>
    </div>
  )
}

function StockChartPanel({ product: p, onClose }) {
  const [range, setRange] = useState(STOCK_CHART_RANGES[1].value)
  const [chart, setChart] = useState({
    state: 'loading',
    points: [],
    currency: p.quoteCurrency || p.currency || 'KRW',
    symbol: p.quoteSymbol || p.symbol || '',
    error: '',
  })
  const activeRange =
    STOCK_CHART_RANGES.find((option) => option.value === range) || STOCK_CHART_RANGES[1]
  const color = p.color || INVEST_META[p.kind].color

  useEffect(() => {
    const symbol = p.quoteSymbol || p.symbol
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
          currency: normalizeCurrencyCode(history.currency || p.quoteCurrency || p.currency, 'KRW'),
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
  }, [activeRange, p.currency, p.quoteCurrency, p.quoteSymbol, p.symbol])

  const points = chart.points
  const currency = chart.currency || p.quoteCurrency || p.currency || 'KRW'
  const first = points[0]?.price || 0
  const last = points[points.length - 1]?.price || 0
  const change = first > 0 && last > 0 ? last - first : 0
  const changePct = first > 0 && last > 0 ? (change / first) * 100 : 0
  const buyPrice = Number(p.buyPrice) || 0

  return (
    <div className="invest-stock-chart-card" style={{ '--accent': color }}>
      <div className="invest-stock-chart-head">
        <div>
          <div className="invest-stock-chart-kicker">{chart.symbol || p.quoteSymbol || '주식'}</div>
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
