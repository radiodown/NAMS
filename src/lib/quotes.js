import { STOCK_SEARCH_PRESETS } from './stockSearchPresets.generated.js'

export function normalizeStockSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase().replace(/\s+/g, '')
  if (!symbol) return ''
  if (symbol === 'KRW-BTC') return 'BTC-KRW'
  if (/^\d{6}$/.test(symbol)) return `${symbol}.KS`
  if (/^\d[0-9A-Z]{5}$/.test(symbol)) return `${symbol}.KS`
  const classMatch = symbol.match(/^([A-Z]{1,6})[./]([A-Z])$/)
  if (classMatch && !['F', 'L', 'T', 'V'].includes(classMatch[2])) {
    return `${classMatch[1]}-${classMatch[2]}`
  }
  return symbol
}

export function normalizeCurrencyCode(value, fallback = '') {
  const code = String(value || fallback).trim().toUpperCase().replace(/[^A-Z]/g, '')
  return code || fallback
}

export function normalizeExchangeSymbol(base, target = 'KRW') {
  const baseCurrency = normalizeCurrencyCode(base)
  const targetCurrency = normalizeCurrencyCode(target, 'KRW')
  if (!baseCurrency || !targetCurrency) return ''
  return `${baseCurrency}${targetCurrency}=X`
}

const QUOTE_TIMEOUT_MS = 12000
const QUOTE_CACHE_PREFIX = 'nams.quote.'
const QUOTE_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7
const STOCK_QUOTE_CACHE_MS = 1000 * 60
const FX_QUOTE_CACHE_MS = 1000 * 60 * 60
const FRANKFURTER_URL = 'https://api.frankfurter.dev/v1/latest'
const UPBIT_TICKER_URL = 'https://api.upbit.com/v1/ticker'
const UPBIT_CANDLES_DAYS_URL = 'https://api.upbit.com/v1/candles/days'
const NAVER_ETF_PAGE_SIZE = 100
const NAVER_ETF_MAX_PAGES = 15
const quoteMemoryCache = new Map()

function isLocalDev() {
  if (typeof window === 'undefined') return false
  return ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname)
}

function readerUrl(url) {
  return `https://r.jina.ai/${encodeURIComponent(url)}`
}

function yahooChartPath(symbol, options = {}) {
  const params = new URLSearchParams({
    range: options.range || '1d',
    interval: options.interval || '1d',
  })
  return `/v8/finance/chart/${encodeURIComponent(symbol)}?${params.toString()}`
}

function yahooSearchPath(query, options = {}) {
  const params = new URLSearchParams({
    q: String(query || '').trim(),
    quotesCount: String(options.limit || 8),
    newsCount: '0',
  })
  return `/v1/finance/search?${params.toString()}`
}

function yahooChartUrl(symbol, options) {
  return yahooChartUrls(symbol, options)[0]
}

function yahooChartUrls(symbol, options) {
  const path = yahooChartPath(symbol, options)
  if (isLocalDev()) return [`/api/yahoo${path}`]

  // GitHub Pages has no server-side proxy, and Yahoo's chart endpoint is not
  // browser-CORS friendly. Jina Reader gives static deployments a CORS-enabled
  // read-only pass-through while keeping the same Yahoo payload shape.
  return [
    readerUrl(`http://query1.finance.yahoo.com${path}`),
    readerUrl(`http://query2.finance.yahoo.com${path}`),
  ]
}

function yahooSearchUrl(query, options) {
  const path = yahooSearchPath(query, options)
  if (isLocalDev()) return `/api/yahoo${path}`
  return readerUrl(`http://query1.finance.yahoo.com${path}`)
}

function naverStockBasicUrl(code) {
  if (typeof window === 'undefined') return `https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/basic`
  return readerUrl(`http://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/basic`)
}

function naverEtfListUrl(page, pageSize = NAVER_ETF_PAGE_SIZE) {
  if (typeof window === 'undefined') {
    return `https://m.stock.naver.com/api/stocks/etf?page=${page}&pageSize=${pageSize}`
  }
  return readerUrl(`http://m.stock.naver.com/api/stocks/etf?page=${page}&pageSize=${pageSize}`)
}

