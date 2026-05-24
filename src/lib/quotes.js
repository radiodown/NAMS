export function normalizeStockSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase().replace(/\s+/g, '')
  if (!symbol) return ''
  if (/^\d{6}$/.test(symbol)) return `${symbol}.KS`
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
const FRANKFURTER_URL = 'https://api.frankfurter.dev/v1/latest'

function isLocalDev() {
  if (typeof window === 'undefined') return false
  return (
    window.location.port === '5173' ||
    ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname)
  )
}

function yahooChartPath(symbol, options = {}) {
  const params = new URLSearchParams({
    range: options.range || '1d',
    interval: options.interval || '1d',
  })
  return `/v8/finance/chart/${encodeURIComponent(symbol)}?${params.toString()}`
}

function yahooChartUrl(symbol, options) {
  const path = yahooChartPath(symbol, options)
  if (isLocalDev()) return `/api/yahoo${path}`

  // GitHub Pages has no server-side proxy, and Yahoo's chart endpoint is not
  // browser-CORS friendly. Jina Reader gives static deployments a CORS-enabled
  // read-only pass-through while keeping the same Yahoo payload shape.
  return `https://r.jina.ai/http://query1.finance.yahoo.com${path.replace(/&/g, '%26')}`
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
    currency: meta?.currency || '',
    time: seconds ? new Date(seconds * 1000).toISOString() : new Date().toISOString(),
  }
}

async function fetchYahooQuote(symbol, emptyMessage) {
  if (!symbol) throw new Error(emptyMessage)

  return quoteFromYahooData(await fetchJson(yahooChartUrl(symbol)), symbol)
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
  return fetchYahooQuote(normalizeStockSymbol(input), '종목 코드가 없습니다.')
}

export async function fetchStockHistory(input, options = {}) {
  const symbol = normalizeStockSymbol(input)
  if (!symbol) throw new Error('종목 코드가 없습니다.')

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
  try {
    return await fetchYahooQuote(symbol, '통화 코드가 없습니다.')
  } catch (error) {
    return fetchFrankfurterRate(base, target)
  }
}
