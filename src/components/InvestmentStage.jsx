import { useEffect, useMemo, useState } from 'react'
import { INVEST_META, INVEST_KINDS } from '../lib/categories'
import { formatKRW, todayStr } from '../lib/format'
import { productMetrics, summarize } from '../lib/investments'
import { fetchStockQuote, normalizeStockSymbol } from '../lib/quotes'
import CalendarInput from './CalendarInput'
import PlusIcon from './PlusIcon'

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
  quoteSymbol: '',
  currentPrice: '',
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
    quoteSymbol: p.quoteSymbol || '',
    currentPrice: p.currentPrice != null ? String(p.currentPrice) : '',
  }
}

const signedKRW = (n) => (n >= 0 ? '+' : '') + formatKRW(n)
const profitClass = (n) => (n >= 0 ? 'profit-pos' : 'profit-neg')

export default function InvestmentStage({ investments }) {
  const { items, addItem, updateItem, removeItem } = investments
  const today = todayStr()
  const [form, setForm] = useState(() => blankForm('예금'))
  const [editingId, setEditingId] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [quoteStatus, setQuoteStatus] = useState({})

  const totals = useMemo(() => summarize(items, today), [items, today])

  const widgetItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const ka = INVEST_KINDS.indexOf(a.kind)
      const kb = INVEST_KINDS.indexOf(b.kind)
      if (ka !== kb) return ka - kb
      return a.name.localeCompare(b.name)
    })
  }, [items])

  const stockQuoteKey = useMemo(
    () =>
      items
        .filter((p) => p.kind === '주식' && (p.quoteSymbol || p.symbol))
        .map((p) => `${p.id}:${p.quoteSymbol || p.symbol}`)
        .join('|'),
    [items]
  )

  useEffect(() => {
    const stocks = items.filter((p) => p.kind === '주식' && (p.quoteSymbol || p.symbol))
    if (stocks.length === 0) return

    let cancelled = false
    async function refreshQuotes() {
      setQuoteStatus((prev) => {
        const next = { ...prev }
        stocks.forEach((p) => {
          next[p.id] = { state: 'loading', text: '조회중' }
        })
        return next
      })

      const results = await Promise.all(
        stocks.map(async (p) => {
          try {
            const quote = await fetchStockQuote(p.quoteSymbol || p.symbol)
            return { p, quote }
          } catch (error) {
            return { p, error }
          }
        })
      )
      if (cancelled) return

      setQuoteStatus((prev) => {
        const next = { ...prev }
        results.forEach(({ p, quote, error }) => {
          next[p.id] = quote
            ? { state: 'ok', text: '실시간' }
            : { state: 'error', text: error?.message || '조회 실패' }
        })
        return next
      })

      results.forEach(({ p, quote }) => {
        if (!quote) return
        updateItem(p.id, {
          currentPrice: quote.price,
          quoteSymbol: quote.symbol,
          quoteCurrency: quote.currency,
          quoteTime: quote.time,
        })
      })
    }

    refreshQuotes()
    const timer = window.setInterval(refreshQuotes, 60000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [stockQuoteKey, updateItem])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  function selectKind(kind) {
    setForm((f) => ({ ...f, kind }))
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
      const principal = Number(form.principal)
      const months = Number(form.months)
      if (!principal || principal <= 0) return alert('원금을 입력하세요.')
      if (!months || months <= 0) return alert('만기(개월)를 입력하세요.')
      product = {
        kind,
        name: form.name.trim(),
        date: form.date,
        memo: form.memo.trim(),
        principal,
        rate: Number(form.rate) || 0,
        months,
        method: form.method,
      }
    } else if (kind === '적금') {
      const monthly = Number(form.monthly)
      const months = Number(form.months)
      if (!monthly || monthly <= 0) return alert('월 납입액을 입력하세요.')
      if (!months || months <= 0) return alert('총 회차(개월)를 입력하세요.')
      product = {
        kind,
        name: form.name.trim(),
        date: form.date,
        memo: form.memo.trim(),
        monthly,
        rate: Number(form.rate) || 0,
        months,
        method: form.method,
        round: form.round === '' ? '' : Number(form.round),
      }
    } else {
      const shares = Number(form.shares)
      const buyPrice = Number(form.buyPrice)
      const quoteSymbol = normalizeStockSymbol(form.quoteSymbol)
      if (!shares || shares <= 0) return alert('보유 수량을 입력하세요.')
      if (!buyPrice || buyPrice <= 0) return alert('평균 매수가를 입력하세요.')
      if (!quoteSymbol) return alert('종목 코드 또는 티커를 입력하세요.')
      product = {
        kind,
        name: form.name.trim(),
        date: form.date,
        memo: form.memo.trim(),
        shares,
        buyPrice,
        quoteSymbol,
        currentPrice: form.currentPrice === '' ? buyPrice : Number(form.currentPrice),
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
    }
  }

  const nameLabel = form.kind === '주식' ? '종목명' : '상품명'
  const dateLabel = form.kind === '예금' ? '가입일' : form.kind === '적금' ? '시작일' : '매수일'

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
        <div className="stat-card">
          <div className="label">보유 상품</div>
          <div className="value">{items.length}개</div>
        </div>
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
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="0"
                  value={form.principal}
                  onChange={(e) => set('principal', e.target.value)}
                />
              </div>
              <div className="field">
                <label>연이율 (%)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="예: 3.5"
                  value={form.rate}
                  onChange={(e) => set('rate', e.target.value)}
                />
              </div>
              <div className="field">
                <label>만기 (개월)</label>
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  placeholder="예: 12"
                  value={form.months}
                  onChange={(e) => set('months', e.target.value)}
                />
              </div>
            </>
          )}

          {form.kind === '적금' && (
            <>
              <div className="field">
                <label>월 납입액 (원)</label>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="0"
                  value={form.monthly}
                  onChange={(e) => set('monthly', e.target.value)}
                />
              </div>
              <div className="field">
                <label>연이율 (%)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="예: 4.0"
                  value={form.rate}
                  onChange={(e) => set('rate', e.target.value)}
                />
              </div>
              <div className="field">
                <label>총 회차 (개월)</label>
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  placeholder="예: 24"
                  value={form.months}
                  onChange={(e) => set('months', e.target.value)}
                />
              </div>
              <div className="field">
                <label>현재 회차 (선택 · 미입력 시 날짜로 계산)</label>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  placeholder="자동 계산"
                  value={form.round}
                  onChange={(e) => set('round', e.target.value)}
                />
              </div>
            </>
          )}

          {form.kind === '주식' && (
            <>
              <div className="field">
                <label>보유 수량 (주)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  placeholder="0"
                  value={form.shares}
                  onChange={(e) => set('shares', e.target.value)}
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
              <label>평균 매수가 (원)</label>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                placeholder="0"
                value={form.buyPrice}
                onChange={(e) => set('buyPrice', e.target.value)}
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
          {widgetItems.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              today={today}
              editing={editingId === p.id}
              quoteStatus={quoteStatus[p.id]}
              onEdit={() => startEdit(p)}
              onRemove={() => handleRemove(p)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ProductCard({ product: p, today, editing, quoteStatus, onEdit, onRemove }) {
  const color = INVEST_META[p.kind].color
  const m = productMetrics(p, today)
  const status = p.kind === '주식' ? quoteStatus || { state: 'idle', text: p.quoteSymbol ? '대기' : '코드 없음' } : null
  const kindDetail =
    p.kind === '예금'
      ? `예금 · ${m.elapsed}/${m.months}개월`
      : p.kind === '적금'
        ? `적금 · ${m.round}/${m.totalRounds}회차`
        : `${p.quoteSymbol || '코드 없음'} · 현재 ${formatKRW(m.currentPrice)}`
  const profitText =
    p.kind === '주식'
      ? `${signedKRW(m.profit)} (${m.returnPct >= 0 ? '+' : ''}${m.returnPct.toFixed(2)}%)`
      : `수익 ${signedKRW(m.profit)}`

  return (
    <div
      className={`invest-card${editing ? ' editing' : ''}`}
      style={{ '--accent': color }}
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
          <button className="icon-btn" onClick={onEdit} aria-label={`${p.name} 수정`} title="수정">
            ✎
          </button>
          <button
            className="icon-btn danger"
            onClick={onRemove}
            aria-label={`${p.name} 삭제`}
            title="삭제"
          >
            ×
          </button>
        </div>
      </div>

      <div className="invest-widget-body">
        <div className="invest-widget-name">{p.name}</div>
        <div className="invest-widget-value">{formatKRW(m.current)}</div>
        <div className={`invest-widget-profit ${profitClass(m.profit)}`}>{profitText}</div>
        <div className="invest-widget-detail">{kindDetail}</div>
      </div>
    </div>
  )
}
