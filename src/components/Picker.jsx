import { useMemo, useState } from 'react'

function normalizeOption(option) {
  if (typeof option === 'string') return { value: option, label: option }
  return {
    value: option?.value ?? '',
    label: option?.label ?? option?.value ?? '',
  }
}

export default function Picker({ value = '', options = [], placeholder = '선택', onChange, ariaLabel }) {
  const [open, setOpen] = useState(false)
  const normalized = useMemo(() => options.map(normalizeOption), [options])
  const selected = normalized.find((option) => String(option.value) === String(value))

  function pick(option) {
    onChange?.(option.value)
    setOpen(false)
  }

  return (
    <div
      className="picker"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <button
        type="button"
        className={`picker-button${open ? ' open' : ''}${selected ? '' : ' is-empty'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel || placeholder}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected?.label || placeholder}</span>
        <span className="picker-arrow" aria-hidden="true">v</span>
      </button>

      {open && (
        <div className="picker-menu" role="listbox">
          {normalized.length === 0 ? (
            <div className="picker-empty">항목 없음</div>
          ) : (
            normalized.map((option) => {
              const active = String(option.value) === String(value)
              return (
                <button
                  type="button"
                  className={`picker-option${active ? ' on' : ''}`}
                  role="option"
                  aria-selected={active}
                  key={`${option.value}-${option.label}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(option)}
                >
                  {option.label}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
