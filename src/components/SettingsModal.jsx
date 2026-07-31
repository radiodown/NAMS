import { useState } from 'react'
import { useEscapeDismiss } from '../lib/useEscapeDismiss'
import CalendarInput from './CalendarInput'
import DataControls from './DataControls'
import DriveBackup from './DriveBackup'

export default function SettingsModal({
  onClose,
  onExport,
  onImport,
  onClear,
  onClearMonth,
  onFillSample,
  importAccept,
  monthDeletionSummary = {},
  maxDeleteMonth = '',
}) {
  const [deleteMonth, setDeleteMonth] = useState('')
  useEscapeDismiss(onClose)
  const deleteSummary = monthDeletionSummary[deleteMonth] || null
  const deleteCount = deleteSummary?.total || 0

  return (
    <div className="fixed-modal-backdrop" onClick={onClose}>
      <div
        className="fixed-modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fixed-modal-head">
          <h3 id="settings-title">설정</h3>
          <button className="fixed-modal-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        <div className="settings-list">
          <section className="settings-section">
            <div className="settings-section-head">
              <h4>로컬 저장/불러오기</h4>
            </div>
            <DataControls
              onExport={onExport}
              onImport={onImport}
              variant="settings"
              exportLabel="저장"
              importLabel="불러오기"
              accept={importAccept}
            />
          </section>

          <DriveBackup />

          <section className="settings-section settings-month-delete-section">
            <div className="settings-section-head">
              <h4>특정 월 데이터 삭제</h4>
              <p>해당 월의 수입·지출과 월별 고정 처리 기록만 삭제합니다.</p>
            </div>
            <div className="settings-month-delete-controls">
              <CalendarInput
                mode="month"
                value={deleteMonth}
                onChange={setDeleteMonth}
                placeholder="삭제할 월 선택"
                ariaLabel="삭제할 월"
                max={maxDeleteMonth}
              />
              <button
                type="button"
                className="btn btn-danger"
                disabled={!deleteMonth || deleteCount === 0}
                onClick={() => onClearMonth?.(deleteMonth)}
              >
                이 월 삭제
              </button>
            </div>
            {deleteMonth && (
              <div className={`settings-month-delete-preview${deleteCount === 0 ? ' is-empty' : ''}`}>
                {deleteCount === 0 ? (
                  <span>선택한 월에 삭제할 데이터가 없습니다.</span>
                ) : (
                  <>
                    <span>수입 <b>{deleteSummary.incomeEntries}건</b></span>
                    <span>지출 <b>{deleteSummary.expenseEntries}건</b></span>
                    <span>고정수입 <b>{deleteSummary.fixedIncomeRecords}건</b></span>
                    <span>고정지출 <b>{deleteSummary.fixedExpenseRecords}건</b></span>
                  </>
                )}
              </div>
            )}
            <small className="settings-month-delete-note">
              고정 항목 원본·투자자산·다른 월 데이터는 유지됩니다.
            </small>
          </section>

          <section className="settings-section">
            <div className="settings-section-head">
              <h4>데이터 초기화</h4>
            </div>
            <div className="settings-section-actions settings-danger-actions">
              <button className="btn btn-danger" onClick={onClear}>
                Clear
              </button>
              <button className="btn btn-primary" onClick={onFillSample}>
                샘플 데이터 채우기
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