function naverSearchAutoCompleteUrl(query) {
  const params = new URLSearchParams({
    query: String(query || '').trim(),
    target: 'stock',
  })
  const path = `/front-api/search/autoComplete?${params.toString()}`
  if (typeof window === 'undefined') return `https://m.stock.naver.com${path}`
  return readerUrl(`http://m.stock.naver.com${path}`)
}

function upbitTickerUrl(market) {
  const params = new URLSearchParams({ markets: market })
  return `${UPBIT_TICKER_URL}?${params.toString()}`
}

function upbitCandlesDaysUrl(market, options = {}) {
  const params = new URLSearchParams({
    market,
    count: String(options.count || 90),
  })
  if (options.to) params.set('to', options.to)
  return `${UPBIT_CANDLES_DAYS_URL}?${params.toString()}`
}

function extractJson(text) {
  const source = String(text || '').trim()
  if (!source) throw new Error('빈 응답입니다.')

  try {
    return JSON.parse(source)
  } catch {
    const marker = 'Markdown Content:'
    const body = source.includes(marker)
      ? source.slice(source.indexOf(marker) + marker.length).trim()
      : source
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('응답 형식이 올바르지 않습니다.')
    return JSON.parse(body.slice(start, end + 1))
  }
}

async function fetchText(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    const text = await res.text()
    if (!res.ok) throw new Error(`시세 조회 실패 (${res.status})`)
    return text
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('시세 조회 시간이 초과되었습니다.')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url, options = {}) {
  return extractJson(await fetchText(url, options))
}

function quoteCacheKey(symbol) {
  const normalized = normalizeStockSymbol(symbol)
  return normalized ? `${QUOTE_CACHE_PREFIX}${normalized}` : ''
}

function normalizeCachedQuote(value, symbol) {
  const quote = value && typeof value === 'object' ? value : null
  const price = Number(quote?.price)
  if (!quote || !Number.isFinite(price) || price <= 0) return null
  const cachedAt = Date.parse(quote.cachedAt || quote.time)
  if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > QUOTE_CACHE_MAX_AGE_MS) return null
  const cachedAtIso = new Date(cachedAt).toISOString()
  return {
    symbol: quote.symbol || normalizeStockSymbol(symbol),
    price,
    previousClose: Number(quote.previousClose) || 0,
    change: Number(quote.change) || 0,
    changePercent: Number(quote.changePercent) || 0,
    currency: quote.currency || guessStockCurrency(quote.symbol || symbol),
    time: quote.time || quote.cachedAt,
    fetchedAt: quote.fetchedAt || cachedAtIso,
    cachedAt: cachedAtIso,
  }
}

function readCachedQuote(symbol, maxAgeMs = QUOTE_CACHE_MAX_AGE_MS) {
  const key = quoteCacheKey(symbol)
  if (!key) return null

  const memoryQuote = normalizeCachedQuote(quoteMemoryCache.get(key), symbol)
  if (memoryQuote) {
    return { ...memoryQuote, cached: true, stale: Date.now() - Date.parse(memoryQuote.cachedAt) > maxAgeMs }
  }

  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    const storageQuote = normalizeCachedQuote(JSON.parse(window.localStorage.getItem(key) || 'null'), symbol)
    if (!storageQuote) return null
    quoteMemoryCache.set(key, storageQuote)
    return { ...storageQuote, cached: true, stale: Date.now() - Date.parse(storageQuote.cachedAt) > maxAgeMs }
  } catch {
    return null
  }
}

function writeCachedQuote(symbol, quote) {
  const key = quoteCacheKey(symbol)
  if (!key || !quote?.price) return quote
  const cached = {
    symbol: quote.symbol || normalizeStockSymbol(symbol),
    price: quote.price,
    previousClose: quote.previousClose || 0,
    change: quote.change || 0,
    changePercent: quote.changePercent || 0,
    currency: quote.currency || guessStockCurrency(quote.symbol || symbol),
    time: quote.time || new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    cachedAt: new Date().toISOString(),
  }
  quoteMemoryCache.set(key, cached)
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(key, JSON.stringify(cached))
    } catch {
      // Storage may be blocked; in-memory cache still helps during this session.
    }
  }
  return { ...quote, fetchedAt: cached.fetchedAt, cachedAt: cached.cachedAt, cached: false, stale: false }
}

