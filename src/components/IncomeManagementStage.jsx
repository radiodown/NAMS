import { useMemo, useState } from 'react'
import { STAGE_META } from '../lib/categories'
import { fixedIncomeEntriesForMonth, fixedIncomeEntriesFromRecords } from '../lib/fixedExpenseEntries'
import { formatKRW, monthOf, todayStr } from '../lib/format'
import CalendarInput from './CalendarInput'

function pct(value, max) {
  return max > 0 ? Math.min(100, (value / max) * 100) : 0
}

function sumBy(rows, keyFn) {
  const map = new Map()
  rows.forEach((row) => {
    const key = keyFn(row)
    map.set(key, (map.get(key) || 0) + (Number(row.amount) || 0))
  })
  return [...map.entries()]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
}

function monthsOfYear(year) {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
}

export default function IncomeManagementStage({
  entries,
  fixedItems = [],
  fixedRecords = [],
}) {
  const [month, setMonth] = useState(() => todayStr().slice(0, 7))
  const [year, setYear] = useState(() => todayStr().slice(0, 4))
  const [periodMode, setPeriodMode] = useState('month')
  const [historySearch, setHistorySearch] = useState('')
  const currentMonth = todayStr().slice(0, 7)
  const periodLabel = periodMode === 'year' ? `${year}년` : month

  const fixedRows = useMemo(
    () => {
      const months = (periodMode === 'year' ? monthsOfYear(year) : [month]).filter(
        (targetMonth) => targetMonth <= currentMonth
      )
      return months.flatMap((targetMonth) => {
        const records = fixedRecords.filter((record) => record.month === targetMonth)
        if (records.length > 0) return fixedIncomeEntriesFromRecords(records)
        if (targetMonth === currentMonth) return fixedIncomeEntriesForMonth(fixedItems, targetMonth)
        return []
      })
    },
    [currentMonth, fixedItems, fixedRecords, month, periodMode, year]
  )

  const rows = useMemo(
    () => [
      ...entries.filter((entry) =>
        entry.type === '수입' &&
        (periodMode === 'year'
          ? monthOf(entry.date).startsWith(`${year}-`)
          : monthOf(entry.date) === month)
      ),
      ...fixedRows,
    ],
    [entries, fixedRows, month, periodMode, year]
  )

  const total = useMemo(() => rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0), [rows])
  const fixedTotal = useMemo(
    () => rows.filter((row) => row.fixedId).reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    [rows]
  )
  const manualTotal = total - fixedTotal
  const byCategory = useMemo(() => sumBy(rows, (row) => row.category || '미분류'), [rows])
  const bySource = useMemo(
    () => sumBy(rows, (row) => (row.fixedId ? '고정수입' : '수동입력')),
    [rows]
  )
  const allListRows = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          (b.date || '').localeCompare(a.date || '') ||
          (Number(b.amount) || 0) - (Number(a.amount) || 0)
      ),
    [rows]
  )
  const listRows = useMemo(() => {
    const query = historySearch.trim().toLowerCase()
    if (!query) return allListRows
    return allListRows.filter((row) =>
      [
        row.date,
        row.fixedId ? '고정수입 고정' : '수동입력 수동',
        row.category,
        row.memo,
        formatKRW(row.amount),
        String(row.amount || ''),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
    )
  }, [allListRows, historySearch])
  const topCategory = byCategory[0]

  return (
    <div className="stage income-management" style={{ '--accent': STAGE_META.수입.color }}>
      <div className="management-head">
        <div>
          <h2 className="section-title">수입 관리</h2>
          <p>선택한 기간의 수입 흐름과 고정수입 반영 내역을 봅니다.</p>
        </div>
        <div className="month-picker">
          <span>분석 기간</span>
          <div className="period-toggle" role="group" aria-label="분석 기간 단위">
            <button
              type="button"
              className={periodMode === 'month' ? 'on' : ''}
              onClick={() => setPeriodMode('month')}
            >
              월
            </button>
            <button
              type="button"
              className={periodMode === 'year' ? 'on' : ''}
              onClick={() => setPeriodMode('year')}
            >
              년
            </button>
          </div>
          <CalendarInput
            mode={periodMode}
            value={periodMode === 'year' ? year : month}
            onChange={periodMode === 'year' ? setYear : setMonth}
            placeholder={periodMode === 'year' ? '연도 선택' : '월 선택'}
            ariaLabel="분석 기간"
          />
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">{periodLabel} 수입</div>
          <div className="value accent">{formatKRW(total)}</div>
        </div>
        <div className="stat-card">
          <div className="label">고정수입</div>
          <div className="value">{formatKRW(fixedTotal)}</div>
        </div>
        <div className="stat-card">
          <div className="label">수동입력</div>
          <div className="value">{formatKRW(manualTotal)}</div>
        </div>
        <div className="stat-card">
          <div className="label">가장 큰 카테고리</div>
          <div className="value">{topCategory ? topCategory.name : '-'}</div>
        </div>
      </div>

      <div className="income-management-grid">
        <div className="card">
          <h2 className="section-title">수입 구분</h2>
          <div className="rank-list">
            {bySource.length === 0 ? (
              <div className="empty" style={{ padding: '36px 10px' }}>선택한 기간의 수입이 없습니다.</div>
            ) : (
              bySource.map((row) => (
                <div className="rank-row" key={row.name}>
                  <span>{row.name}</span>
                  <b>{formatKRW(row.amount)}</b>
                  <div className="usage-bar">
                    <i style={{ width: `${pct(row.amount, bySource[0].amount)}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="section-title">카테고리별 수입</h2>
          <div className="rank-list">
            {byCategory.length === 0 ? (
              <div className="empty" style={{ padding: '36px 10px' }}>선택한 기간의 수입이 없습니다.</div>
            ) : (
              byCategory.slice(0, 8).map((row) => (
                <div className="rank-row" key={row.name}>
                  <span>{row.name}</span>
                  <b>{formatKRW(row.amount)}</b>
                  <div className="usage-bar">
                    <i style={{ width: `${pct(row.amount, byCategory[0].amount)}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">수입 내역</h2>
        {allListRows.length > 0 && (
          <div className="ledger-filter-bar management-history-search">
            <div className="ledger-filter-field ledger-filter-search">
              <span>검색</span>
              <input
                type="search"
                placeholder="날짜, 구분, 카테고리, 메모, 금액"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
              />
            </div>
            <div className="ledger-filter-actions">
              <button
                type="button"
                className="btn btn-sm"
                disabled={!historySearch.trim()}
                onClick={() => setHistorySearch('')}
              >
                초기화
              </button>
            </div>
          </div>
        )}
        {allListRows.length === 0 ? (
          <div className="empty">
            <strong>선택한 기간의 수입이 없습니다</strong>
            기간을 바꾸거나 수입 항목을 추가해 보세요.
          </div>
        ) : listRows.length === 0 ? (
          <div className="empty">
            <strong>조건에 맞는 수입 내역이 없습니다</strong>
            검색어를 조정해 보세요.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="ledger-table income-history-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>구분</th>
                  <th>카테고리</th>
                  <th className="col-right">금액</th>
                  <th>메모</th>
                </tr>
              </thead>
              <tbody>
                {listRows.map((row, index) => (
                  <tr key={`${row.id || 'income'}-${row.date}-${index}`}>
                    <td data-label="날짜">{row.date || '-'}</td>
                    <td data-label="구분">
                      <span className="mini-tag">{row.fixedId ? '고정' : '수동'}</span>
                    </td>
                    <td data-label="카테고리">
                      <span className="tag">{row.category || '미분류'}</span>
                    </td>
                    <td className="amount" data-label="금액">{formatKRW(row.amount)}</td>
                    <td className="memo" data-label="메모">{row.memo || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
