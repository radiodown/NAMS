import { useEffect, useMemo, useState } from 'react'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function pad(n) {
  return String(n).padStart(2, '0')
}

function dateValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function monthValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

function yearValue(date) {
  return String(date.getFullYear())
}

function parseDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function parseMonth(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseYear(value) {
  const match = String(value || '').match(/^(\d{4})$/)
  if (!match) return null
  const date = new Date(Number(match[1]), 0, 1)
  return Number.isNaN(date.getTime()) ? null : date
}

function parseValue(value, mode) {
  if (mode === 'year') return parseYear(value)
  if (mode === 'month') return parseMonth(value)
  return parseDate(value)
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function addYears(date, amount) {
  return new Date(date.getFullYear() + amount, date.getMonth(), 1)
}

function labelFor(value, mode, placeholder) {
  const date = parseValue(value, mode)
  if (!date) return placeholder
  if (mode === 'year') return `${date.getFullYear()}년`
  if (mode === 'month') return `${date.getFullYear()}년 ${date.getMonth() + 1}월`
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

export default function CalendarInput({
  value = '',
  onChange,
  mode = 'date',
  placeholder = '날짜 선택',
  ariaLabel,
}) {
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(() => {
    const parsed = parseValue(value, mode)
    const base = parsed || new Date()
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })

  const selectedDate = useMemo(() => parseDate(value), [value])
  const selectedMonth = useMemo(() => parseMonth(value), [value])
  const selectedYear = useMemo(() => parseYear(value), [value])
  const empty = !value

  useEffect(() => {
    const parsed = parseValue(value, mode)
    if (parsed) setVisible(new Date(parsed.getFullYear(), parsed.getMonth(), 1))
  }, [mode, value])

  const days = useMemo(() => {
    const first = new Date(visible.getFullYear(), visible.getMonth(), 1)
    const start = new Date(first)
    start.setDate(1 - first.getDay())
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start)
      date.setDate(start.getDate() + index)
      return date
    })
  }, [visible])
  const yearStart = Math.floor(visible.getFullYear() / 12) * 12

  function pickDate(date) {
    onChange?.(dateValue(date))
    setOpen(false)
  }

  function pickMonth(month) {
    onChange?.(monthValue(new Date(visible.getFullYear(), month, 1)))
    setOpen(false)
  }

  function pickYear(year) {
    onChange?.(yearValue(new Date(year, 0, 1)))
    setOpen(false)
  }

  return (
    <div
      className="calendar-input"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <button
        type="button"
        className={`calendar-button${open ? ' open' : ''}${empty ? ' is-empty' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel || placeholder}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{labelFor(value, mode, placeholder)}</span>
        <span className="calendar-icon" aria-hidden="true">▦</span>
      </button>

      {open && (
        <div className={`calendar-menu ${mode}`} role="dialog" aria-label={ariaLabel || placeholder}>
          <div className="calendar-head">
            <button
              type="button"
              className="calendar-nav"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() =>
                setVisible((date) =>
                  mode === 'year' ? addYears(date, -12) : mode === 'month' ? addYears(date, -1) : addMonths(date, -1)
                )
              }
              aria-label="이전"
            >
              ‹
            </button>
            <strong>
              {mode === 'year'
                ? `${yearStart} - ${yearStart + 11}`
                : `${visible.getFullYear()}년${mode === 'date' ? ` ${visible.getMonth() + 1}월` : ''}`}
            </strong>
            <button
              type="button"
              className="calendar-nav"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() =>
                setVisible((date) =>
                  mode === 'year' ? addYears(date, 12) : mode === 'month' ? addYears(date, 1) : addMonths(date, 1)
                )
              }
              aria-label="다음"
            >
              ›
            </button>
          </div>

          {mode === 'year' ? (
            <div className="calendar-year-grid">
              {Array.from({ length: 12 }, (_, index) => {
                const year = yearStart + index
                const active = selectedYear && selectedYear.getFullYear() === year
                return (
                  <button
                    type="button"
                    className={`calendar-cell year${active ? ' selected' : ''}`}
                    key={year}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickYear(year)}
                  >
                    {year}
                  </button>
                )
              })}
            </div>
          ) : mode === 'month' ? (
            <div className="calendar-month-grid">
              {Array.from({ length: 12 }, (_, month) => {
                const active =
                  selectedMonth &&
                  selectedMonth.getFullYear() === visible.getFullYear() &&
                  selectedMonth.getMonth() === month
                return (
                  <button
                    type="button"
                    className={`calendar-cell month${active ? ' selected' : ''}`}
                    key={month}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickMonth(month)}
                  >
                    {month + 1}월
                  </button>
                )
              })}
            </div>
          ) : (
            <>
              <div className="calendar-weekdays">
                {WEEKDAYS.map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="calendar-grid">
                {days.map((date) => {
                  const valueKey = dateValue(date)
                  const selected = selectedDate && dateValue(selectedDate) === valueKey
                  const outside = date.getMonth() !== visible.getMonth()
                  const today = dateValue(new Date()) === valueKey
                  return (
                    <button
                      type="button"
                      className={`calendar-cell${selected ? ' selected' : ''}${outside ? ' outside' : ''}${today ? ' today' : ''}`}
                      key={valueKey}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickDate(date)}
                    >
                      {date.getDate()}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
