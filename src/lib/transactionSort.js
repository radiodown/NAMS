const KOREAN_COLLATOR = new Intl.Collator('ko-KR', {
  numeric: true,
  sensitivity: 'base',
})

export function defaultTransactionSortDirection(key) {
  return key === 'date' || key === 'amount' ? 'desc' : 'asc'
}

export function nextTransactionSort(current, key) {
  if (current.key === key) {
    return {
      key,
      direction: current.direction === 'asc' ? 'desc' : 'asc',
    }
  }
  return { key, direction: defaultTransactionSortDirection(key) }
}

export function sortTransactionRows(rows, sort, paymentLabel = () => '') {
  const direction = sort.direction === 'asc' ? 1 : -1

  return [...rows].sort((left, right) => {
    let primary = 0
    if (sort.key === 'amount') {
      primary = (Number(left.amount) || 0) - (Number(right.amount) || 0)
    } else {
      const leftValue =
        sort.key === 'paymentMethod'
          ? paymentLabel(left)
          : sort.key === 'category'
            ? left.category || '미분류'
            : sort.key === 'memo'
              ? left.memo || ''
              : left.date || ''
      const rightValue =
        sort.key === 'paymentMethod'
          ? paymentLabel(right)
          : sort.key === 'category'
            ? right.category || '미분류'
            : sort.key === 'memo'
              ? right.memo || ''
              : right.date || ''
      primary = KOREAN_COLLATOR.compare(String(leftValue), String(rightValue))
    }

    return (
      primary * direction ||
      (right.date || '').localeCompare(left.date || '') ||
      (Number(right.amount) || 0) - (Number(left.amount) || 0) ||
      String(left.id || '').localeCompare(String(right.id || ''))
    )
  })
}
