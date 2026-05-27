import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { compactKRW, formatKRW, todayStr } from '../lib/format'
import { parseNumberInput } from '../lib/numberInput'
import {
  fetchExchangeRate,
  fetchStockHistory,
  fetchStockQuote,
  fetchStockSearch,
  normalizeStockSymbol,
} from '../lib/quotes'
import {
  MOCK_INVEST_COLOR,
  portfolioValueSeries,
  summarizePortfolio,
} from '../lib/mockInvestment'
import NumberInput from './NumberInput'

const STOCK_QUOTE_REFRESH_MS = 60 * 1000
const FX_QUOTE_REFRESH_MS = 60 * 60 * 1000
const QUOTE_STAGGER_MS = 1400
const HISTORY_RANGE = '1y'
const HISTORY_INTERVAL = '1d'

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  )
}

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

function signed(value) {
  if (!Number.isFinite(value) || value === 0) return formatKRW(0)
  return `${value > 0 ? '+' : ''}${formatKRW(value)}`
}

function pctText(value) {
  if (!Number.isFinite(value) || value === 0) return '0.00%'
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

function toneClass(value) {
  if (!Number.isFinite(value) || value === 0) return ''
  return value > 0 ? 'up' : 'down'
}

function formatLocalPrice(value, currency) {
  if (!Number.isFinite(value)) return '-'
  if (currency === 'KRW') return formatKRW(value)
  return `${currency} ${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
}

function formatStalePrice(value, currency) {
  const price = formatLocalPrice(value, currency)
  return price === '-' ? '시세 대기' : `${price} 기준`
}

export default function MockInvestmentStage({ mockInvest }) {
  const { portfolio, setStartingCash, buy, sell, reset } = mockInvest

  const [cashInput, setCashInput] = useState(() => String(portfolio.startingCash || ''))
  const [search, setSearch] = useState({ query: '', state: 'idle', items: [], error: '' })
  const [searchOpen, setSearchOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const [tradeForm, setTradeForm] = useState({
    units: '',
    price: '',
  })
  const [tradeBusy, setTradeBusy] = useState(false)
  const [quotes, setQuotes] = useState(() => new Map())
  const [fxRates, setFxRates] = useState(() => new Map())
  const [priceHistory, setPriceHistory] = useState(() => new Map())
  const [fxHistory, setFxHistory] = useState(() => new Map())
  const [historyState, setHistoryState] = useState('idle')
  const [historyOpen, setHistoryOpen] = useState(false)
  const lockedQueryRef = useRef('')
  const searchRunRef = useRef(0)

  const heldSymbolsKey = useMemo(
    () =>
      [...new Set(portfolio.positions.map((p) => `${p.symbol}|${p.currency}`))]
        .sort()
        .join('||'),
    [portfolio.positions]
  )

  const heldSymbols = useMemo(
    () =>
      heldSymbolsKey
        ? heldSymbolsKey.split('||').map((key) => {
            const [symbol, currency] = key.split('|')
            return { symbol, currency }
          })
        : [],
    [heldSymbolsKey]
  )

  // Live quote refresh for held positions + the selected search result.
  useEffect(() => {
    const symbols = new Map()
    heldSymbols.forEach(({ symbol, currency }) => {
      symbols.set(symbol, currency)
    })
    if (selected?.symbol) {
      symbols.set(selected.symbol, selected.currency || 'KRW')
    }
    if (symbols.size === 0) return undefined
    let cancelled = false

    async function fetchQuotes() {
      const entries = [...symbols.entries()]
      for (let index = 0; index < entries.length; index += 1) {
        const [symbol, currency] = entries[index]
        if (cancelled) return
        try {
          const quote = await fetchStockQuote(symbol)
          if (cancelled) return
          setQuotes((prev) => {
            const next = new Map(prev)
            next.set(symbol, { price: quote.price, currency })
            return next
          })
        } catch {
          // keep the previous quote when a throttled request fails
        }
        if (index < entries.length - 1) await wait(QUOTE_STAGGER_MS)
      }
    }

    fetchQuotes()
    const timer = window.setInterval(fetchQuotes, STOCK_QUOTE_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [heldSymbols, selected?.symbol, selected?.currency])

  // FX rates for non-KRW positions.
  useEffect(() => {
    const currencies = new Set()
    heldSymbols.forEach(({ currency }) => {
      if (currency && currency !== 'KRW') currencies.add(currency)
    })
    if (selected?.currency && selected.currency !== 'KRW') {
      currencies.add(selected.currency)
    }
    if (currencies.size === 0) return undefined
    let cancelled = false

    async function fetchFx() {
      const currencyList = [...currencies]
      for (let index = 0; index < currencyList.length; index += 1) {
        const currency = currencyList[index]
        if (cancelled) return
        try {
          const quote = await fetchExchangeRate(currency, 'KRW')
          if (cancelled) return
          const price = Number(quote.price) || 0
          if (price > 0) {
            setFxRates((prev) => {
              const next = new Map(prev)
              next.set(currency, price)
              return next
            })
          }
        } catch {
          // keep the previous FX rate when a throttled request fails
        }
        if (index < currencyList.length - 1) await wait(QUOTE_STAGGER_MS)
      }
    }

    fetchFx()
    const timer = window.setInterval(fetchFx, FX_QUOTE_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [heldSymbols, selected?.currency])

  // Historical prices for held symbols + FX, for the value timeline chart.
  useEffect(() => {
    if (!portfolio.createdAt || heldSymbols.length === 0) {
      setHistoryState('idle')
      return undefined
    }
    let cancelled = false
    setHistoryState('loading')

    async function loadHistory() {
      const priceEntries = await Promise.allSettled(
        heldSymbols.map(async ({ symbol }) => {
          const history = await fetchStockHistory(symbol, {
            range: HISTORY_RANGE,
            interval: HISTORY_INTERVAL,
          })
          return [symbol, history]
        })
      )

      const currencies = [
        ...new Set(
          heldSymbols
            .map((h) => h.currency)
            .filter((c) => c && c !== 'KRW')
        ),
      ]
      const fxEntries = await Promise.allSettled(
        currencies.map(async (currency) => {
          const symbol = `${currency}KRW=X`
          const history = await fetchStockHistory(symbol, {
            range: HISTORY_RANGE,
            interval: HISTORY_INTERVAL,
          })
          return [currency, history]
        })
      )

      if (cancelled) return
      setPriceHistory(buildHistoryMap(priceEntries))
      setFxHistory(buildHistoryMap(fxEntries))
      setHistoryState('done')
    }

    loadHistory().catch((error) => {
      if (cancelled) return
      console.warn('[mockInvest] history load failed', error)
      setHistoryState('error')
    })

    return () => {
      cancelled = true
    }
  }, [heldSymbols, portfolio.createdAt])

  // Stock search (debounced).
  useEffect(() => {
    const query = search.query.trim()
    if (query.length < 2 || query === lockedQueryRef.current) {
      return undefined
    }
    let cancelled = false
    const runId = ++searchRunRef.current
    setSearch((prev) => ({ ...prev, state: 'loading', error: '', mode: 'local' }))
    const timer = window.setTimeout(async () => {
      try {
        const results = await fetchStockSearch(query, { limit: 7, localOnly: true })
        if (cancelled || searchRunRef.current !== runId) return
        setSearch((prev) => ({ ...prev, state: 'done', items: results, error: '', mode: 'local' }))
        setSearchOpen(true)
      } catch (error) {
        if (cancelled || searchRunRef.current !== runId) return
        setSearch((prev) => ({
          ...prev,
          state: 'error',
          items: [],
          error: error?.message || '검색 실패',
          mode: 'local',
        }))
        setSearchOpen(true)
      }
    }, 260)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [search.query])

  // Auto-fill trade price when user picks a search result.
  useEffect(() => {
    if (!selected?.symbol) return
    const quote = quotes.get(selected.symbol)
    if (quote?.price) {
      const price = String(quote.price)
      setTradeForm((prev) => (prev.price === price ? prev : { ...prev, price }))
    }
  }, [quotes, selected?.symbol])

  const summary = useMemo(
    () => summarizePortfolio(portfolio, quotes, fxRates),
    [portfolio, quotes, fxRates]
  )

  const series = useMemo(() => {
    if (heldSymbols.length === 0 && portfolio.trades.length === 0) return []
    return portfolioValueSeries(portfolio, priceHistory, fxHistory)
  }, [portfolio, priceHistory, fxHistory, heldSymbols.length])

  const hasTrades = portfolio.trades.length > 0 || portfolio.positions.length > 0

  function selectSearchItem(item) {
    searchRunRef.current += 1
    const symbol = normalizeStockSymbol(item.symbol || item.name || '')
    if (!symbol) return
    const name = item.name || symbol
    const currency = (item.currency || 'KRW').toUpperCase()
    const currentPrice = Number(item.currentPrice) || 0
    setSelected({
      symbol,
      name,
      currency,
      exchange: item.exchange || '',
    })
    if (currentPrice > 0) {
      setQuotes((prev) => {
        const next = new Map(prev)
        next.set(symbol, { price: currentPrice, currency })
        return next
      })
      setTradeForm((prev) => ({ ...prev, price: String(currentPrice) }))
    } else {
      setTradeForm((prev) => ({ ...prev, price: '' }))
    }
    setSearch((prev) => ({ ...prev, query: name }))
    lockedQueryRef.current = name
    setSearchOpen(false)
  }

  async function runRemoteSearch() {
    const query = search.query.trim()
    if (query.length < 2) return

    lockedQueryRef.current = ''
    setSearchOpen(true)
    const runId = ++searchRunRef.current
    setSearch({ query, state: 'loading', items: [], error: '', mode: 'remote' })
    try {
      const results = await fetchStockSearch(query, { limit: 7 })
      if (searchRunRef.current !== runId) return
      setSearch({ query, state: 'done', items: results, error: '', mode: 'remote' })
    } catch (error) {
      if (searchRunRef.current !== runId) return
      setSearch({
        query,
        state: 'error',
        items: [],
        error: error?.message || '검색 실패',
        mode: 'remote',
      })
    }
  }

  async function refreshSelectedQuote() {
    if (!selected?.symbol) return
    try {
      const quote = await fetchStockQuote(selected.symbol)
      setQuotes((prev) => {
        const next = new Map(prev)
        next.set(selected.symbol, { price: quote.price, currency: selected.currency })
        return next
      })
      if (selected.currency && selected.currency !== 'KRW') {
        try {
          const fxQuote = await fetchExchangeRate(selected.currency, 'KRW')
          setFxRates((prev) => {
            const next = new Map(prev)
            next.set(selected.currency, Number(fxQuote.price) || 0)
            return next
          })
        } catch {
          // ignore — FX optional refresh
        }
      }
      setTradeForm((prev) => ({ ...prev, price: String(quote.price) }))
    } catch (error) {
      alert(error?.message || '시세 조회 실패')
    }
  }

  function submitStartingCash(e) {
    e.preventDefault()
    const amount = parseNumberInput(cashInput)
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('초기 자본을 입력하세요.')
      return
    }
    setStartingCash(amount)
  }

  function submitBuy(e) {
    e?.preventDefault?.()
    if (!selected?.symbol) {
      alert('매수할 종목을 검색해 선택하세요.')
      return
    }
    const units = Number(tradeForm.units)
    const priceLocal = Number(tradeForm.price)
    if (!Number.isFinite(units) || units <= 0) {
      alert('수량을 입력하세요.')
      return
    }
    if (!Number.isFinite(priceLocal) || priceLocal <= 0) {
      alert('가격을 입력하세요.')
      return
    }
    const fxRate =
      selected.currency === 'KRW' ? 1 : Number(fxRates.get(selected.currency)) || 0
    if (selected.currency !== 'KRW' && fxRate <= 0) {
      alert('환율 정보를 가져오지 못했습니다. 잠시 후 다시 시도하세요.')
      return
    }
    try {
      setTradeBusy(true)
      buy({
        symbol: selected.symbol,
        name: selected.name,
        currency: selected.currency,
        units,
        priceLocal,
        fxRate,
        date: todayStr(),
      })
      setTradeForm({ units: '', price: '' })
    } catch (error) {
      alert(error?.message || '매수 실패')
    } finally {
      setTradeBusy(false)
    }
  }

  async function sellPosition(position) {
    const quote = quotes.get(position.symbol)
    const defaultPrice = quote?.price || position.avgPriceLocal
    const unitsStr = window.prompt(
      `${position.name} 매도 수량 (보유 ${position.units.toLocaleString(undefined, { maximumFractionDigits: 6 })})`,
      String(position.units)
    )
    if (unitsStr == null) return
    const units = Number(unitsStr)
    if (!Number.isFinite(units) || units <= 0 || units > position.units + 1e-6) {
      alert('유효한 수량을 입력하세요.')
      return
    }
    const priceStr = window.prompt(
      `매도 가격 (${position.currency})`,
      String(defaultPrice || '')
    )
    if (priceStr == null) return
    const priceLocal = Number(priceStr)
    if (!Number.isFinite(priceLocal) || priceLocal <= 0) {
      alert('유효한 가격을 입력하세요.')
      return
    }
    let fxRate = position.currency === 'KRW' ? 1 : Number(fxRates.get(position.currency)) || 0
    if (position.currency !== 'KRW' && fxRate <= 0) {
      try {
        const fxQuote = await fetchExchangeRate(position.currency, 'KRW')
        fxRate = Number(fxQuote.price) || 0
      } catch {
        // fall through
      }
    }
    if (position.currency !== 'KRW' && fxRate <= 0) {
      alert('환율 정보를 가져오지 못했습니다.')
      return
    }
    try {
      sell({
        symbol: position.symbol,
        currency: position.currency,
        units,
        priceLocal,
        fxRate,
        date: todayStr(),
      })
    } catch (error) {
      alert(error?.message || '매도 실패')
    }
  }

  function handleReset() {
    if (
      !window.confirm(
        '모의투자 포트폴리오를 초기화할까요? 보유 종목과 거래 내역이 모두 사라집니다.'
      )
    )
      return
    reset(portfolio.startingCash || 0)
    setSelected(null)
    setTradeForm({ units: '', price: '' })
  }

  return (
    <div className="stage mock-invest-stage" style={{ '--accent': MOCK_INVEST_COLOR }}>
      <div className="management-head">
        <div>
          <h2 className="section-title">모의투자</h2>
          <p>가상의 자본으로 실제 시세 종목을 매수·매도해 포트폴리오 수익률을 추적합니다.</p>
        </div>
        <div className="management-head-actions">
          <button type="button" className="btn btn-sm" onClick={handleReset}>
            포트폴리오 초기화
          </button>
        </div>
      </div>

      {!hasTrades && (
        <div className="card mock-invest-setup">
          <h3 className="section-title">시작 자본 설정</h3>
          <form className="mock-invest-setup-form" onSubmit={submitStartingCash}>
            <NumberInput
              min="0"
              decimal={false}
              placeholder="예: 10000000"
              value={cashInput}
              onChange={setCashInput}
            />
            <button type="submit" className="btn btn-sm btn-accent">
              저장
            </button>
          </form>
          <p className="hint">
            거래가 한 건이라도 발생하면 시작 자본 변경은 ‘초기화’로만 가능합니다.
          </p>
        </div>
      )}

      <div className="stat-grid mock-invest-stat-grid">
        <div className="stat-card">
          <div className="label">총자산</div>
          <div className="value">{formatKRW(summary.totalValueKRW)}</div>
          <div className={`month-change ${toneClass(summary.totalReturnKRW)}`}>
            {signed(summary.totalReturnKRW)} ({pctText(summary.totalReturnPct)})
          </div>
        </div>
        <div className="stat-card">
          <div className="label">가용 현금</div>
          <div className="value">{formatKRW(portfolio.cash)}</div>
          <div className="month-change">시작 {formatKRW(portfolio.startingCash)}</div>
        </div>
        <div className="stat-card">
          <div className="label">평가손익(미실현)</div>
          <div className={`value ${toneClass(summary.unrealizedPnL)}`}>
            {signed(summary.unrealizedPnL)}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">실현손익 누적</div>
          <div className={`value ${toneClass(portfolio.realizedPnL)}`}>
            {signed(portfolio.realizedPnL)}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="form-card-head">
          <h2 className="section-title">매수</h2>
          {selected && (
            <button type="button" className="btn btn-sm" onClick={refreshSelectedQuote}>
              시세 새로고침
            </button>
          )}
        </div>
        <form className="mock-invest-trade-form" onSubmit={submitBuy}>
          <div className="mock-invest-search">
            <span>종목 검색</span>
            <div
              className="card-product-search"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setSearchOpen(false)
              }}
            >
              <input
                type="search"
                placeholder="종목명, 코드 (예: 삼성전자, AAPL, 005930)"
                value={search.query}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  lockedQueryRef.current = ''
                  setSearch((prev) => ({ ...prev, query: e.target.value }))
                }}
              />
              <button
                type="button"
                className="stock-search-button"
                onClick={runRemoteSearch}
                disabled={
                  search.query.trim().length < 2 ||
                  (search.state === 'loading' && search.mode === 'remote')
                }
                aria-label="외부 종목 검색"
                title="외부 종목 검색"
              >
                <SearchIcon />
              </button>
              {selected && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => {
                    searchRunRef.current += 1
                    setSelected(null)
                    setSearch({ query: '', state: 'idle', items: [], error: '' })
                  }}
                  aria-label="선택 해제"
                >
                  ×
                </button>
              )}
              {searchOpen && search.items.length > 0 && (
                <div className="card-product-results">
                  {search.items.map((item) => (
                    <button
                      type="button"
                      className="card-product-option"
                      key={`${item.symbol}-${item.exchange || ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectSearchItem(item)}
                    >
                      <b>{item.name || item.symbol}</b>
                      <span>
                        {item.symbol} · {item.exchange || '-'}
                        {item.currency ? ` · ${item.currency}` : ''}
                      </span>
                      {item.type && <small>{item.type}</small>}
                    </button>
                  ))}
                </div>
              )}
              {searchOpen && search.state === 'loading' && (
                <div className="card-product-results">
                  <div className="card-product-empty">
                    {search.mode === 'remote' ? '종목 검색 중' : '자동완성 확인중'}
                  </div>
                </div>
              )}
              {searchOpen &&
                search.state === 'done' &&
                search.items.length === 0 &&
                search.query.trim().length >= 2 && (
                  <div className="card-product-results">
                    <div className="card-product-empty">
                      {search.mode === 'remote' ? '검색 결과 없음' : '자동완성 결과 없음'}
                    </div>
                  </div>
                )}
              {searchOpen && search.state === 'error' && (
                <div className="card-product-results">
                  <div className="card-product-empty">{search.error || '검색 실패'}</div>
                </div>
              )}
            </div>
            {selected && (
              <div className="selected-card-product">
                <span>
                  {selected.name} ({selected.symbol})
                  {selected.currency && selected.currency !== 'KRW'
                    ? ` · ${selected.currency}`
                    : ''}
                </span>
              </div>
            )}
          </div>
          <div className="mock-invest-trade-fields">
            <label>
              <span>수량</span>
              <NumberInput
                min="0"
                placeholder="0"
                value={tradeForm.units}
                onChange={(value) => setTradeForm((prev) => ({ ...prev, units: value }))}
              />
            </label>
            <label>
              <span>가격 ({selected?.currency || 'KRW'})</span>
              <NumberInput
                min="0"
                placeholder="0"
                value={tradeForm.price}
                onChange={(value) => setTradeForm((prev) => ({ ...prev, price: value }))}
              />
            </label>
            <label>
              <span>매수 총액</span>
              <strong className="mock-invest-trade-total">
                {(() => {
                  const units = Number(tradeForm.units) || 0
                  const price = Number(tradeForm.price) || 0
                  const fx =
                    !selected || selected.currency === 'KRW'
                      ? 1
                      : Number(fxRates.get(selected.currency)) || 0
                  if (units <= 0 || price <= 0) return formatKRW(0)
                  if (selected?.currency && selected.currency !== 'KRW' && fx <= 0)
                    return '환율 필요'
                  return formatKRW(units * price * fx)
                })()}
              </strong>
            </label>
            <button
              type="submit"
              className="btn btn-sm btn-accent"
              disabled={tradeBusy || !selected}
            >
              매수
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 className="section-title">보유 종목</h2>
        {summary.valuedPositions.length === 0 ? (
          <div className="empty" style={{ padding: '32px 10px' }}>
            아직 보유 종목이 없습니다. 위에서 종목을 검색하고 매수하세요.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="ledger-table mock-invest-positions">
              <thead>
                <tr>
                  <th>종목</th>
                  <th className="col-right">보유</th>
                  <th className="col-right">평균가</th>
                  <th className="col-right">현재가</th>
                  <th className="col-right">평가액(KRW)</th>
                  <th className="col-right">평가손익</th>
                  <th>액션</th>
                </tr>
              </thead>
              <tbody>
                {summary.valuedPositions.map((position) => (
                  <tr key={`${position.symbol}-${position.currency}`}>
                    <td>
                      <b>{position.name}</b>
                      <div className="mock-invest-row-sub">
                        {position.symbol}
                        {position.currency !== 'KRW' ? ` · ${position.currency}` : ''}
                      </div>
                    </td>
                    <td className="col-right">
                      {position.units.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    </td>
                    <td className="col-right">
                      {formatLocalPrice(position.avgPriceLocal, position.currency)}
                    </td>
                    <td className="col-right">
                      {position.stale
                        ? formatStalePrice(position.currentPriceLocal, position.currency)
                        : formatLocalPrice(position.currentPriceLocal, position.currency)}
                    </td>
                    <td className="col-right">{formatKRW(position.marketValueKRW || 0)}</td>
                    <td className={`col-right ${toneClass(position.unrealizedPnLKRW)}`}>
                      {signed(position.unrealizedPnLKRW)}
                      <div className="mock-invest-row-sub">
                        {pctText(position.unrealizedPnLPct)}
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => sellPosition(position)}
                      >
                        매도
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="section-title">자산 추이</h2>
        {series.length < 2 ? (
          <div className="empty" style={{ padding: '32px 10px' }}>
            {historyState === 'loading'
              ? '시세 이력을 불러오는 중입니다…'
              : '매수 후 자산 추이가 여기 표시됩니다.'}
          </div>
        ) : (
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="mockInvestValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={MOCK_INVEST_COLOR} stopOpacity={0.45} />
                    <stop offset="95%" stopColor={MOCK_INVEST_COLOR} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: 'currentColor' }}
                  minTickGap={32}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'currentColor' }}
                  tickFormatter={(value) => compactKRW(value)}
                  width={66}
                />
                <Tooltip
                  formatter={(value) => formatKRW(value)}
                  labelFormatter={(label) => `날짜 ${label}`}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="total"
                  name="총자산"
                  stroke={MOCK_INVEST_COLOR}
                  strokeWidth={2}
                  fill="url(#mockInvestValue)"
                />
                <Area
                  type="monotone"
                  dataKey="invested"
                  name="투자 평가액"
                  stroke="#7c3aed"
                  strokeWidth={1.5}
                  fillOpacity={0}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="card">
        <div className="form-card-head">
          <h2 className="section-title">거래 내역</h2>
          {portfolio.trades.length > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setHistoryOpen((open) => !open)}
            >
              {historyOpen ? '접기' : '펼치기'} ({portfolio.trades.length})
            </button>
          )}
        </div>
        {portfolio.trades.length === 0 ? (
          <div className="empty" style={{ padding: '32px 10px' }}>
            아직 거래가 없습니다.
          </div>
        ) : historyOpen ? (
          <div className="table-wrap">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>구분</th>
                  <th>종목</th>
                  <th className="col-right">수량</th>
                  <th className="col-right">단가</th>
                  <th className="col-right">총액(KRW)</th>
                  <th className="col-right">실현손익</th>
                </tr>
              </thead>
              <tbody>
                {[...portfolio.trades]
                  .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                  .map((trade) => (
                    <tr key={trade.id}>
                      <td>{trade.date}</td>
                      <td>
                        <span className={`tag ${trade.type === 'sell' ? 'down' : 'up'}`}>
                          {trade.type === 'sell' ? '매도' : '매수'}
                        </span>
                      </td>
                      <td>
                        <b>{trade.name}</b>
                        <div className="mock-invest-row-sub">
                          {trade.symbol}
                          {trade.currency !== 'KRW' ? ` · ${trade.currency}` : ''}
                        </div>
                      </td>
                      <td className="col-right">
                        {trade.units.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                      </td>
                      <td className="col-right">
                        {formatLocalPrice(trade.priceLocal, trade.currency)}
                      </td>
                      <td className="col-right">{formatKRW(trade.totalKRW)}</td>
                      <td className={`col-right ${toneClass(trade.realizedPnLKRW)}`}>
                        {trade.type === 'sell' ? signed(trade.realizedPnLKRW) : '-'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function buildHistoryMap(entries) {
  const map = new Map()
  entries.forEach((entry) => {
    if (entry.status !== 'fulfilled') return
    const [key, history] = entry.value
    if (!history || !Array.isArray(history.points)) return
    const inner = new Map()
    history.points.forEach((point) => {
      if (point.date && Number.isFinite(point.price) && point.price > 0) {
        inner.set(point.date, point.price)
      }
    })
    if (inner.size > 0) map.set(key, inner)
  })
  return map
}
