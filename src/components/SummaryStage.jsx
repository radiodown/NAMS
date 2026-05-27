import { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  ComposedChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
} from 'recharts'
import { formatKRW, compactKRW, monthOf, todayStr } from '../lib/format'
import { exchangeRateMap, projectAssets, stockMetrics, summarize } from '../lib/investments'
import { defaultGraphStageSettings, normalizeGraphStageSettings } from '../lib/schema'
import { useStoredSlice } from '../lib/store'
import { STORE_PATHS } from '../lib/storePaths'

const PIE_COLORS = [
  '#6366f1', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#ec4899',
  '#8b5cf6', '#14b8a6', '#f97316', '#84cc16', '#06b6d4', '#a855f7',
]
const KIND_COLORS = { 예금: '#0891b2', 적금: '#4f46e5', 주식: '#d97706', 비트코인: '#f97316', 자산: '#0f766e', 환율: '#059669' }
const DEFAULT_HORIZON_YEARS = 5
const MIN_HORIZON_YEARS = 1
const MAX_HORIZON_YEARS = 80
const MIN_WAGE_GROWTH = -10
const MAX_WAGE_GROWTH = 20
const MAX_EXPENSE_TREND_CATEGORIES = 5
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const roundToStep = (value, step = 0.5) => Math.round(value / step) * step

function aggregateMonths(entries) {
  const map = {}
  for (const e of entries) {
    const m = monthOf(e.date)
    if (!m) continue
    if (!map[m]) map[m] = { month: m, 수입: 0, 지출: 0 }
    if (map[m][e.type] != null) map[m][e.type] += e.amount
  }
  const months = Object.values(map).sort((a, b) => a.month.localeCompare(b.month))
  let cumulative = 0
  for (const m of months) {
    m.순수익 = m.수입 - m.지출
    cumulative += m.순수익
    m.누적현금 = cumulative
  }
  return months
}

