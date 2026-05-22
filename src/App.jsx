import { useEffect, useMemo, useState } from 'react'
import { useLedger } from './lib/useLedger'
import { useFixedExpenses } from './lib/useFixedExpenses'
import { useInvestments } from './lib/useInvestments'
import { useCategories } from './lib/useCategories'
import { usePaymentMethods } from './lib/usePaymentMethods'
import { toCSV, fromCSV } from './lib/csv'
import { todayStr } from './lib/format'
import { STAGE_META, INVEST_COLOR, SUMMARY_COLOR } from './lib/categories'
import { fixedExpenseEntriesForMonth, fixedExpenseEntriesFromRecords } from './lib/fixedExpenseEntries'
import LedgerStage from './components/LedgerStage'
import InvestmentStage from './components/InvestmentStage'
import ExpenseManagementStage from './components/ExpenseManagementStage'
import SummaryStage from './components/SummaryStage'
import CsvControls from './components/CsvControls'

const TABS = ['수입', '지출', '지출 관리', '투자', '그래프요약']
const STAGE_STORAGE_KEY = 'wal-stage-config-yaml'
const THEME_STORAGE_KEY = 'wal-theme-settings-yaml'

const TAB_COLOR = {
  수입: STAGE_META.수입.color,
  지출: STAGE_META.지출.color,
  '지출 관리': STAGE_META.지출.color,
  투자: INVEST_COLOR,
  그래프요약: SUMMARY_COLOR,
}

function normalizeStageConfig(value) {
  const saved = Array.isArray(value) ? value : []
  const used = new Set()
  const ordered = []

  saved.forEach((stage) => {
    const name = typeof stage === 'string' ? stage : stage?.name
    if (!TABS.includes(name) || used.has(name)) return
    used.add(name)
    ordered.push({ name, visible: stage?.visible !== false })
  })

  TABS.forEach((name) => {
    if (!used.has(name)) ordered.push({ name, visible: true })
  })

  if (!ordered.some((stage) => stage.visible)) ordered[0].visible = true
  return ordered
}

function loadStageConfig() {
  try {
    return normalizeStageConfig(parseStageConfigYaml(localStorage.getItem(STAGE_STORAGE_KEY) || ''))
  } catch {
    return normalizeStageConfig([])
  }
}

function serializeStageConfig(config) {
  return [
    'stages:',
    ...normalizeStageConfig(config).flatMap((stage) => [
      `  - name: ${stage.name}`,
      `    visible: ${stage.visible ? 'true' : 'false'}`,
    ]),
  ].join('\n')
}

function parseStageConfigYaml(text) {
  const stages = []
  let current = null

  String(text || '').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('- name:')) {
      if (current) stages.push(current)
      current = { name: trimmed.slice('- name:'.length).trim(), visible: true }
    } else if (trimmed.startsWith('visible:') && current) {
      current.visible = trimmed.slice('visible:'.length).trim() !== 'false'
    }
  })

  if (current) stages.push(current)
  return stages
}

function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : 'light'
}

function loadTheme() {
  try {
    const line = String(localStorage.getItem(THEME_STORAGE_KEY) || '')
      .split(/\r?\n/)
      .find((item) => item.trim().startsWith('theme:'))
    return normalizeTheme(line?.split(':').slice(1).join(':').trim())
  } catch {
    return 'light'
  }
}

function serializeTheme(theme) {
  return `theme: ${normalizeTheme(theme)}`
}

