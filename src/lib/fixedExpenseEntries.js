function dateForMonth(month, day) {
  const [year, monthNum] = month.split('-').map(Number)
  if (!year || !monthNum) return `${month}-01`
  const lastDay = new Date(year, monthNum, 0).getDate()
  const clamped = Math.min(Math.max(Number(day) || 1, 1), lastDay)
  return `${month}-${String(clamped).padStart(2, '0')}`
}

function paymentName(methods, id, fallback) {
  return methods.find((method) => method.id === id)?.name || fallback || '미지정'
}

export function fixedExpenseEntriesForMonth(items = [], month, paymentMethods = []) {
  if (!month) return []

  return items
    .filter(Boolean)
    .map((item) => {
      const paymentMethodId = item.paymentMethodId || ''
      return {
        id: `fixed-${item.id || item.name}-${month}`,
        type: '지출',
        date: dateForMonth(month, item.day),
        category: item.category || '기타',
        color: item.color || '',
        paymentMethodId,
        paymentMethod: paymentName(paymentMethods, paymentMethodId, item.paymentMethod),
        amount: Number(item.amount) || 0,
        memo: item.name || '고정지출',
        fixedId: item.id || '',
        virtualFixed: true,
      }
    })
}

export function fixedExpenseEntriesFromRecords(records = [], paymentMethods = []) {
  return records.filter(Boolean).map((record) => {
    const paymentMethodId = record.paymentMethodId || ''
    const day = record.day || '01'
    return {
      id: record.id || `fixed-record-${record.sourceId || record.name}-${record.month}`,
      type: '지출',
      date: `${record.month}-${String(day).padStart(2, '0')}`,
      category: record.category || '기타',
      color: record.color || '',
      paymentMethodId,
      paymentMethod: paymentName(paymentMethods, paymentMethodId, record.paymentMethod),
      amount: Number(record.amount) || 0,
      memo: record.name || '고정지출',
      fixedId: record.sourceId || '',
      fixedRecord: true,
    }
  })
}
