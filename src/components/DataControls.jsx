import { useRef } from 'react'
import { BACKUP_ACCEPT } from '../lib/backup'

// Backup controls: export the whole browser document as raw JSON, and
// restore it by importing a JSON file.
function LocalActionIcon({ type }) {
  if (type === 'save') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
        <path d="M17 21v-8H7v8" />
        <path d="M7 3v5h8" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  )
}

export default function DataControls({
  onExport,
  onImport,
  variant = 'compact',
  importLabel = '가져오기',
  exportLabel = '내보내기',
}) {
  const inputRef = useRef(null)

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (file) onImport(file)
    e.target.value = '' // allow re-importing the same file
  }

  return (
    <div className={`csv-controls ${variant}`}>
      <input
        ref={inputRef}
        type="file"
        accept={BACKUP_ACCEPT}
        onChange={handleFile}
        hidden
      />
      <button type="button" className="btn btn-primary drive-action-btn" onClick={onExport}>
        <LocalActionIcon type="save" />
        {exportLabel}
      </button>
      <button
        type="button"
        className="btn btn-ghost drive-action-btn"
        onClick={() => inputRef.current?.click()}
      >
        <LocalActionIcon type="load" />
        {importLabel}
      </button>
    </div>
  )
}
