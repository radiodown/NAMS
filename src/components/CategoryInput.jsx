import { useId, useMemo } from 'react'

function normalizeOption(option) {
  if (typeof option === 'string') return { value: option, label: option }
  return {
    value: option?.value ?? '',
    label: option?.label ?? option?.value ?? '',
  }
}

export default function CategoryInput({
  value = '',
  options = [],
  placeholder = '카테고리 입력',
  onChange,
  ariaLabel,
  ...props
}) {
  const inputId = useId().replace(/:/g, '')
  const listId = `${inputId}-category-options`
  const normalized = useMemo(() => {
    const seen = new Set()
    return options
      .map(normalizeOption)
      .filter((option) => {
        const key = String(option.value || '').trim()
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })
  }, [options])

  return (
    <>
      <input
        {...props}
        type="text"
        list={normalized.length ? listId : undefined}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        aria-label={ariaLabel || placeholder}
        onChange={(e) => onChange?.(e.target.value)}
      />
      {normalized.length > 0 && (
        <datalist id={listId}>
          {normalized.map((option) => (
            <option key={option.value} value={option.value} label={option.label} />
          ))}
        </datalist>
      )}
    </>
  )
}
