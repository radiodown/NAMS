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

function yahooChartUrl(symbol) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`
  const local =
    typeof window !== 'undefined' &&
    (window.location.port === '5173' ||
      ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname))
  return local ? `/api/yahoo${path}` : `https://query1.finance.yahoo.com${path}`
}

async function fetchYahooQuote(symbol, emptyMessage) {
  if (!symbol) throw new Error(emptyMessage)

  const res = await fetch(yahooChartUrl(symbol))
  if (!res.ok) throw new Error(`시세 조회 실패 (${res.status})`)

  const data = await res.json()
  const meta = data?.chart?.result?.[0]?.meta
  const price = Number(meta?.regularMarketPrice ?? meta?.previousClose)
  if (!Number.isFinite(price) || price <= 0) throw new Error('현재가를 찾을 수 없습니다.')

  const prevRaw = Number(meta?.chartPreviousClose ?? meta?.previousClose)
  const previousClose = Number.isFinite(prevRaw) && prevRaw > 0 ? prevRaw : 0
  const change = previousClose > 0 ? price - previousClose : 0
  const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0

  const seconds = Number(meta?.regularMarketTime)
  return {
    symbol: meta?.symbol || symbol,
    price,
    previousClose,
    change,
    changePercent,
    currency: meta?.currency || '',
    time: seconds ? new Date(seconds * 1000).toISOString() : new Date().toISOString(),
  }
}

export async function fetchStockQuote(input) {
  return fetchYahooQuote(normalizeStockSymbol(input), '종목 코드가 없습니다.')
}

export async function fetchExchangeRate(base, target = 'KRW') {
  return fetchYahooQuote(normalizeExchangeSymbol(base, target), '통화 코드가 없습니다.')
}