async function withCachedQuoteFallback(symbol, fetcher, options = {}) {
  const maxAgeMs = options.maxAgeMs ?? QUOTE_CACHE_MAX_AGE_MS
  const freshCached = readCachedQuote(symbol, maxAgeMs)
  if (freshCached && !freshCached.stale) return freshCached

  try {
    return writeCachedQuote(symbol, await fetcher())
  } catch (error) {
    const cached = readCachedQuote(symbol, maxAgeMs)
    if (cached) return { ...cached, errorMessage: error?.message || '시세 조회 실패' }
    throw error
  }
}

function quoteFromYahooData(data, fallbackSymbol) {
  if (data?.code || data?.status) {
    throw new Error(data?.readableMessage || data?.message || '시세 조회 실패')
  }

  const error = data?.chart?.error
  if (error) throw new Error(error.description || error.message || '시세 조회 실패')

  const meta = data?.chart?.result?.[0]?.meta
  const price = Number(meta?.regularMarketPrice ?? meta?.previousClose)
  if (!Number.isFinite(price) || price <= 0) throw new Error('현재가를 찾을 수 없습니다.')

  const prevRaw = Number(meta?.chartPreviousClose ?? meta?.previousClose)
  const previousClose = Number.isFinite(prevRaw) && prevRaw > 0 ? prevRaw : 0
  const change = previousClose > 0 ? price - previousClose : 0
  const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0

  const seconds = Number(meta?.regularMarketTime)
  return {
    symbol: meta?.symbol || fallbackSymbol,
    price,
    previousClose,
    change,
    changePercent,
    currency: meta?.currency || guessStockCurrency(meta?.symbol || fallbackSymbol, meta?.exchangeName),
    time: seconds ? new Date(seconds * 1000).toISOString() : new Date().toISOString(),
  }
}

async function fetchYahooQuote(symbol, emptyMessage) {
  if (!symbol) throw new Error(emptyMessage)

  let lastError = null
  for (const url of yahooChartUrls(symbol)) {
    try {
      return quoteFromYahooData(await fetchJson(url), symbol)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('시세 조회 실패')
}

function isBitcoinKrwSymbol(symbol) {
  return normalizeStockSymbol(symbol) === 'BTC-KRW'
}

function quoteFromUpbitTickerData(data) {
  const item = Array.isArray(data) ? data[0] : null
  const price = Number(item?.trade_price)
  if (!Number.isFinite(price) || price <= 0) throw new Error('비트코인 현재가를 찾을 수 없습니다.')
  const previousClose = Number(item?.prev_closing_price) || 0
  const change = Number(item?.signed_change_price ?? (previousClose ? price - previousClose : 0)) || 0
  const rate = Number(item?.signed_change_rate)
  const timestamp = Number(item?.timestamp)
  return {
    symbol: 'BTC-KRW',
    price,
    previousClose,
    change,
    changePercent: Number.isFinite(rate) ? rate * 100 : previousClose > 0 ? (change / previousClose) * 100 : 0,
    currency: 'KRW',
    time: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
  }
}

async function fetchUpbitBitcoinQuote() {
  return quoteFromUpbitTickerData(await fetchJson(upbitTickerUrl('KRW-BTC')))
}

function historyCountForRange(range) {
  if (range === '1mo') return 31
  if (range === '1y') return 365
  return 93
}

function historyFromUpbitCandles(data) {
  const candles = Array.isArray(data) ? data : []
  const byDate = new Map()

  candles.forEach((item) => {
    const date = String(item?.candle_date_time_kst || item?.candle_date_time_utc || '').slice(0, 10)
    const price = Number(item?.trade_price)
    if (date && Number.isFinite(price) && price > 0 && !byDate.has(date)) {
      byDate.set(date, { date, price })
    }
  })

  const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  if (points.length === 0) throw new Error('비트코인 그래프 데이터를 찾을 수 없습니다.')

  return {
    symbol: 'BTC-KRW',
    currency: 'KRW',
    points,
  }
}

async function fetchUpbitBitcoinHistory(options = {}) {
  const targetCount = historyCountForRange(options.range || '3mo')
  const candles = []
  let to = ''

  while (candles.length < targetCount) {
    const batch = await fetchJson(
      upbitCandlesDaysUrl('KRW-BTC', {
        count: Math.min(200, targetCount - candles.length),
        to,
      })
    )
    if (!Array.isArray(batch) || batch.length === 0) break
    candles.push(...batch)
    const oldest = batch[batch.length - 1]?.candle_date_time_utc
    if (!oldest) break
    to = `${oldest}Z`
  }

  return historyFromUpbitCandles(candles)
}

function compactSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/코덱스/g, 'kodex')
    .replace(/타이거/g, 'tiger')
    .replace(/에이스/g, 'ace')
    .replace(/라이즈/g, 'rise')
    .replace(/케이비스타/g, 'kbstar')
    .replace(/아리랑/g, 'arirang')
    .replace(/플러스/g, 'plus')
    .replace(/하나로/g, 'hanaro')
    .replace(/코세프/g, 'kosef')
    .replace(/쏠|솔/g, 'sol')
    .replace(/에스[앤엔]피/g, 'sandp')
    .replace(/s\s*&\s*p/g, 'sandp')
    .replace(/\bsp(?=\d)/g, 'sandp')
    .replace(/[^0-9a-z가-힣]+/g, '')
}

