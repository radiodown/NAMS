import { useRef } from 'react'

// Backup controls: export the whole wal-store document as raw JSON, and
// restore it by importing a JSON file.
export default function DataControls({ onExport, onImport, variant = 'compact' }) {
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
        accept=".json,application/json"
        onChange={handleFile}
        hidden
      />
      <button className="btn btn-ghost" onClick={() => inputRef.current?.click()}>
        가져오기
      </button>
      <button className="btn btn-primary" onClick={onExport}>
        내보내기
      </button>
    </div>
  )
}
