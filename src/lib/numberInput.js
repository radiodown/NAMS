export function cleanNumberInput(value, { decimal = true } = {}) {
  let text = String(value ?? '').replace(/,/g, '').replace(/\s/g, '')
  text = text.replace(decimal ? /[^\d.]/g : /\D/g, '')
  if (!decimal) return text

  const [head, ...tail] = text.split('.')
  return tail.length ? `${head}.${tail.join('')}` : head
}

export function cleanAmountInput(value) {
  let text = String(value ?? '')
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .toLowerCase()
    .replace(/[^0-9.억만천km]/g, '')
  const [head, ...tail] = text.split('.')
  if (tail.length) text = `${head}.${tail.join('')}`
  return text
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

export function formatAmountInput(value) {
  const text = String(value ?? '')
  if (!text) return ''
  if (/[억만천km]/i.test(text)) return cleanAmountInput(text)
  return formatNumberInput(text)
}

export function parseNumberInput(value) {
  const n = Number(cleanNumberInput(value))
  return Number.isFinite(n) ? n : 0
}

export function parseAmountInput(value) {
  const text = cleanAmountInput(value)
  if (!text) return 0

  if (/[억만천]/.test(text)) {
    let total = 0
    let matched = ''
    const pattern = /(\d+(?:\.\d+)?)(억|만|천)/g
    let match = pattern.exec(text)
    while (match) {
      const amount = Number(match[1])
      if (Number.isFinite(amount)) {
        const unit = match[2]
        const multiplier = unit === '억' ? 100000000 : unit === '만' ? 10000 : 1000
        total += amount * multiplier
        matched += match[0]
      }
      match = pattern.exec(text)
    }
    const leftover = text.replace(matched, '').replace(/[억만천]/g, '')
    const extra = Number(leftover)
    if (Number.isFinite(extra)) total += extra
    return Math.round(total)
  }

  const suffix = text.match(/^(\d+(?:\.\d+)?)([km])$/)
  if (suffix) {
    const amount = Number(suffix[1])
    if (!Number.isFinite(amount)) return 0
    return Math.round(amount * (suffix[2] === 'm' ? 1000000 : 1000))
  }

  const n = Number(cleanNumberInput(text))
  return Number.isFinite(n) ? n : 0
}
