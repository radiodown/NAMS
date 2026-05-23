import { useEffect, useMemo, useState } from 'react'
import { useLedger } from './lib/useLedger'
import { useFixedExpenses } from './lib/useFixedExpenses'
import { useInvestments } from './lib/useInvestments'
import { useCategories } from './lib/useCategories'
import { usePaymentMethods } from './lib/usePaymentMethods'
import { todayStr } from './lib/format'
import { STAGE_META, INVEST_COLOR, SUMMARY_COLOR } from './lib/categories'
import { fixedExpenseEntriesForMonth, fixedExpenseEntriesFromRecords } from './lib/fixedExpenseEntries'
import LedgerStage from './components/LedgerStage'
import InvestmentStage from './components/InvestmentStage'
import ExpenseManagementStage from './components/ExpenseManagementStage'
import SummaryStage from './components/SummaryStage'
import SettingsModal from './components/SettingsModal'
import { clearStoredData as clearAppStoredData, useStoredSlice } from './lib/store'
import { STAGE_TABS as TABS, normalizeStageConfig, defaultStageConfig } from './lib/schema'
import {
  BACKUP_MIME,
  backupFileName,
  countBackupItems,
  createBackupText,
  importBackupDocument,
  parseBackupText,
} from './lib/backup'
import { STORE_PATHS } from './lib/storePaths'
import {
  isConfigured as isDriveConfigured,
  getSavedConnection,
  saveBackup as saveDriveBackup,
} from './lib/googleDrive'

const TAB_COLOR = {
  수입: STAGE_META.수입.color,
  지출: STAGE_META.지출.color,
  '지출 관리': STAGE_META.지출.color,
  투자: INVEST_COLOR,
  그래프요약: SUMMARY_COLOR,
}

function shiftMonth(month, offset) {
  const [year, monthNum] = month.split('-').map(Number)
  if (!year || !monthNum) return month
  const date = new Date(year, monthNum - 1 + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export default function App() {
  const ledger = useLedger()
  const fixed = useFixedExpenses()
  const invest = useInvestments()
  const categoryStore = useCategories()
  const paymentMethods = usePaymentMethods()
  const { entries } = ledger
  const [tab, setTab] = useState('수입')
  const [stageConfig, setStageConfig] = useStoredSlice(
    STORE_PATHS.settings.stages,
    defaultStageConfig
  )
  const [stageOpen, setStageOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dragStage, setDragStage] = useState('')
  const [theme, setTheme] = useStoredSlice(STORE_PATHS.settings.theme, 'light')
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
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    if (!visibleTabs.includes(tab)) setTab(visibleTabs[0] || TABS[0])
  }, [tab, visibleTabs])

  useEffect(() => {
    const last = fixed.lastActiveMonth
    if (last && last < currentMonth) {
      fixed.recordMonth(last, paymentMethods.items)
    }
    if (last !== currentMonth) {
      fixed.setLastActiveMonth(currentMonth)
    }
  }, [currentMonth, fixed.lastActiveMonth, fixed.recordMonth, fixed.setLastActiveMonth, paymentMethods.items])

  function exportJSON() {
    const blob = new Blob([createBackupText()], { type: BACKUP_MIME })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = backupFileName()
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function importJSON(file) {
    const reader = new FileReader()
    reader.onload = () => {
      let parsed
      try {
        parsed = parseBackupText(reader.result)
      } catch (error) {
        alert(error?.message || '백업 파일을 읽지 못했습니다.')
        return
      }
      const count = countBackupItems(parsed)
      if (
        !window.confirm(
          `현재 데이터를 이 백업(거래·고정지출·투자 ${count}건)으로 모두 교체합니다.\n계속할까요?`
        )
      ) {
        return
      }
      importBackupDocument(parsed)
      window.location.reload()
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

  function clearStoredData() {
    if (!window.confirm('저장된 모든 데이터를 삭제할까요?')) return
    clearAppStoredData()
    window.location.reload()
  }

  useEffect(() => {
    let saving = false

    function handleShortcut(e) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      if (saving) return

      if (isDriveConfigured() && getSavedConnection()?.connected) {
        saving = true
        saveDriveBackup()
          .catch((error) => {
            alert(`구글 드라이브 저장 실패: ${error?.message || error}`)
          })
          .finally(() => {
            saving = false
          })
        return
      }

      exportJSON()
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <h1>NAMS</h1>
          <span>Next Asset Management System</span>
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
          <button
            className="settings-button"
            onClick={() => setSettingsOpen(true)}
            aria-label="설정 열기"
            title="설정"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Z" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.05.05a2.05 2.05 0 0 1-2.9 2.9l-.05-.05A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.08A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.05.05a2.05 2.05 0 0 1-2.9-2.9l.05-.05A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.08A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.05-.05a2.05 2.05 0 0 1 2.9-2.9l.05.05A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.08A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.05-.05a2.05 2.05 0 0 1 2.9 2.9l-.05.05A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
            </svg>
          </button>
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

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onExport={exportJSON}
          onImport={importJSON}
          onClear={clearStoredData}
        />
      )}

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
          <SummaryStage entries={entriesWithCurrentFixed} investments={invest.items} />
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
        데이터는 이 브라우저에 자동 저장됩니다 · 백업하거나 다른 기기로 옮기려면 JSON으로 내보내세요
      </footer>
    </div>
  )
}
