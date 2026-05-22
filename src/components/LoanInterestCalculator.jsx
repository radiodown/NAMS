import {
  LOAN_REPAYMENT_METHODS,
  calculateLoanPayment,
  normalizeLoanMethod,
} from '../lib/loanInterest'
import { formatKRW } from '../lib/format'
import NumberInput from './NumberInput'

export default function LoanInterestCalculator({
  principal,
  rate,
  months,
  method,
  round,
  graceMonths,
  onChange,
  onApply,
}) {
  const repaymentMethod = normalizeLoanMethod(method)
  const result = calculateLoanPayment({
    principal,
    rate,
    months,
    method: repaymentMethod,
    round,
    graceMonths,
  })
  const showGrace = repaymentMethod === '거치 후 원리금균등상환'

  return (
    <div className="loan-interest-calculator">
      <div className="field">
        <label>타입</label>
        <input type="text" value="이자계산기" readOnly />
      </div>
      <div className="field">
        <label>상환방식</label>
        <select
          value={repaymentMethod}
          onChange={(e) => onChange('loanMethod', e.target.value)}
        >
          {LOAN_REPAYMENT_METHODS.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>대출원금 (원)</label>
        <NumberInput
          min="0"
          step="1"
          decimal={false}
          placeholder="0"
          value={principal}
          onChange={(value) => onChange('loanPrincipal', value)}
        />
      </div>
      <div className="field">
        <label>연이율 (%)</label>
        <NumberInput
          min="0"
          step="0.01"
          placeholder="예: 4.5"
          value={rate}
          onChange={(value) => onChange('loanRate', value)}
        />
      </div>
      <div className="field">
        <label>기간 (개월)</label>
        <NumberInput
          min="1"
          step="1"
          decimal={false}
          placeholder="1"
          value={months}
          onChange={(value) => onChange('loanMonths', value)}
        />
      </div>
      <div className="field">
        <label>현재회차</label>
        <NumberInput
          min="1"
          step="1"
          decimal={false}
          placeholder="1"
          value={round}
          onChange={(value) => onChange('loanRound', value)}
        />
      </div>
      {showGrace && (
        <div className="field">
          <label>거치개월</label>
          <NumberInput
            min="0"
            step="1"
            decimal={false}
            placeholder="0"
            value={graceMonths}
            onChange={(value) => onChange('loanGraceMonths', value)}
          />
        </div>
      )}
      <div className="loan-interest-result">
        <div className="loan-payment-summary">
          <span>{result.phase} {result.round}회차</span>
          <b>이자 {formatKRW(result.interest)}</b>
          <span>원금 {formatKRW(result.principalPayment)}</span>
          <span>납입 {formatKRW(result.totalPayment)}</span>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-accent"
          disabled={result.interest <= 0}
          onClick={() => onApply(result.interest)}
        >
          이자 적용
        </button>
      </div>
    </div>
  )
}