function shiftMonth(month, offset) {
  const [year, monthNum] = month.split('-').map(Number)
  if (!year || !monthNum) return month
  const date = new Date(year, monthNum - 1 + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function completedMonthsThisYear(month) {
  const [year, monthNum] = month.split('-').map(Number)
  if (!year || !monthNum || monthNum <= 1) return []
  return Array.from(
    { length: monthNum - 1 },
    (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`
  )
}

function completedMonthsToRecord(month) {
  const months = completedMonthsThisYear(month)
  const previous = shiftMonth(month, -1)
  return previous && !months.includes(previous) ? [...months, previous] : months
}

export default function App() {
  const ledger = useLedger()
  const fixed = useFixedExpenses()
  const invest = useInvestments()
  const categoryStore = useCategories()
  const paymentMethods = usePaymentMethods()
  const { entries } = ledger
  const [tab, setTab] = useState('수입')
  const [stageConfig, setStageConfig] = useState(loadStageConfig)
  const [stageOpen, setStageOpen] = useState(false)
  const [dragStage, setDragStage] = useState('')
  const [theme, setTheme] = useState(loadTheme)
  const currentMonth = todayStr().slice(0, 7)
  const previousMonth = shiftMonth(currentMonth, -1)
  const transactionEntries = useMemo(
    () => entries.filter((entry) => !entry.fixedId),
    [entries]
  )
  const currentFixedEntries = useMemo(
    () => fixedExpenseEntriesForMonth(fixed.items, currentMonth, paymentMethods.items),
    [fixed.items, currentMonth, paymentMethods.items]
  )
  const previousFixedEntries = useMemo(
    () => {
      const records = fixed.records.filter((record) => record.month === previousMonth)
      return records.length > 0
        ? fixedExpenseEntriesFromRecords(records, paymentMethods.items)
        : fixedExpenseEntriesForMonth(fixed.items, previousMonth, paymentMethods.items)
    },
    [fixed.items, fixed.records, previousMonth, paymentMethods.items]
  )
  const fixedRecordEntries = useMemo(
    () =>
      fixedExpenseEntriesFromRecords(
        fixed.records.filter((record) => record.month < currentMonth),
        paymentMethods.items
      ),
    [currentMonth, fixed.records, paymentMethods.items]
  )
  const entriesWithCurrentFixed = useMemo(
    () => [...transactionEntries, ...fixedRecordEntries, ...currentFixedEntries],
    [transactionEntries, fixedRecordEntries, currentFixedEntries]
  )
  const visibleTabs = useMemo(
    () => stageConfig.filter((stage) => stage.visible).map((stage) => stage.name),
    [stageConfig]
  )

  useEffect(() => {
    try {
      localStorage.setItem(STAGE_STORAGE_KEY, serializeStageConfig(stageConfig))
    } catch {
      // skip silently
    }
  }, [stageConfig])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(THEME_STORAGE_KEY, serializeTheme(theme))
    } catch {
      // skip silently
    }
  }, [theme])

  useEffect(() => {
    if (!visibleTabs.includes(tab)) setTab(visibleTabs[0] || TABS[0])
  }, [tab, visibleTabs])

  useEffect(() => {
    completedMonthsToRecord(currentMonth).forEach((month) => {
      fixed.recordMonth(month, paymentMethods.items)
    })
  }, [currentMonth, fixed.recordMonth, paymentMethods.items])

  function exportCSV() {
    if (
      entries.length === 0 &&
      fixed.items.length === 0 &&
      fixed.records.length === 0 &&
      invest.items.length === 0 &&
      paymentMethods.items.length === 0
    ) {
      alert('내보낼 데이터가 없습니다.')
      return
    }
    const csv =
      '﻿' +
      toCSV({
        transactions: entries,
        fixedItems: fixed.items,
        fixedRecords: fixed.records,
        investments: invest.items,
        paymentMethods: paymentMethods.items,
      })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `가계부_${todayStr()}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function importCSV(file) {
    const reader = new FileReader()
    reader.onload = () => {
      const {
        transactions,
        fixedItems,
        fixedRecords,
        investments,
        paymentMethods: importedPaymentMethods,
      } = fromCSV(String(reader.result || ''))
      const total =
        transactions.length + fixedItems.length + fixedRecords.length + investments.length + importedPaymentMethods.length
      if (total === 0) {
        alert(
          'CSV에서 가져올 데이터를 찾지 못했습니다.\n헤더와 type 값(수입/지출/고정지출/고정지출기록/결제수단/예금/적금/주식)을 확인해 주세요.'
        )
        return
      }
      const current =
        entries.length + fixed.items.length + fixed.records.length + invest.items.length + paymentMethods.items.length
      if (
        current > 0 &&
        !window.confirm(
          `현재 모든 데이터(거래·고정지출·고정지출 기록·투자상품·결제수단) ${current}건을 CSV의 ${total}건으로 교체합니다.\n계속할까요?`
        )
      ) {
        return
      }
      ledger.replaceAll(transactions)
      fixed.replaceAll(fixedItems)
      fixed.replaceRecords(fixedRecords)
      invest.replaceAll(investments)
      paymentMethods.replaceAll(importedPaymentMethods)
      setTab('그래프요약')
      alert(
        `가져오기 완료\n· 거래 ${transactions.length}건\n· 고정지출 ${fixedItems.length}건\n· 고정지출 기록 ${fixedRecords.length}건\n· 투자상품 ${investments.length}건\n· 결제수단 ${importedPaymentMethods.length}건`
      )
    }
    reader.onerror = () => alert('파일을 읽지 못했습니다.')
    reader.readAsText(file, 'utf-8')
  }

  const counts = useMemo(() => {
    const c = { 수입: 0, 지출: 0, 투자: invest.items.length }
    transactionEntries.forEach((e) => {
      if (e.type === '수입' || e.type === '지출') c[e.type] += 1
    })
    return c
  }, [transactionEntries, invest.items])

  const visibleCount = stageConfig.filter((stage) => stage.visible).length

  function toggleStage(name) {
    setStageConfig((prev) =>
      normalizeStageConfig(
        prev.map((stage) =>
          stage.name === name && (prev.filter((item) => item.visible).length > 1 || !stage.visible)
            ? { ...stage, visible: !stage.visible }
            : stage
        )
      )
    )
  }

  function updateCategoryEverywhere(type, oldName, nextName) {
    const from = String(oldName || '').trim()
    const to = String(nextName || '').trim()
    if (!categoryStore.updateCategory(type, from, to)) return false

    ledger.replaceAll(
      entries.map((entry) =>
        entry.type === type && entry.category === from ? { ...entry, category: to } : entry
      )
    )

    if (type === '지출') {
      fixed.replaceAll(
        fixed.items.map((item) =>
          item.category === from ? { ...item, category: to } : item
        )
      )
    }

    return true
  }

  function updatePaymentMethodEverywhere(id, patch) {
    const current = paymentMethods.items.find((method) => method.id === id)
    const from = String(current?.name || '').trim()
    const to = String(patch?.name || '').trim()

    paymentMethods.updateItem(id, patch)

    if (!from || !to || from === to) return

    ledger.replaceAll(
      entries.map((entry) =>
        entry.type === '지출' &&
        (entry.paymentMethodId === id || entry.paymentMethod === from)
          ? { ...entry, paymentMethod: to }
          : entry
      )
    )

    fixed.replaceAll(
      fixed.items.map((item) =>
        item.paymentMethodId === id || item.paymentMethod === from
          ? { ...item, paymentMethod: to }
          : item
      )
    )
  }

  function replacePaymentMethodEverywhere(fromId, toId) {
    const fromMethod = paymentMethods.items.find((method) => method.id === fromId)
    const toMethod = paymentMethods.items.find((method) => method.id === toId)
    if (!fromMethod || !toMethod || fromMethod.id === toMethod.id) return false

    ledger.replaceAll(
      entries.map((entry) =>
        entry.type === '지출' &&
        (entry.paymentMethodId === fromMethod.id || entry.paymentMethod === fromMethod.name)
          ? { ...entry, paymentMethodId: toMethod.id, paymentMethod: toMethod.name }
          : entry
      )
    )

    fixed.replaceAll(
      fixed.items.map((item) =>
        item.paymentMethodId === fromMethod.id || item.paymentMethod === fromMethod.name
          ? { ...item, paymentMethodId: toMethod.id, paymentMethod: toMethod.name }
          : item
      )
    )

    return true
  }

  function sameStageOrder(a, b) {
    return a.length === b.length && a.every((stage, index) => stage.name === b[index]?.name)
  }

  function reorderStage(fromName, toName, afterTarget = false) {
    if (!fromName || !toName || fromName === toName) return
    setStageConfig((prev) => {
      const next = [...prev]
      const from = next.findIndex((stage) => stage.name === fromName)
      if (from < 0) return prev
      const [moved] = next.splice(from, 1)
      const target = next.findIndex((stage) => stage.name === toName)
      if (target < 0) return prev
      next.splice(target + (afterTarget ? 1 : 0), 0, moved)
      const normalized = normalizeStageConfig(next)
      return sameStageOrder(prev, normalized) ? prev : normalized
    })
  }

  function openStageSettings(e) {
    e.preventDefault()
    setStageOpen(true)
  }

  function toggleTheme() {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <h1>가계부</h1>
          <span>{visibleTabs.join(' · ')}</span>
        </div>
        <div className="header-actions">
          <button
            className={`theme-toggle ${theme}`}
            onClick={toggleTheme}
            aria-label={`${theme === 'dark' ? '라이트' : '다크'} 모드로 전환`}
          >
            <span className="theme-toggle-track">
              <span className="theme-toggle-thumb" />
            </span>
            <span className="theme-toggle-label">{theme === 'dark' ? 'Dark' : 'Light'}</span>
          </button>
          <CsvControls onExport={exportCSV} onImport={importCSV} variant="compact" />
        </div>
      </header>

      <nav className="tabs" onContextMenu={openStageSettings}>
        {visibleTabs.map((t) => (
          <button
            key={t}
            className={`tab${tab === t ? ' active' : ''}`}
            style={tab === t ? { '--tab-color': TAB_COLOR[t] } : undefined}
            onClick={() => setTab(t)}
          >
            {t}
            {counts[t] != null && <span className="count">{counts[t]}</span>}
          </button>
        ))}
      </nav>

      {stageOpen && (
        <div className="fixed-modal-backdrop" onClick={() => setStageOpen(false)}>
          <div
            className="fixed-modal stage-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fixed-modal-head">
              <h3>스테이지 설정</h3>
              <button
                className="fixed-modal-close"
                onClick={() => setStageOpen(false)}
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            <div className={`stage-manager-list${dragStage ? ' dragging' : ''}`}>
              {stageConfig.map((stage) => {
                const locked = stage.visible && visibleCount === 1
                return (
                  <div
                    className={`stage-manager-row${stage.visible ? '' : ' off'}${dragStage === stage.name ? ' dragging' : ''}`}
                    key={stage.name}
                    style={{ '--stage-color': TAB_COLOR[stage.name] }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      const rect = e.currentTarget.getBoundingClientRect()
                      const afterTarget = e.clientY > rect.top + rect.height / 2
                      reorderStage(dragStage, stage.name, afterTarget)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragStage('')
                    }}
                  >
                    <button
                      className={`stage-toggle${stage.visible ? ' on' : ''}`}
                      role="switch"
                      aria-checked={stage.visible}
                      disabled={locked}
                      onClick={() => toggleStage(stage.name)}
                      aria-label={`${stage.name} ${stage.visible ? '끄기' : '켜기'}`}
                    >
                      <span className="stage-toggle-thumb" />
                    </button>
                    <span className="stage-manager-name">{stage.name}</span>
                    <button
                      type="button"
                      className="stage-drag-handle"
                      draggable
                      onDragStart={(e) => {
                        setDragStage(stage.name)
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', stage.name)
                        const row = e.currentTarget.closest('.stage-manager-row')
                        if (row) {
                          e.dataTransfer.setDragImage(row, row.clientWidth - 18, row.clientHeight / 2)
                        }
                      }}
                      onDragEnd={() => setDragStage('')}
                      aria-label={`${stage.name} 순서 드래그`}
                    >
                      <span />
                      <span />
                      <span />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <div className="stage-transition" key={tab}>
        {tab === '그래프요약' ? (
          <SummaryStage
            entries={entriesWithCurrentFixed}
            investments={invest.items}
            onExport={exportCSV}
            onImport={importCSV}
          />
        ) : tab === '투자' ? (
          <InvestmentStage investments={invest} />
        ) : tab === '지출 관리' ? (
          <ExpenseManagementStage
            entries={transactionEntries}
            fixedItems={fixed.items}
            fixedRecords={fixed.records}
            paymentMethods={paymentMethods}
            updatePaymentMethod={updatePaymentMethodEverywhere}
            replacePaymentMethod={replacePaymentMethodEverywhere}
          />
        ) : (
          <LedgerStage
            key={tab}
            type={tab}
            entries={transactionEntries}
            addEntry={ledger.addEntry}
            updateEntry={ledger.updateEntry}
            removeEntry={ledger.removeEntry}
            fixed={fixed}
            fixedExpenseEntries={currentFixedEntries}
            previousFixedExpenseEntries={previousFixedEntries}
            categories={categoryStore.categories[tab] || STAGE_META[tab].categories}
            addCategory={categoryStore.addCategory}
            updateCategory={updateCategoryEverywhere}
            removeCategory={categoryStore.removeCategory}
            paymentMethods={paymentMethods.items}
            addPaymentMethod={paymentMethods.addItem}
          />
        )}
      </div>

      <footer className="app-footer">
        데이터는 이 브라우저에 자동 저장됩니다 · 백업하거나 다른 기기로 옮기려면 CSV로 내보내세요
      </footer>
    </div>
  )
}
