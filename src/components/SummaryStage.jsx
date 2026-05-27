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
  const [pieType, setPieType] = useState('지출')
  const [year, setYear] = useState('all')
  const [horizonYears, setHorizonYears] = useState(DEFAULT_HORIZON_YEARS)
  const [investmentWeightOverride, setInvestmentWeightOverride] = useState(null)
  const [annualReturnOverride, setAnnualReturnOverride] = useState(null)
  const [wageGrowth, setWageGrowth] = useState(0)
  const [monthlyIncomeInvestmentOverride, setMonthlyIncomeInvestmentOverride] = useState(0)

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
                    setHorizonYears(
                      clamp(Number(e.target.value), MIN_HORIZON_YEARS, MAX_HORIZON_YEARS)
                    )
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
                  onChange={(e) => setInvestmentWeightOverride(Number(e.target.value))}
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
                  onChange={(e) => setAnnualReturnOverride(Number(e.target.value))}
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
                    setWageGrowth(clamp(Number(e.target.value), MIN_WAGE_GROWTH, MAX_WAGE_GROWTH))
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
                  onChange={(e) => setMonthlyIncomeInvestmentOverride(Number(e.target.value))}
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
                onClick={() => setYear('all')}
              >
                전체
              </button>
              {years.map((y) => (
                <button
                  key={y}
                  className={activeYear === y ? 'on' : ''}
                  onClick={() => setYear(y)}
                >
                  {y}년
                </button>
              ))}
            </div>
          )}

          <div className="chart-grid">
            <div className="chart-card">
              <h3>월별 추이</h3>
              <p className="sub">월별 수입 · 지출 흐름</p>
              {months.length === 0 ? (
                <div className="empty" style={{ padding: '60px 10px' }}>
                  날짜가 있는 거래가 없습니다.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={months} margin={{ top: 5, right: 14, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                    <XAxis dataKey="month" fontSize={12} tickMargin={8} />
                    <YAxis tickFormatter={compactKRW} fontSize={12} width={54} />
                    <Tooltip formatter={tooltipMoney} />
                    <Legend />
                    <Line type="monotone" dataKey="수입" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="지출" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} />
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
                    onClick={() => setPieType('지출')}
                  >
                    지출
                  </button>
                  <button
                    className={pieType === '투자' ? 'on' : ''}
                    onClick={() => setPieType('투자')}
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
        </>
      )}
    </div>
  )
}