function hasKorean(value) {
  return /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(String(value || ''))
}

function guessStockCurrency(symbol, exchange) {
  const code = String(symbol || '').toUpperCase()
  const exch = String(exchange || '').toUpperCase()
  if (code.endsWith('.KS') || code.endsWith('.KQ') || ['KSC', 'KOSPI', 'KOSDAQ'].includes(exch)) return 'KRW'
  if (code.endsWith('.T') || exch === 'JPX') return 'JPY'
  if (code.endsWith('.DE') || code.endsWith('.PA')) return 'EUR'
  return 'USD'
}

function normalizeSearchItem(item) {
  const symbol = normalizeStockSymbol(item?.symbol)
  if (!symbol) return null
  const name = String(item?.name || item?.longname || item?.shortname || symbol).trim()
  const exchange = String(item?.exchange || item?.exchDisp || '').trim()
  const currency = normalizeCurrencyCode(item?.currency, guessStockCurrency(symbol, exchange))
  return {
    symbol,
    name,
    exchange,
    type: String(item?.quoteType || item?.typeDisp || item?.type || '').trim(),
    currency,
    currentPrice: Number(item?.currentPrice) || undefined,
  }
}

function yahooSearchQuery(query) {
  const raw = String(query || '').trim()
  if (/^[A-Z]{1,6}[./-][A-Z]$/i.test(raw)) return normalizeStockSymbol(raw)
  if (/^\d[0-9A-Z]{5}(?:\.(?:KS|KQ))?$/i.test(raw)) return normalizeStockSymbol(raw)
  return raw
}

function localStockSearch(query) {
  const compact = compactSearchText(query)
  const normalizedSymbol = normalizeStockSymbol(query)
  if (!compact && !normalizedSymbol) return []

  return STOCK_SEARCH_PRESETS.map((item) => ({
    ...item,
    type: item.type || 'EQUITY',
    score:
      item.symbol === normalizedSymbol
        ? 0
        : compactSearchText(item.name) === compact
          ? 1
          : item.symbol.startsWith(normalizedSymbol)
            ? 2
            : compactSearchText(item.name).includes(compact)
              ? 3
              : (item.keywords || []).some((keyword) => compactSearchText(keyword).includes(compact))
                ? 4
                : 99,
  }))
    .filter((item) => item.score < 99)
    .sort((a, b) => {
      const aRank = Number.isFinite(a.rank) ? a.rank : Number.MAX_SAFE_INTEGER
      const bRank = Number.isFinite(b.rank) ? b.rank : Number.MAX_SAFE_INTEGER
      return a.score - b.score || aRank - bRank || a.name.localeCompare(b.name, 'ko')
    })
    .map(normalizeSearchItem)
    .filter(Boolean)
}

