import { useEffect, useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { formatKRW, monthOf, todayStr } from '../lib/format'
import CalendarInput from './CalendarInput'
import { fixedExpenseEntriesForMonth, fixedExpenseEntriesFromRecords } from '../lib/fixedExpenseEntries'
import { reconcileFixedExpenseEntries } from '../lib/fixedExpenseSettlement'
import { createId } from '../lib/id'
import { daysUntilInstallmentDue } from '../lib/installment'
import { parseAmountInput } from '../lib/numberInput'
import { categoryColor, categoryIcon } from '../lib/categoryPresentation'
import { defaultExpensePlanSettings, normalizeExpensePlanSettings } from '../lib/schema'
import { useStoredSlice, withUndo } from '../lib/store'
import { STORE_PATHS } from '../lib/storePaths'
import { nextTransactionSort, sortTransactionRows } from '../lib/transactionSort'
import CategoryBadge from './CategoryBadge'
import NumberInput from './NumberInput'
import PaymentMethodManager from './PaymentMethodManager'
import Picker from './Picker'
import SortableHeader from './SortableHeader'

const EXPENSE_COLOR = '#dc2626'
const BUDGET_PIE_COLORS = [
  '#6366f1', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#ec4899',
  '#8b5cf6', '#14b8a6', '#f97316', '#84cc16', '#06b6d4', '#a855f7',
]
const BUDGET_UNALLOCATED_COLOR = '#cbd5e1'

function BudgetPlanTooltip({ active, payload, total }) {
  if (!active || !payload?.length) return null

  const item = payload[0]?.payload
  if (!item) return null

  const share = total > 0 ? (Number(item.value) / total) * 100 : 0
  const groupLabel =
    item.group === 'fixed'
      ? '고정지출'
      : item.group === 'savings'
        ? '저축(고정)'
        : item.group === 'unallocated'
          ? '남은 예산'
          : '카테고리 예산'

  return (
    <div
      className="budget-plan-tooltip"
      style={{ '--tooltip-color': item.color || 'var(--accent)' }}
    >
      <div className="budget-plan-tooltip-head">
        <i aria-hidden="true" />
        <strong>{item.name}</strong>
        <span>{groupLabel}</span>
      </div>
      <b className="budget-plan-tooltip-amount">{formatKRW(item.value)}</b>
      <div className="budget-plan-tooltip-bar" aria-hidden="true">
        <i style={{ width: `${Math.min(100, share)}%` }} />
      </div>
      <div className="budget-plan-tooltip-foot">
        <span>전체 월 예산에서</span>
        <b>{share.toFixed(1)}%</b>
      </div>
    </div>
  )
}

function BudgetExecutionWidget({ budgetExecution, periodLabel, categoryIcons }) {
  return (
    <section className="card budget-execution" aria-labelledby="budget-execution-title">
      <div className="budget-execution-head">
        <div>
          <span>예산 이행 현황</span>
          <h3 id="budget-execution-title">{periodLabel} 계획 대비 실제 지출</h3>
          <p>
            {budgetExecution.plannedMultiplier > 1
              ? '월 예산을 12개월 기준으로 환산해 비교합니다.'
              : '등록한 월 예산과 선택한 달의 실제 지출을 비교합니다.'}
          </p>
        </div>
        <span className={`budget-execution-status ${budgetExecution.tone}`}>
          <i aria-hidden="true" />
          {budgetExecution.label}
        </span>
      </div>

      <div className="budget-execution-summary">
        <div>
          <span>기간 예산</span>
          <b>{formatKRW(budgetExecution.planned)}</b>
        </div>
        <div>
          <span>실제 지출</span>
          <b>{formatKRW(budgetExecution.actual)}</b>
        </div>
        <div className={budgetExecution.remaining < 0 ? 'over' : 'remaining'}>
          <span>{budgetExecution.remaining < 0 ? '초과 금액' : '남은 금액'}</span>
          <b>{formatKRW(Math.abs(budgetExecution.remaining))}</b>
        </div>
        <div className="budget-execution-total-progress">
          <div>
            <span>전체 사용률</span>
            <b>
              {budgetExecution.rate == null ? '-' : `${Math.round(budgetExecution.rate)}%`}
            </b>
          </div>
          <i aria-hidden="true">
            <b
              className={budgetExecution.tone}
              style={{
                width: `${
                  budgetExecution.rate == null
                    ? budgetExecution.actual > 0 ? 100 : 0
                    : Math.min(100, budgetExecution.rate)
                }%`,
              }}
            />
          </i>
        </div>
      </div>

      {budgetExecution.items.length === 0 ? (
        <div className="budget-execution-empty">
          카테고리 예산을 추가하면 실제 지출과의 이행률을 확인할 수 있습니다.
        </div>
      ) : (
        <div className="budget-execution-table">
          <div className="budget-execution-columns" aria-hidden="true">
            <span>항목</span>
            <span>실제 / 예산</span>
            <span>사용률</span>
            <span>결과</span>
          </div>
          <div className="budget-execution-list">
            {budgetExecution.items.map((item) => {
              const itemRate = item.planned > 0 ? (item.actual / item.planned) * 100 : null
              const difference = item.planned - item.actual
              const itemTone =
                item.type === 'unplanned' || (item.planned <= 0 && item.actual > 0)
                  ? 'unplanned'
                  : difference < 0
                    ? 'over'
                    : item.planned <= 0
                      ? 'neutral'
                      : 'good'
              const resultLabel =
                item.planned <= 0 && item.actual > 0
                  ? `미계획 ${formatKRW(item.actual)}`
                  : item.planned <= 0
                    ? '예산 입력 필요'
                    : difference < 0
                      ? `${formatKRW(Math.abs(difference))} 초과`
                      : `${formatKRW(difference)} 남음`
              return (
                <div
                  className={`budget-execution-row ${itemTone}`}
                  key={item.id}
                  style={{ '--budget-category-color': item.color }}
                >
                  <span className="budget-execution-category">
                    {item.type === 'fixed' ? (
                      <span className="budget-execution-fixed">
                        <i aria-hidden="true" />
                        고정지출
                      </span>
                    ) : (
                      <CategoryBadge category={item.name} icons={categoryIcons} />
                    )}
                    {item.type === 'unplanned' && <span className="mini-tag">미계획</span>}
                  </span>
                  <span className="budget-execution-amount">
                    <b>{formatKRW(item.actual)}</b>
                    <small>/ {item.planned > 0 ? formatKRW(item.planned) : '예산 없음'}</small>
                  </span>
                  <span className="budget-execution-item-progress">
                    <i aria-hidden="true">
                      <b
                        style={{
                          width: `${
                            itemRate == null
                              ? item.actual > 0 ? 100 : 0
                              : Math.min(100, itemRate)
                          }%`,
                        }}
                      />
                    </i>
                    <small>{itemRate == null ? '-' : `${Math.round(itemRate)}%`}</small>
                  </span>
                  <strong>{resultLabel}</strong>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

function installmentBadgeTone(dateStr) {
  const days = daysUntilInstallmentDue(dateStr)
  if (days == null) return ''
  if (days < 0) return ' expired'
  if (days <= 30) return ' soon'
  return ''
}

function pct(value, max) {
  return max > 0 ? Math.min(100, (value / max) * 100) : 0
}

function methodName(methods, id, fallback) {
  return methods.find((method) => method.id === id)?.name || fallback || '미지정'
}

function methodProductLabel(method) {
  return [method.cardProductIssuer, method.cardProductName].filter(Boolean).join(' · ')
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
  fixedIncomeItems = [],
  categories = [],
  categoryIcons = {},
  paymentMethods,
  updatePaymentMethod,
  replacePaymentMethod,
}) {
  const [rawExpensePlan, setRawExpensePlan] = useStoredSlice(
    STORE_PATHS.settings.expensePlan,
    defaultExpensePlanSettings
  )
  const expensePlan = useMemo(() => normalizeExpensePlanSettings(rawExpensePlan), [rawExpensePlan])
  const updateExpensePlan = (updater) => {
    setRawExpensePlan((current) =>
      normalizeExpensePlanSettings(
        typeof updater === 'function' ? updater(normalizeExpensePlanSettings(current)) : updater
      )
    )
  }
  const totalFixedIncome = useMemo(
    () => fixedIncomeItems.reduce((sum, it) => sum + (Number(it?.amount) || 0), 0),
    [fixedIncomeItems]
  )
  const [budgetPlanCollapsed, setBudgetPlanCollapsed] = useState(false)
  const [fixedBundleExpanded, setFixedBundleExpanded] = useState(false)
  const fixedBundleMembers = useMemo(
    () =>
      fixedItems
        .filter(Boolean)
        .map((it) => ({
          id: it.id,
          name: it.name || '(이름 없음)',
          amount: Number(it.amount) || 0,
          color: it.color,
          category: it.category || '',
        })),
    [fixedItems]
  )
  const fixedBundleTotal = useMemo(
    () => fixedBundleMembers.reduce((sum, it) => sum + it.amount, 0),
    [fixedBundleMembers]
  )
  const fixedSavingsTotal = useMemo(
    () =>
      fixedBundleMembers
        .filter((it) => it.category === '저축')
        .reduce((sum, it) => sum + it.amount, 0),
    [fixedBundleMembers]
  )
  const fixedOtherTotal = fixedBundleTotal - fixedSavingsTotal
  const budgetCategories = useMemo(
    () => [...new Set(categories.map((category) => String(category || '').trim()).filter(Boolean))],
    [categories]
  )
  const usedBudgetCategories = useMemo(
    () => new Set(expensePlan.customItems.map((item) => item.name).filter(Boolean)),
    [expensePlan.customItems]
  )
  const availableBudgetCategoryOptions = useMemo(
    () =>
      budgetCategories
        .filter((category) => !usedBudgetCategories.has(category))
        .map((category) => ({
          value: category,
          label: [categoryIcon(category, categoryIcons), category].filter(Boolean).join(' '),
        })),
    [budgetCategories, categoryIcons, usedBudgetCategories]
  )
  const allocatedTotal = useMemo(
    () =>
      fixedBundleTotal +
      expensePlan.customItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    [expensePlan.customItems, fixedBundleTotal]
  )
  const customAllocatedTotal = allocatedTotal - fixedBundleTotal
  const unallocated = totalFixedIncome - allocatedTotal
  const allocationRate = totalFixedIncome > 0 ? (allocatedTotal / totalFixedIncome) * 100 : 0
  const allocationProgress = Math.min(100, Math.max(0, allocationRate))
  const allocationRateLabel = Math.round(allocationRate)
  const budgetStatus =
    unallocated < 0
      ? { tone: 'over', label: '예산을 초과했어요' }
      : unallocated === 0
        ? { tone: 'complete', label: '배분을 완료했어요' }
        : allocationRate >= 80
          ? { tone: 'near', label: '거의 다 배분했어요' }
          : null
  const budgetPieData = useMemo(() => {
    const slices = []
    if (fixedBundleExpanded) {
      fixedBundleMembers
        .filter((member) => member.amount > 0)
        .forEach((member, index) =>
          slices.push({
            id: `fixed-${member.id}`,
            name: member.name,
            value: member.amount,
            group: member.category === '저축' ? 'savings' : 'fixed',
            color: member.color || BUDGET_PIE_COLORS[index % BUDGET_PIE_COLORS.length],
          })
        )
    } else {
      if (fixedOtherTotal > 0) {
        slices.push({
          id: 'fixed',
          name: '고정지출',
          value: fixedOtherTotal,
          group: 'fixed',
          color: '#ef4444',
        })
      }
      if (fixedSavingsTotal > 0) {
        slices.push({
          id: 'fixed-savings',
          name: '저축',
          value: fixedSavingsTotal,
          group: 'savings',
          color: '#ef6644',
        })
      }
    }
    expensePlan.customItems
      .filter((item) => item.amount > 0)
      .forEach((item, index) =>
        slices.push({
          id: item.id,
          name: item.name || '(이름 없음)',
          value: item.amount,
          group: 'custom',
          color: categoryColor(item.name) || BUDGET_PIE_COLORS[(index + 2) % BUDGET_PIE_COLORS.length],
        })
      )
    if (unallocated > 0) {
      slices.push({
        id: 'unallocated',
        name: '미배정',
        value: unallocated,
        group: 'unallocated',
        color: BUDGET_UNALLOCATED_COLOR,
      })
    }
    return slices
  }, [
    expensePlan.customItems,
    fixedBundleExpanded,
    fixedBundleMembers,
    fixedOtherTotal,
    fixedSavingsTotal,
    unallocated,
  ])

  function addBudgetItem(name = '') {
    const category = String(name || '').trim()
    if (!category || !budgetCategories.includes(category)) return
    updateExpensePlan((current) => ({
      ...current,
      customItems: current.customItems.some((item) => item.name === category)
        ? current.customItems
        : [...current.customItems, { id: createId(), name: category, amount: 0 }],
    }))
  }

  function updateBudgetItem(id, patch) {
    updateExpensePlan((current) => ({
      ...current,
      customItems: current.customItems.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }))
  }

  function removeBudgetItem(id) {
    updateExpensePlan((current) => ({
      ...current,
      customItems: current.customItems.filter((item) => item.id !== id),
    }))
  }

  function budgetCategoryOptionsFor(item) {
    const options = budgetCategories
      .filter(
        (category) =>
          category === item.name ||
          !expensePlan.customItems.some(
            (otherItem) => otherItem.id !== item.id && otherItem.name === category
          )
      )
      .map((category) => ({
        value: category,
        label: [categoryIcon(category, categoryIcons), category].filter(Boolean).join(' '),
      }))

    if (item.name && !budgetCategories.includes(item.name)) {
      options.unshift({
        value: item.name,
        label: `${item.name} · 이전 항목`,
      })
    }
    return options
  }

  const [month, setMonth] = useState(() => todayStr().slice(0, 7))
  const [year, setYear] = useState(() => todayStr().slice(0, 4))
  const [periodMode, setPeriodMode] = useState('month')
  const [historyCollapsed, setHistoryCollapsed] = useState(true)
  const [historySearch, setHistorySearch] = useState('')
  const [historySort, setHistorySort] = useState({ key: 'date', direction: 'desc' })
  const [categorySpendExpanded, setCategorySpendExpanded] = useState(false)
  const [selectedMethodKey, setSelectedMethodKey] = useState('')
  const [replaceTargetId, setReplaceTargetId] = useState('')
  const methods = paymentMethods.items
  const periodLabel = periodMode === 'year' ? `${year}년` : month
  const limitMultiplier = periodMode === 'year' ? 12 : 1
  const currentMonth = todayStr().slice(0, 7)

  const fixedRows = useMemo(
    () => {
      const months = (periodMode === 'year' ? monthsOfYear(year) : [month]).filter(
        (targetMonth) => targetMonth <= currentMonth
      )
      const rows = months.flatMap((targetMonth) => {
        const records = fixedRecords.filter((record) => record.month === targetMonth)
        if (records.length > 0) return fixedExpenseEntriesFromRecords(records, methods)
        if (targetMonth === currentMonth) {
          return fixedExpenseEntriesForMonth(fixedItems, targetMonth, methods)
        }
        return []
      })
      return reconcileFixedExpenseEntries(rows, entries).unsettledEntries
    },
    [currentMonth, entries, fixedItems, fixedRecords, methods, month, periodMode, year]
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
  const budgetExecution = useMemo(() => {
    const plannedMultiplier = periodMode === 'year' ? 12 : 1
    const plannedCategoryNames = new Set(
      expensePlan.customItems.map((item) => item.name).filter(Boolean)
    )
    const actualByCategory = new Map()
    const unplannedByCategory = new Map()
    let fixedActual = 0

    rows.forEach((row) => {
      const amount = Number(row.amount) || 0
      if (row.fixedId) {
        fixedActual += amount
        return
      }
      const category = row.category || '미분류'
      const target = plannedCategoryNames.has(category) ? actualByCategory : unplannedByCategory
      target.set(category, (target.get(category) || 0) + amount)
    })

    const items = []
    const fixedPlan = fixedBundleTotal * plannedMultiplier
    if (fixedPlan > 0 || fixedActual > 0) {
      items.push({
        id: 'fixed',
        name: '고정지출',
        type: 'fixed',
        planned: fixedPlan,
        actual: fixedActual,
        color: '#ef4444',
      })
    }
    expensePlan.customItems.forEach((item) => {
      items.push({
        id: item.id,
        name: item.name || '이름 없는 예산',
        type: 'category',
        planned: (Number(item.amount) || 0) * plannedMultiplier,
        actual: actualByCategory.get(item.name) || 0,
        color: categoryColor(item.name),
      })
    })
    ;[...unplannedByCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, actual]) => {
        if (actual <= 0) return
        items.push({
          id: `unplanned-${name}`,
          name,
          type: 'unplanned',
          planned: 0,
          actual,
          color: categoryColor(name),
        })
      })

    const planned = allocatedTotal * plannedMultiplier
    const remaining = planned - total
    const rate = planned > 0 ? (total / planned) * 100 : total > 0 ? null : 0
    const tone =
      planned <= 0 && total > 0
        ? 'over'
        : total > planned
          ? 'over'
          : 'good'
    const label =
      planned <= 0 && total > 0
        ? '예산 등록 필요'
        : total > planned
          ? '예산 초과'
          : '예산 범위 내'

    return { items, planned, actual: total, remaining, rate, tone, label, plannedMultiplier }
  }, [allocatedTotal, expensePlan.customItems, fixedBundleTotal, periodMode, rows, total])
  const allExpenseListRows = rows
  const expenseListRows = useMemo(() => {
    const query = historySearch.trim().toLowerCase()
    const filtered = !query
      ? allExpenseListRows
      : allExpenseListRows.filter((row) => {
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

    return sortTransactionRows(filtered, historySort, (row) =>
      methodName(methods, row.paymentMethodId, row.paymentMethod)
    )
  }, [allExpenseListRows, historySearch, historySort, methods])

  const methodCards = useMemo(() => {
    const spentById = new Map()
    const usageByKey = new Map()
    const ensureUsage = (key, seed) => {
      if (!usageByKey.has(key)) {
        usageByKey.set(key, {
          key,
          amount: 0,
          count: 0,
          latestDate: '',
          ...seed,
        })
      }
      return usageByKey.get(key)
    }
    rows.forEach((row) => {
      const id = row.paymentMethodId || ''
      spentById.set(id, (spentById.get(id) || 0) + (Number(row.amount) || 0))
      const configuredMethod = methods.find((method) => method.id === id)
      const key = configuredMethod
        ? `method:${configuredMethod.id}`
        : id
          ? `orphan:${id}`
          : 'unknown'
      const usage = ensureUsage(key, {
        type: configuredMethod ? 'configured' : id ? 'orphan' : 'unknown',
        rawPaymentMethodId: id,
        rawPaymentMethodName: row.paymentMethod || '',
      })
      usage.amount += Number(row.amount) || 0
      usage.count += 1
      if ((row.date || '') > usage.latestDate) usage.latestDate = row.date || ''
    })
    const configuredIds = new Set(methods.map((method) => method.id))
    const configured = methods.map((method) => ({
      ...method,
      key: `method:${method.id}`,
      type: 'configured',
      rawPaymentMethodId: method.id,
      rawPaymentMethodName: method.name,
      count: usageByKey.get(`method:${method.id}`)?.count || 0,
      latestDate: usageByKey.get(`method:${method.id}`)?.latestDate || '',
      amount: spentById.get(method.id) || 0,
      limitAmount: method.monthlyLimit ? Number(method.monthlyLimit) * limitMultiplier : '',
      targetAmount: method.monthlyTarget ? Number(method.monthlyTarget) * limitMultiplier : '',
    }))
    const orphan = [...usageByKey.values()].filter(
      (usage) => usage.type === 'orphan' && !configuredIds.has(usage.rawPaymentMethodId)
    ).map((usage) => ({
      key: usage.key,
      id: usage.rawPaymentMethodId,
      type: 'orphan',
      rawPaymentMethodId: usage.rawPaymentMethodId,
      rawPaymentMethodName: usage.rawPaymentMethodName,
      name: usage.rawPaymentMethodName || '삭제된 결제수단',
      kind: '삭제됨',
      annualFee: '',
      monthlyLimit: '',
      monthlyTarget: '',
      limitAmount: '',
      targetAmount: '',
      amount: usage.amount,
      count: usage.count,
      latestDate: usage.latestDate,
    }))
    const unknown = usageByKey.get('unknown')
    return unknown?.amount > 0
      ? [
          ...configured,
          ...orphan,
          {
            key: 'unknown',
            id: '',
            type: 'unknown',
            rawPaymentMethodId: '',
            rawPaymentMethodName: '',
            name: '미지정',
            kind: '기타',
            annualFee: '',
            monthlyLimit: '',
            monthlyTarget: '',
            limitAmount: '',
            targetAmount: '',
            amount: unknown.amount,
            count: unknown.count,
            latestDate: unknown.latestDate,
          },
        ]
      : [...configured, ...orphan]
  }, [limitMultiplier, methods, rows])

  const selectedMethod = useMemo(
    () => methodCards.find((method) => method.key === selectedMethodKey) || null,
    [methodCards, selectedMethodKey]
  )
  const selectedMethodRows = useMemo(() => {
    if (!selectedMethod) return []
    const selectedId = selectedMethod.rawPaymentMethodId || ''
    return rows
      .filter((row) => (row.paymentMethodId || '') === selectedId)
      .sort(
        (a, b) =>
          (b.date || '').localeCompare(a.date || '') ||
          (Number(b.amount) || 0) - (Number(a.amount) || 0)
      )
  }, [rows, selectedMethod])
  const selectedConfiguredMethod = selectedMethod?.type === 'configured'
    ? methods.find((method) => method.id === selectedMethod.rawPaymentMethodId)
    : null
  const replaceOptions = useMemo(
    () =>
      methods
        .filter((method) => method.id !== selectedMethod?.rawPaymentMethodId)
        .map((method) => ({ value: method.id, label: method.name })),
    [methods, selectedMethod]
  )

  const topCategory = byCategory[0]

  useEffect(() => {
    if (!selectedMethodKey) return
    if (!methodCards.some((method) => method.key === selectedMethodKey)) {
      setSelectedMethodKey('')
      setReplaceTargetId('')
    }
  }, [methodCards, selectedMethodKey])

  function toggleMethodCard(method) {
    setSelectedMethodKey((current) => (current === method.key ? '' : method.key))
    setReplaceTargetId('')
  }

  function handleMethodContextMenu(e, method) {
    if (method.type !== 'configured' || !paymentMethods?.removeItem) return
    e.preventDefault()
    if (!window.confirm(`결제수단 '${method.name}'을(를) 삭제할까요?`)) return
    withUndo(`결제수단 '${method.name}' 삭제`, () => paymentMethods.removeItem(method.id))
    if (selectedMethodKey === method.key) setSelectedMethodKey('')
  }

  function applyPaymentMethodReplace() {
    if (!selectedMethod || !replaceTargetId || !replacePaymentMethod) return
    const target = methods.find((method) => method.id === replaceTargetId)
    if (!target) return
    const ok = window.confirm(
      `'${selectedMethod.name}' 결제수단으로 기록된 지출과 고정지출을 '${target.name}'(으)로 모두 옮길까요?`
    )
    if (!ok) return
    if (
      replacePaymentMethod(
        selectedMethod.rawPaymentMethodId,
        target.id,
        selectedMethod.rawPaymentMethodName || selectedMethod.name
      )
    ) {
      setSelectedMethodKey(`method:${target.id}`)
      setReplaceTargetId('')
    }
  }

  function sortHistoryBy(key) {
    setHistorySort((current) => nextTransactionSort(current, key))
  }

  return (
    <div className="stage expense-management" style={{ '--accent': EXPENSE_COLOR }}>
      <div className="management-head">
        <div>
          <h2 className="section-title">지출 관리</h2>
          <p>결제수단과 카테고리 기준으로 선택한 기간의 지출 흐름을 봅니다.</p>
        </div>
        <div className="management-head-actions">
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
      </div>

      <div className="card budget-plan-card">
        <div className="budget-plan-head">
          <div>
            <div className="budget-plan-kicker">
              <span className="budget-plan-kicker-icon" aria-hidden="true">₩</span>
              <span>MONTHLY BUDGET</span>
            </div>
          </div>
          <div className="budget-plan-head-actions">
            {(totalFixedIncome <= 0 || budgetStatus) && (
              <span className={`budget-plan-status ${totalFixedIncome <= 0 ? 'empty' : budgetStatus.tone}`}>
                <i aria-hidden="true" />
                {totalFixedIncome <= 0 ? '계획 시작 전' : budgetStatus.label}
              </span>
            )}
            <button
              type="button"
              className={`budget-plan-collapse${budgetPlanCollapsed ? ' collapsed' : ''}`}
              onClick={() => setBudgetPlanCollapsed((collapsed) => !collapsed)}
              aria-expanded={!budgetPlanCollapsed}
              aria-label={`MONTHLY BUDGET ${budgetPlanCollapsed ? '펼치기' : '접기'}`}
            >
              <span>{budgetPlanCollapsed ? '펼치기' : '접기'}</span>
              <i aria-hidden="true">›</i>
            </button>
          </div>
        </div>
        {budgetPlanCollapsed ? (
          <div className="budget-plan-collapsed-summary">
            <div>
              <span>월 고정수입</span>
              <b>{formatKRW(totalFixedIncome)}</b>
            </div>
            <div>
              <span>배분 예산</span>
              <b>{formatKRW(allocatedTotal)}</b>
            </div>
            <div className={unallocated < 0 ? 'over' : 'remaining'}>
              <span>{unallocated < 0 ? '초과 금액' : '남은 예산'}</span>
              <b>{formatKRW(Math.abs(unallocated))}</b>
            </div>
            <small>{allocationRateLabel}% 배분</small>
          </div>
        ) : totalFixedIncome <= 0 ? (
          <div className="budget-plan-empty">
            <span className="budget-plan-empty-icon" aria-hidden="true">₩</span>
            <strong>먼저 월 고정수입을 등록해 주세요</strong>
            <p>수입 관리에서 월 고정수입을 추가하면 이곳에서 자동으로 예산을 나눌 수 있어요.</p>
          </div>
        ) : (
          <>
            <div className="budget-plan-overview">
              <div className="budget-plan-income">
                <span>이번 달 예산 기준</span>
                <strong>{formatKRW(totalFixedIncome)}</strong>
                <small>등록한 월 고정수입의 합계예요.</small>
              </div>
              <div className="budget-plan-progress">
                <div className="budget-plan-progress-head">
                  <span>예산 배분률</span>
                  <strong className={unallocated < 0 ? 'over' : ''}>
                    {allocationRateLabel}%
                  </strong>
                </div>
                <div
                  className={`budget-plan-progress-track${unallocated < 0 ? ' over' : ''}`}
                  role="progressbar"
                  aria-label="예산 배분률"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={Math.min(100, allocationRateLabel)}
                >
                  <i style={{ width: `${allocationProgress}%` }} />
                </div>
                <p>
                  {unallocated < 0
                    ? `${formatKRW(Math.abs(unallocated))}만큼 계획을 줄이면 수입 안에 들어와요.`
                    : `${formatKRW(unallocated)}을(를) 더 배분할 수 있어요.`}
                </p>
              </div>
              <div className="budget-plan-stats">
                <div className="budget-plan-stat">
                  <span>고정지출</span>
                  <b>{formatKRW(fixedBundleTotal)}</b>
                </div>
                <div className="budget-plan-stat">
                  <span>카테고리 예산</span>
                  <b>{formatKRW(customAllocatedTotal)}</b>
                </div>
                <div className={`budget-plan-stat${unallocated < 0 ? ' over' : ''}`}>
                  <span>{unallocated < 0 ? '초과 금액' : '남은 예산'}</span>
                  <b>{formatKRW(Math.abs(unallocated))}</b>
                </div>
              </div>
            </div>

            <div className="budget-plan-body">
              <section className="budget-plan-visual" aria-labelledby="budget-allocation-title">
                <div className="budget-plan-panel-head">
                  <div>
                    <span>배분 구조</span>
                    <h3 id="budget-allocation-title">월 수입 사용 계획</h3>
                  </div>
                  <span className="budget-plan-count">
                    {expensePlan.customItems.length +
                      (fixedOtherTotal > 0 ? 1 : 0) +
                      (fixedSavingsTotal > 0 ? 1 : 0)}
                    개 항목
                  </span>
                </div>
                <div className="budget-plan-chart">
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={budgetPieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={72}
                        outerRadius={104}
                        paddingAngle={2}
                        stroke="none"
                        onClick={(entry) => {
                          if (entry?.group === 'fixed' || entry?.group === 'savings')
                            setFixedBundleExpanded((expanded) => !expanded)
                        }}
                      >
                        {budgetPieData.map((entry) => (
                          <Cell key={entry.id} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={<BudgetPlanTooltip total={totalFixedIncome} />}
                        cursor={false}
                        wrapperStyle={{ zIndex: 5, outline: 'none' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className={`budget-plan-chart-center${unallocated < 0 ? ' over' : ''}`}>
                    <span>{unallocated < 0 ? '예산 초과' : '남은 예산'}</span>
                    <strong>{formatKRW(Math.abs(unallocated))}</strong>
                    <small>{allocationRateLabel}% 배분</small>
                  </div>
                </div>
                <p className="budget-plan-chart-hint">
                  조각에 마우스를 올리면 상세 금액을, 고정지출을 누르면 세부 항목을 볼 수 있어요.
                </p>
              </section>

              <section className="budget-plan-editor" aria-labelledby="budget-editor-title">
                <div className="budget-plan-panel-head">
                  <div>
                    <span>예산 편집</span>
                    <h3 id="budget-editor-title">항목별 계획 금액</h3>
                  </div>
                  <span className="budget-plan-auto-save">자동 저장</span>
                </div>

                <div className="budget-plan-list">
                <div className="budget-plan-row budget-plan-row-fixed">
                    <span className="budget-plan-row-dot fixed" aria-hidden="true" />
                    <span className="budget-plan-row-name">
                      <b>고정지출</b>
                      <small>등록 항목 자동 반영</small>
                    </span>
                    <span className="budget-plan-row-amount">{formatKRW(fixedBundleTotal)}</span>
                    <button
                      type="button"
                      className={`budget-plan-detail-toggle${fixedBundleExpanded ? ' open' : ''}`}
                      onClick={() => setFixedBundleExpanded((expanded) => !expanded)}
                      aria-label="고정지출 상세 항목 보기"
                      aria-expanded={fixedBundleExpanded}
                    >
                      ›
                    </button>
                  </div>
                  {fixedBundleExpanded && fixedBundleMembers.length > 0 && (
                    <div className="budget-plan-fixed-detail">
                      {fixedBundleMembers.map((member) => (
                        <div key={member.id}>
                          <span
                            className="budget-plan-row-dot"
                            style={{ background: member.color || 'var(--accent)' }}
                            aria-hidden="true"
                          />
                          <span>{member.name}</span>
                          <b>{formatKRW(member.amount)}</b>
                        </div>
                      ))}
                    </div>
                  )}

                  {expensePlan.customItems.map((item, index) => (
                    <div className="budget-plan-row" key={item.id}>
                      <span
                        className="budget-plan-row-dot"
                        style={{
                          background:
                            categoryColor(item.name) ||
                            BUDGET_PIE_COLORS[(index + 2) % BUDGET_PIE_COLORS.length],
                        }}
                        aria-hidden="true"
                      />
                      <div className="budget-plan-category-picker">
                        <Picker
                          ariaLabel={`${item.name || '예산 항목'} 카테고리`}
                          placeholder="카테고리 선택"
                          options={budgetCategoryOptionsFor(item)}
                          value={item.name}
                          onChange={(name) => updateBudgetItem(item.id, { name })}
                        />
                      </div>
                      <div className="budget-plan-amount-input">
                        <NumberInput
                          min="0"
                          step="1"
                          decimal={false}
                          amount
                          aria-label={`${item.name || '예산 항목'} 계획 금액`}
                          placeholder="0"
                          value={item.amount ? String(item.amount) : ''}
                          onChange={(value) => updateBudgetItem(item.id, { amount: parseAmountInput(value) })}
                        />
                        <span>원</span>
                      </div>
                      <button
                        type="button"
                        className="budget-plan-remove"
                        onClick={() => removeBudgetItem(item.id)}
                        aria-label={`${item.name || '항목'} 삭제`}
                        title="항목 삭제"
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  {expensePlan.customItems.length === 0 && (
                    <div className="budget-plan-list-empty">
                      기존 지출 카테고리에서 예산 항목을 추가해 보세요.
                    </div>
                  )}

                  <div className="budget-plan-category-add">
                    <div>
                      <strong>카테고리 예산 추가</strong>
                      <span>지출 관리에 등록된 카테고리만 표시됩니다.</span>
                    </div>
                    {availableBudgetCategoryOptions.length > 0 ? (
                      <Picker
                        ariaLabel="예산에 추가할 지출 카테고리"
                        placeholder="+ 카테고리 선택"
                        options={availableBudgetCategoryOptions}
                        value=""
                        onChange={addBudgetItem}
                      />
                    ) : (
                      <span className="budget-plan-categories-complete">
                        모든 카테고리를 추가했습니다.
                      </span>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </>
        )}
      </div>

      {totalFixedIncome > 0 && (
        <BudgetExecutionWidget
          budgetExecution={budgetExecution}
          periodLabel={periodLabel}
          categoryIcons={categoryIcons}
        />
      )}

      <div className="expense-management-grid">
        <div className="card method-usage-panel">
          <div className="method-usage-panel-head">
            <div>
              <h2 className="section-title">결제수단별 사용</h2>
              <p>{periodLabel} · {methodCards.length}개 결제수단 · 결제수단 우클릭 시 삭제</p>
            </div>
            <div className="method-usage-total">
              <span>총 사용</span>
              <strong>{formatKRW(total)}</strong>
            </div>
          </div>
          <div className="method-usage-list">
            {methodCards.length === 0 ? (
              <div className="empty" style={{ padding: '36px 10px' }}>결제수단을 추가해 주세요.</div>
            ) : (
              <>
                <div className="method-usage-columns" aria-hidden="true">
                  <span>결제수단</span>
                  <span>사용액</span>
                  <span>한도</span>
                  <span>실적</span>
                  <span />
                </div>
                {methodCards.map((method, index) => {
                  const isSelected = selectedMethodKey === method.key
                  const productText = methodProductLabel(method)
                  const methodMeta = [method.kind, productText].filter(Boolean).join(' · ')
                  const limitRate = method.limitAmount
                    ? Math.round((method.amount / method.limitAmount) * 100)
                    : 0
                  const targetRate = method.targetAmount
                    ? Math.round((method.amount / method.targetAmount) * 100)
                    : 0
                  return (
                    <div
                      className={`method-usage-card${isSelected ? ' selected' : ''}`}
                      key={method.key}
                      style={{ '--method-color': BUDGET_PIE_COLORS[index % BUDGET_PIE_COLORS.length] }}
                      onContextMenu={(e) => handleMethodContextMenu(e, method)}
                    >
                      <button
                        type="button"
                        className="method-usage-summary"
                        onClick={() => toggleMethodCard(method)}
                        aria-expanded={isSelected}
                  >
                    <span className="method-usage-identity">
                      <i className="method-usage-avatar" aria-hidden="true">
                        {(method.name || '?').trim().slice(0, 1)}
                      </i>
                      <span>
                        <b>{method.name}</b>
                        <small title={methodMeta}>{methodMeta || '결제수단 정보 없음'}</small>
                      </span>
                    </span>
                    <span className="method-usage-spend">
                      <strong>{formatKRW(method.amount)}</strong>
                      <small>전체 {pct(method.amount, total).toFixed(0)}%</small>
                    </span>
                    <span className={`method-usage-metric${limitRate > 100 ? ' over' : ''}`}>
                      <span>
                        <small>한도</small>
                        <b>{method.limitAmount ? `${limitRate}%` : '-'}</b>
                      </span>
                      <i>
                        <b style={{ width: `${pct(method.amount, method.limitAmount)}%` }} />
                      </i>
                    </span>
                    <span className={`method-usage-metric target${targetRate >= 100 ? ' met' : ''}`}>
                      <span>
                        <small>실적</small>
                        <b>
                          {method.targetAmount
                            ? targetRate >= 100 ? '달성' : `${targetRate}%`
                            : '-'}
                        </b>
                      </span>
                      <i>
                        <b style={{ width: `${pct(method.amount, method.targetAmount)}%` }} />
                      </i>
                    </span>
                    <span className={`method-usage-chevron${isSelected ? ' open' : ''}`} aria-hidden="true">
                      ›
                    </span>
                    <span className="method-usage-hover-card" aria-hidden="true">
                      <span className="method-usage-hover-title">
                        <b>{method.name}</b>
                        <small>{methodMeta || '결제수단 정보 없음'}</small>
                      </span>
                      <span className="method-usage-hover-metrics">
                        <span>
                          <small>사용</small>
                          <b>{formatKRW(method.amount)}</b>
                        </span>
                        <span>
                          <small>비중</small>
                          <b>{pct(method.amount, total).toFixed(0)}%</b>
                        </span>
                        <span>
                          <small>건수</small>
                          <b>{method.count || 0}건</b>
                        </span>
                        <span>
                          <small>최근</small>
                          <b>{method.latestDate || '-'}</b>
                        </span>
                      </span>
                    </span>
                      </button>
                      {isSelected && (
                        <div className="method-usage-detail">
                      <div className="method-usage-detail-grid">
                        <div>
                          <span>사용 건수</span>
                          <b>{method.count || 0}건</b>
                        </div>
                        <div>
                          <span>최근 사용</span>
                          <b>{method.latestDate || '-'}</b>
                        </div>
                        <div>
                          <span>월 한도</span>
                          <b>{method.monthlyLimit ? formatKRW(method.monthlyLimit) : '-'}</b>
                        </div>
                        <div>
                          <span>월 실적</span>
                          <b>{method.monthlyTarget ? formatKRW(method.monthlyTarget) : '-'}</b>
                        </div>
                      </div>
                      <section className="method-expense-history" aria-label={`${method.name} 지출 내역`}>
                        <div className="method-expense-history-head">
                          <div>
                            <h3>이 결제수단의 지출</h3>
                            <span>{periodLabel} · {selectedMethodRows.length}건</span>
                          </div>
                          <strong>{formatKRW(method.amount)}</strong>
                        </div>
                        {selectedMethodRows.length === 0 ? (
                          <div className="method-expense-history-empty">
                            선택한 기간의 지출 내역이 없습니다.
                          </div>
                        ) : (
                          <div className="method-expense-history-list">
                            {selectedMethodRows.map((row, rowIndex) => (
                              <div
                                className="method-expense-history-row"
                                key={`${row.id || 'expense'}-${row.date}-${rowIndex}`}
                              >
                                <time dateTime={row.date || undefined}>{row.date || '-'}</time>
                                <span className="method-expense-history-category">
                                  <CategoryBadge category={row.category} icons={categoryIcons} />
                                  {row.fixedId && <span className="mini-tag">고정</span>}
                                </span>
                                <span className="method-expense-history-memo">
                                  {row.memo || (row.fixedId ? '고정지출' : '메모 없음')}
                                </span>
                                <strong>{formatKRW(row.amount)}</strong>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                      {method.cardProductSourceUrl && (
                        <a
                          className="method-product-link"
                          href={method.cardProductSourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          카드 상품 보기
                        </a>
                      )}
                      {replacePaymentMethod && replaceOptions.length > 0 && (
                        <div className="method-replace-panel">
                          <div className="payment-field">
                            <span>사용내역 이동</span>
                            <Picker
                              value={replaceTargetId}
                              options={replaceOptions}
                              placeholder="옮길 결제수단"
                              onChange={setReplaceTargetId}
                            />
                          </div>
                          <button
                            type="button"
                            className="btn btn-sm btn-accent"
                            disabled={!replaceTargetId}
                            onClick={applyPaymentMethodReplace}
                          >
                            모두 변경
                          </button>
                        </div>
                      )}
                      {selectedConfiguredMethod && updatePaymentMethod && (
                        <div className="method-edit-panel">
                          <PaymentMethodManager
                            key={selectedConfiguredMethod.id}
                            methods={methods}
                            updateMethod={updatePaymentMethod}
                            view="form"
                            initialEditId={selectedConfiguredMethod.id}
                            resetAfterSubmit={false}
                          />
                        </div>
                      )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>

        <div className="card category-spend-panel">
          <div className="category-spend-panel-head">
            <div>
              <h2 className="section-title">카테고리별 지출</h2>
              <p>{periodLabel} · {byCategory.length}개 카테고리</p>
            </div>
            {topCategory && (
              <div className="category-spend-top">
                <span>가장 큰 지출</span>
                <strong>{topCategory.name}</strong>
              </div>
            )}
          </div>
          <div className="category-spend-list">
            {byCategory.length === 0 ? (
              <div className="empty" style={{ padding: '36px 10px' }}>선택한 기간의 지출이 없습니다.</div>
            ) : (
              (categorySpendExpanded ? byCategory : byCategory.slice(0, 8)).map((row, index) => {
                const share = total > 0 ? (row.amount / total) * 100 : 0
                const color = categoryColor(row.name)
                return (
                  <div
                    className="category-spend-row"
                    key={row.name}
                    style={{ '--category-color': color }}
                  >
                    <span className="category-spend-rank">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="category-spend-name">
                      <span className="category-spend-icon" aria-hidden="true">
                        {categoryIcon(row.name, categoryIcons) || '—'}
                      </span>
                      <b title={row.name}>{row.name}</b>
                    </span>
                    <span className="category-spend-share">{share.toFixed(1)}%</span>
                    <strong className="category-spend-amount">{formatKRW(row.amount)}</strong>
                    <span className="category-spend-bar" aria-hidden="true">
                      <i style={{ width: `${pct(row.amount, byCategory[0].amount)}%` }} />
                    </span>
                  </div>
                )
              })
            )}
          </div>
          {byCategory.length > 8 && (
            <button
              type="button"
              className="category-spend-more"
              onClick={() => setCategorySpendExpanded((expanded) => !expanded)}
              aria-expanded={categorySpendExpanded}
            >
              <span>
                {categorySpendExpanded ? '접기' : `더보기 (${byCategory.length - 8}개)`}
              </span>
              <span className={categorySpendExpanded ? 'open' : ''} aria-hidden="true">⌄</span>
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <button
          type="button"
          className="fixed-toggle"
          onClick={() => setHistoryCollapsed((collapsed) => !collapsed)}
          aria-expanded={!historyCollapsed}
        >
          <span className={`chevron${historyCollapsed ? '' : ' open'}`}>▶</span>
          <h2 className="section-title" style={{ margin: 0 }}>지출 내역</h2>
        </button>
        {!historyCollapsed && (
          <>
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
                      <SortableHeader
                        label="날짜"
                        sortKey="date"
                        sort={historySort}
                        onSort={sortHistoryBy}
                      />
                      <SortableHeader
                        label="카테고리"
                        sortKey="category"
                        sort={historySort}
                        onSort={sortHistoryBy}
                      />
                      <SortableHeader
                        label="결제수단"
                        sortKey="paymentMethod"
                        sort={historySort}
                        onSort={sortHistoryBy}
                      />
                      <SortableHeader
                        label="금액"
                        sortKey="amount"
                        sort={historySort}
                        onSort={sortHistoryBy}
                        align="right"
                      />
                      <SortableHeader
                        label="메모"
                        sortKey="memo"
                        sort={historySort}
                        onSort={sortHistoryBy}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {expenseListRows.map((row, index) => (
                      <tr key={`${row.id || 'expense'}-${row.date}-${index}`}>
                        <td data-label="날짜">{row.date || '-'}</td>
                        <td data-label="카테고리">
                          <CategoryBadge category={row.category} icons={categoryIcons} />
                          {row.fixedId && <span className="mini-tag">고정</span>}
                          {row.installmentDueDate && (
                            <span className={`mini-tag${installmentBadgeTone(row.installmentDueDate)}`}>
                              할부 만료 {row.installmentDueDate}
                            </span>
                          )}
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
          </>
        )}
      </div>
    </div>
  )
}
