import { useMemo } from 'react'
import { TAX_COLOR } from '../lib/categories'
import { formatKRW } from '../lib/format'
import { useStoredSlice } from '../lib/store'
import { STORE_PATHS } from '../lib/storePaths'
import { defaultTaxSettings } from '../lib/schema'
import {
  PRODUCT_LIMITS,
  computeTaxSettlement,
  generateTaxTips,
} from '../lib/taxSettlement'
import NumberInput from './NumberInput'

const TIP_TONES = {
  warn: { label: '주의', className: 'tip-warn' },
  tip: { label: '팁', className: 'tip-suggest' },
  good: { label: '좋아요', className: 'tip-good' },
  info: { label: '안내', className: 'tip-info' },
}

const signed = (n) => (n >= 0 ? '+' : '') + formatKRW(n)

function ProgressBar({ value, max, color = TAX_COLOR }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="tax-progress" aria-label={`진행률 ${pct.toFixed(0)}%`}>
      <div
        className="tax-progress-bar"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  )
}

function Row({ label, value, hint, accent }) {
  return (
    <div className="tax-row">
      <div className="tax-row-label">
        <span>{label}</span>
        {hint && <span className="tax-row-hint">{hint}</span>}
      </div>
      <div className={`tax-row-value ${accent || ''}`}>{value}</div>
    </div>
  )
}