function koreanStockCode(symbol) {
  const match = String(symbol || '').toUpperCase().match(/^(\d[0-9A-Z]{5})(?:\.(?:KS|KQ))?$/)
  return match?.[1] || ''
}

function parseMarketNumber(value) {
  const n = Number(String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function quoteFromNaverData(data, fallbackSymbol) {
  const price = parseMarketNumber(data?.closePriceRaw ?? data?.closePrice)
  if (!price || price <= 0) throw new Error('현재가를 찾을 수 없습니다.')
  const change = parseMarketNumber(data?.compareToPreviousClosePriceRaw ?? data?.compareToPreviousClosePrice)
  const previousClose = price - change
  const changePercent = parseMarketNumber(data?.fluctuationsRatioRaw ?? data?.fluctuationsRatio)
  const fallback = normalizeStockSymbol(fallbackSymbol)
  const symbol = normalizeStockSymbol(data?.reutersCode || data?.itemCode || fallback)
  return {
    symbol: symbol.endsWith('.KS') && fallback.endsWith('.KQ') ? fallback : symbol,
    price,
    previousClose: previousClose > 0 ? previousClose : 0,
    change,
    changePercent,
    currency: data?.currencyType?.name || data?.currencyType?.code || 'KRW',
    time: data?.localTradedAt ? new Date(data.localTradedAt).toISOString() : new Date().toISOString(),
  }
}

async function fetchNaverQuote(symbol) {
  const code = koreanStockCode(symbol)
  if (!code) throw new Error('종목 코드가 없습니다.')
  return quoteFromNaverData(await fetchJson(naverStockBasicUrl(code)), symbol)
}

function normalizeNaverEtfItem(item) {
  const code = String(item?.itemCode || item?.reutersCode || '').trim()
  if (!/^\d[0-9A-Z]{5}$/.test(code)) return null
  const exchangeCode = item?.stockExchangeType?.code || 'KS'
  const suffix = exchangeCode === 'KQ' ? 'KQ' : 'KS'
  return normalizeSearchItem({
    symbol: `${code}.${suffix}`,
    name: item?.stockName,
    exchange: item?.stockExchangeType?.nameEng || item?.stockExchangeType?.name || 'KOSPI',
    quoteType: 'ETF',
    currency: 'KRW',
    currentPrice: parseMarketNumber(item?.closePriceRaw ?? item?.closePrice),
  })
}

function naverSearchCurrency(item) {
  const nation = String(item?.nationCode || '').toUpperCase()
  if (nation === 'KOR') return 'KRW'
  if (nation === 'USA') return 'USD'
  if (nation === 'JPN') return 'JPY'
  if (nation === 'CHN') return 'CNY'
  if (nation === 'HKG') return 'HKD'
  return guessStockCurrency(item?.code || item?.reutersCode, item?.typeCode || item?.typeName)
}

function normalizeNaverSearchSymbol(item) {
  const code = String(item?.code || '').trim().toUpperCase()
  const reutersCode = String(item?.reutersCode || '').trim().toUpperCase()
  const exchange = String(item?.typeCode || '').trim().toUpperCase()
  const nation = String(item?.nationCode || '').trim().toUpperCase()
  if (/^\d{6}$/.test(code) && nation === 'KOR') {
    return `${code}.${exchange === 'KOSDAQ' ? 'KQ' : 'KS'}`
  }
  if (nation === 'USA' && /^[A-Z][A-Z0-9.-]{0,9}$/.test(code)) {
    return code.replace('.', '-')
  }
  if (exchange === 'TOKYO' && code) return `${code}.T`
  return normalizeStockSymbol(code || reutersCode)
}

function normalizeNaverSearchItem(item) {
  const symbol = normalizeNaverSearchSymbol(item)
  if (!symbol) return null
  const category = String(item?.category || '').toUpperCase()
  return normalizeSearchItem({
    symbol,
    name: item?.name,
    exchange: item?.typeName || item?.typeCode,
    quoteType: category.includes('ETF') ? 'ETF' : 'EQUITY',
    currency: naverSearchCurrency(item),
  })
}

let naverEtfListPromise = null

async function fetchNaverEtfList() {
  if (!naverEtfListPromise) {
    naverEtfListPromise = (async () => {
      const first = await fetchJson(naverEtfListUrl(1))
      const firstStocks = first?.stocks || []
      const total = Number(first?.totalCount) || firstStocks.length
      const pages = Math.min(Math.ceil(total / NAVER_ETF_PAGE_SIZE), NAVER_ETF_MAX_PAGES)
      const rest = await Promise.all(
        Array.from({ length: Math.max(0, pages - 1) }, (_, index) =>
          fetchJson(naverEtfListUrl(index + 2)).catch(() => ({ stocks: [] }))
        )
      )
      return [first, ...rest]
        .flatMap((page) => page?.stocks || [])
        .map(normalizeNaverEtfItem)
        .filter(Boolean)
    })().catch((error) => {
      naverEtfListPromise = null
      throw error
    })
  }
  return naverEtfListPromise
}

function shouldSearchKoreanEtfs(query) {
  const compact = compactSearchText(query)
  return (
    hasKorean(query) ||
    /^\d{2,6}/.test(compact) ||
    /(kodex|tiger|ace|sol|rise|kbstar|arirang|plus|hanaro|kosef|etf|sandp|nasdaq|kospi|kosdaq)/i.test(compact)
  )
}

async function naverEtfSearch(query, options = {}) {
  if (!shouldSearchKoreanEtfs(query)) return []
  const compact = compactSearchText(query)
  const normalizedSymbol = normalizeStockSymbol(query)
  const normalizedCode = koreanStockCode(normalizedSymbol)
  const limit = options.limit || 8
  const list = await fetchNaverEtfList()

  return list
    .map((item) => {
      const itemCode = koreanStockCode(item.symbol)
      const text = compactSearchText(`${item.name} ${item.symbol} ${itemCode}`)
      const score =
        item.symbol === normalizedSymbol || itemCode === normalizedCode
          ? 0
          : compactSearchText(item.name) === compact
            ? 1
            : itemCode.startsWith(compact)
              ? 2
              : text.includes(compact)
                ? 3
                : 99
      return { ...item, score }
    })
    .filter((item) => item.score < 99)
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, 'ko'))
    .slice(0, limit)
    .map(({ score, ...item }) => item)
}

