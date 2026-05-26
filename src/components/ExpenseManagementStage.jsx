import { useMemo, useState } from 'react'
import { formatKRW, monthOf, todayStr } from '../lib/format'
import CalendarInput from './CalendarInput'
import { fixedExpenseEntriesForMonth, fixedExpenseEntriesFromRecords } from '../lib/fixedExpenseEntries'
import PaymentMethodManager from './PaymentMethodManager'
import Picker from './Picker'

const EXPENSE_COLOR = '#dc2626'

function pct(value, max) {
  return max > 0 ? Math.min(100, (value / max) * 100) : 0
}

function methodName(methods, id, fallback) {
  return methods.find((method) => method.id === id)?.name || fallback || '미지정'
}

function sumBy(rows, keyFn) {
  const map = new Map()
  rows.forEach((row) => {
    const key = keyFn(row)
    map.set(key, (map.get(key) || 0) + (Number(row.amount) || 0))
  })
  return [...map.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount)
}

function monthsOfYear(year) {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
}

export default function ExpenseManagementStage({
  entries,
  fixedItems = [],
  fixedRecords = [],
  paymentMethods,
  updatePaymentMethod,
  replacePaymentMethod,
}) {
  const [month, setMonth] = useState(() => todayStr().slice(0, 7))
  const [year, setYear] = useState(() => todayStr().slice(0, 4))
  const [periodMode, setPeriodMode] = useState('month')
  const [methodChange, setMethodChange] = useState({ from: '', to: '' })
  const [historySearch, setHistorySearch] = useState('')
  const methods = paymentMethods.items
  const periodLabel = periodMode === 'year' ? `${year}년` : month
  const limitMultiplier = periodMode === 'year' ? 12 : 1
  const currentMonth = todayStr().slice(0, 7)
  const methodOptions = useMemo(
    () => methods.map((method) => ({ value: method.id, label: method.name })),
    [methods]
  )

  const fixedRows = useMemo(
    () => {
      const months = (periodMode === 'year' ? monthsOfYear(year) : [month]).filter(
        (targetMonth) => targetMonth <= currentMonth
      )
      return months.flatMap((targetMonth) => {
        const records = fixedRecords.filter((record) => record.month === targetMonth)
        if (records.length > 0) return fixedExpenseEntriesFromRecords(records, methods)
        if (targetMonth === currentMonth) {
          return fixedExpenseEntriesForMonth(fixedItems, targetMonth, methods)
        }
        return []
      })
    },
    [currentMonth, fixedItems, fixedRecords, methods, month, periodMode, year]
  )
  const rows = useMemo(
    () => [
      ...entries.filter((e) =>
        e.type === '지출' &&
        (periodMode === 'year' ? monthOf(e.date).startsWith(`${year}-`) : monthOf(e.date) === month)
      ),
      ...fixedRows,
    ],
    [entries, fixedRows, month, periodMode, year]
  )

  const total = useMemo(() => rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0), [rows])
  const byCategory = useMemo(() => sumBy(rows, (row) => row.category || '미분류'), [rows])
  const byMethod = useMemo(
    () =>
      sumBy(rows, (row) => methodName(methods, row.paymentMethodId, row.paymentMethod)),
    [rows, methods]
  )
  const allExpenseListRows = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          (b.date || '').localeCompare(a.date || '') ||
          (Number(b.amount) || 0) - (Number(a.amount) || 0)
      ),
    [rows]
  )
  const expenseListRows = useMemo(() => {
    const query = historySearch.trim().toLowerCase()
    if (!query) return allExpenseListRows
    return allExpenseListRows.filter((row) => {
      const paymentLabel = methodName(methods, row.paymentMethodId, row.paymentMethod)
      return [
        row.date,
        row.category,
        paymentLabel,
        row.memo,
        row.fixedId ? '고정지출 고정' : '수동입력 수동',
        formatKRW(row.amount),
        String(row.amount || ''),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [allExpenseListRows, historySearch, methods])

  const methodCards = useMemo(() => {
    const spentById = new Map()
    rows.forEach((row) => {
      const id = row.paymentMethodId || ''
      spentById.set(id, (spentById.get(id) || 0) + (Number(row.amount) || 0))
    })
    const configuredIds = new Set(methods.map((method) => method.id))
    const configured = methods.map((method) => ({
      ...method,
      amount: spentById.get(method.id) || 0,
      limitAmount: method.monthlyLimit ? Number(method.monthlyLimit) * limitMultiplier : '',
      targetAmount: method.monthlyTarget ? Number(method.monthlyTarget) * limitMultiplier : '',
    }))
    const unknown = rows
      .filter((row) => !row.paymentMethodId)
      .reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
    const orphan = sumBy(
      rows.filter((row) => row.paymentMethodId && !configuredIds.has(row.paymentMethodId)),
      (row) => row.paymentMethod || '삭제된 결제수단'
    ).map((row) => ({
      id: `orphan-${row.name}`,
      name: row.name,
      kind: '삭제됨',
      annualFee: '',
      monthlyLimit: '',
      monthlyTarget: '',
      limitAmount: '',
      targetAmount: '',
      amount: row.amount,
    }))
    return unknown > 0
      ? [
          ...configured,
          ...orphan,
          {
            id: '',
            name: '미지정',
            kind: '기타',
            annualFee: '',
            monthlyLimit: '',
            monthlyTarget: '',
            limitAmount: '',
            targetAmount: '',
            amount: unknown,
          },
        ]
      : [...configured, ...orphan]
  }, [limitMultiplier, methods, rows])

  const overLimit = methodCards.filter((m) => m.limitAmount && m.amount > m.limitAmount).length
  const targetMet = methodCards.filter((m) => m.targetAmount && m.amount >= m.targetAmount).length
  const topCategory = byCategory[0]
  const topMethod = byMethod[0]

  function submitMethodChange(e) {
    e.preventDefault()
    if (!methodChange.from || !methodChange.to) return alert('변경할 결제수단을 선택하세요.')
    if (methodChange.from === methodChange.to) return alert('서로 다른 결제수단을 선택하세요.')
    if (replacePaymentMethod?.(methodChange.from, methodChange.to)) {
      setMethodChange({ from: '', to: '' })
      alert('기존 지출 데이터의 결제수단을 변경했습니다.')
    }
  }

  return (
    <div className="stage expense-management" style={{ '--accent': EXPENSE_COLOR }}>
      <div className="management-head">
        <div>
          <h2 className="section-title">지출 관리</h2>
          <p>결제수단과 카테고리 기준으로 선택한 기간의 지출 흐름을 봅니다.</p>
        </div>
        <div className="month-picker">
          <span>분석 기간</span>
          <div className="period-toggle" role="group" aria-label="분석 기간 단위">
            <button
              type="button"
              className={periodMode === 'month' ? 'on' : ''}
              onClick={() => setPeriodMode('month')}
            >
              월
            </button>
            <button
              type="button"
              className={periodMode === 'year' ? 'on' : ''}
              onClick={() => setPeriodMode('year')}
            >
              년
            </button>
          </div>
          <CalendarInput
            mode={periodMode}
            value={periodMode === 'year' ? year : month}
            onChange={periodMode === 'year' ? setYear : setMonth}
            placeholder={periodMode === 'year' ? '연도 선택' : '월 선택'}
            ariaLabel="분석 기간"
          />
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">{periodLabel} 지출</div>
          <div className="value accent">{formatKRW(total)}</div>
        </div>
        <div className="stat-card">
          <div className="label">가장 큰 카테고리</div>
          <div className="value">{topCategory ? topCategory.name : '-'}</div>
        </div>
        <div className="stat-card">
          <div className="label">가장 많이 쓴 결제수단</div>
          <div className="value">{topMethod ? topMethod.name : '-'}</div>
        </div>
        <div className="stat-card">
          <div className="label">한도 초과 / 실적 달성</div>
          <div className="value">{overLimit} / {targetMet}</div>
        </div>
      </div>

      <div className="expense-management-grid">
        <div className="card">
          <h2 className="section-title">결제수단별 사용</h2>
          <div className="method-usage-list">
            {methodCards.length === 0 ? (
              <div className="empty" style={{ padding: '36px 10px' }}>결제수단을 추가해 주세요.</div>
            ) : (
              methodCards.map((method) => (
                <div className="method-usage-card" key={method.id || 'unknown'}>
                  <div className="method-usage-head">
                    <div>
                      <b>{method.name}</b>
                      <span>
                        {method.kind}
                        {method.annualFee ? ` · 연회비 ${formatKRW(method.annualFee)}` : ''}
                      </span>
                    </div>
                    <strong>{formatKRW(method.amount)}</strong>
                  </div>
                  {method.limitAmount ? (
                    <div className="usage-row">
                      <span>{periodMode === 'year' ? '연 한도' : '한도'} {formatKRW(method.limitAmount)}</span>
                      <b>{pct(method.amount, method.limitAmount).toFixed(0)}%</b>
                      <div className="usage-bar">
                        <i style={{ width: `${pct(method.amount, method.limitAmount)}%` }} />
                      </div>
                    </div>
                  ) : null}
                  {method.targetAmount ? (
                    <div className="usage-row">
                      <span>{periodMode === 'year' ? '연 실적' : '실적'} {formatKRW(method.targetAmount)}</span>
                      <b>{method.amount >= method.targetAmount ? '달성' : `${pct(method.amount, method.targetAmount).toFixed(0)}%`}</b>
                      <div className="usage-bar target">
                        <i style={{ width: `${pct(method.amount, method.targetAmount)}%` }} />
                      </div>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="section-title">카테고리별 지출</h2>
          <div className="rank-list">
            {byCategory.length === 0 ? (
              <div className="empty" style={{ padding: '36px 10px' }}>선택한 기간의 지출이 없습니다.</div>
            ) : (
              byCategory.slice(0, 8).map((row) => (
                <div className="rank-row" key={row.name}>
                  <span>{row.name}</span>
                  <b>{formatKRW(row.amount)}</b>
                  <div className="usage-bar">
                    <i style={{ width: `${pct(row.amount, byCategory[0].amount)}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">결제수단 변경</h2>
        <form className="payment-form" onSubmit={submitMethodChange}>
          <div className="payment-field">
            <span>기존</span>
            <Picker
              value={methodChange.from}
              options={methodOptions}
              placeholder="A 선택"
              onChange={(value) => setMethodChange((prev) => ({ ...prev, from: value }))}
            />
          </div>
          <div className="payment-field">
            <span>변경</span>
            <Picker
              value={methodChange.to}
              options={methodOptions}
              placeholder="B 선택"
              onChange={(value) => setMethodChange((prev) => ({ ...prev, to: value }))}
            />
          </div>
          <div className="payment-form-actions">
            <button type="submit" className="btn btn-sm btn-accent">
              변경
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 className="section-title">결제수단 설정</h2>
        <PaymentMethodManager
          methods={methods}
          addMethod={paymentMethods.addItem}
          updateMethod={updatePaymentMethod}
          removeMethod={paymentMethods.removeItem}
        />
      </div>

      <div className="card">
        <h2 className="section-title">지출 내역</h2>
        {allExpenseListRows.length > 0 && (
          <div className="ledger-filter-bar management-history-search">
            <div className="ledger-filter-field ledger-filter-search">
              <span>검색</span>
              <input
                type="search"
                placeholder="날짜, 카테고리, 결제수단, 메모, 금액"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
              />
            </div>
            <div className="ledger-filter-actions">
              <button
                type="button"
                className="btn btn-sm"
                disabled={!historySearch.trim()}
                onClick={() => setHistorySearch('')}
              >
                초기화
              </button>
            </div>
          </div>
        )}
        {allExpenseListRows.length === 0 ? (
          <div className="empty">
            <strong>선택한 기간의 지출이 없습니다</strong>
            기간을 바꾸거나 지출 항목을 추가해 보세요.
          </div>
        ) : expenseListRows.length === 0 ? (
          <div className="empty">
            <strong>조건에 맞는 지출 내역이 없습니다</strong>
            검색어를 조정해 보세요.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="ledger-table expense-history-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>카테고리</th>
                  <th>결제수단</th>
                  <th className="col-right">금액</th>
                  <th>메모</th>
                </tr>
              </thead>
              <tbody>
                {expenseListRows.map((row, index) => (
                  <tr key={`${row.id || 'expense'}-${row.date}-${index}`}>
                    <td data-label="날짜">{row.date || '-'}</td>
                    <td data-label="카테고리">
                      <span className="tag">{row.category || '미분류'}</span>
                      {row.fixedId && <span className="mini-tag">고정</span>}
                    </td>
                    <td data-label="결제수단">
                      {methodName(methods, row.paymentMethodId, row.paymentMethod)}
                    </td>
                    <td className="amount" data-label="금액">{formatKRW(row.amount)}</td>
                    <td className="memo" data-label="메모">{row.memo || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
