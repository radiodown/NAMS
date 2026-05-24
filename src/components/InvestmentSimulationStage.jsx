import { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import CalendarInput from './CalendarInput'
import NumberInput from './NumberInput'
import {
  INVEST_SIM_COLOR,
  INVEST_SIM_STRATEGIES,
  buildBenchmarkScenario,
  defaultSimulationScenario,
  normalizeSimulationScenario,
  simulateInvestmentScenario,
} from '../lib/investmentSimulation'
import { compactKRW, formatKRW, todayStr } from '../lib/format'
import { summarize } from '../lib/investments'

const HORIZON_OPTIONS = [
  { label: '1년', value: 1 },
  { label: '3년', value: 3 },
  { label: '5년', value: 5 },
  { label: '10년', value: 10 },
  { label: '20년', value: 20 },
]

const COMPARE_COLORS = ['#0f766e', '#d97706', '#7c3aed']

function formatPct(value, digits = 1) {
  return `${(Number(value) || 0).toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`
}

function formatRatio(value) {
  return (Number(value) || 0).toLocaleString('ko-KR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function signedPct(value, digits = 1) {
  const n = Number(value) || 0
  return `${n >= 0 ? '+' : ''}${formatPct(n, digits)}`
}

const tooltipMoney = (value) => formatKRW(value)
const tooltipPct = (value) => formatPct(value)

export default function InvestmentSimulationStage({ investments, simulations }) {
  const today = todayStr()
  const invest = useMemo(() => summarize(investments || [], today), [investments, today])
  const [draft, setDraft] = useState(() =>
    defaultSimulationScenario({
      startDate: today,
      initialCapital: Math.round(invest.current || 10000000),
    })
  )
  const [compareIds, setCompareIds] = useState([])

  const normalizedDraft = useMemo(() => normalizeSimulationScenario(draft), [draft])
  const result = useMemo(
    () => simulateInvestmentScenario(normalizedDraft),
    [normalizedDraft]
  )
  const benchmark = useMemo(
    () => simulateInvestmentScenario(buildBenchmarkScenario(normalizedDraft), { includeBenchmarkEvent: false }),
    [normalizedDraft]
  )
  const selectedComparisons = useMemo(
    () =>
      (simulations.items || [])
        .filter((scenario) => compareIds.includes(scenario.id))
        .slice(0, 3)
        .map((scenario, index) => ({
          scenario,
          color: COMPARE_COLORS[index % COMPARE_COLORS.length],
          result: simulateInvestmentScenario(scenario),
          key: `saved${index}`,
        })),
    [compareIds, simulations.items]
  )

  const comparisonRows = useMemo(
    () =>
      result.points.map((point, index) => {
        const row = {
          date: point.date,
          현재: point.asset,
          벤치마크: benchmark.points[index]?.asset,
        }
        selectedComparisons.forEach((item) => {
          row[item.key] = item.result.points[index]?.asset
        })
        return row
      }),
    [benchmark.points, result.points, selectedComparisons]
  )

  const returnRows = useMemo(
    () =>
      result.points.map((point) => ({
        date: point.date,
        수익률: point.returnPct,
        낙폭: point.drawdownPct,
      })),
    [result.points]
  )

  const allocationRows = useMemo(
    () =>
      result.points.map((point) => ({
        date: point.date,
        투자자산: point.riskWeightPct,
        현금: point.cashWeightPct,
      })),
    [result.points]
  )

  const recentEvents = useMemo(
    () =>
      [...result.events]
        .filter((event) => event.month === 0 || event.amount > 0)
        .slice(0, 18),
    [result.events]
  )

  const benchmarkGap = result.metrics.totalReturnPct - benchmark.metrics.totalReturnPct
  const savedCount = simulations.items?.length || 0

  function setField(name, value) {
    setDraft((prev) => normalizeSimulationScenario({ ...prev, [name]: value }))
  }

  function loadScenario(scenario) {
    setDraft(normalizeSimulationScenario(scenario))
  }

  function saveScenario() {
    const saved = simulations.saveItem(normalizedDraft)
    setDraft(saved)
  }

  function duplicateScenario(scenario) {
    const saved = simulations.saveItem({
      ...scenario,
      id: '',
      name: `${scenario.name} 복사본`,
    })
    setDraft(saved)
    setCompareIds((prev) => [...new Set([...prev, saved.id])].slice(-3))
  }

  function removeScenario(id) {
    if (!window.confirm('저장된 시나리오를 삭제할까요?')) return
    simulations.removeItem(id)
    setCompareIds((prev) => prev.filter((item) => item !== id))
    if (draft.id === id) setDraft(defaultSimulationScenario({ startDate: today }))
  }

  function toggleCompare(id) {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id)
      return [...prev, id].slice(-3)
    })
  }

  function applyCurrentInvestments() {
    setDraft((prev) =>
      normalizeSimulationScenario({
        ...prev,
        initialCapital: Math.round(invest.current),
        assetName: '현재 투자 포트폴리오',
      })
    )
  }

  return (
    <div className="stage simulation-stage" style={{ '--accent': INVEST_SIM_COLOR }}>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">최종 자산</div>
          <div className="value accent">{formatKRW(result.metrics.finalValue)}</div>
          <div className="value-sub">{normalizedDraft.years}년 후</div>
        </div>
        <div className="stat-card">
          <div className="label">총 수익률</div>
          <div className="value">{signedPct(result.metrics.totalReturnPct)}</div>
          <div className="value-sub">투입금 {formatKRW(result.metrics.totalContributed)}</div>
        </div>
        <div className="stat-card">
          <div className="label">연환산 수익률</div>
          <div className="value">{signedPct(result.metrics.annualizedReturnPct)}</div>
          <div className="value-sub">월별 현금흐름 기준</div>
        </div>
        <div className="stat-card">
          <div className="label">최대 낙폭</div>
          <div className="value" style={{ color: '#dc2626' }}>
            {formatPct(result.metrics.maxDrawdownPct)}
          </div>
          <div className="value-sub">변동성 {formatPct(result.metrics.volatilityPct)}</div>
        </div>
        <div className="stat-card">
          <div className="label">샤프 비율</div>
          <div className="value">{formatRatio(result.metrics.sharpeRatio)}</div>
          <div className="value-sub">무위험 {formatPct(normalizedDraft.riskFreeRate)}</div>
        </div>
        <div className="stat-card">
          <div className="label">비용 · 세금</div>
          <div className="value">{formatKRW(result.metrics.totalFees + result.metrics.totalTaxes)}</div>
          <div className="value-sub">
            수수료 {formatKRW(result.metrics.totalFees)} · 세금 {formatKRW(result.metrics.totalTaxes)}
          </div>
        </div>
      </div>

      <div className="simulation-grid">
        <section className="card simulation-control-card">
          <div className="form-card-head">
            <h2 className="section-title">시뮬레이션 조건</h2>
            <div className="form-card-actions">
              <button className="btn btn-sm" type="button" onClick={applyCurrentInvestments} disabled={invest.current <= 0}>
                현재 투자액 사용
              </button>
              <button className="btn btn-accent btn-sm" type="button" onClick={saveScenario}>
                시나리오 저장
              </button>
            </div>
          </div>

          <div className="simulation-form">
            <div className="field field-wide">
              <label>시나리오 이름</label>
              <input
                value={draft.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="예: 장기 적립식"
              />
            </div>
            <div className="field">
              <label>기준일</label>
              <CalendarInput value={draft.startDate} onChange={(value) => setField('startDate', value)} />
            </div>
            <div className="field">
              <label>투자 기간</label>
              <select value={draft.years} onChange={(e) => setField('years', e.target.value)}>
                {HORIZON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field field-wide">
              <label>투자 종목/자산군</label>
              <input
                value={draft.assetName}
                onChange={(e) => setField('assetName', e.target.value)}
                placeholder="예: S&P500 ETF, 국내 배당주, 혼합형 포트폴리오"
              />
            </div>
            <div className="field">
              <label>초기 투자금 (원)</label>
              <NumberInput
                decimal={false}
                min="0"
                value={draft.initialCapital}
                onChange={(value) => setField('initialCapital', value)}
              />
            </div>
            <div className="field">
              <label>월 정기 투자금 (원)</label>
              <NumberInput
                decimal={false}
                min="0"
                value={draft.monthlyContribution}
                onChange={(value) => setField('monthlyContribution', value)}
              />
            </div>
            <div className="field">
              <label>기대 연수익률 (%)</label>
              <NumberInput
                step="0.1"
                value={draft.annualReturn}
                onChange={(value) => setField('annualReturn', value)}
              />
            </div>
            <div className="field">
              <label>예상 변동성 (%)</label>
              <NumberInput
                min="0"
                step="0.1"
                value={draft.annualVolatility}
                onChange={(value) => setField('annualVolatility', value)}
              />
            </div>
            <div className="field">
              <label>투자자산 비중 (%)</label>
              <NumberInput
                min="0"
                max="100"
                decimal={false}
                value={draft.riskAssetWeight}
                onChange={(value) => setField('riskAssetWeight', value)}
              />
            </div>
            <div className="field">
              <label>현금 수익률 (%)</label>
              <NumberInput
                step="0.1"
                value={draft.cashAnnualReturn}
                onChange={(value) => setField('cashAnnualReturn', value)}
              />
            </div>
            <div className="field">
              <label>벤치마크 연수익률 (%)</label>
              <NumberInput
                step="0.1"
                value={draft.benchmarkAnnualReturn}
                onChange={(value) => setField('benchmarkAnnualReturn', value)}
              />
            </div>
            <div className="field">
              <label>무위험 수익률 (%)</label>
              <NumberInput
                step="0.1"
                value={draft.riskFreeRate}
                onChange={(value) => setField('riskFreeRate', value)}
              />
            </div>
          </div>

          <div className="simulation-strategy">
            <label>투자 전략</label>
            <div className="seg simulation-strategy-seg">
              {INVEST_SIM_STRATEGIES.map((strategy) => (
                <button
                  key={strategy}
                  type="button"
                  className={draft.strategy === strategy ? 'on' : ''}
                  onClick={() => setField('strategy', strategy)}
                >
                  {strategy}
                </button>
              ))}
            </div>
          </div>

          <div className="simulation-form compact">
            <div className="field">
              <label>거래 수수료 (%)</label>
              <NumberInput
                min="0"
                step="0.01"
                value={draft.feeRate}
                onChange={(value) => setField('feeRate', value)}
              />
            </div>
            <div className="field">
              <label>세금 (%)</label>
              <NumberInput
                min="0"
                step="0.1"
                value={draft.taxRate}
                onChange={(value) => setField('taxRate', value)}
              />
            </div>
            <div className="field">
              <label>슬리피지 (%)</label>
              <NumberInput
                min="0"
                step="0.01"
                value={draft.slippageRate}
                onChange={(value) => setField('slippageRate', value)}
              />
            </div>
            {(draft.strategy === '목표 비중 리밸런싱' || draft.strategy === '손절/익절') && (
              <div className="field">
                <label>리밸런싱 주기 (개월)</label>
                <NumberInput
                  min="1"
                  decimal={false}
                  value={draft.rebalanceMonths}
                  onChange={(value) => setField('rebalanceMonths', value)}
                />
              </div>
            )}
            {draft.strategy === '이동평균선' && (
              <div className="field">
                <label>이동평균 기간 (개월)</label>
                <NumberInput
                  min="2"
                  decimal={false}
                  value={draft.movingAverageMonths}
                  onChange={(value) => setField('movingAverageMonths', value)}
                />
              </div>
            )}
            {draft.strategy === '손절/익절' && (
              <>
                <div className="field">
                  <label>손절 기준 (%)</label>
                  <NumberInput
                    min="0"
                    decimal={false}
                    value={draft.stopLossPct}
                    onChange={(value) => setField('stopLossPct', value)}
                  />
                </div>
                <div className="field">
                  <label>익절 기준 (%)</label>
                  <NumberInput
                    min="0"
                    decimal={false}
                    value={draft.takeProfitPct}
                    onChange={(value) => setField('takeProfitPct', value)}
                  />
                </div>
              </>
            )}
          </div>
        </section>

        <section className="card simulation-saved-card">
          <div className="form-card-head">
            <h2 className="section-title">저장된 시나리오</h2>
            <span className="simulation-count">{savedCount}개</span>
          </div>

          {savedCount === 0 ? (
            <div className="empty simulation-empty">
              <strong>저장된 시나리오 없음</strong>
              조건을 조정한 뒤 저장하면 비교 대상으로 사용할 수 있습니다.
            </div>
          ) : (
            <div className="simulation-scenario-list">
              {simulations.items.map((scenario) => {
                const selected = compareIds.includes(scenario.id)
                return (
                  <div className="simulation-scenario-row" key={scenario.id}>
                    <button type="button" className="scenario-main" onClick={() => loadScenario(scenario)}>
                      <strong>{scenario.name}</strong>
                      <span>
                        {scenario.strategy} · {scenario.years}년 · {formatPct(scenario.annualReturn)}
                      </span>
                    </button>
                    <label className={`scenario-compare${selected ? ' on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleCompare(scenario.id)}
                      />
                      비교
                    </label>
                    <button type="button" className="icon-btn" onClick={() => duplicateScenario(scenario)} aria-label={`${scenario.name} 복제`}>
                      ⧉
                    </button>
                    <button type="button" className="icon-btn danger" onClick={() => removeScenario(scenario.id)} aria-label={`${scenario.name} 삭제`}>
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      <div className="chart-grid simulation-chart-grid">
        <div className="chart-card simulation-wide-chart">
          <div className="chart-head">
            <div>
              <h3>자산 변화</h3>
              <p className="sub">
                {normalizedDraft.assetName} · 벤치마크 대비 {signedPct(benchmarkGap)}
              </p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={comparisonRows} margin={{ top: 5, right: 14, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
              <XAxis dataKey="date" fontSize={12} tickMargin={8} />
              <YAxis tickFormatter={compactKRW} fontSize={12} width={54} />
              <Tooltip formatter={tooltipMoney} />
              <Legend />
              <Line type="monotone" dataKey="현재" stroke={INVEST_SIM_COLOR} strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="벤치마크" stroke="#64748b" strokeWidth={2} dot={false} strokeDasharray="5 5" />
              {selectedComparisons.map((item) => (
                <Line
                  key={item.key}
                  type="monotone"
                  dataKey={item.key}
                  name={item.scenario.name}
                  stroke={item.color}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>수익률 · 낙폭</h3>
          <p className="sub">총 투입금 기준 수익률과 고점 대비 낙폭</p>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={returnRows} margin={{ top: 5, right: 14, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
              <XAxis dataKey="date" fontSize={12} tickMargin={8} />
              <YAxis tickFormatter={(value) => `${value}%`} fontSize={12} width={46} />
              <Tooltip formatter={tooltipPct} />
              <Legend />
              <Line type="monotone" dataKey="수익률" stroke="#16a34a" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="낙폭" stroke="#dc2626" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>비중 변화</h3>
          <p className="sub">투자자산과 현금 비중</p>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={allocationRows} margin={{ top: 5, right: 14, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
              <XAxis dataKey="date" fontSize={12} tickMargin={8} />
              <YAxis tickFormatter={(value) => `${value}%`} fontSize={12} width={46} />
              <Tooltip formatter={tooltipPct} />
              <Legend />
              <Area type="monotone" dataKey="현금" stackId="a" stroke="#94a3b8" fill="#cbd5e1" />
              <Area type="monotone" dataKey="투자자산" stackId="a" stroke={INVEST_SIM_COLOR} fill="#93c5fd" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card simulation-events-card">
          <h3>거래 타이밍</h3>
          <p className="sub">초기 배분, 정기 매수, 리밸런싱, 조건부 매도 기록</p>
          <div className="simulation-event-list">
            {recentEvents.map((event, index) => (
              <div className="simulation-event-row" key={`${event.date}-${event.type}-${index}`}>
                <span className={`event-type type-${event.type}`}>{event.type}</span>
                <div>
                  <strong>{event.date}</strong>
                  <span>{event.label}</span>
                </div>
                <b>{event.amount > 0 ? formatKRW(event.amount) : '-'}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