async function naverAutoCompleteSearch(query, options = {}) {
  const limit = options.limit || 8
  const data = await fetchJson(naverSearchAutoCompleteUrl(query))
  return (data?.result?.items || [])
    .map(normalizeNaverSearchItem)
    .filter(Boolean)
    .slice(0, limit)
}

async function yahooStockSearch(query, options = {}) {
  const data = await fetchJson(yahooSearchUrl(yahooSearchQuery(query), options))
  return (data?.quotes || [])
    .filter((item) => ['EQUITY', 'ETF'].includes(String(item?.quoteType || '').toUpperCase()))
    .map(normalizeSearchItem)
    .filter(Boolean)
}

export async function fetchStockSearch(input, options = {}) {
  const query = String(input || '').trim()
  if (query.length < 2) return []

  const limit = options.limit || 8
  const local = localStockSearch(query).slice(0, limit)
  if (options.localOnly) return local

  const naverAuto = await naverAutoCompleteSearch(query, { limit }).catch(() => [])
  const naverEtfs = await naverEtfSearch(query, { limit }).catch(() => [])
  const remote =
    hasKorean(query) && (local.length > 0 || naverAuto.length > 0 || naverEtfs.length > 0)
      ? []
      : await yahooStockSearch(query, { limit }).catch(() => [])

  const map = new Map()
  ;[...local, ...naverAuto, ...naverEtfs, ...remote].forEach((item) => {
    const prev = map.get(item.symbol)
    if (!prev) {
      map.set(item.symbol, item)
      return
    }
    map.set(item.symbol, {
      ...prev,
      exchange: prev.exchange || item.exchange,
      type: prev.type || item.type,
      currency: prev.currency || item.currency,
      currentPrice: prev.currentPrice || item.currentPrice,
    })
  })
  return [...map.values()].slice(0, limit)
}

