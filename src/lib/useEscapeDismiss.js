import { useEffect, useRef } from 'react'

const dismissStack = []

function handleEscape(event) {
  if (
    event.key !== 'Escape' ||
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat
  ) {
    return
  }

  const entry = dismissStack[dismissStack.length - 1]
  if (!entry) return

  event.preventDefault()
  event.stopPropagation()
  entry.dismiss()
}

function removeEntry(entry) {
  const index = dismissStack.lastIndexOf(entry)
  if (index >= 0) dismissStack.splice(index, 1)
  if (dismissStack.length === 0) {
    document.removeEventListener('keydown', handleEscape, true)
  }
}

export function useEscapeDismiss(onDismiss, active = true) {
  const dismissRef = useRef(onDismiss)

  useEffect(() => {
    dismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    if (!active) return undefined

    const entry = {
      dismiss: () => dismissRef.current?.(),
    }
    dismissStack.push(entry)
    if (dismissStack.length === 1) {
      document.addEventListener('keydown', handleEscape, true)
    }

    return () => removeEntry(entry)
  }, [active])
}
