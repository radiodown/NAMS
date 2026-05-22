import { cleanNumberInput, formatNumberInput } from '../lib/numberInput'

export default function NumberInput({
  value,
  onChange,
  decimal = true,
  inputMode,
  ...props
}) {
  return (
    <input
      {...props}
      type="text"
      inputMode={inputMode || (decimal ? 'decimal' : 'numeric')}
      value={formatNumberInput(value)}
      onChange={(e) => onChange(cleanNumberInput(e.target.value, { decimal }))}
    />
  )
}
