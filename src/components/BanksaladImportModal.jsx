import { useState } from 'react'

function formatMonthLabel(month) {
  const [year, monthNum] = month.split('-')
  return `${year}년 ${Number(monthNum)}월`
}

export default function BanksaladImportModal({ fileName, months, onCancel, onConfirm }) {
  const [selected, setSelected] = useState(() => new Set(months.map((m) => m.month)))

  function toggleMonth(month, checked) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(month)
      else next.delete(month)
      return next
    })
  }

  function toggleAll(checked) {
    setSelected(checked ? new Set(months.map((m) => m.month)) : new Set())
  }

  const allChecked = selected.size === months.length
  const totalIncome = months.reduce(
    (sum, m) => sum + (selected.has(m.month) ? m.incomeCount : 0),
    0
  )
  const totalExpense = months.reduce(
    (sum, m) => sum + (selected.has(m.month) ? m.expenseCount : 0),
    0
  )

  return (
    <div className="fixed-modal-backdrop" onClick={onCancel}>
      <div
        className="fixed-modal banksalad-import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="banksalad-import-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fixed-modal-head">
          <h3 id="banksalad-import-title">불러올 월 선택</h3>
          <button className="fixed-modal-close" onClick={onCancel} aria-label="닫기">
            ×
          </button>
        </div>

        {fileName && <p className="banksalad-import-file">{fileName}</p>}
        <p className="banksalad-import-hint">
          총 {months.length}개월치 내역이 있습니다. 가져올 월을 선택하세요.
        </p>

        <label className="banksalad-month-row banksalad-month-all">
          <input
            type="checkbox"
            checked={allChecked}
            onChange={(e) => toggleAll(e.target.checked)}
          />
          <span>전체 선택</span>
        </label>

        <div className="banksalad-month-list">
          {months.map((m) => (
            <label className="banksalad-month-row" key={m.month}>
              <input
                type="checkbox"
                checked={selected.has(m.month)}
                onChange={(e) => toggleMonth(m.month, e.target.checked)}
              />
              <span className="banksalad-month-name">{formatMonthLabel(m.month)}</span>
              <span className="banksalad-month-counts">
                수입 {m.incomeCount}건 · 지출 {m.expenseCount}건
              </span>
            </label>
          ))}
        </div>

        <div className="banksalad-import-total">
          선택됨: {selected.size}개월 (수입 {totalIncome}건, 지출 {totalExpense}건)
        </div>

        <div className="fixed-modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            취소
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={selected.size === 0}
            onClick={() => onConfirm([...selected])}
          >
            가져오기
          </button>
        </div>
      </div>
    </div>
  )
}
