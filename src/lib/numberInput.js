export function cleanNumberInput(value, { decimal = true } = {}) {
  let text = String(value ?? '').replace(/,/g, '').replace(/\s/g, '')
  text = text.replace(decimal ? /[^\d.]/g : /\D/g, '')
  if (!decimal) return text

  const [head, ...tail] = text.split('.')
  return tail.length ? `${head}.${tail.join('')}` : head
}

export function formatNumberInput(value) {
  const text = String(value ?? '')
  if (!text) return ''

  const negative = text.startsWith('-')
  const unsigned = negative ? text.slice(1) : text
  const [rawInt, rawDecimal] = unsigned.split('.')
  const normalizedInt = rawInt.replace(/^0+(?=\d)/, '')
  const intPart = normalizedInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const prefix = negative ? '-' : ''

  if (unsigned.endsWith('.')) return `${prefix}${intPart}.`
  if (rawDecimal != null) return `${prefix}${intPart}.${rawDecimal}`
  return `${prefix}${intPart}`
}

export function parseNumberInput(value) {
  const n = Number(cleanNumberInput(value))
  return Number.isFinite(n) ? n : 0
}