export default function TaxSettlementStage({ entries, investments, paymentMethods }) {
  const [settings, setSettings] = useStoredSlice(
    STORE_PATHS.settings.taxSettlement,
    defaultTaxSettings
  )

  const result = useMemo(
    () => computeTaxSettlement({ entries, investments, paymentMethods, settings }),
    [entries, investments, paymentMethods, settings]
  )
  const tips = useMemo(() => generateTaxTips(result), [result])

  function update(patch) {
    setSettings((prev) => ({ ...prev, ...patch }))
  }

  const cardThreshold = result.cardDeduction.threshold
  const cardUsage = result.cardSpending.total
  const cardOverThreshold = cardUsage > cardThreshold
  const cardThresholdPct = cardThreshold > 0
    ? Math.min(100, (cardUsage / cardThreshold) * 100)
    : 0

  return (
    <div className="stage tax-stage" style={{ '--accent': TAX_COLOR }}>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">총급여 ({result.year}년)</div>
          <div className="value">{formatKRW(result.totalSalary)}</div>
          <div className="value-sub">
            {result.salaryIsManual ? '수동 입력값' : `자동 (급여 카테고리 합계 ${formatKRW(result.autoSalary)})`}
          </div>
        </div>
        <div className="stat-card">
          <div className="label">산출세액</div>
          <div className="value" style={{ color: '#dc2626' }}>
            {formatKRW(result.calculatedTax)}
          </div>
          <div className="value-sub">과표 구간 {result.bracket}</div>
        </div>
        <div className="stat-card">
          <div className="label">세액공제 합계</div>
          <div className="value" style={{ color: '#16a34a' }}>
            -{formatKRW(result.totalTaxCredit)}
          </div>
          <div className="value-sub">결정세액 {formatKRW(result.determinedTax)}</div>
        </div>
        <div className="stat-card">
          <div className="label">예상 환급액</div>
          <div
            className="value accent"
            style={{ color: result.refund >= 0 ? '#0e7490' : '#dc2626' }}
          >
            {signed(result.refund)}
          </div>
          <div className="value-sub">기납부세액 − 결정세액</div>
        </div>
      </div>

      <div className="card tax-settings">
        <div className="card-head">
          <h3>기준 정보</h3>
          <p className="sub">총급여와 가족 구성, 무주택 요건에 따라 공제 한도가 달라집니다.</p>
        </div>
        <div className="tax-settings-grid">
          <div className="field">
            <label>대상 연도</label>
            <NumberInput
              decimal={false}
              min="2000"
              value={String(settings.year)}
              onChange={(value) => update({ year: Number(value) || new Date().getFullYear() })}
            />
          </div>
          <div className="field">
            <label>총급여 (수동 입력 · 비우면 자동)</label>
            <NumberInput
              decimal={false}
              min="0"
              placeholder={`자동: ${formatKRW(result.autoSalary)}`}
              value={settings.manualSalary === '' ? '' : String(settings.manualSalary)}
              onChange={(value) =>
                update({ manualSalary: value === '' ? '' : Number(value) || 0 })
              }
            />
          </div>
          <div className="field">
            <label>부양가족 수 (본인 제외)</label>
            <NumberInput
              decimal={false}
              min="0"
              value={String(settings.dependents)}
              onChange={(value) => update({ dependents: Number(value) || 0 })}
            />
          </div>
          <div className="field">
            <label>자녀 수 ({result.childCreditAge}세 이상)</label>
            <NumberInput
              decimal={false}
              min="0"
              value={String(settings.children)}
              onChange={(value) => update({ children: Number(value) || 0 })}
            />
          </div>
          <div className="field">
            <label>월세 (월 납부액)</label>
            <NumberInput
              decimal={false}
              min="0"
              value={String(settings.monthlyRent)}
              onChange={(value) => update({ monthlyRent: Number(value) || 0 })}
            />
          </div>
          <div className="field">
            <label>기납부 소득세 (회사 원천징수액)</label>
            <NumberInput
              decimal={false}
              min="0"
              value={String(settings.prepaidTax)}
              onChange={(value) => update({ prepaidTax: Number(value) || 0 })}
            />
          </div>
          <div className="field">
            <label>의료비 추가 자료 (연간)</label>
            <NumberInput
              decimal={false}
              min="0"
              value={String(settings.extraMedical || 0)}
              onChange={(value) => update({ extraMedical: Number(value) || 0 })}
            />
          </div>
          <div className="field">
            <label>교육비 추가 자료 (연간)</label>
            <NumberInput
              decimal={false}
              min="0"
              value={String(settings.extraEducation || 0)}
              onChange={(value) => update({ extraEducation: Number(value) || 0 })}
            />
          </div>
          <div className="field">
            <label>보험료 추가 자료 (연간)</label>
            <NumberInput
              decimal={false}
              min="0"
              value={String(settings.extraInsurance || 0)}
              onChange={(value) => update({ extraInsurance: Number(value) || 0 })}
            />
          </div>
          <div className="field">
            <label>기부금 추가 자료 (연간)</label>
            <NumberInput
              decimal={false}
              min="0"
              value={String(settings.extraDonation || 0)}
              onChange={(value) => update({ extraDonation: Number(value) || 0 })}
            />
          </div>
          <div className="field tax-toggle-field">
            <label className="tax-check-row">
              <input
                type="checkbox"
                checked={settings.isHomeless}
                onChange={(e) => update({ isHomeless: e.target.checked })}
              />
              <span className="tax-check-box" aria-hidden="true" />
              <span>무주택 세대 요건 충족 (월세·청약 공제 대상)</span>
            </label>
          </div>
          <div className="field tax-toggle-field">
            <label className="tax-check-row">
              <input
                type="checkbox"
                checked={Boolean(settings.marriageCredit)}
                onChange={(e) => update({ marriageCredit: e.target.checked })}
              />
              <span className="tax-check-box" aria-hidden="true" />
              <span>혼인세액공제 대상 (2024~2026년 혼인신고 · 생애 1회)</span>
            </label>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>카드 사용액 공제</h3>
          <p className="sub">
            공제대상 결제수단 사용액 중 총급여 25%를 넘긴 금액에 적용됩니다.
          </p>
        </div>
        <div className="tax-card-gauge">
          <div className="tax-gauge-bar">
            <div
              className="tax-gauge-fill"
              style={{ width: `${cardThresholdPct}%` }}
            />
            <div
              className="tax-gauge-threshold"
              style={{ left: '100%' }}
              title="25% 임계선"
            />
          </div>
          <div className="tax-gauge-labels">
            <span>현재 {formatKRW(cardUsage)}</span>
            <span>임계선 {formatKRW(cardThreshold)}</span>
          </div>
        </div>
        {cardOverThreshold ? (
          <Row
            label="공제 대상 초과액"
            value={formatKRW(result.cardDeduction.excess)}
            hint={`공제 적용액 합계 ${formatKRW(result.cardDeduction.total)}`}
            accent="good"
          />
        ) : (
          <Row
            label="임계선까지 남은 금액"
            value={formatKRW(Math.max(0, cardThreshold - cardUsage))}
            hint="이만큼 더 사용해야 공제 시작"
            accent="warn"
          />
        )}
        <div className="tax-card-table">
          <div className="tax-card-table-head">
            <span>결제수단</span>
            <span>연간 사용액</span>
            <span>예상 공제액</span>
          </div>
          <div className="tax-card-table-row">
            <span>신용카드 (15%)</span>
            <span>{formatKRW(result.cardSpending.신용카드)}</span>
            <span>{formatKRW(result.cardDeduction.breakdown.신용카드)}</span>
          </div>
          <div className="tax-card-table-row">
            <span>체크/현금영수증 (30%)</span>
            <span>{formatKRW(result.cardSpending.체크카드현금)}</span>
            <span>{formatKRW(result.cardDeduction.breakdown.체크카드현금)}</span>
          </div>
          <div className="tax-card-table-row">
            <span>전통시장 (40%)</span>
            <span>{formatKRW(result.cardSpending.전통시장)}</span>
            <span>{formatKRW(result.cardDeduction.breakdown.전통시장)}</span>
          </div>
          <div className="tax-card-table-row">
            <span>대중교통 (40%)</span>
            <span>{formatKRW(result.cardSpending.대중교통)}</span>
            <span>{formatKRW(result.cardDeduction.breakdown.대중교통)}</span>
          </div>
          <div className="tax-card-table-row">
            <span>문화체육 등 (30%)</span>
            <span>{formatKRW(result.cardSpending.도서공연)}</span>
            <span>{formatKRW(result.cardDeduction.breakdown.도서공연)}</span>
          </div>
          <div className="tax-card-table-foot">
            <span>한도</span>
            <span />
            <span>
              기본 {formatKRW(result.cardDeduction.cap.regular)} + 추가 {formatKRW(result.cardDeduction.cap.extra)}
            </span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>비과세 · 절세상품</h3>
          <p className="sub">투자 탭에서 상품에 절세 태그를 지정하면 자동 인식됩니다.</p>
        </div>
        <div className="tax-product-grid">
          {Object.entries(PRODUCT_LIMITS).map(([key, meta]) => {
            const bucket = result.products[key]
            const pct = meta.contribution > 0
              ? Math.min(100, (bucket.contribution / meta.contribution) * 100)
              : 0
            return (
              <div className="tax-product-card" key={key}>
                <div className="tax-product-head">
                  <strong>{key}</strong>
                  <span className="tax-product-pct">{pct.toFixed(0)}%</span>
                </div>
                <div className="tax-product-desc">{meta.label}</div>
                <ProgressBar value={bucket.contribution} max={meta.contribution} />
                <div className="tax-product-figures">
                  <span>{formatKRW(bucket.contribution)}</span>
                  <span className="muted">/ {formatKRW(meta.contribution)}</span>
                </div>
                {bucket.products.length > 0 && (
                  <ul className="tax-product-list">
                    {bucket.products.map((p) => (
                      <li key={p.id}>
                        <span>{p.name}</span>
                        <span>{formatKRW(p.contribution)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>산출 흐름</h3>
          <p className="sub">총급여부터 환급까지 단계별 계산 결과.</p>
        </div>
        <Row
          label="총급여"
          value={formatKRW(result.totalSalary)}
          hint={result.salaryIsManual ? '수동 입력' : '급여 카테고리 합계'}
        />
        <Row
          label="− 근로소득공제"
          value={`-${formatKRW(result.earnedDeduction)}`}
          hint="구간별 자동 계산"
        />
        <Row
          label="= 근로소득금액"
          value={formatKRW(result.earnedIncome)}
          accent="bold"
        />
        <Row
          label="− 인적공제 (본인 + 부양가족)"
          value={`-${formatKRW(result.personalDeduction)}`}
          hint={`${1 + (settings.dependents || 0)}명 × 150만`}
        />
        <Row
          label="− 신용카드 등 소득공제"
          value={`-${formatKRW(result.cardDeduction.total)}`}
        />
        {result.housingDeduction > 0 && (
          <Row
            label="− 주택청약 소득공제"
            value={`-${formatKRW(result.housingDeduction)}`}
            hint="40% × 한도 300만"
          />
        )}
        <Row
          label="= 과세표준"
          value={formatKRW(result.taxableIncome)}
          accent="bold"
        />
        <Row
          label={`× 누진세율 (${result.bracket})`}
          value={formatKRW(result.calculatedTax)}
          hint="산출세액"
          accent="warn"
        />
        <Row
          label="− 근로소득세액공제"
          value={`-${formatKRW(result.earnedIncomeTaxCredit)}`}
          hint="산출세액 × 55% / 30% (한도 적용)"
        />
        {result.childrenCredit > 0 && (
          <Row
            label="− 자녀세액공제"
            value={`-${formatKRW(result.childrenCredit)}`}
            hint={`${result.childCreditAge}세 이상 ${settings.children}명`}
          />
        )}
        <Row
          label="− 의료비 세액공제"
          value={`-${formatKRW(result.medical.credit)}`}
          hint={`총급여 3% (${formatKRW(result.medical.threshold)}) 초과분의 15%`}
        />
        <Row
          label="− 교육비 세액공제"
          value={`-${formatKRW(result.education.credit)}`}
          hint="대상 금액 × 15%"
        />
        <Row
          label="− 보장성보험료 세액공제"
          value={`-${formatKRW(result.insurance.credit)}`}
          hint="한도 100만 × 12%"
        />
        <Row
          label="− 기부금 세액공제"
          value={`-${formatKRW(result.donation.credit)}`}
          hint="1천만 이하 15% / 초과 30%"
        />
        {result.rent.credit > 0 && (
          <Row
            label="− 월세 세액공제"
            value={`-${formatKRW(result.rent.credit)}`}
            hint={`연 ${formatKRW(result.rent.eligible)} × ${(result.rent.rate * 100).toFixed(0)}%`}
          />
        )}
        <Row
          label="− 연금계좌 세액공제"
          value={`-${formatKRW(result.pension.credit)}`}
          hint={`${formatKRW(result.pension.eligible)} × ${(result.pension.rate * 100).toFixed(1)}%`}
        />
        {result.standardTaxCredit > 0 && (
          <Row
            label="− 표준세액공제"
            value={`-${formatKRW(result.standardTaxCredit)}`}
            hint="특별세액공제 미적용 시 13만"
          />
        )}
        {result.marriageCredit > 0 && (
          <Row
            label="− 혼인세액공제"
            value={`-${formatKRW(result.marriageCredit)}`}
            hint="2024~2026 혼인신고 · 생애 1회"
          />
        )}
        <Row
          label="= 결정세액"
          value={formatKRW(result.determinedTax)}
          accent="bold"
        />
        <Row
          label="− 기납부세액"
          value={`-${formatKRW(result.prepaidTax)}`}
        />
        <Row
          label="= 예상 환급액"
          value={signed(result.refund)}
          accent={result.refund >= 0 ? 'good' : 'warn'}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <h3>절세 팁</h3>
          <p className="sub">현재 데이터 기준 추천. 룰 기반이므로 참고용입니다.</p>
        </div>
        <div className="tax-tip-list">
          {tips.length === 0 ? (
            <div className="empty">표시할 팁이 없습니다.</div>
          ) : (
            tips.map((tip, index) => {
              const tone = TIP_TONES[tip.level] || TIP_TONES.info
              return (
                <div className={`tax-tip ${tone.className}`} key={`${tip.title}-${index}`}>
                  <div className="tax-tip-head">
                    <span className="tax-tip-badge">{tone.label}</span>
                    <strong>{tip.title}</strong>
                  </div>
                  <p>{tip.detail}</p>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="tax-disclaimer">
        ⚠️ 본 계산은 평균적인 직장인 케이스를 단순화한 추정값입니다. 실제 연말정산은
        부양가족 구성, 의료비 종류, 기부금 단체 분류, 지방소득세, 회사 원천징수 자료 등에 따라
        달라질 수 있어요.
      </div>
    </div>
  )
}
