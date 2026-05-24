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
import { TAX_BENEFIT_TAGS } from '../lib/schema'
import { compactKRW, formatKRW, todayStr } from '../lib/format'
import { exchangeRateMap, productMetrics, summarize } from '../lib/investments'
import { parseNumberInput } from '../lib/numberInput'
import {
  fetchExchangeRate,
  fetchStockHistory,
  fetchStockQuote,
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

// Long-press duration before a touch becomes a widget drag, and how far the
// finger may stray during that wait before it counts as a scroll instead.
const LONG_PRESS_MS = 300
const TOUCH_MOVE_CANCEL = 12

const blankForm = (kind = '예금') => ({
  kind,
  name: '',
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
  quoteSymbol: '',
  currentPrice: '',
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
    currency: p.currency || p.quoteCurrency || 'KRW',
    color: p.color || defaultColor(p.kind),
    quoteSymbol: p.quoteSymbol || '',
    currentPrice: p.currentPrice != null ? String(p.currentPrice) : '',
    taxBenefit: p.taxBenefit && TAX_BENEFIT_TAGS.includes(p.taxBenefit) ? p.taxBenefit : '없음',
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

  // rawItems feeds summarize/exchangeRateMap so legacy 환율 widgets keep
  // providing FX rates for stock conversion. 환율 items contribute 0 to totals
  // so including them does not skew the numbers.
  const totals = useMemo(() => summarize(rawItems, today), [rawItems, today])
  const rates = useMemo(() => exchangeRateMap(rawItems), [rawItems])

  useEffect(() => {
    if (!activeStockId) return
    if (!items.some((p) => p.id === activeStockId && p.kind === '주식')) {
      setActiveStockId(null)
    }
  }, [activeStockId, items])

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
        .filter((p) => p.kind === '주식' && (p.quoteSymbol || p.symbol))
        .map(
          (p) =>
            `${p.id}:STOCK:${p.quoteSymbol || p.symbol}:${p.currency || p.quoteCurrency || ''}`
        )
        .join('|'),
    [items]
  )

  useEffect(() => {
    const quoteItems = items.filter((p) => p.kind === '주식' && (p.quoteSymbol || p.symbol))
    if (quoteItems.length === 0) return

    let cancelled = false
    async function refreshQuotes() {
      setQuoteStatus((prev) => {
        const next = { ...prev }
        quoteItems.forEach((p) => {
          next[p.id] = { state: 'loading', text: '조회중' }
        })
        return next
      })

      const results = await Promise.all(
        quoteItems.map(async (p) => {
          try {
            const quote = await fetchStockQuote(p.quoteSymbol || p.symbol)
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
        })
      )
      if (cancelled) return

      setQuoteStatus((prev) => {
        const next = { ...prev }
        results.forEach(({ p, quote, error, exchangeError }) => {
          next[p.id] = quote
            ? exchangeError
              ? { state: 'error', text: '환율 실패' }
              : { state: 'ok', text: '실시간' }
            : { state: 'error', text: error?.message || '조회 실패' }
        })
        return next
      })

      results.forEach(({ p, quote, currency, exchangeQuote }) => {
        if (!quote) return
        updateItem(p.id, {
          currentPrice: quote.price,
          currency,
          quoteSymbol: quote.symbol,
          quoteCurrency: currency || quote.currency,
          quoteTime: quote.time,
          ...(exchangeQuote
            ? { exchangeRate: exchangeQuote.price, exchangeRateTime: exchangeQuote.time }
            : {}),
        })
      })
    }

    refreshQuotes()
    const timer = window.setInterval(refreshQuotes, 60000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [quoteKey, updateItem])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  function selectKind(kind) {
    setForm((f) => ({ ...f, kind, color: defaultColor(kind) }))
  }

  function submit(e) {
    e.preventDefault()
    const { kind } = form
    if (!form.name.trim()) {
      alert(kind === '주식' ? '종목명을 입력하세요.' : '상품명을 입력하세요.')
      return
    }
    if (!form.date) {
      alert('날짜를 입력하세요.')
      return
    }
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
        taxBenefit: form.taxBenefit || '없음',
      }
    } else if (kind === '적금') {
      const monthly = parseNumberInput(form.monthly)
      const months = parseNumberInput(form.months)
      if (!monthly || monthly <= 0) return alert('월 납입액을 입력하세요.')
      if (!months || months <= 0) return alert('총 회차(개월)를 입력하세요.')
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
        round: form.round === '' ? '' : parseNumberInput(form.round),
        taxBenefit: form.taxBenefit || '없음',
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
        taxBenefit: form.taxBenefit || '없음',
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

  const nameLabel = form.kind === '주식' ? '종목명' : '상품명'
  const dateLabel = form.kind === '예금' ? '가입일' : form.kind === '적금' ? '시작일' : '매수일'
  const stockBuyPreview = form.kind === '주식' ? additionalBuyPreview(form) : null

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
          <div className="field">
            <label>{nameLabel}</label>
            <input
              type="text"
              placeholder={form.kind === '주식' ? '예: 삼성전자' : '예: OO은행 정기예금'}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
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
                <label>총 회차 (개월)</label>
                <NumberInput
                  min="1"
                  decimal={false}
                  placeholder="예: 24"
                  value={form.months}
                  onChange={(value) => set('months', value)}
                />
              </div>
              <div className="field">
                <label>현재 회차 (선택 · 미입력 시 날짜로 계산)</label>
                <NumberInput
                  min="0"
                  decimal={false}
                  placeholder="자동 계산"
                  value={form.round}
                  onChange={(value) => set('round', value)}
                />
              </div>
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
                <label>종목 코드/티커</label>
                <input
                  type="text"
                  placeholder="예: 005930, 091990.KQ, AAPL"
                  value={form.quoteSymbol}
                  onChange={(e) => set('quoteSymbol', e.target.value)}
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
              {TAX_BENEFIT_TAGS.map((tag) => (
                <button
                  type="button"
                  key={tag}
                  className={form.taxBenefit === tag ? 'on' : ''}
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
        <button className="invest-add-btn" onClick={openAdd} aria-label="투자 위젯 추가">
          <PlusIcon />
        </button>
      </div>

      {items.length === 0 ? (
        <div className="invest-empty-widget">
          <strong>등록된 투자 위젯 없음</strong>
          <span>+ 버튼으로 예금, 적금, 주식을 추가하세요.</span>
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
    p.kind === '주식' || p.kind === '환율'
      ? quoteStatus || { state: 'idle', text: p.kind === '환율' || p.quoteSymbol ? '대기' : '코드 없음' }
      : null
  let kindDetail = ''
  let profitText = `수익 ${signedKRW(m.profit)}`
  let valueText = formatKRW(m.current)
  const clickable = p.kind === '주식'

  if (p.kind === '예금') {
    kindDetail = `예금 · ${m.elapsed}/${m.months}개월`
  } else if (p.kind === '적금') {
    kindDetail = `적금 · ${m.round}/${m.totalRounds}회차`
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
      <div className="category-stat-roll" key={active ? `${active.base}${active.target}` : 'empty'}>
        <div className="label">
          {active ? `${active.label} (${active.base}/${active.target})` : '대표 환율'}
        </div>
        <div className="value">
          {active ? (
            <>
              {formatRate(active.price)}
              <span className={`month-change ${tone}`}>
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
