export function formatKRW(n) {
  const value = Math.round(Number(n) || 0)
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs < 10000) return sign + abs.toLocaleString('ko-KR') + '원'

  const roundedMan = Math.round(abs / 10000)
  if (roundedMan < 100) {
    return (
      sign +
      (abs / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) +
      '만원'
    )
  }
  if (roundedMan < 10000) return sign + roundedMan.toLocaleString('ko-KR') + '만원'

  const jo = Math.floor(roundedMan / 100000000)
  const afterJo = roundedMan % 100000000
  const eok = Math.floor(afterJo / 10000)
  const man = afterJo % 10000
  const parts = []
  if (jo > 0) parts.push(`${jo.toLocaleString('ko-KR')}조`)
  if (eok > 0) parts.push(`${eok.toLocaleString('ko-KR')}억`)
  if (man > 0) parts.push(`${man.toLocaleString('ko-KR')}만원`)

  const text = parts.join(' ')
  return sign + (man > 0 ? text : `${text}원`)
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
