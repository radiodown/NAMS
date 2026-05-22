import DataControls from './DataControls'
import DriveBackup from './DriveBackup'

export default function SettingsModal({ onClose, onExport, onImport, onClear }) {
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
            />
          </section>

          <DriveBackup />

          <section className="settings-section">
            <div className="settings-section-head">
              <h4>데이터 초기화</h4>
            </div>
            <div className="settings-section-actions">
              <button className="btn btn-danger" onClick={onClear}>
                Clear
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
