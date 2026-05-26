import { useEffect, useMemo, useState } from 'react'
import { STAGE_META } from '../lib/categories'
import { formatKRW, monthOf, todayStr } from '../lib/format'
import {
  detectRecurringTransaction,
  parseTransactionText,
  recentEntrySuggestions,
} from '../lib/inputAssist'
import { isLoanInterestCategory } from '../lib/loanInterest'
import { parseAmountInput } from '../lib/numberInput'
import CalendarInput from './CalendarInput'
import FixedExpenses from './FixedExpenses'
import LoanInterestCalculator from './LoanInterestCalculator'
import NumberInput from './NumberInput'
import PaymentMethodManager from './PaymentMethodManager'
import Picker from './Picker'

const blankForm = () => ({
  date: todayStr(),
  category: '',
  paymentMethodId: '',
  amount: '',
  memo: '',
  loanMethod: '만기일시상환',
  loanPrincipal: '',
  loanRate: '',
  loanMonths: '1',
  loanRound: '1',
  loanGraceMonths: '',
})
const blankCategoryForm = () => ({ original: '', value: '' })
const PAYMENT_FILTER_UNSPECIFIED = '__unspecified__'

function previousMonthOf(month) {
  const [year, monthNum] = month.split('-').map(Number)
  if (!year || !monthNum) return ''
  const date = new Date(year, monthNum - 2, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function lastDateOfMonth(month) {
  const [year, monthNum] = String(month || '').split('-').map(Number)
  if (!year || !monthNum) return ''
  const date = new Date(year, monthNum, 0)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
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

function optionsWithCurrent(options, value) {
  const current = String(value || '').trim()
  return current && !options.includes(current) ? [...options, current] : options
}

export default function LedgerStage({
  type,
  entries,
  addEntry,
  updateEntry,
  removeEntry,
  fixed,
  fixedIncome,
  fixedExpenseCollapsed,
  setFixedExpenseCollapsed,
  fixedIncomeCollapsed,
  setFixedIncomeCollapsed,
  fixedExpenseEntries = [],
  previousFixedExpenseEntries = [],
  fixedIncomeEntries = [],
  previousFixedIncomeEntries = [],
  categories,
  addCategory,
  updateCategory,
  removeCategory,
  paymentMethods = [],
  addPaymentMethod,
  updatePaymentMethod,
  removePaymentMethod,
  replacePaymentMethod,
}) {
  const meta = STAGE_META[type]
  const categoryList = categories?.length ? categories : meta.categories
  const [form, setForm] = useState(blankForm)
  const [editingId, setEditingId] = useState(null)
  const [categoryForm, setCategoryForm] = useState(blankCategoryForm)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [paymentEditOpen, setPaymentEditOpen] = useState(false)
  const [paymentListOpen, setPaymentListOpen] = useState(false)
  const [pendingPaymentEditId, setPendingPaymentEditId] = useState('')
  const [methodChange, setMethodChange] = useState({ from: '', to: '' })
  const [mobileEntryOpen, setMobileEntryOpen] = useState(false)
  const [mobileManualOpen, setMobileManualOpen] = useState(false)
  const [quickInput, setQuickInput] = useState('')
  const [inlineEditId, setInlineEditId] = useState(null)
  const [inlineDraft, setInlineDraft] = useState(blankForm)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [historySearch, setHistorySearch] = useState('')
  const [historyStartDate, setHistoryStartDate] = useState('')
  const [historyEndDate, setHistoryEndDate] = useState('')
  const [historyCategory, setHistoryCategory] = useState('')
  const [historyPayment, setHistoryPayment] = useState('')
  const [historyFiltersOpen, setHistoryFiltersOpen] = useState(false)

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
  const loanInterestMode = type === '지출' && isLoanInterestCategory(form.category)

  const ledgerRows = useMemo(
    () =>
      entries
        .filter((e) => e.type === type)
        .sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [entries, type]
  )
  const activeFixedEntries = type === '지출' ? fixedExpenseEntries : type === '수입' ? fixedIncomeEntries : []
  const previousActiveFixedEntries =
    type === '지출'
      ? previousFixedExpenseEntries
      : type === '수입'
        ? previousFixedIncomeEntries
        : []
  const currentMonth = todayStr().slice(0, 7)
  const currentMonthStart = `${currentMonth}-01`
  const currentMonthEnd = lastDateOfMonth(currentMonth)
  const rows = useMemo(
    () => (type === '지출' ? ledgerRows.filter((e) => !e.fixedId) : ledgerRows),
    [ledgerRows, type]
  )
  const historyCategoryOptions = useMemo(() => {
    const names = [...new Set([...categoryList, ...rows.map((row) => row.category)].filter(Boolean))]
    return [
      { value: '', label: '전체 카테고리' },
      ...names.map((name) => ({ value: name, label: name })),
    ]
  }, [categoryList, rows])
  const historyPaymentOptions = useMemo(
    () => [
      { value: '', label: '전체 결제수단' },
      { value: PAYMENT_FILTER_UNSPECIFIED, label: '미지정' },
      ...paymentMethods.map((method) => ({ value: method.id, label: method.name })),
    ],
    [paymentMethods]
  )
  const filteredRows = useMemo(() => {
    const query = historySearch.trim().toLowerCase()
    return rows.filter((row) => {
      if (monthOf(row.date) !== currentMonth) return false
      if (historyStartDate && row.date < historyStartDate) return false
      if (historyEndDate && row.date > historyEndDate) return false
      if (historyCategory && row.category !== historyCategory) return false
      if (type === '지출' && historyPayment) {
        if (historyPayment === PAYMENT_FILTER_UNSPECIFIED) {
          if (row.paymentMethodId) return false
        } else if (row.paymentMethodId !== historyPayment) {
          return false
        }
      }
      if (!query) return true
      const paymentLabel =
        paymentMethods.find((method) => method.id === row.paymentMethodId)?.name ||
        row.paymentMethod ||
        '미지정'
      return [
        row.date,
        row.category,
        row.memo,
        paymentLabel,
        formatKRW(row.amount),
        String(row.amount || ''),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [
    currentMonth,
    historyCategory,
    historyEndDate,
    historyPayment,
    historySearch,
    historyStartDate,
    paymentMethods,
    rows,
    type,
  ])
  const historyFilterActive =
    Boolean(historySearch.trim()) ||
    Boolean(historyStartDate) ||
    Boolean(historyEndDate) ||
    Boolean(historyCategory) ||
    Boolean(historyPayment)
  const rowIds = useMemo(() => filteredRows.map((row) => row.id), [filteredRows])
  const selectedRowIds = useMemo(
    () => rowIds.filter((id) => selectedIds.has(id)),
    [rowIds, selectedIds]
  )
  const allRowsSelected = rowIds.length > 0 && selectedRowIds.length === rowIds.length
  const recentSuggestions = useMemo(() => recentEntrySuggestions(rows), [rows])
  const recurringCandidate = useMemo(
    () =>
      detectRecurringTransaction(
        rows,
        type,
        type === '지출' ? fixed?.items || [] : type === '수입' ? fixedIncome?.items || [] : []
      ),
    [fixed?.items, fixedIncome?.items, rows, type]
  )
  const previousMonth = previousMonthOf(currentMonth)
  const currentMonthRows = useMemo(
    () => ledgerRows.filter((e) => monthOf(e.date) === currentMonth),
    [ledgerRows, currentMonth]
  )
  const monthTotal = useMemo(() => currentMonthRows.reduce((s, e) => s + e.amount, 0), [currentMonthRows])
  const fixedMonthTotal = useMemo(
    () => activeFixedEntries.reduce((s, e) => s + e.amount, 0),
    [activeFixedEntries]
  )
  const visibleMonthTotal = type === '수입' ? monthTotal + fixedMonthTotal : monthTotal
  const previousMonthRows = useMemo(
    () => ledgerRows.filter((e) => monthOf(e.date) === previousMonth),
    [ledgerRows, previousMonth]
  )
  const previousMonthTotal = useMemo(
    () => previousMonthRows.reduce((s, e) => s + e.amount, 0),
    [previousMonthRows]
  )
  const previousFixedMonthTotal = useMemo(
    () => previousActiveFixedEntries.reduce((s, e) => s + e.amount, 0),
    [previousActiveFixedEntries]
  )
  const hasPreviousMonthRows = previousMonthRows.length > 0 || previousActiveFixedEntries.length > 0
  const monthTrendInfo = monthTrend(
    visibleMonthTotal,
    hasPreviousMonthRows ? previousMonthTotal + previousFixedMonthTotal : 0
  )
  const categoryStats = useMemo(() => {
    const currentMap = new Map()
    const previousMap = new Map()
    addCategoryTotals(currentMap, currentMonthRows)
    if (type === '지출' || type === '수입') addCategoryTotals(currentMap, activeFixedEntries)
    if (hasPreviousMonthRows) {
      addCategoryTotals(previousMap, previousMonthRows)
      if (type === '지출' || type === '수입') addCategoryTotals(previousMap, previousActiveFixedEntries)
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
    activeFixedEntries,
    hasPreviousMonthRows,
    previousActiveFixedEntries,
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

  useEffect(() => {
    const available = new Set(rowIds)
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)))
      return next.size === current.size ? current : next
    })
  }, [rowIds])

  useEffect(() => {
    if (editingId) return
    const latest = rows[0]
    if (!latest) return
    setForm((current) => {
      if (current.category || current.amount || current.memo || current.paymentMethodId) return current
      return {
        ...current,
        category: latest.category || '',
        paymentMethodId:
          type === '지출'
            ? latest.paymentMethodId ||
              paymentMethods.find((method) => method.name === latest.paymentMethod)?.id ||
              ''
            : '',
      }
    })
  }, [editingId, paymentMethods, rows, type])

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const setInline = (key, value) => setInlineDraft((f) => ({ ...f, [key]: value }))
  const paymentName = (id, fallback) =>
    paymentMethods.find((method) => method.id === id)?.name || fallback || '미지정'

  function submit(e) {
    e.preventDefault()
    const amount = parseAmountInput(form.amount)
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
      if (loanInterestMode) {
        payload.loanMethod = form.loanMethod
        payload.loanPrincipal = form.loanPrincipal
        payload.loanRate = form.loanRate
        payload.loanMonths = form.loanMonths
        payload.loanRound = form.loanRound
        payload.loanGraceMonths = form.loanGraceMonths
      }
    }
    addCategory?.(type, payload.category)
    if (editingId) {
      updateEntry(editingId, payload)
      setEditingId(null)
    } else {
      addEntry(payload)
    }
    setForm({
      ...blankForm(),
      date: form.date,
      category: payload.category,
      paymentMethodId: type === '지출' ? payload.paymentMethodId || '' : '',
    })
    setMobileEntryOpen(false)
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
      loanMethod: row.loanMethod || '만기일시상환',
      loanPrincipal: row.loanPrincipal != null ? String(row.loanPrincipal) : '',
      loanRate: row.loanRate != null ? String(row.loanRate) : '',
      loanMonths: row.loanMonths != null ? String(row.loanMonths) : '1',
      loanRound: row.loanRound != null ? String(row.loanRound) : '1',
      loanGraceMonths: row.loanGraceMonths != null ? String(row.loanGraceMonths) : '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(blankForm())
  }

  function addQuickInput() {
    const parsed = parseTransactionText(quickInput, {
      type,
      categories: categoryList,
      paymentMethods,
      entries: rows,
    })
    if (!Object.keys(parsed).length) return

    const amount = parsed.amount || parseAmountInput(form.amount)
    if (!amount || amount <= 0) {
      alert('빠른 입력에 금액을 포함해 주세요.')
      return
    }

    const paymentMethodId = type === '지출' ? parsed.paymentMethodId || form.paymentMethodId : ''
    const payload = {
      type,
      date: parsed.date || form.date || todayStr(),
      category: (parsed.category || form.category || '미분류').trim(),
      amount,
      memo: parsed.memo || form.memo.trim(),
    }
    if (type === '지출') {
      payload.paymentMethodId = paymentMethodId
      payload.paymentMethod = paymentName(paymentMethodId)
      if (isLoanInterestCategory(payload.category) && loanInterestMode) {
        payload.loanMethod = form.loanMethod
        payload.loanPrincipal = form.loanPrincipal
        payload.loanRate = form.loanRate
        payload.loanMonths = form.loanMonths
        payload.loanRound = form.loanRound
        payload.loanGraceMonths = form.loanGraceMonths
      }
    }

    addCategory?.(type, payload.category)
    addEntry(payload)
    setEditingId(null)
    setQuickInput('')
    setForm({
      ...blankForm(),
      date: payload.date,
      category: payload.category,
      paymentMethodId,
    })
    setMobileEntryOpen(false)
  }

  function applyRecent(row) {
    setEditingId(null)
    setInlineEditId(null)
    setForm({
      ...blankForm(),
      date: form.date || todayStr(),
      category: row.category || '',
      paymentMethodId:
        type === '지출'
          ? row.paymentMethodId ||
            paymentMethods.find((method) => method.name === row.paymentMethod)?.id ||
            ''
          : '',
      amount: String(row.amount || ''),
      memo: row.memo || '',
    })
  }

  function duplicateRow(row) {
    const payload = {
      type,
      date: todayStr(),
      category: row.category || '미분류',
      amount: Number(row.amount) || 0,
      memo: row.memo || '',
    }
    if (!payload.amount) return
    if (type === '지출') {
      payload.paymentMethodId =
        row.paymentMethodId ||
        paymentMethods.find((method) => method.name === row.paymentMethod)?.id ||
        ''
      payload.paymentMethod = paymentName(payload.paymentMethodId, row.paymentMethod)
      if (isLoanInterestCategory(row.category)) {
        payload.loanMethod = row.loanMethod
        payload.loanPrincipal = row.loanPrincipal
        payload.loanRate = row.loanRate
        payload.loanMonths = row.loanMonths
        payload.loanRound = row.loanRound
        payload.loanGraceMonths = row.loanGraceMonths
      }
    }
    addCategory?.(type, payload.category)
    addEntry(payload)
  }

  function startInlineEdit(row) {
    setEditingId(null)
    setInlineEditId(row.id)
    setInlineDraft({
      ...blankForm(),
      date: row.date || todayStr(),
      category: row.category || '',
      paymentMethodId:
        type === '지출'
          ? row.paymentMethodId ||
            paymentMethods.find((method) => method.name === row.paymentMethod)?.id ||
            ''
          : '',
      amount: String(row.amount || ''),
      memo: row.memo || '',
    })
  }

  function cancelInlineEdit() {
    setInlineEditId(null)
    setInlineDraft(blankForm())
  }

  function saveInlineEdit(row) {
    const amount = parseAmountInput(inlineDraft.amount)
    if (!inlineDraft.date) {
      alert('날짜를 입력하세요.')
      return
    }
    if (!amount || amount <= 0) {
      alert('금액을 0보다 큰 값으로 입력하세요.')
      return
    }
    const payload = {
      type,
      date: inlineDraft.date,
      category: inlineDraft.category.trim() || '미분류',
      amount,
      memo: inlineDraft.memo.trim(),
    }
    if (type === '지출') {
      payload.paymentMethodId = inlineDraft.paymentMethodId
      payload.paymentMethod = paymentName(inlineDraft.paymentMethodId, row.paymentMethod)
    }
    addCategory?.(type, payload.category)
    updateEntry(row.id, payload)
    cancelInlineEdit()
  }

  function addRecurringFixed() {
    if (!recurringCandidate) return
    const target = type === '지출' ? fixed : type === '수입' ? fixedIncome : null
    if (!target?.addItem) return

    const payload = {
      name: recurringCandidate.memo || recurringCandidate.category,
      category: recurringCandidate.category || '기타',
      amount: recurringCandidate.amount,
      day: recurringCandidate.day || '',
    }
    if (type === '지출') {
      payload.paymentMethodId = recurringCandidate.paymentMethodId
      payload.paymentMethod = paymentName(
        recurringCandidate.paymentMethodId,
        recurringCandidate.paymentMethod
      )
    }
    addCategory?.(type, payload.category)
    target.addItem(payload)
  }

  function toggleRowSelection(id, checked) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleAllRows(checked) {
    setSelectedIds((current) => {
      const next = new Set(current)
      rowIds.forEach((id) => {
        if (checked) next.add(id)
        else next.delete(id)
      })
      return next
    })
  }

  function toggleSelectionMode() {
    if (selectionMode) setSelectedIds(new Set())
    setSelectionMode((current) => !current)
  }

  function handleLedgerListDoubleClick(e) {
    if (e.target.closest?.('button,input,textarea,select,a,.picker,.calendar-input')) return
    toggleSelectionMode()
  }

  function deleteSelectedRows() {
    if (selectedRowIds.length === 0) return
    if (!window.confirm(`선택한 ${selectedRowIds.length}개 ${type} 내역을 삭제할까요?`)) return

    selectedRowIds.forEach((id) => removeEntry(id))
    if (selectedRowIds.includes(editingId)) cancelEdit()
    if (selectedRowIds.includes(inlineEditId)) cancelInlineEdit()
    setSelectedIds((current) => {
      const next = new Set(current)
      selectedRowIds.forEach((id) => next.delete(id))
      return next
    })
  }

  function handleDelete(row) {
    if (window.confirm(`${row.date} · ${row.category} · ${formatKRW(row.amount)}\n이 항목을 삭제할까요?`)) {
      removeEntry(row.id)
      if (editingId === row.id) cancelEdit()
      if (inlineEditId === row.id) cancelInlineEdit()
      setSelectedIds((current) => {
        if (!current.has(row.id)) return current
        const next = new Set(current)
        next.delete(row.id)
        return next
      })
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

  function resetHistoryFilters() {
    setHistorySearch('')
    setHistoryStartDate('')
    setHistoryEndDate('')
    setHistoryCategory('')
    setHistoryPayment('')
  }

  function normalizeHistoryDate(value) {
    if (!value || monthOf(value) !== currentMonth) return ''
    if (value < currentMonthStart) return currentMonthStart
    if (currentMonthEnd && value > currentMonthEnd) return currentMonthEnd
    return value
  }

  function updateHistoryStartDate(value) {
    const next = normalizeHistoryDate(value)
    setHistoryStartDate(next)
    if (next && historyEndDate && historyEndDate < next) setHistoryEndDate(next)
  }

  function updateHistoryEndDate(value) {
    const next = normalizeHistoryDate(value)
    setHistoryEndDate(next)
    if (next && historyStartDate && historyStartDate > next) setHistoryStartDate(next)
  }

  function openMobileEntry() {
    setEditingId(null)
    setMobileEntryOpen(true)
  }

  function renderInputAssist() {
    return (
      <div className="input-assist-panel">
        <div className="quick-entry-bar">
          <textarea
            rows={1}
            placeholder={
              type === '지출'
                ? '오늘 점심 9,500 체크카드'
                : '25일 월급 300만'
            }
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                addQuickInput()
              }
            }}
          />
          <button type="button" className="btn btn-sm" onClick={addQuickInput}>
            바로 추가
          </button>
        </div>
        {recentSuggestions.length > 0 && (
          <div className="assist-chip-row">
            {recentSuggestions.map((row) => (
              <button
                type="button"
                className="assist-chip"
                key={`${row.id}-${row.date}`}
                onClick={() => applyRecent(row)}
              >
                <strong>{row.category}</strong>
                <span>{formatKRW(row.amount)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  function renderEntryForm(extraClass = '') {
    const formClass = [
      'entry-form',
      type === '지출' ? 'expense-form' : '',
      extraClass,
    ].filter(Boolean).join(' ')

    return (
      <form className={formClass} onSubmit={submit}>
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
          <NumberInput
            min="0"
            step="1"
            decimal={false}
            amount
            placeholder="0"
            value={form.amount}
            onChange={(value) => set('amount', value)}
          />
        </div>
        {loanInterestMode && (
          <LoanInterestCalculator
            principal={form.loanPrincipal}
            rate={form.loanRate}
            months={form.loanMonths}
            method={form.loanMethod}
            round={form.loanRound}
            graceMonths={form.loanGraceMonths}
            onChange={set}
            onApply={(amount) => set('amount', String(amount))}
          />
        )}
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
    )
  }

  return (
    <div className="stage" style={{ '--accent': meta.color }}>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">이번 달 ({currentMonth})</div>
          <div className="value accent">
            {formatKRW(visibleMonthTotal)}
            {(type === '지출' || type === '수입') && (
              <span className={`month-change ${monthTrendInfo.tone}`}>
                ({monthTrendInfo.mark} {monthTrendInfo.percent}%)
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
          type="지출"
          items={fixed.items}
          addItem={fixed.addItem}
          updateItem={fixed.updateItem}
          removeItem={fixed.removeItem}
          categories={categoryList}
          addCategory={addCategory}
          paymentMethods={paymentMethods}
          collapsed={fixedExpenseCollapsed}
          onCollapsedChange={setFixedExpenseCollapsed}
        />
      )}

      {type === '수입' && fixedIncome && (
        <FixedExpenses
          type="수입"
          items={fixedIncome.items}
          addItem={fixedIncome.addItem}
          updateItem={fixedIncome.updateItem}
          removeItem={fixedIncome.removeItem}
          categories={categoryList}
          addCategory={addCategory}
          collapsed={fixedIncomeCollapsed}
          onCollapsedChange={setFixedIncomeCollapsed}
        />
      )}

      {recurringCandidate && (
        <div className="recurring-suggestion">
          <div>
            <strong>{recurringCandidate.memo || recurringCandidate.category}</strong>
            <span>
              {recurringCandidate.category} · {formatKRW(recurringCandidate.amount)} ·{' '}
              {recurringCandidate.months}개월 반복
            </span>
          </div>
          <button type="button" className="btn btn-sm btn-accent" onClick={addRecurringFixed}>
            고정 위젯으로
          </button>
        </div>
      )}

      <div className="card ledger-entry-card">
        <div className="form-card-head">
          <h2 className="section-title">{editingId ? `${type} 항목 수정` : `${type} 항목 추가`}</h2>
          <div className="form-card-actions">
            <button className="btn btn-sm" onClick={() => setCategoryOpen(true)}>
              카테고리 관리
            </button>
            {type === '지출' && (
              <>
                <button className="btn btn-sm" onClick={() => setPaymentEditOpen(true)}>
                  결제수단 추가/변경
                </button>
                <button className="btn btn-sm" onClick={() => setPaymentListOpen(true)}>
                  결제수단 목록
                </button>
              </>
            )}
          </div>
        </div>
        {renderInputAssist()}
        {renderEntryForm()}
      </div>

      <button
        type="button"
        className="mobile-entry-fab"
        onClick={openMobileEntry}
        aria-label={`${type} 항목 추가`}
      >
        +
      </button>

      {mobileEntryOpen && (
        <div className="mobile-entry-backdrop" onClick={() => setMobileEntryOpen(false)}>
          <div
            className="mobile-entry-sheet"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mobile-entry-head">
              <h2>{type} 추가</h2>
              <button
                type="button"
                className="mobile-entry-close"
                onClick={() => setMobileEntryOpen(false)}
                aria-label="닫기"
              >
                ×
              </button>
            </div>
            <div className="mobile-entry-tools mobile-entry-tools-top">
              <button type="button" className="btn btn-sm" onClick={() => setCategoryOpen(true)}>
                카테고리 관리
              </button>
              {type === '지출' && (
                <>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setPaymentEditOpen(true)}
                  >
                    결제수단 추가/변경
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setPaymentListOpen(true)}
                  >
                    결제수단 목록
                  </button>
                </>
              )}
            </div>
            <div className="mobile-entry-section mobile-entry-quick-section">
              <div className="mobile-entry-section-head">
                <h3>빠른 추가</h3>
              </div>
              {renderInputAssist()}
            </div>
            <div className="mobile-entry-section mobile-entry-manual-section">
              <button
                type="button"
                className="mobile-entry-section-head mobile-entry-manual-toggle"
                onClick={() => setMobileManualOpen((open) => !open)}
                aria-expanded={mobileManualOpen}
              >
                <h3>수동 추가</h3>
                <span className={`mobile-entry-manual-chevron${mobileManualOpen ? ' open' : ''}`}>
                  ▶
                </span>
              </button>
              {mobileManualOpen && renderEntryForm('mobile-entry-form')}
            </div>
          </div>
        </div>
      )}

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
                  {isLoanInterestCategory(c) && <span className="mini-tag">이자계산기</span>}
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

      {paymentEditOpen && (
        <div
          className="fixed-modal-backdrop"
          onClick={() => {
            setPaymentEditOpen(false)
            setPendingPaymentEditId('')
          }}
        >
          <div
            className="fixed-modal payment-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <PaymentMethodManager
              view="form"
              methods={paymentMethods}
              addMethod={addPaymentMethod}
              updateMethod={updatePaymentMethod}
              initialEditId={pendingPaymentEditId}
            />
            {type === '지출' && replacePaymentMethod && paymentMethods.length >= 2 && (
              <section className="payment-replace-section" aria-label="결제수단 일괄 변경">
                <header className="payment-section-head">
                  <div className="payment-section-title">
                    <span className="payment-section-badge replace">일괄</span>
                    <h4>기존 지출의 결제수단 일괄 교체</h4>
                  </div>
                  <p className="payment-section-hint">
                    A 결제수단으로 기록된 지출과 고정지출을 B 결제수단으로 옮깁니다.
                  </p>
                </header>
                <form
                  className="payment-form payment-replace-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!methodChange.from || !methodChange.to)
                      return alert('변경할 결제수단을 선택하세요.')
                    if (methodChange.from === methodChange.to)
                      return alert('서로 다른 결제수단을 선택하세요.')
                    if (replacePaymentMethod(methodChange.from, methodChange.to)) {
                      setMethodChange({ from: '', to: '' })
                      alert('기존 지출 데이터의 결제수단을 변경했습니다.')
                    }
                  }}
                >
                  <div className="payment-field">
                    <span>기존 (A)</span>
                    <Picker
                      value={methodChange.from}
                      options={paymentMethods.map((m) => ({ value: m.id, label: m.name }))}
                      placeholder="A 선택"
                      onChange={(value) => setMethodChange((prev) => ({ ...prev, from: value }))}
                    />
                  </div>
                  <div className="payment-field">
                    <span>변경 (B)</span>
                    <Picker
                      value={methodChange.to}
                      options={paymentMethods.map((m) => ({ value: m.id, label: m.name }))}
                      placeholder="B 선택"
                      onChange={(value) => setMethodChange((prev) => ({ ...prev, to: value }))}
                    />
                  </div>
                  <div className="payment-form-actions">
                    <button type="submit" className="btn btn-sm btn-accent">
                      일괄 변경
                    </button>
                  </div>
                </form>
              </section>
            )}
          </div>
        </div>
      )}

      {paymentListOpen && (
        <div className="fixed-modal-backdrop" onClick={() => setPaymentListOpen(false)}>
          <div
            className="fixed-modal payment-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <PaymentMethodManager
              view="list"
              methods={paymentMethods}
              updateMethod={updatePaymentMethod}
              removeMethod={removePaymentMethod}
              onEditRequest={(method) => {
                setPaymentListOpen(false)
                setPendingPaymentEditId(method.id)
                setPaymentEditOpen(true)
              }}
            />
          </div>
        </div>
      )}

      <div className="card">
        <div className="ledger-list-head">
          <h2 className="section-title">{type} 내역</h2>
          <div className="ledger-list-actions">
            {rows.length > 0 && (
              <button
                type="button"
                className={`icon-btn ledger-filter-toggle${historyFiltersOpen || historyFilterActive ? ' on' : ''}`}
                onClick={() => setHistoryFiltersOpen((open) => !open)}
                aria-label={`${type} 내역 검색 필터 ${historyFiltersOpen ? '닫기' : '열기'}`}
                title="검색 필터"
              >
                ⌕
              </button>
            )}
            {selectionMode && selectedRowIds.length > 0 && (
              <button type="button" className="btn btn-sm btn-danger" onClick={deleteSelectedRows}>
                선택 삭제 {selectedRowIds.length}
              </button>
            )}
          </div>
        </div>
        {rows.length > 0 && (
          <div
            className={`ledger-filter-bar ledger-history-filter-bar ${
              type === '지출' ? 'has-payment' : 'no-payment'
            }${historyFiltersOpen ? ' mobile-open' : ''}`}
          >
            <div className="ledger-filter-field ledger-filter-search">
              <span>검색</span>
              <input
                type="search"
                placeholder="현재 달 내 검색"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
              />
            </div>
            <div className="ledger-filter-field">
              <span>시작일</span>
              <CalendarInput
                value={historyStartDate}
                onChange={updateHistoryStartDate}
                placeholder="월 시작"
                ariaLabel={`${type} 내역 시작일 필터`}
                min={currentMonthStart}
                max={currentMonthEnd}
              />
            </div>
            <div className="ledger-filter-field">
              <span>종료일</span>
              <CalendarInput
                value={historyEndDate}
                onChange={updateHistoryEndDate}
                placeholder="월 끝"
                ariaLabel={`${type} 내역 종료일 필터`}
                min={currentMonthStart}
                max={currentMonthEnd}
              />
            </div>
            <div className="ledger-filter-field">
              <span>카테고리</span>
              <Picker
                value={historyCategory}
                options={historyCategoryOptions}
                placeholder="전체 카테고리"
                onChange={setHistoryCategory}
              />
            </div>
            {type === '지출' && (
              <div className="ledger-filter-field">
                <span>결제수단</span>
                <Picker
                  value={historyPayment}
                  options={historyPaymentOptions}
                  placeholder="전체 결제수단"
                  onChange={setHistoryPayment}
                />
              </div>
            )}
            <div className="ledger-filter-actions">
              <button
                type="button"
                className="btn btn-sm"
                disabled={!historyFilterActive}
                onClick={resetHistoryFilters}
              >
                초기화
              </button>
            </div>
          </div>
        )}
        {rows.length === 0 ? (
          <div className="empty">
            <strong>아직 {type} 기록이 없습니다</strong>
            위 양식으로 첫 {type} 항목을 추가해 보세요.
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="empty">
            <strong>조건에 맞는 {type} 내역이 없습니다</strong>
            검색어나 필터를 조정해 보세요.
          </div>
        ) : (
          <div
            className={`table-wrap${inlineEditId ? ' has-inline-edit' : ''}`}
            onDoubleClick={handleLedgerListDoubleClick}
          >
            <table className="ledger-table">
              <thead>
                <tr>
                  {selectionMode && (
                    <th className="ledger-select-head">
                      <input
                        type="checkbox"
                        checked={allRowsSelected}
                        onChange={(e) => toggleAllRows(e.target.checked)}
                        aria-label={`${type} 내역 전체 선택`}
                      />
                    </th>
                  )}
                  <th>날짜</th>
                  <th>카테고리</th>
                  {type === '지출' && <th>결제수단</th>}
                  <th className="col-right">금액</th>
                  <th>메모</th>
                  <th className="col-right">관리</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const inlineEditing = inlineEditId === row.id
                  const inlineCategoryOptions = optionsWithCurrent(categoryList, inlineDraft.category)
                  return (
                    <tr
                      key={row.id}
                      className={
                        inlineEditing
                          ? 'editing inline-editing'
                          : editingId === row.id
                            ? 'editing'
                            : undefined
                      }
                    >
                      {selectionMode && (
                        <td className="ledger-select-cell" data-label="선택">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(row.id)}
                            onChange={(e) => toggleRowSelection(row.id, e.target.checked)}
                            aria-label={`${row.date} ${row.category} 선택`}
                          />
                        </td>
                      )}
                      <td data-label="날짜">
                        {inlineEditing ? (
                          <CalendarInput
                            value={inlineDraft.date}
                            onChange={(value) => setInline('date', value)}
                            min={currentMonthStart}
                            max={currentMonthEnd}
                          />
                        ) : (
                          row.date || '—'
                        )}
                      </td>
                      <td data-label="카테고리">
                        {inlineEditing ? (
                          <Picker
                            value={inlineDraft.category}
                            options={inlineCategoryOptions}
                            placeholder="카테고리 선택"
                            onChange={(value) => setInline('category', value)}
                          />
                        ) : (
                          <>
                            <span className="tag">{row.category}</span>
                            {isLoanInterestCategory(row.category) && (
                              <span className="mini-tag">이자계산기</span>
                            )}
                            {row.fixedId && <span className="mini-tag">고정</span>}
                          </>
                        )}
                      </td>
                      {type === '지출' && (
                        <td data-label="결제수단">
                          {inlineEditing ? (
                            <Picker
                              value={inlineDraft.paymentMethodId}
                              options={paymentOptions}
                              placeholder="미지정"
                              onChange={(value) => setInline('paymentMethodId', value)}
                            />
                          ) : (
                            paymentName(row.paymentMethodId, row.paymentMethod)
                          )}
                        </td>
                      )}
                      <td className={inlineEditing ? undefined : 'amount'} data-label="금액">
                        {inlineEditing ? (
                          <NumberInput
                            min="0"
                            step="1"
                            decimal={false}
                            amount
                            className="ledger-inline-input"
                            value={inlineDraft.amount}
                            onChange={(value) => setInline('amount', value)}
                          />
                        ) : (
                          formatKRW(row.amount)
                        )}
                      </td>
                      <td className="memo" data-label="메모">
                        {inlineEditing ? (
                          <input
                            type="text"
                            className="ledger-inline-input"
                            value={inlineDraft.memo}
                            onChange={(e) => setInline('memo', e.target.value)}
                          />
                        ) : (
                          row.memo || '—'
                        )}
                      </td>
                      <td data-label="관리">
                        <div className="row-actions">
                          {inlineEditing ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-sm btn-accent"
                                onClick={() => saveInlineEdit(row)}
                              >
                                저장
                              </button>
                              <button type="button" className="btn btn-sm" onClick={cancelInlineEdit}>
                                취소
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="icon-btn"
                                onClick={() => duplicateRow(row)}
                                aria-label={`${row.date} ${row.category} 복제`}
                                title="복제"
                              >
                                ⧉
                              </button>
                              <button
                                className="icon-btn"
                                onClick={() => startInlineEdit(row)}
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
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
