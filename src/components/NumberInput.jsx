import { useState } from 'react'
import {
  cleanAmountInput,
  cleanNumberInput,
  formatAmountInput,
  formatNumberInput,
} from '../lib/numberInput'

export default function NumberInput({
  value,
  onChange,
  decimal = true,
  amount = false,
  inputMode,
  onCompositionStart,
  onCompositionEnd,
  ...props
}) {
  const [composing, setComposing] = useState(false)
  const [compositionDraft, setCompositionDraft] = useState('')

  const displayValue =
    amount && composing
      ? compositionDraft
      : amount
        ? formatAmountInput(value)
        : formatNumberInput(value)

  function handleChange(e) {
    if (!amount) {
      onChange(cleanNumberInput(e.target.value, { decimal }))
      return
    }

    const next = e.target.value
    if (composing || e.nativeEvent?.isComposing) {
      setCompositionDraft(next)
      onChange(next)
      return
    }
    onChange(cleanAmountInput(next))
  }

  return (
    <input
      {...props}
      type="text"
      inputMode={inputMode || (amount ? 'text' : decimal ? 'decimal' : 'numeric')}
      value={displayValue}
      onChange={handleChange}
      onCompositionStart={(e) => {
        if (amount) {
          setComposing(true)
          setCompositionDraft(e.currentTarget.value)
        }
        onCompositionStart?.(e)
      }}
      onCompositionEnd={(e) => {
        if (amount) {
          const next = cleanAmountInput(e.currentTarget.value)
          setComposing(false)
          setCompositionDraft(next)
          onChange(next)
        }
        onCompositionEnd?.(e)
      }}
    />
  )
}
