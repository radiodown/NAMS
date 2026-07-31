import { useEffect, useRef, useState } from 'react'
import { subscribeUndo, undoLastChange } from '../lib/store'

const DISMISS_MS = 6000

export default function UndoToast() {
  const [entry, setEntry] = useState(null)
  const lastIdRef = useRef(null)
  const timerRef = useRef(null)

  useEffect(() => {
    return subscribeUndo((top) => {
      if (!top || top.id === lastIdRef.current) return
      lastIdRef.current = top.id
      setEntry(top)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setEntry(null), DISMISS_MS)
    })
  }, [])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  if (!entry) return null

  function handleUndo() {
    clearTimeout(timerRef.current)
    undoLastChange()
    setEntry(null)
  }

  return (
    <div className="undo-toast" role="status">
      <span className="undo-toast-label">{entry.label}</span>
      <button type="button" className="undo-toast-btn" onClick={handleUndo}>
        실행 취소
      </button>
    </div>
  )
}
