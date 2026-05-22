export function normalizeStockSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase().replace(/\s+/g, '')
  if (!symbol) return ''
  if (/^\d{6}$/.test(symbol)) return `${symbol}.KS`
  return symbol
}

function yahooChartUrl(symbol) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`
  const local =
    typeof window !== 'undefined' &&
    (window.location.port === '5173' ||
      ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname))
  return local ? `/api/yahoo${path}` : `https://query1.finance.yahoo.com${path}`
}

export async function fetchStockQuote(input) {
  const symbol = normalizeStockSymbol(input)
  if (!symbol) throw new Error('종목 코드가 없습니다.')

  const res = await fetch(yahooChartUrl(symbol))
  if (!res.ok) throw new Error(`시세 조회 실패 (${res.status})`)

  const data = await res.json()
  const meta = data?.chart?.result?.[0]?.meta
  const price = Number(meta?.regularMarketPrice ?? meta?.previousClose)
  if (!Number.isFinite(price) || price <= 0) throw new Error('현재가를 찾을 수 없습니다.')

  const seconds = Number(meta?.regularMarketTime)
  return {
    symbol: meta?.symbol || symbol,
    price,
    currency: meta?.currency || '',
    time: seconds ? new Date(seconds * 1000).toISOString() : new Date().toISOString(),
  }
}