function categoryBreakdown(entries, type) {
  const map = {}
  for (const e of entries) {
    if (e.type !== type) continue
    const c = e.category || '미분류'
    map[c] = (map[c] || 0) + e.amount
  }
  return Object.entries(map)
    .map(([name, value]) => ({ name, value }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
}

function averageMonthlyIncome(entries) {
  const map = {}
  for (const e of entries) {
    if (e.type !== '수입') continue
    const m = monthOf(e.date)
    if (!m) continue
    map[m] = (map[m] || 0) + e.amount
  }
  const values = Object.values(map).filter((amount) => amount > 0)
  if (values.length === 0) return 0
  return values.reduce((sum, amount) => sum + amount, 0) / values.length
}

const tooltipMoney = (value) => formatKRW(value)

function normalizeCategoryName(value) {
  return String(value ?? '').trim()
}

function expenseCategoryOptions(entries, selectedCategories = []) {
  const totals = new Map()
  entries.forEach((entry) => {
    if (entry.type !== '지출') return
    const category = normalizeCategoryName(entry.category) || '미분류'
    const amount = Number(entry.amount) || 0
    if (amount <= 0) return
    totals.set(category, (totals.get(category) || 0) + amount)
  })

  selectedCategories.forEach((category) => {
    const name = normalizeCategoryName(category)
    if (name && !totals.has(name)) totals.set(name, 0)
  })

  return [...totals.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
}

function buildExpenseCategoryTrend(entries, months, selectedCategories = [], limit = 5) {
  const totals = new Map()
  const byMonth = new Map()

  entries.forEach((entry) => {
    if (entry.type !== '지출') return
    const month = monthOf(entry.date)
    if (!month) return
    const category = normalizeCategoryName(entry.category) || '미분류'
    const amount = Number(entry.amount) || 0
    if (amount <= 0) return
    totals.set(category, (totals.get(category) || 0) + amount)
    if (!byMonth.has(month)) byMonth.set(month, {})
    const bucket = byMonth.get(month)
    bucket[category] = (bucket[category] || 0) + amount
  })

  const selected = [...new Set(selectedCategories.map(normalizeCategoryName).filter(Boolean))]
    .slice(0, limit)
  const categories =
    selected.length > 0
      ? selected
      : [...totals.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([name]) => name)

  const data = months.map(({ month }) => {
    const source = byMonth.get(month) || {}
    const row = { month }
    categories.forEach((category) => {
      row[category] = source[category] || 0
    })
    return row
  })

  return { categories, data }
}

function ProjectionEndpointLabel({ x, y, value, payload, index }) {
  const pointX = Number(x)
  const pointY = Number(y)
  if (!value || !Number.isFinite(pointX) || !Number.isFinite(pointY)) return null

  const isStart = payload?.projectionEndpoint === 'start' || index === 0
  const title = isStart ? '시작' : '예상'
  const valueText = String(value)
  const textWidth = Array.from(valueText).reduce(
    (sum, char) => sum + (/[\d.,+-]/.test(char) ? 6 : 12),
    0
  )
  const boxWidth = Math.max(62, textWidth + 24)
  const boxHeight = 42
  const boxX = isStart ? pointX + 12 : pointX - boxWidth - 12
  const showAbove = pointY > boxHeight + 24
  const boxY = showAbove ? pointY - boxHeight - 14 : pointY + 14
  const lineTargetY = showAbove ? boxY + boxHeight : boxY

  return (
    <g pointerEvents="none">
      <line
        x1={pointX}
        y1={pointY}
        x2={pointX}
        y2={lineTargetY}
        stroke="#7c3aed"
        strokeWidth={1.5}
        strokeDasharray="3 3"
        opacity={0.58}
      />
      <circle cx={pointX} cy={pointY} r={5.5} fill="#fff" stroke="#7c3aed" strokeWidth={2.5} />
      <circle cx={pointX} cy={pointY} r={2.5} fill="#7c3aed" />
      <rect
        x={boxX}
        y={boxY}
        width={boxWidth}
        height={boxHeight}
        rx={10}
        fill="var(--surface)"
        stroke="color-mix(in srgb, #7c3aed 30%, var(--border))"
        filter="drop-shadow(0 6px 12px rgba(15, 23, 42, 0.16))"
      />
      <text x={boxX + 12} y={boxY + 15} fill="#7c3aed" fontSize={10} fontWeight={900}>
        {title}
      </text>
      <text x={boxX + 12} y={boxY + 31} fill="var(--text)" fontSize={12} fontWeight={900}>
        {valueText}
      </text>
    </g>
  )
}

export default function SummaryStage({ entries, investments }) {
  const today = todayStr()
  const [expenseTrendSettingsOpen, setExpenseTrendSettingsOpen] = useState(false)
  const [rawGraphSettings, setGraphSettings] = useStoredSlice(
    STORE_PATHS.settings.graphStage,
    defaultGraphStageSettings
  )
  const graphSettings = useMemo(
    () => normalizeGraphStageSettings(rawGraphSettings),
    [rawGraphSettings]
  )
  const {
    pieType,
    year,
    horizonYears,
    investmentWeightOverride,
    annualReturnOverride,
    wageGrowth,
    monthlyIncomeInvestmentOverride,
    expenseTrendCategories,
  } = graphSettings

  function updateGraphSettings(patch) {
    setGraphSettings((prev) =>
      normalizeGraphStageSettings({
        ...defaultGraphStageSettings(),
        ...(prev && typeof prev === 'object' ? prev : {}),
        ...patch,
      })
    )
  }

  const years = useMemo(() => {
    const set = new Set()
    entries.forEach((e) => {
      const y = (e.date || '').slice(0, 4)
      if (y.length === 4) set.add(y)
    })
    return [...set].sort()
  }, [entries])

  const activeYear = year !== 'all' && !years.includes(year) ? 'all' : year
  const filtered = useMemo(
    () =>
      activeYear === 'all'
        ? entries
        : entries.filter((e) => (e.date || '').slice(0, 4) === activeYear),
    [entries, activeYear]
  )
  const months = useMemo(() => aggregateMonths(filtered), [filtered])
  const selectedExpenseTrendCategories = useMemo(
    () =>
      [...new Set(expenseTrendCategories.map(normalizeCategoryName).filter(Boolean))]
        .slice(0, MAX_EXPENSE_TREND_CATEGORIES),
    [expenseTrendCategories]
  )
  const expenseTrendCategoryOptions = useMemo(
    () => expenseCategoryOptions(entries, selectedExpenseTrendCategories),
    [entries, selectedExpenseTrendCategories]
  )
  const selectedExpenseTrendCategorySet = useMemo(
    () => new Set(selectedExpenseTrendCategories),
    [selectedExpenseTrendCategories]
  )
  const expenseCategoryTrend = useMemo(
    () =>
      buildExpenseCategoryTrend(
        filtered,
        months,
        selectedExpenseTrendCategories,
        MAX_EXPENSE_TREND_CATEGORIES
      ),
    [filtered, months, selectedExpenseTrendCategories]
  )

  function toggleExpenseTrendCategory(category) {
    const name = normalizeCategoryName(category)
    if (!name) return
    const exists = selectedExpenseTrendCategorySet.has(name)
    const next = exists
      ? selectedExpenseTrendCategories.filter((item) => item !== name)
      : [...selectedExpenseTrendCategories, name].slice(0, MAX_EXPENSE_TREND_CATEGORIES)
    updateGraphSettings({ expenseTrendCategories: next })
  }

  function clearExpenseTrendCategories() {
    updateGraphSettings({ expenseTrendCategories: [] })
  }

  const invest = useMemo(() => summarize(investments, today), [investments, today])

  const totals = useMemo(() => {
    let income = 0
    let expense = 0
    entries.forEach((e) => {
      if (e.type === '수입') income += e.amount
      else if (e.type === '지출') expense += e.amount
    })
    const cash = income - expense
    return { income, expense, cash, netWorth: cash + invest.current }
  }, [entries, invest])

  const defaultInvestmentWeight = useMemo(
    () => (totals.netWorth > 0 ? clamp(Math.round((invest.current / totals.netWorth) * 100), 0, 100) : 0),
    [invest.current, totals.netWorth]
  )
  const defaultAnnualReturn = useMemo(() => {
    const rates = exchangeRateMap(investments)
    const stocks = investments.filter((p) => p.kind === '주식').map((p) => stockMetrics(p, rates))
    const stockCurrent = stocks.reduce((sum, stock) => sum + stock.current, 0)
    if (stockCurrent <= 0) return 5
    const weightedReturn =
      stocks.reduce((sum, stock) => sum + stock.returnPct * stock.current, 0) / stockCurrent
    return clamp(roundToStep(weightedReturn), -30, 30)
  }, [investments])
  const investmentWeight = investmentWeightOverride ?? defaultInvestmentWeight
  const annualReturn = annualReturnOverride ?? defaultAnnualReturn
  const monthlyIncomeInvestmentWeight = monthlyIncomeInvestmentOverride
  const monthlyIncome = useMemo(() => averageMonthlyIncome(entries), [entries])
  const projectionBase = Math.max(0, totals.netWorth)
  const scenarioInvestment = projectionBase * (investmentWeight / 100)
  const monthlyInvestment = monthlyIncome * (monthlyIncomeInvestmentWeight / 100)
  const horizonMonths = horizonYears * 12
  const projection = useMemo(
    () =>
      projectAssets(investments, totals.cash, today, horizonMonths, {
        scenario: {
          baseAmount: projectionBase,
          investmentWeight,
          annualReturn,
          wageGrowth,
          monthlyIncome,
          monthlyIncomeInvestmentWeight,
        },
      }),
    [
      annualReturn,
      horizonMonths,
      investmentWeight,
      investments,
      monthlyIncome,
      monthlyIncomeInvestmentWeight,
      projectionBase,
      today,
      totals.cash,
      wageGrowth,
    ]
  )
  const projectionChartData = useMemo(() => {
    const lastIndex = projection.length - 1
    return projection.map((point, index) => {
      const projectionEndpoint =
        index === 0 ? 'start' : index === lastIndex ? 'end' : ''
      return {
        ...point,
        projectionEndpoint,
        projectionEndpointLabel: projectionEndpoint ? compactKRW(point.투자) : '',
      }
    })
  }, [projection])

  const pieData = useMemo(() => {
    if (pieType === '투자') {
      return ['예금', '적금', '주식', '비트코인', '자산']
        .map((k) => ({ name: k, value: invest.byKind[k] || 0 }))
        .filter((d) => d.value > 0)
    }
    return categoryBreakdown(filtered, '지출')
  }, [pieType, filtered, invest])

  const empty = entries.length === 0 && investments.length === 0

  return (
    <div className="stage" style={{ '--accent': '#7c3aed' }}>
      {empty ? (
        <div className="card">
          <div className="empty">
            <strong>표시할 데이터가 없습니다</strong>
            수입 · 지출 · 투자 탭에서 내역을 입력하거나, 설정에서 백업 파일을
            불러오세요.
          </div>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="label">총수입</div>
              <div className="value" style={{ color: '#16a34a' }}>
                {formatKRW(totals.income)}
              </div>
            </div>
            <div className="stat-card">
              <div className="label">총지출</div>
              <div className="value" style={{ color: '#dc2626' }}>
                {formatKRW(totals.expense)}
              </div>
            </div>
            <div className="stat-card">
              <div className="label">투자 평가액</div>
              <div className="value" style={{ color: '#0e7490' }}>
                {formatKRW(invest.current)}
              </div>
            </div>
            <div className="stat-card">
              <div className="label">순자산 (현금 + 투자)</div>
              <div className="value accent">{formatKRW(totals.netWorth)}</div>
            </div>
          </div>

          <div className="card">
            <div className="chart-head">
              <div>
                <h3 className="future-title">미래 자산 추이</h3>
              </div>
              <label className="projection-control projection-horizon-control">
                <span className="projection-control-head">
                  <span>기간</span>
                  <strong>{horizonYears}년</strong>
                </span>
                <input
                  type="range"
                  min={MIN_HORIZON_YEARS}
                  max={MAX_HORIZON_YEARS}
                  step="1"
                  value={horizonYears}
                  aria-label="미래 자산 추이 기간"
                  onChange={(e) =>
                    updateGraphSettings({
                      horizonYears: clamp(Number(e.target.value), MIN_HORIZON_YEARS, MAX_HORIZON_YEARS),
                    })
                  }
                />
              </label>
            </div>
            <div className="projection-controls" aria-label="미래 자산 추이 조정">
              <label className="projection-control">
                <span className="projection-control-head">
                  <span>투자 비중</span>
                  <strong>{investmentWeight}%</strong>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={investmentWeight}
                  onChange={(e) =>
                    updateGraphSettings({ investmentWeightOverride: Number(e.target.value) })
                  }
                />
              </label>
              <label className="projection-control">
                <span className="projection-control-head">
                  <span>연 수익률</span>
                  <strong>
                    {annualReturn >= 0 ? '+' : ''}
                    {annualReturn}%
                  </strong>
                </span>
                <input
                  type="range"
                  min="-30"
                  max="30"
                  step="0.5"
                  value={annualReturn}
                  onChange={(e) =>
                    updateGraphSettings({ annualReturnOverride: Number(e.target.value) })
                  }
                />
              </label>
              <label className="projection-control">
                <span className="projection-control-head">
                  <span>임금 상승률</span>
                  <strong>
                    {wageGrowth >= 0 ? '+' : ''}
                    {wageGrowth}%
                  </strong>
                </span>
                <input
                  type="range"
                  min={MIN_WAGE_GROWTH}
                  max={MAX_WAGE_GROWTH}
                  step="0.5"
                  value={wageGrowth}
                  onChange={(e) =>
                    updateGraphSettings({
                      wageGrowth: clamp(Number(e.target.value), MIN_WAGE_GROWTH, MAX_WAGE_GROWTH),
                    })
                  }
                />
              </label>
              <label className="projection-control">
                <span className="projection-control-head">
                  <span>월수입 투자</span>
                  <strong>{monthlyIncomeInvestmentWeight}%</strong>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={monthlyIncomeInvestmentWeight}
                  onChange={(e) =>
                    updateGraphSettings({ monthlyIncomeInvestmentOverride: Number(e.target.value) })
                  }
                />
              </label>
              <div className="projection-scenario-summary">
                <span>기준 {formatKRW(projectionBase)}</span>
                <span>투자 {formatKRW(scenarioInvestment)}</span>
                <span>월평균 수입 {formatKRW(monthlyIncome)}</span>
                <span>
                  임금 상승률 {wageGrowth >= 0 ? '+' : ''}
                  {wageGrowth}%
                </span>
                <span>월 투자 {formatKRW(monthlyInvestment)}</span>
              </div>
            </div>
            {projectionBase <= 0 ? (
              <div className="empty" style={{ padding: '48px 10px' }}>
                수입 · 지출 · 투자 데이터를 입력하면 미래 자산 추이가 표시됩니다.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={projectionChartData} margin={{ top: 44, right: 22, bottom: 5, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                  <XAxis
                    dataKey="month"
                    fontSize={12}
                    tickMargin={8}
                    interval={Math.max(0, horizonYears)}
                  />
                  <YAxis tickFormatter={compactKRW} fontSize={12} width={54} />
                  <Tooltip formatter={tooltipMoney} />
                  <Legend />
                  <Area type="monotone" dataKey="투자" stroke="#7c3aed" fill="#c4b5fd">
                    <LabelList
                      dataKey="projectionEndpointLabel"
                      content={<ProjectionEndpointLabel />}
                    />
                  </Area>
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {years.length > 1 && (
            <div className="year-filter">
              <button
                className={activeYear === 'all' ? 'on' : ''}
                onClick={() => updateGraphSettings({ year: 'all' })}
              >
                전체
              </button>
              {years.map((y) => (
                <button
                  key={y}
                  className={activeYear === y ? 'on' : ''}
                  onClick={() => updateGraphSettings({ year: y })}
                >
                  {y}년
                </button>
              ))}
            </div>
          )}

          <div className="chart-grid">
            <div
              className="chart-card expense-trend-chart-card"
              role="button"
              tabIndex={0}
              aria-label="카테고리별 지출 추이 설정"
              onClick={() => setExpenseTrendSettingsOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setExpenseTrendSettingsOpen(true)
                }
              }}
            >
              <div className="chart-head">
                <div>
                  <h3>카테고리별 지출 추이</h3>
                  <p className="sub">
                    {selectedExpenseTrendCategories.length > 0
                      ? '선택 카테고리 월별 변화'
                      : '상위 지출 카테고리 월별 변화'}
                  </p>
                </div>
                <span className="expense-trend-mode-pill">
                  {selectedExpenseTrendCategories.length > 0
                    ? `${selectedExpenseTrendCategories.length}/${MAX_EXPENSE_TREND_CATEGORIES}`
                    : '자동'}
                </span>
              </div>
              {months.length === 0 ? (
                <div className="empty" style={{ padding: '60px 10px' }}>
                  날짜가 있는 거래가 없습니다.
                </div>
              ) : expenseCategoryTrend.categories.length === 0 ? (
                <div className="empty" style={{ padding: '60px 10px' }}>
                  지출 카테고리 데이터가 없습니다.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={expenseCategoryTrend.data} margin={{ top: 5, right: 14, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                    <XAxis dataKey="month" fontSize={12} tickMargin={8} />
                    <YAxis tickFormatter={compactKRW} fontSize={12} width={54} />
                    <Tooltip formatter={tooltipMoney} />
                    <Legend />
                    {expenseCategoryTrend.categories.map((category, index) => (
                      <Line
                        key={category}
                        type="monotone"
                        dataKey={category}
                        stroke={PIE_COLORS[index % PIE_COLORS.length]}
                        strokeWidth={2.2}
                        dot={{ r: 2.8 }}
                        activeDot={{ r: 5 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="chart-card">
              <h3>수입 대비 지출</h3>
              <p className="sub">막대: 수입 · 지출 / 선: 순수익</p>
              {months.length === 0 ? (
                <div className="empty" style={{ padding: '60px 10px' }}>
                  날짜가 있는 거래가 없습니다.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={months} margin={{ top: 5, right: 14, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                    <XAxis dataKey="month" fontSize={12} tickMargin={8} />
                    <YAxis tickFormatter={compactKRW} fontSize={12} width={54} />
                    <Tooltip formatter={tooltipMoney} />
                    <Legend />
                    <Bar dataKey="수입" fill="#16a34a" radius={[4, 4, 0, 0]} barSize={16} />
                    <Bar dataKey="지출" fill="#dc2626" radius={[4, 4, 0, 0]} barSize={16} />
                    <Line type="monotone" dataKey="순수익" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="chart-card">
              <div className="chart-head">
                <div>
                  <h3>카테고리별 비중</h3>
                  <p className="sub">
                    {pieType === '지출' ? '지출 카테고리 분포' : '투자 상품 비중 (평가액)'}
                  </p>
                </div>
                <div className="toggle">
                  <button
                    className={pieType === '지출' ? 'on' : ''}
                    onClick={() => updateGraphSettings({ pieType: '지출' })}
                  >
                    지출
                  </button>
                  <button
                    className={pieType === '투자' ? 'on' : ''}
                    onClick={() => updateGraphSettings({ pieType: '투자' })}
                  >
                    투자
                  </button>
                </div>
              </div>
              {pieData.length === 0 ? (
                <div className="empty" style={{ padding: '60px 10px' }}>
                  {pieType} 데이터가 없습니다.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label={({ percent }) =>
                        percent > 0.04 ? `${(percent * 100).toFixed(0)}%` : ''
                      }
                      labelLine={false}
                    >
                      {pieData.map((entry, i) => (
                        <Cell
                          key={entry.name}
                          fill={KIND_COLORS[entry.name] || PIE_COLORS[i % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip formatter={tooltipMoney} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="chart-card">
              <h3>누적 현금 흐름</h3>
              <p className="sub">수입 − 지출을 월별로 누적</p>
              {months.length === 0 ? (
                <div className="empty" style={{ padding: '60px 10px' }}>
                  날짜가 있는 거래가 없습니다.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={months} margin={{ top: 5, right: 14, bottom: 5, left: 0 }}>
                    <defs>
                      <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                    <XAxis dataKey="month" fontSize={12} tickMargin={8} />
                    <YAxis tickFormatter={compactKRW} fontSize={12} width={54} />
                    <Tooltip formatter={tooltipMoney} />
                    <Area
                      type="monotone"
                      dataKey="누적현금"
                      stroke="#7c3aed"
                      strokeWidth={2}
                      fill="url(#cashFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {expenseTrendSettingsOpen && (
            <div
              className="fixed-modal-backdrop"
              onClick={() => setExpenseTrendSettingsOpen(false)}
            >
              <div
                className="fixed-modal expense-trend-modal"
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="fixed-modal-head">
                  <h3>지출 추이 카테고리</h3>
                  <button
                    className="fixed-modal-close"
                    onClick={() => setExpenseTrendSettingsOpen(false)}
                    aria-label="닫기"
                  >
                    ×
                  </button>
                </div>

                <div className="expense-trend-summary">
                  <strong>
                    {selectedExpenseTrendCategories.length > 0
                      ? `${selectedExpenseTrendCategories.length}/${MAX_EXPENSE_TREND_CATEGORIES} 선택`
                      : `자동 상위 ${MAX_EXPENSE_TREND_CATEGORIES}개`}
                  </strong>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={clearExpenseTrendCategories}
                    disabled={selectedExpenseTrendCategories.length === 0}
                  >
                    자동
                  </button>
                </div>

                {expenseTrendCategoryOptions.length === 0 ? (
                  <div className="empty" style={{ padding: '28px 10px' }}>
                    지출 카테고리 데이터가 없습니다.
                  </div>
                ) : (
                  <div className="expense-trend-category-grid">
                    {expenseTrendCategoryOptions.map((option, index) => {
                      const selected = selectedExpenseTrendCategorySet.has(option.name)
                      const disabled =
                        !selected &&
                        selectedExpenseTrendCategories.length >= MAX_EXPENSE_TREND_CATEGORIES
                      const colorIndex = selected
                        ? selectedExpenseTrendCategories.indexOf(option.name)
                        : index

                      return (
                        <label
                          className={`expense-trend-category-option${disabled ? ' disabled' : ''}`}
                          key={option.name}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={disabled}
                            onChange={() => toggleExpenseTrendCategory(option.name)}
                          />
                          <span
                            className="expense-trend-swatch"
                            style={{
                              '--category-color':
                                PIE_COLORS[colorIndex % PIE_COLORS.length],
                            }}
                            aria-hidden="true"
                          />
                          <span className="expense-trend-category-name">{option.name}</span>
                          <span className="expense-trend-category-total">
                            {formatKRW(option.value)}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}

                <div className="fixed-modal-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-accent"
                    onClick={() => setExpenseTrendSettingsOpen(false)}
                  >
                    완료
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
