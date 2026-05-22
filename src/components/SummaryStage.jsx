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
} from 'recharts'
import { formatKRW, compactKRW, monthOf, todayStr } from '../lib/format'
import { summarize, projectAssets } from '../lib/investments'
import CsvControls from './CsvControls'

const PIE_COLORS = [
  '#6366f1', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#ec4899',
  '#8b5cf6', '#14b8a6', '#f97316', '#84cc16', '#06b6d4', '#a855f7',
]
const KIND_COLORS = { 예금: '#0891b2', 적금: '#4f46e5', 주식: '#d97706' }
const HORIZONS = [
  { label: '1년', months: 12 },
  { label: '3년', months: 36 },
  { label: '5년', months: 60 },
  { label: '10년', months: 120 },
]

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

const tooltipMoney = (value) => formatKRW(value)

export default function SummaryStage({ entries, investments, onExport, onImport }) {
  const today = todayStr()
  const [pieType, setPieType] = useState('지출')
  const [year, setYear] = useState('all')
  const [horizon, setHorizon] = useState(60)

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

  const projection = useMemo(
    () => projectAssets(investments, totals.cash, today, horizon),
    [investments, totals.cash, today, horizon]
  )

  const pieData = useMemo(() => {
    if (pieType === '투자') {
      return ['예금', '적금', '주식']
        .map((k) => ({ name: k, value: invest.byKind[k] || 0 }))
        .filter((d) => d.value > 0)
    }
    return categoryBreakdown(filtered, '지출')
  }, [pieType, filtered, invest])

  const empty = entries.length === 0 && investments.length === 0

  return (
    <div className="stage" style={{ '--accent': '#7c3aed' }}>
      <div className="card csv-card">
        <div>
          <h2 className="section-title">CSV 데이터 관리</h2>
          <p className="csv-desc">
            거래 · 고정지출 · 투자상품을 하나의 CSV로 내보내 백업하고, 저장해 둔 CSV를
            업로드하면 아래 그래프에서 추이를 확인할 수 있습니다.
          </p>
        </div>
        <CsvControls onExport={onExport} onImport={onImport} variant="full" />
      </div>

      {empty ? (
        <div className="card">
          <div className="empty">
            <strong>표시할 데이터가 없습니다</strong>
            수입 · 지출 · 투자 탭에서 내역을 입력하거나, 위의 <b>CSV 가져오기</b>로 파일을
            업로드하세요.
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
                <p className="sub">
                  현금은 고정, 예금 · 적금은 이율로 증가, 주식은 현재가로 합산
                </p>
              </div>
              <div className="toggle">
                {HORIZONS.map((h) => (
                  <button
                    key={h.months}
                    className={horizon === h.months ? 'on' : ''}
                    onClick={() => setHorizon(h.months)}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            </div>
            {investments.length === 0 ? (
              <div className="empty" style={{ padding: '48px 10px' }}>
                투자 탭에서 예금 · 적금 · 주식 상품을 추가하면 미래 자산 추이가 표시됩니다.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={projection} margin={{ top: 5, right: 14, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                  <XAxis
                    dataKey="month"
                    fontSize={12}
                    tickMargin={8}
                    interval={Math.max(0, Math.floor(horizon / 12))}
                  />
                  <YAxis tickFormatter={compactKRW} fontSize={12} width={54} />
                  <Tooltip formatter={tooltipMoney} />
                  <Legend />
                  <Area type="monotone" dataKey="현금" stackId="a" stroke="#94a3b8" fill="#cbd5e1" />
                  <Area type="monotone" dataKey="예금" stackId="a" stroke="#0891b2" fill="#67e8f9" />
                  <Area type="monotone" dataKey="적금" stackId="a" stroke="#4f46e5" fill="#a5b4fc" />
                  <Area type="monotone" dataKey="주식" stackId="a" stroke="#d97706" fill="#fcd34d" />
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
