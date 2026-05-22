import { useEffect, useMemo, useState } from 'react'
import { STAGE_META } from '../lib/categories'
import { formatKRW, monthOf, todayStr } from '../lib/format'
import CalendarInput from './CalendarInput'
import FixedExpenses from './FixedExpenses'
import PaymentMethodManager from './PaymentMethodManager'
import Picker from './Picker'

const blankForm = () => ({ date: todayStr(), category: '', paymentMethodId: '', amount: '', memo: '' })
const blankCategoryForm = () => ({ original: '', value: '' })

function previousMonthOf(month) {
  const [year, monthNum] = month.split('-').map(Number)
  if (!year || !monthNum) return ''
  const date = new Date(year, monthNum - 2, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthTrend(current, previous) {
  if (!previous) return { mark: '-', percent: 0, tone: 'flat' }
  const percent = Math.round(((current - previous) / previous) * 100)
  if (percent > 0) return { mark: '▲', percent, tone: 'up' }
  if (percent < 0) return { mark: '▼', percent: Math.abs(percent), tone: 'down' }
  return { mark: '-', percent: 0, tone: 'flat' }
}

function addCategoryTotals(map, rows) {
  rows.forEach((row) => {
    const category = row.category || '미분류'
    map.set(category, (map.get(category) || 0) + (Number(row.amount) || 0))
  })
}

export default function LedgerStage({
  type,
  entries,
  addEntry,
  updateEntry,
  removeEntry,
  fixed,
  fixedExpenseEntries = [],
  previousFixedExpenseEntries = [],
  categories,
  addCategory,
  updateCategory,
  removeCategory,
  paymentMethods = [],
  addPaymentMethod,
}) {
  const meta = STAGE_META[type]
  const categoryList = categories?.length ? categories : meta.categories
  const [form, setForm] = useState(blankForm)
  const [editingId, setEditingId] = useState(null)
  const [categoryForm, setCategoryForm] = useState(blankCategoryForm)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)

  const categoryOptions = useMemo(() => {
    const current = form.category.trim()
    return current && !categoryList.includes(current) ? [...categoryList, current] : categoryList
  }, [categoryList, form.category])
  const paymentOptions = useMemo(
    () => [
      { value: '', label: '미지정' },
      ...paymentMethods.map((method) => ({ value: method.id, label: method.name })),
    ],
    [paymentMethods]
  )

  const ledgerRows = useMemo(
    () =>
      entries
        .filter((e) => e.type === type)
        .sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [entries, type]
  )
  const rows = useMemo(
    () => (type === '지출' ? ledgerRows.filter((e) => !e.fixedId) : ledgerRows),
    [ledgerRows, type]
  )
  const totalRows = useMemo(
    () => (type === '지출' ? [...ledgerRows, ...fixedExpenseEntries] : ledgerRows),
    [fixedExpenseEntries, ledgerRows, type]
  )

  const total = useMemo(() => totalRows.reduce((s, e) => s + e.amount, 0), [totalRows])
  const currentMonth = todayStr().slice(0, 7)
  const previousMonth = previousMonthOf(currentMonth)
  const currentMonthRows = useMemo(
    () => ledgerRows.filter((e) => monthOf(e.date) === currentMonth),
    [ledgerRows, currentMonth]
  )
  const monthTotal = useMemo(() => currentMonthRows.reduce((s, e) => s + e.amount, 0), [currentMonthRows])
  const fixedMonthTotal = useMemo(
    () => fixedExpenseEntries.reduce((s, e) => s + e.amount, 0),
    [fixedExpenseEntries]
  )
  const previousMonthRows = useMemo(
    () => ledgerRows.filter((e) => monthOf(e.date) === previousMonth),
    [ledgerRows, previousMonth]
  )
  const previousMonthTotal = useMemo(
    () => previousMonthRows.reduce((s, e) => s + e.amount, 0),
    [previousMonthRows]
  )
  const previousFixedMonthTotal = useMemo(
    () => previousFixedExpenseEntries.reduce((s, e) => s + e.amount, 0),
    [previousFixedExpenseEntries]
  )
  const hasPreviousMonthRows = previousMonthRows.length > 0
  const expenseTrend = monthTrend(monthTotal, previousMonthTotal)
  const totalExpenseTrend = monthTrend(
    monthTotal + fixedMonthTotal,
    hasPreviousMonthRows ? previousMonthTotal + previousFixedMonthTotal : 0
  )
  const categoryStats = useMemo(() => {
    const currentMap = new Map()
    const previousMap = new Map()
    addCategoryTotals(currentMap, currentMonthRows)
    if (type === '지출') addCategoryTotals(currentMap, fixedExpenseEntries)
    if (hasPreviousMonthRows) {
      addCategoryTotals(previousMap, previousMonthRows)
      if (type === '지출') addCategoryTotals(previousMap, previousFixedExpenseEntries)
    }

    return [...currentMap.entries()]
      .map(([name, amount]) => ({
        name,
        amount,
        trend: monthTrend(amount, previousMap.get(name) || 0),
      }))
      .sort((a, b) => b.amount - a.amount)
  }, [
    currentMonthRows,
    fixedExpenseEntries,
    hasPreviousMonthRows,
    previousFixedExpenseEntries,
    previousMonthRows,
    type,
  ])
  const [categoryStatIndex, setCategoryStatIndex] = useState(0)
  const activeCategoryStat = categoryStats.length
    ? categoryStats[categoryStatIndex % categoryStats.length]
    : null

  useEffect(() => {
    setCategoryStatIndex(0)
    if (categoryStats.length <= 1) return undefined

    const timer = window.setInterval(() => {
      setCategoryStatIndex((index) => (index + 1) % categoryStats.length)
    }, 2800)
    return () => window.clearInterval(timer)
  }, [categoryStats.length, currentMonth])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const paymentName = (id, fallback) =>
    paymentMethods.find((method) => method.id === id)?.name || fallback || '미지정'

  function submit(e) {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!form.date) {
      alert('날짜를 입력하세요.')
      return
    }
    if (!amount || amount <= 0) {
      alert('금액을 0보다 큰 값으로 입력하세요.')
      return
    }
    const payload = {
      type,
      date: form.date,
      category: form.category.trim() || '미분류',
      amount,
      memo: form.memo.trim(),
    }
    if (type === '지출') {
      payload.paymentMethodId = form.paymentMethodId
      payload.paymentMethod = paymentName(form.paymentMethodId)
    }
    addCategory?.(type, payload.category)
    if (editingId) {
      updateEntry(editingId, payload)
      setEditingId(null)
    } else {
      addEntry(payload)
    }
    setForm({ ...blankForm(), date: form.date })
  }

  function startEdit(row) {
    setEditingId(row.id)
    setForm({
      date: row.date,
      category: row.category,
      paymentMethodId:
        row.paymentMethodId ||
        paymentMethods.find((method) => method.name === row.paymentMethod)?.id ||
        '',
      amount: String(row.amount),
      memo: row.memo || '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(blankForm())
  }

  function handleDelete(row) {
    if (window.confirm(`${row.date} · ${row.category} · ${formatKRW(row.amount)}\n이 항목을 삭제할까요?`)) {
      removeEntry(row.id)
      if (editingId === row.id) cancelEdit()
    }
  }

  function submitCategory(e) {
    e.preventDefault()
    const value = categoryForm.value.trim()
    if (!value) return
    if (categoryForm.original) {
      updateCategory?.(type, categoryForm.original, value)
      if (form.category === categoryForm.original) set('category', value)
    } else {
      addCategory?.(type, value)
    }
    setCategoryForm(blankCategoryForm())
  }

  function editCategory(name) {
    setCategoryForm({ original: name, value: name })
  }

  function deleteCategory(name) {
    if (window.confirm(`카테고리 '${name}'을(를) 삭제할까요?`)) {
      removeCategory?.(type, name)
      if (form.category === name) set('category', '')
      if (categoryForm.original === name) setCategoryForm(blankCategoryForm())
    }
  }

  return (
    <div className="stage" style={{ '--accent': meta.color }}>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">{type} 전체 합계</div>
          <div className="value accent">
            {formatKRW(total)}
            {type === '지출' && (
              <span className={`month-change ${totalExpenseTrend.tone}`}>
                ({totalExpenseTrend.mark} {totalExpenseTrend.percent}%)
              </span>
            )}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">이번 달 ({currentMonth})</div>
          <div className="value">
            {formatKRW(monthTotal)}
            {type === '지출' && (
              <span className={`month-change ${expenseTrend.tone}`}>
                ({expenseTrend.mark} {expenseTrend.percent}%)
              </span>
            )}
          </div>
        </div>
        <div className="stat-card category-stat-card">
          <div className="category-stat-roll" key={activeCategoryStat?.name || 'empty'}>
            <div className="label">{activeCategoryStat ? activeCategoryStat.name : '카테고리 없음'}</div>
            <div className="value">
              {activeCategoryStat ? formatKRW(activeCategoryStat.amount) : '-'}
              {activeCategoryStat && (
                <span className={`month-change ${activeCategoryStat.trend.tone}`}>
                  ({activeCategoryStat.trend.mark} {activeCategoryStat.trend.percent}%)
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {type === '지출' && fixed && (
        <FixedExpenses
          items={fixed.items}
          addItem={fixed.addItem}
          updateItem={fixed.updateItem}
          removeItem={fixed.removeItem}
          categories={categoryList}
          addCategory={addCategory}
          paymentMethods={paymentMethods}
        />
      )}

      <div className="card">
        <div className="form-card-head">
          <h2 className="section-title">{editingId ? `${type} 항목 수정` : `${type} 항목 추가`}</h2>
          <div className="form-card-actions">
            <button className="btn btn-sm" onClick={() => setCategoryOpen(true)}>
              카테고리 관리
            </button>
            {type === '지출' && (
              <button className="btn btn-sm" onClick={() => setPaymentOpen(true)}>
                결제수단 관리
              </button>
            )}
          </div>
        </div>
        <form className={`entry-form${type === '지출' ? ' expense-form' : ''}`} onSubmit={submit}>
          <div className="field">
            <label>날짜</label>
            <CalendarInput value={form.date} onChange={(value) => set('date', value)} />
          </div>
          <div className="field">
            <label>카테고리</label>
            <Picker
              value={form.category}
              options={categoryOptions}
              placeholder="카테고리 선택"
              onChange={(value) => set('category', value)}
            />
          </div>
          {type === '지출' && (
            <div className="field">
              <label>결제수단</label>
              <Picker
                value={form.paymentMethodId}
                options={paymentOptions}
                placeholder="미지정"
                onChange={(value) => set('paymentMethodId', value)}
              />
            </div>
          )}
          <div className="field">
            <label>금액 (원)</label>
            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              placeholder="0"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
            />
          </div>
          <div className="field field-memo">
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

      {categoryOpen && (
        <div className="fixed-modal-backdrop" onClick={() => setCategoryOpen(false)}>
          <div
            className="fixed-modal category-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fixed-modal-head">
              <h3>{type} 카테고리</h3>
              <button
                className="fixed-modal-close"
                onClick={() => setCategoryOpen(false)}
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            <form className="category-form" onSubmit={submitCategory}>
              <input
                type="text"
                placeholder="카테고리명"
                value={categoryForm.value}
                onChange={(e) =>
                  setCategoryForm((prev) => ({ ...prev, value: e.target.value }))
                }
              />
              <button type="submit" className="btn btn-sm btn-accent">
                {categoryForm.original ? '수정' : '추가'}
              </button>
              {categoryForm.original && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setCategoryForm(blankCategoryForm())}
                >
                  취소
                </button>
              )}
            </form>

            <div className="category-chip-row">
              {categoryList.map((c) => (
                <span className="category-chip" key={c}>
                  {c}
                  <button className="icon-btn" onClick={() => editCategory(c)} aria-label={`${c} 수정`}>
                    ✎
                  </button>
                  <button
                    className="icon-btn danger"
                    onClick={() => deleteCategory(c)}
                    aria-label={`${c} 삭제`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {paymentOpen && (
        <div className="fixed-modal-backdrop" onClick={() => setPaymentOpen(false)}>
          <div
            className="fixed-modal payment-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fixed-modal-head">
              <h3>결제수단</h3>
              <button
                className="fixed-modal-close"
                onClick={() => setPaymentOpen(false)}
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <PaymentMethodManager
              methods={paymentMethods}
              addMethod={addPaymentMethod}
              showMethods={false}
            />
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="section-title">{type} 내역</h2>
        {rows.length === 0 ? (
          <div className="empty">
            <strong>아직 {type} 기록이 없습니다</strong>
            위 양식으로 첫 {type} 항목을 추가해 보세요.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>카테고리</th>
                  {type === '지출' && <th>결제수단</th>}
                  <th className="col-right">금액</th>
                  <th>메모</th>
                  <th className="col-right">관리</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={editingId === row.id ? 'editing' : undefined}>
                    <td data-label="날짜">{row.date || '—'}</td>
                    <td data-label="카테고리">
                      <span className="tag">{row.category}</span>
                      {row.fixedId && <span className="mini-tag">고정</span>}
                    </td>
                    {type === '지출' && (
                      <td data-label="결제수단">
                        {paymentName(row.paymentMethodId, row.paymentMethod)}
                      </td>
                    )}
                    <td className="amount" data-label="금액">{formatKRW(row.amount)}</td>
                    <td className="memo" data-label="메모">{row.memo || '—'}</td>
                    <td data-label="관리">
                      <div className="row-actions">
                        {type === '지출' ? (
                          <>
                            <button
                              className="icon-btn"
                              onClick={() => startEdit(row)}
                              aria-label={`${row.date} ${row.category} 수정`}
                              title="수정"
                            >
                              ✎
                            </button>
                            <button
                              className="icon-btn danger"
                              onClick={() => handleDelete(row)}
                              aria-label={`${row.date} ${row.category} 삭제`}
                              title="삭제"
                            >
                              ×
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="btn btn-sm" onClick={() => startEdit(row)}>
                              수정
                            </button>
                            <button className="btn btn-sm btn-danger" onClick={() => handleDelete(row)}>
                              삭제
                            </button>
                          </>
                        )}
                      </div>
                    </td>
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