function historyFromYahooData(data, fallbackSymbol) {
  if (data?.code || data?.status) {
    throw new Error(data?.readableMessage || data?.message || '그래프 조회 실패')
  }

  const error = data?.chart?.error
  if (error) throw new Error(error.description || error.message || '그래프 조회 실패')

  const result = data?.chart?.result?.[0]
  const timestamps = result?.timestamp || []
  const closes = result?.indicators?.quote?.[0]?.close || []
  const meta = result?.meta || {}
  const points = timestamps
    .map((seconds, index) => ({
      date: new Date(Number(seconds) * 1000).toISOString().slice(0, 10),
      price: Number(closes[index]),
    }))
    .filter((point) => point.date && Number.isFinite(point.price) && point.price > 0)

  if (points.length === 0) throw new Error('그래프 데이터를 찾을 수 없습니다.')

  return {
    symbol: meta.symbol || fallbackSymbol,
    currency: meta.currency || '',
    points,
  }
}

async function fetchFrankfurterRate(base, target) {
  const baseCurrency = normalizeCurrencyCode(base)
  const targetCurrency = normalizeCurrencyCode(target, 'KRW')
  if (!baseCurrency || !targetCurrency) throw new Error('통화 코드가 없습니다.')
  if (baseCurrency === targetCurrency) {
    return {
      symbol: `${baseCurrency}${targetCurrency}`,
      price: 1,
      previousClose: 1,
      change: 0,
      changePercent: 0,
      currency: targetCurrency,
      time: new Date().toISOString(),
    }
  }

  const url = `${FRANKFURTER_URL}?from=${encodeURIComponent(baseCurrency)}&to=${encodeURIComponent(targetCurrency)}`
  const data = await fetchJson(url)
  const price = Number(data?.rates?.[targetCurrency])
  if (!Number.isFinite(price) || price <= 0) throw new Error('환율을 찾을 수 없습니다.')

  return {
    symbol: `${baseCurrency}${targetCurrency}`,
    price,
    previousClose: 0,
    change: 0,
    changePercent: 0,
    currency: targetCurrency,
    time: data?.date ? new Date(`${data.date}T00:00:00Z`).toISOString() : new Date().toISOString(),
  }
}

export async function fetchStockQuote(input) {
  const symbol = normalizeStockSymbol(input)
  if (!symbol) throw new Error('종목 코드가 없습니다.')

  return withCachedQuoteFallback(symbol, async () => {
    if (isBitcoinKrwSymbol(symbol)) {
      try {
        return await fetchUpbitBitcoinQuote()
      } catch (upbitError) {
        try {
          return await fetchYahooQuote(symbol, '종목 코드가 없습니다.')
        } catch {
          throw upbitError
        }
      }
    }
    if (koreanStockCode(symbol)) {
      try {
        return await fetchNaverQuote(symbol)
      } catch (naverError) {
        try {
          return await fetchYahooQuote(symbol, '종목 코드가 없습니다.')
        } catch {
          throw naverError
        }
      }
    }
    return fetchYahooQuote(symbol, '종목 코드가 없습니다.')
  }, { maxAgeMs: STOCK_QUOTE_CACHE_MS })
}

export async function fetchStockHistory(input, options = {}) {
  const symbol = normalizeStockSymbol(input)
  if (!symbol) throw new Error('종목 코드가 없습니다.')

  if (isBitcoinKrwSymbol(symbol)) {
    try {
      return await fetchUpbitBitcoinHistory(options)
    } catch (upbitError) {
      try {
        return await fetchYahooHistory(symbol, options)
      } catch {
        throw upbitError
      }
    }
  }

  return fetchYahooHistory(symbol, options)
}

async function fetchYahooHistory(symbol, options = {}) {
  return historyFromYahooData(
    await fetchJson(
      yahooChartUrl(symbol, {
        range: options.range || '3mo',
        interval: options.interval || '1d',
      })
    ),
    symbol
  )
}

export async function fetchExchangeRate(base, target = 'KRW') {
  const symbol = normalizeExchangeSymbol(base, target)
  if (!symbol) throw new Error('통화 코드가 없습니다.')

  return withCachedQuoteFallback(symbol, async () => {
    try {
      return await fetchYahooQuote(symbol, '통화 코드가 없습니다.')
    } catch {
      return fetchFrankfurterRate(base, target)
    }
  }, { maxAgeMs: FX_QUOTE_CACHE_MS })
}
