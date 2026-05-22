export function formatKRW(n) {
  return (Number(n) || 0).toLocaleString('ko-KR') + '원'
}

// Compact label for chart axes: 12,340,000 -> "1,234만"
export function compactKRW(n) {
  const v = Number(n) || 0
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1e8) {
    return sign + (abs / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '억'
  }
  if (abs >= 1e4) {
    return sign + Math.round(abs / 1e4).toLocaleString('ko-KR') + '만'
  }
  return sign + abs.toLocaleString('ko-KR')
}

export function monthOf(date) {
  return (date || '').slice(0, 7)
}

export function todayStr() {
  const d = new Date()
  const offset = d.getTimezoneOffset()
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10)
}
