export default function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
}) {
  const active = sort.key === sortKey
  const directionLabel = active && sort.direction === 'asc' ? '오름차순' : '내림차순'
  const nextDirectionLabel =
    active && sort.direction === 'asc'
      ? '내림차순'
      : active
        ? '오름차순'
        : sortKey === 'date' || sortKey === 'amount'
          ? '내림차순'
          : '오름차순'

  return (
    <th
      className={`${align === 'right' ? 'col-right ' : ''}sortable-column`}
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className={`table-sort-button${active ? ' active' : ''}`}
        onClick={() => onSort(sortKey)}
        aria-label={`${label} ${nextDirectionLabel}으로 정렬`}
        title={`${label} ${nextDirectionLabel}으로 정렬`}
      >
        <span>{label}</span>
        <span className="table-sort-icon" aria-hidden="true">
          {active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
        </span>
        {active && <span className="sr-only">현재 {directionLabel}</span>}
      </button>
    </th>
  )
}
