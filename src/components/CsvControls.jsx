import { useRef } from 'react'

export default function CsvControls({ onExport, onImport, variant = 'compact' }) {
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
        accept=".csv,text/csv"
        onChange={handleFile}
        hidden
      />
      <button className="btn btn-ghost" onClick={() => inputRef.current?.click()}>
        CSV 가져오기
      </button>
      <button className="btn btn-primary" onClick={onExport}>
        CSV 내보내기
      </button>
    </div>
  )
}
