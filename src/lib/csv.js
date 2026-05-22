// Single unified CSV holding every kind of record:
//  - 수입 / 지출        : transactions
//  - 고정지출            : fixed-expense templates
//  - 고정지출기록        : finalized monthly fixed-expense snapshots
//  - 예금 / 적금 / 주식  : investment products
// Each row only fills the columns relevant to its `type`; the rest stay blank.
import { createId } from './id'

const HEADER = [
  'id',
  'type',
  'date',
  'name',
  'category',
  'amount',
  'memo',
  'fixedId',
  'paymentMethodId',
  'paymentMethod',
  'day',
  'color',
  'kind',
  'annualFee',
  'monthlyLimit',
  'monthlyTarget',
  'rate',
  'months',
  'method',
  'round',
  'shares',
  'buyPrice',
  'quoteSymbol',
  'quoteCurrency',
  'quoteTime',
  'currentPrice',
]

const TX_TYPES = ['수입', '지출']

function escapeCell(value) {
  const s = String(value ?? '')
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export function toCSV({
  transactions = [],
  fixedItems = [],
  fixedRecords = [],
  investments = [],
  paymentMethods = [],
}) {
  const lines = [HEADER.join(',')]
  const push = (obj) => lines.push(HEADER.map((h) => escapeCell(obj[h])).join(','))

  for (const e of transactions) {
    push({
      id: e.id,
      type: e.type,
      date: e.date,
      category: e.category,
      amount: e.amount,
      memo: e.memo,
      fixedId: e.fixedId,
      paymentMethodId: e.paymentMethodId,
      paymentMethod: e.paymentMethod,
    })
  }
  for (const f of fixedItems) {
    push({
      id: f.id,
      type: '고정지출',
      name: f.name,
      category: f.category,
      amount: f.amount,
      day: f.day,
      color: f.color,
      paymentMethodId: f.paymentMethodId,
      paymentMethod: f.paymentMethod,
    })
  }
  for (const r of fixedRecords) {
    push({
      id: r.id,
      type: '고정지출기록',
      date: r.month ? `${r.month}-${String(r.day || 1).padStart(2, '0')}` : '',
      name: r.name,
      category: r.category,
      amount: r.amount,
      fixedId: r.sourceId,
      day: r.day,
      color: r.color,
      paymentMethodId: r.paymentMethodId,
      paymentMethod: r.paymentMethod,
    })
  }
  for (const method of paymentMethods) {
    push({
      id: method.id,
      type: '결제수단',
      name: method.name,
      kind: method.kind,
      annualFee: method.annualFee,
      monthlyLimit: method.monthlyLimit,
      monthlyTarget: method.monthlyTarget,
    })
  }
  for (const p of investments) {
    if (p.kind === '주식') {
      push({
        id: p.id,
        type: '주식',
        date: p.date,
        name: p.name,
        memo: p.memo,
        shares: p.shares,
        buyPrice: p.buyPrice,
        quoteSymbol: p.quoteSymbol,
        quoteCurrency: p.quoteCurrency,
        quoteTime: p.quoteTime,
        currentPrice: p.currentPrice,
      })
    } else {
      push({
        id: p.id,
        type: p.kind,
        date: p.date,
        name: p.name,
        amount: p.kind === '예금' ? p.principal : p.monthly,
        memo: p.memo,
        rate: p.rate,
        months: p.months,
        method: p.method,
        round: p.kind === '적금' ? p.round : '',
      })
    }
  }
  return lines.join('\r\n')
}

// RFC 4180-ish parser: handles quoted fields, escaped quotes and newlines.
function parseRows(text) {
  let input = text
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1) // strip BOM

  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false
  let i = 0

  while (i < input.length) {
    const ch = input[i]
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      cell += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(cell)
      cell = ''
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i++
      continue
    }
    cell += ch
    i++
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export function fromCSV(text) {
  const result = { transactions: [], fixedItems: [], fixedRecords: [], investments: [], paymentMethods: [] }
  const rows = parseRows(text)
  if (rows.length < 2) return result

  const header = rows[0].map((h) => h.trim().toLowerCase())
  const idx = (name) => header.indexOf(name)
  const I = {
    id: idx('id'),
    type: idx('type'),
    date: idx('date'),
    name: idx('name'),
    category: idx('category'),
    amount: idx('amount'),
    memo: idx('memo'),
    fixedId: idx('fixedid'),
    paymentMethodId: idx('paymentmethodid'),
    paymentMethod: idx('paymentmethod'),
    day: idx('day'),
    color: idx('color'),
    kind: idx('kind'),
    annualFee: idx('annualfee'),
    monthlyLimit: idx('monthlylimit'),
    monthlyTarget: idx('monthlytarget'),
    rate: idx('rate'),
    months: idx('months'),
    method: idx('method'),
    round: idx('round'),
    shares: idx('shares'),
    buyPrice: idx('buyprice'),
    quoteSymbol: idx('quotesymbol'),
    quoteCurrency: idx('quotecurrency'),
    quoteTime: idx('quotetime'),
    currentPrice: idx('currentprice'),
  }
  const num = (v) => {
    const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''))
    return Number.isFinite(n) ? n : 0
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const g = (i) => (i >= 0 && i < row.length ? row[i] : '')
    const type = g(I.type).trim()
    const id = g(I.id).trim() || createId()

    if (TX_TYPES.includes(type)) {
      result.transactions.push({
        id,
        type,
        date: g(I.date).trim(),
        category: g(I.category).trim() || '미분류',
        amount: num(g(I.amount)),
        memo: g(I.memo).trim(),
        fixedId: g(I.fixedId).trim(),
        paymentMethodId: g(I.paymentMethodId).trim(),
        paymentMethod: g(I.paymentMethod).trim(),
      })
    } else if (type === '고정지출') {
      const dayRaw = g(I.day).trim()
      result.fixedItems.push({
        id,
        name: g(I.name).trim() || '(이름 없음)',
        category: g(I.category).trim() || '기타',
        amount: num(g(I.amount)),
        day: dayRaw === '' ? '' : num(dayRaw),
        color: g(I.color).trim(),
        paymentMethodId: g(I.paymentMethodId).trim(),
        paymentMethod: g(I.paymentMethod).trim(),
      })
    } else if (type === '고정지출기록') {
      const dayRaw = g(I.day).trim()
      result.fixedRecords.push({
        id,
        month: g(I.date).trim().slice(0, 7),
        sourceId: g(I.fixedId).trim(),
        name: g(I.name).trim() || '고정지출',
        category: g(I.category).trim() || '기타',
        amount: num(g(I.amount)),
        day: dayRaw === '' ? '' : num(dayRaw),
        color: g(I.color).trim(),
        paymentMethodId: g(I.paymentMethodId).trim(),
        paymentMethod: g(I.paymentMethod).trim(),
      })
    } else if (type === '결제수단') {
      result.paymentMethods.push({
        id,
        name: g(I.name).trim() || '(이름 없음)',
        kind: g(I.kind).trim() || '카드',
        annualFee: g(I.annualFee).trim() === '' ? '' : num(g(I.annualFee)),
        monthlyLimit: g(I.monthlyLimit).trim() === '' ? '' : num(g(I.monthlyLimit)),
        monthlyTarget: g(I.monthlyTarget).trim() === '' ? '' : num(g(I.monthlyTarget)),
      })
    } else if (type === '예금' || type === '적금') {
      const roundRaw = g(I.round).trim()
      const p = {
        id,
        kind: type,
        name: g(I.name).trim() || '(이름 없음)',
        date: g(I.date).trim(),
        memo: g(I.memo).trim(),
        rate: num(g(I.rate)),
        months: num(g(I.months)),
        method: g(I.method).trim() === '복리' ? '복리' : '단리',
      }
      if (type === '예금') {
        p.principal = num(g(I.amount))
      } else {
        p.monthly = num(g(I.amount))
        p.round = roundRaw === '' ? '' : num(roundRaw)
      }
      result.investments.push(p)
    } else if (type === '주식') {
      result.investments.push({
        id,
        kind: '주식',
        name: g(I.name).trim() || '(이름 없음)',
        date: g(I.date).trim(),
        memo: g(I.memo).trim(),
        shares: num(g(I.shares)),
        buyPrice: num(g(I.buyPrice)),
        quoteSymbol: g(I.quoteSymbol).trim(),
        quoteCurrency: g(I.quoteCurrency).trim(),
        quoteTime: g(I.quoteTime).trim(),
        currentPrice: num(g(I.currentPrice)),
      })
    }
  }
  return result
}
