import { useEffect, useMemo, useRef, useState } from 'react'
import { STAGE_META } from '../lib/categories'
import { formatKRW } from '../lib/format'
import { createId } from '../lib/id'
import { isLoanInterestCategory } from '../lib/loanInterest'
import { parseAmountInput, parseNumberInput } from '../lib/numberInput'
import LoanInterestCalculator from './LoanInterestCalculator'
import NumberInput from './NumberInput'
import Picker from './Picker'
import PlusIcon from './PlusIcon'

const blankForm = () => ({
  name: '',
  category: '',
  paymentMethodId: '',
  amount: '',
  day: '',
  color: '',
  loanMethod: '만기일시상환',
  loanPrincipal: '',
  loanRate: '',
  loanMonths: '1',
  loanRound: '1',
  loanGraceMonths: '',
})

// Per-category accent palette so each small widget reads as distinct.
const WIDGET_COLORS = [
  '#dc2626', '#ea580c', '#d97706', '#16a34a', '#0891b2',
  '#2563eb', '#7c3aed', '#c026d3', '#db2777', '#0d9488',
]
const INCOME_WIDGET_COLORS = [
  '#059669', '#2563eb', '#0d9488', '#7c3aed', '#65a30d',
  '#d97706', '#db2777', '#0891b2', '#4f46e5', '#16a34a',
]

function colorForCategory(category, categories, palette = WIDGET_COLORS) {
  const idx = categories.indexOf(category)
  if (idx >= 0) return palette[idx % palette.length]
  let hash = 0
  for (let i = 0; i < category.length; i += 1) {
    hash = (hash + category.charCodeAt(i) * (i + 1)) % palette.length
  }
  return palette[hash]
}

// Parse a #rgb or #rrggbb string to [r, g, b]; null if it isn't valid hex.
function hexToRgb(hex) {
  const s = String(hex || '').trim().replace(/^#/, '')
  const full = s.length === 3 ? s.replace(/./g, (c) => c + c) : s
  if (full.length !== 6) return null
  const n = Number.parseInt(full, 16)
  return Number.isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Clamp each channel and join back into a #rrggbb string.
function rgbToHex([r, g, b]) {
  const h = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function itemName(it) {
  return String(it?.name || '(이름 없음)')
}

function itemCategory(it) {
  return String(it?.category || '기타')
}

function itemDay(it) {
  const day = Number(it?.day)
  return Number.isFinite(day) && day > 0 ? day : ''
}

function itemPaymentMethodId(it) {
  return String(it?.paymentMethodId || '')
}

function itemColor(it, category, categories) {
  return String(it?.color || '').trim() || colorForCategory(category, categories)
}

// Amount-weighted blend of a set of widgets' colors. Bigger expenses pull the
// result toward their hue, matching the amount-proportional widths of the bar.
function blendCategoryColor(members, category, categories) {
  let r = 0
  let g = 0
  let b = 0
  let total = 0
  members.forEach((it) => {
    const rgb = hexToRgb(itemColor(it, category, categories))
    if (!rgb) return
    const weight = Math.max(Number(it?.amount) || 0, 0) || 1
    r += rgb[0] * weight
    g += rgb[1] * weight
    b += rgb[2] * weight
    total += weight
  })
  if (total === 0) return colorForCategory(category, categories)
  return rgbToHex([r / total, g / total, b / total])
}

// Days until the next occurrence of a monthly payment day. null if no day set.
function daysUntilPayment(day) {
  if (!day) return null
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const y = now.getFullYear()
  const m = now.getMonth()
  const lastThis = new Date(y, m + 1, 0).getDate()
  let target = new Date(y, m, Math.min(day, lastThis))
  if (target < now) {
    const lastNext = new Date(y, m + 2, 0).getDate()
    target = new Date(y, m + 1, Math.min(day, lastNext))
  }
  return Math.round((target - now) / 86400000)
}

// Long-press duration before a touch turns into a widget drag, and how far the
// finger may stray during that wait before it counts as a scroll instead.
const LONG_PRESS_MS = 300
const TOUCH_MOVE_CANCEL = 12

// Whether `unit` is a valid merge target for the `source` widget — same
// category, never the widget itself. Shared by the mouse and touch drag paths.
function unitAcceptsSource(unit, source) {
  if (!unit || !source) return false
  const cat = source.category || '기타'
  if (unit.type === 'single') {
    return unit.it.id !== source.id && (unit.it.category || '기타') === cat
  }
  return unit.category === cat
}

// Merge the `source` widget into a drop target by giving them a shared groupId.
function applyMerge(source, unit, updateItem) {
  if (unit.type === 'single') {
    // merge two singles — reuse the target's groupId if it already had one
    const groupId = unit.it.groupId || createId()
    updateItem(source.id, { groupId })
    updateItem(unit.it.id, { groupId })
  } else {
    // drop onto an existing bundle
    updateItem(source.id, { groupId: unit.groupId })
  }
}

export default function FixedExpenses({
  type = '지출',
  items,
  addItem,
  updateItem,
  removeItem,
  categories = STAGE_META.지출.categories,
  addCategory,
  paymentMethods = [],
}) {
  const meta = STAGE_META[type] || STAGE_META.지출
  const isExpense = type === '지출'
  const fixedLabel = isExpense ? '고정지출' : '고정수입'
  const dayLabel = isExpense ? '결제일' : '입금일'
  const namePlaceholder = isExpense ? '예: 넷플릭스' : '예: 월급'
  const colorPalette = isExpense ? WIDGET_COLORS : INCOME_WIDGET_COLORS
  const emptyHelp = isExpense
    ? '+ 버튼으로 월세, 구독료, 보험료를 추가하세요.'
    : '+ 버튼으로 월급, 용돈, 임대수입을 추가하세요.'
  const [collapsed, setCollapsed] = useState(false)
  const [form, setForm] = useState(blankForm)
  const [editingId, setEditingId] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [draggingId, setDraggingId] = useState(null)
  const [dropKey, setDropKey] = useState(null)
  const [touchDragging, setTouchDragging] = useState(false)
  // Touch long-press drag bookkeeping. Kept in refs so the document-level
  // listeners can read live values without re-subscribing on every render.
  const touchRef = useRef({
    itemId: null,
    startX: 0,
    startY: 0,
    x: 0,
    y: 0,
    timer: 0,
    active: false,
    dropKey: null,
  })
  const ghostRef = useRef(null)
  const dragDataRef = useRef({ renderUnits: [], items: [], updateItem: () => {} })

  const categoryOptions = useMemo(() => {
    const current = form.category.trim()
    return current && !categories.includes(current) ? [...categories, current] : categories
  }, [categories, form.category])
  const paymentOptions = useMemo(
    () => [
      { value: '', label: '미지정' },
      ...paymentMethods.map((method) => ({ value: method.id, label: method.name })),
    ],
    [paymentMethods]
  )

  const totalMonthly = useMemo(
    () => items.reduce((s, it) => s + (Number(it?.amount) || 0), 0),
    [items]
  )

  // Group by category in first-seen order so same-category widgets sit next to
  // each other, but the grid still flows continuously row by row.
  const groups = useMemo(() => {
    const order = []
    const map = new Map()
    items.filter(Boolean).forEach((it) => {
      const category = itemCategory(it)
      if (!map.has(category)) {
        order.push(category)
        map.set(category, { category, color: '', items: [], subtotal: 0 })
      }
      const group = map.get(category)
      group.items.push(it)
      group.subtotal += Number(it.amount) || 0
    })
    // Color each category by the amount-weighted blend of its own widgets, so
    // the "한눈에 보기" bar reflects the real widget colors in the grid below.
    return order.map((category) => {
      const group = map.get(category)
      group.color = blendCategoryColor(group.items, category, categories)
      return group
    })
  }, [items, categories])

  // Widgets that share a groupId render as one merged "bundle" card. A bundle
  // needs 2+ members; a lone groupId silently falls back to a normal widget.
  const bundleCounts = useMemo(() => {
    const counts = new Map()
    items.filter(Boolean).forEach((it) => {
      if (it.groupId) counts.set(it.groupId, (counts.get(it.groupId) || 0) + 1)
    })
    return counts
  }, [items])

  // Flatten the category groups into render units — each unit is either a
  // single widget or a bundle, with the bundle placed at its first member.
  const renderUnits = useMemo(() => {
    const units = []
    const bundleAt = new Map()
    groups.forEach((cg) => {
      cg.items.forEach((it) => {
        const gid = it.groupId
        if (gid && (bundleCounts.get(gid) || 0) >= 2) {
          if (bundleAt.has(gid)) {
            const unit = units[bundleAt.get(gid)]
            unit.items.push(it)
            unit.subtotal += Number(it.amount) || 0
          } else {
            bundleAt.set(gid, units.length)
            units.push({
              type: 'bundle',
              key: gid,
              groupId: gid,
              category: cg.category,
              color: cg.color,
              items: [it],
              subtotal: Number(it.amount) || 0,
            })
          }
        } else {
          units.push({ type: 'single', key: it.id, it, category: cg.category })
        }
      })
    })
    // A bundle's accent blends its own members the same way a category does.
    units.forEach((u) => {
      if (u.type === 'bundle') {
        u.color = blendCategoryColor(u.items, u.category, categories)
      }
    })
    return units
  }, [groups, bundleCounts, categories])

  // Bar widths are relative to the largest unit (single amount or bundle total).
  const maxUnitAmount = useMemo(
    () =>
      renderUnits.reduce(
        (m, u) => Math.max(m, u.type === 'bundle' ? u.subtotal : Number(u.it.amount) || 0),
        0
      ),
    [renderUnits]
  )

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const selectedColor =
    form.color || colorForCategory(form.category.trim() || '기타', categories, colorPalette)
  const loanInterestMode = isExpense && isLoanInterestCategory(form.category)

  function defaultFixedForm() {
    const validItems = items.filter(Boolean)
    const latest = validItems[validItems.length - 1]
    if (!latest) return blankForm()
    const day = itemDay(latest)
    return {
      ...blankForm(),
      category: itemCategory(latest),
      paymentMethodId: isExpense ? itemPaymentMethodId(latest) : '',
      day: day === '' ? '' : String(day),
    }
  }

  function submitForm(e) {
    e.preventDefault()
    const amount = parseAmountInput(form.amount)
    if (!form.name.trim()) {
      alert('항목명을 입력하세요.')
      return
    }
    if (!amount || amount <= 0) {
      alert('금액을 0보다 큰 값으로 입력하세요.')
      return
    }
    const day = form.day === '' ? '' : Math.min(Math.max(parseNumberInput(form.day) || 1, 1), 31)
    const payload = {
      name: form.name.trim(),
      category: form.category.trim() || '기타',
      color: selectedColor,
      amount,
      day,
    }
    if (isExpense) {
      payload.paymentMethodId = form.paymentMethodId
      payload.paymentMethod =
        paymentMethods.find((method) => method.id === form.paymentMethodId)?.name || '미지정'
    }
    if (loanInterestMode) {
      payload.loanMethod = form.loanMethod
      payload.loanPrincipal = form.loanPrincipal
      payload.loanRate = form.loanRate
      payload.loanMonths = form.loanMonths
      payload.loanRound = form.loanRound
      payload.loanGraceMonths = form.loanGraceMonths
    }
    addCategory?.(type, payload.category)
    if (editingId) {
      updateItem(editingId, payload)
      setEditingId(null)
    } else {
      addItem(payload)
    }
    setForm(defaultFixedForm())
    setFormOpen(false)
  }

  function openAdd() {
    setEditingId(null)
    setForm(defaultFixedForm())
    setCollapsed(false)
    setFormOpen(true)
  }

  function startEdit(it) {
    const day = itemDay(it)
    setEditingId(it.id)
    setForm({
      name: itemName(it) === '(이름 없음)' ? '' : itemName(it),
      category: itemCategory(it),
      paymentMethodId: isExpense
        ? itemPaymentMethodId(it) ||
          paymentMethods.find((method) => method.name === it?.paymentMethod)?.id ||
          ''
        : '',
      amount: String(it.amount || ''),
      day: day === '' ? '' : String(day),
      color: itemColor(it, itemCategory(it), categories),
      loanMethod: it.loanMethod || '만기일시상환',
      loanPrincipal: it.loanPrincipal != null ? String(it.loanPrincipal) : '',
      loanRate: it.loanRate != null ? String(it.loanRate) : '',
      loanMonths: it.loanMonths != null ? String(it.loanMonths) : '1',
      loanRound: it.loanRound != null ? String(it.loanRound) : '1',
      loanGraceMonths: it.loanGraceMonths != null ? String(it.loanGraceMonths) : '',
    })
    setCollapsed(false)
    setFormOpen(true)
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(blankForm())
    setFormOpen(false)
  }

  function handleRemove(it) {
    if (
      window.confirm(
        `${fixedLabel} '${itemName(it)}'을(를) 삭제할까요?`
      )
    ) {
      removeItem(it.id)
      if (editingId === it.id) cancelEdit()
    }
  }

  function duplicateItem(it) {
    const category = itemCategory(it)
    const day = itemDay(it)
    const payload = {
      name: `${itemName(it)} 복사`,
      category,
      color: itemColor(it, category, categories),
      amount: Number(it.amount) || 0,
      day,
      groupId: '',
    }
    if (isExpense) {
      payload.paymentMethodId = itemPaymentMethodId(it)
      payload.paymentMethod =
        paymentMethods.find((method) => method.id === payload.paymentMethodId)?.name ||
        it?.paymentMethod ||
        '미지정'
    }
    if (isExpense && isLoanInterestCategory(category)) {
      payload.loanMethod = it.loanMethod
      payload.loanPrincipal = it.loanPrincipal
      payload.loanRate = it.loanRate
      payload.loanMonths = it.loanMonths
      payload.loanRound = it.loanRound
      payload.loanGraceMonths = it.loanGraceMonths
    }
    addCategory?.(type, category)
    addItem(payload)
  }

  const draggingItem = draggingId ? items.find((it) => it.id === draggingId) || null : null

  // A widget may only be dropped onto a same-category target, never itself.
  function canDrop(unit) {
    return unitAcceptsSource(unit, draggingItem)
  }

  function handleDragStart(e, it) {
    setDraggingId(it.id)
    e.dataTransfer.effectAllowed = 'move'
    try {
      e.dataTransfer.setData('text/plain', it.id)
    } catch {
      // some browsers restrict setData during dragstart — draggingId covers it
    }
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDropKey(null)
  }

  function handleDragOver(e, unit) {
    if (!canDrop(unit)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropKey !== unit.key) setDropKey(unit.key)
  }

  function handleDragLeave(e, unit) {
    if (e.currentTarget.contains(e.relatedTarget)) return
    if (dropKey === unit.key) setDropKey(null)
  }

  function handleDrop(e, unit) {
    e.preventDefault()
    const ok = canDrop(unit)
    const source = draggingItem
    setDraggingId(null)
    setDropKey(null)
    if (!ok || !source) return
    applyMerge(source, unit, updateItem)
  }

  function ungroupBundle(groupId) {
    items
      .filter((it) => it.groupId === groupId)
      .forEach((it) => updateItem(it.id, { groupId: '' }))
  }

  // ---- touch drag: long-press a widget, drag it onto a same-category widget ----
  function positionGhost(x, y) {
    const el = ghostRef.current
    if (el) el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -130%)`
  }

  function handleTouchStart(e, it) {
    if (e.touches.length !== 1) return
    if (e.target.closest?.('button')) return // keep the edit/delete buttons tappable
    const t = e.touches[0]
    const s = touchRef.current
    clearTimeout(s.timer)
    s.itemId = it.id
    s.startX = t.clientX
    s.startY = t.clientY
    s.x = t.clientX
    s.y = t.clientY
    s.active = false
    s.dropKey = null
    s.timer = setTimeout(() => {
      s.active = true
      setDraggingId(it.id)
      setTouchDragging(true)
      navigator.vibrate?.(12)
    }, LONG_PRESS_MS)
  }

  // Mirror the data the document listeners need so they can subscribe just once.
  useEffect(() => {
    dragDataRef.current = { renderUnits, items, updateItem }
  })

  // Drop the ghost at the finger the instant a long-press promotes to a drag.
  useEffect(() => {
    if (touchDragging) positionGhost(touchRef.current.x, touchRef.current.y)
  }, [touchDragging])

  useEffect(() => {
    function endSession() {
      const s = touchRef.current
      clearTimeout(s.timer)
      s.itemId = null
      s.active = false
      s.dropKey = null
      setDraggingId(null)
      setDropKey(null)
      setTouchDragging(false)
    }

    function onTouchMove(e) {
      const s = touchRef.current
      if (s.itemId == null) return
      const t = e.touches[0]
      if (!t) return
      s.x = t.clientX
      s.y = t.clientY
      if (!s.active) {
        // Within the long-press wait a real move means the user is scrolling —
        // cancel the pending pickup and let the page scroll normally.
        const moved = Math.abs(t.clientX - s.startX) + Math.abs(t.clientY - s.startY)
        if (moved > TOUCH_MOVE_CANCEL) {
          clearTimeout(s.timer)
          s.itemId = null
        }
        return
      }
      e.preventDefault() // dragging now — suppress page scroll
      positionGhost(t.clientX, t.clientY)
      const { renderUnits: units, items: list } = dragDataRef.current
      const source = list.find((it) => it.id === s.itemId)
      const el = document.elementFromPoint(t.clientX, t.clientY)
      const unitEl = el && el.closest('[data-unit-key]')
      const key = unitEl ? unitEl.getAttribute('data-unit-key') : null
      const unit = key ? units.find((u) => u.key === key) : null
      const validKey = unitAcceptsSource(unit, source) ? key : null
      if (s.dropKey !== validKey) {
        s.dropKey = validKey
        setDropKey(validKey)
      }
    }

    function onTouchEnd(e) {
      const s = touchRef.current
      if (s.itemId == null) return
      if (s.active) {
        if (e.cancelable) e.preventDefault() // swallow the trailing click
        const { renderUnits: units, items: list, updateItem: update } = dragDataRef.current
        const source = list.find((it) => it.id === s.itemId)
        const unit = s.dropKey ? units.find((u) => u.key === s.dropKey) : null
        if (unitAcceptsSource(unit, source)) applyMerge(source, unit, update)
      }
      endSession()
    }

    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd)
    document.addEventListener('touchcancel', onTouchEnd)
    return () => {
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchEnd)
      clearTimeout(touchRef.current.timer)
    }
  }, [])

  return (
    <div className="fixed-section" style={{ '--accent': meta.color }}>
      <div className="fixed-head">
        <button className="fixed-toggle" onClick={() => setCollapsed((c) => !c)}>
          <span className={`chevron${collapsed ? '' : ' open'}`}>▶</span>
          <h2 className="section-title" style={{ margin: 0 }}>{fixedLabel}</h2>
        </button>
        <div className="fixed-summary">
          <span className="fixed-summary-total">월 {formatKRW(totalMonthly)}</span>
          <span className="fixed-summary-sub">
            위젯 {items.length}개 · 카테고리 {groups.length}개
          </span>
        </div>
        <button className="fixed-add-btn" onClick={openAdd} aria-label={`${fixedLabel} 위젯 추가`}>
          <PlusIcon />
        </button>
      </div>

      {!collapsed && (
        <>
          {items.length === 0 ? (
            <div className="fixed-widget-grid">
              <div
                className="fixed-empty-widget"
                role="button"
                tabIndex={0}
                onClick={openAdd}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    openAdd()
                  }
                }}
              >
                <strong>등록된 위젯 없음</strong>
                <span>{emptyHelp}</span>
              </div>
            </div>
          ) : (
            <>
              {totalMonthly > 0 && (
                <div className="fixed-compose" aria-hidden="true">
                  {groups.map((g) => (
                    <i
                      key={g.category}
                      style={{
                        width: `${(g.subtotal / totalMonthly) * 100}%`,
                        background: g.color,
                      }}
                      title={`${g.category} · ${formatKRW(g.subtotal)}`}
                    />
                  ))}
                </div>
              )}

              <div className="fixed-widget-grid">
                {renderUnits.map((unit) => {
                  if (unit.type === 'bundle') {
                    return (
                      <BundleWidget
                        key={unit.key}
                        unit={unit}
                        totalMonthly={totalMonthly}
                        maxUnitAmount={maxUnitAmount}
                        categories={categories}
                        isDropTarget={dropKey === unit.key}
                        onDragOver={(e) => handleDragOver(e, unit)}
                        onDragLeave={(e) => handleDragLeave(e, unit)}
                        onDrop={(e) => handleDrop(e, unit)}
                        onUngroup={() => ungroupBundle(unit.groupId)}
                      />
                    )
                  }
                  const { it } = unit
                  const amount = Number(it.amount) || 0
                  const day = itemDay(it)
                  const dday = daysUntilPayment(day)
                  const soon = dday !== null && dday <= 7
                  const share =
                    totalMonthly > 0 ? Math.round((amount / totalMonthly) * 100) : 0
                  const shareLabel = amount > 0 && share === 0 ? '<1%' : `${share}%`
                  const barWidth = maxUnitAmount > 0 ? (amount / maxUnitAmount) * 100 : 0
                  const widgetColor = itemColor(it, unit.category, categories)
                  return (
                    <div
                      className={`fixed-expense-widget${editingId === it.id ? ' editing' : ''}${
                        draggingId === it.id ? ' dragging' : ''
                      }${dropKey === unit.key ? ' drop-target' : ''}`}
                      key={unit.key}
                      data-unit-key={unit.key}
                      style={{ '--accent': widgetColor }}
                      draggable
                      onDragStart={(e) => handleDragStart(e, it)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => handleDragOver(e, unit)}
                      onDragLeave={(e) => handleDragLeave(e, unit)}
                      onDrop={(e) => handleDrop(e, unit)}
                      onTouchStart={(e) => handleTouchStart(e, it)}
                    >
                      <div className="fixed-widget-head">
                        <span className="fixed-widget-cat">
                          <span className="fixed-widget-dot" />
                          <span className="fixed-widget-cat-label">{unit.category}</span>
                          {isLoanInterestCategory(unit.category) && (
                            <span className="mini-tag">이자계산기</span>
                          )}
                        </span>
                        <div className="fixed-widget-actions">
                          <button
                            className="icon-btn"
                            onClick={() => duplicateItem(it)}
                            aria-label={`${itemName(it)} 복제`}
                            title="복제"
                          >
                            ⧉
                          </button>
                          <button
                            className="icon-btn"
                            onClick={() => startEdit(it)}
                            aria-label={`${itemName(it)} 수정`}
                            title="수정"
                          >
                            ✎
                          </button>
                          <button
                            className="icon-btn danger"
                            onClick={() => handleRemove(it)}
                            aria-label={`${itemName(it)} 삭제`}
                            title="삭제"
                          >
                            ×
                          </button>
                        </div>
                      </div>

                      <div className="fixed-widget-main">
                        <span className="fixed-expense-amount">{formatKRW(amount)}</span>
                        <span className="fixed-expense-name">{itemName(it)}</span>
                      </div>

                      <div className="fixed-widget-bar">
                        <i style={{ width: `${barWidth}%` }} />
                      </div>

                      <div className="fixed-widget-foot">
                        <span
                          className={`fixed-day-badge${soon ? ' soon' : ''}${
                            day ? '' : ' muted'
                          }`}
                        >
                          {day
                            ? `매월 ${day}일${
                                soon ? (dday === 0 ? ' · 오늘' : ` · D-${dday}`) : ''
                              }`
                            : `${dayLabel} 미설정`}
                        </span>
                        <span className="fixed-widget-share">{shareLabel}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {formOpen && (
            <div className="fixed-modal-backdrop" onClick={cancelEdit}>
              <div
                className="fixed-modal"
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="fixed-modal-head">
                  <h3>{editingId ? '위젯 수정' : '위젯 추가'}</h3>
                  <button className="fixed-modal-close" onClick={cancelEdit} aria-label="닫기">
                    ×
                  </button>
                </div>

                <form className="fixed-widget-form" onSubmit={submitForm}>
                  <div className="field">
                    <label>항목명</label>
                    <input
                      type="text"
                      placeholder={namePlaceholder}
                      value={form.name}
                      onChange={(e) => set('name', e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>카테고리</label>
                    <Picker
                      value={form.category}
                      options={categoryOptions}
                      placeholder="카테고리 선택"
                      onChange={(value) => set('category', value)}
                    />
                  </div>
                  <div className="field">
                    <label>색상</label>
                    <div className="fixed-color-control">
                      <div className="fixed-color-swatches">
                        {colorPalette.map((color) => (
                          <button
                            type="button"
                            className={`fixed-color-swatch${selectedColor === color ? ' on' : ''}`}
                            key={color}
                            style={{ '--swatch': color }}
                            onClick={() => set('color', color)}
                            aria-label={`${color} 선택`}
                          />
                        ))}
                      </div>
                      <input
                        type="color"
                        value={selectedColor}
                        onChange={(e) => set('color', e.target.value)}
                        aria-label="사용자 색상 선택"
                      />
                    </div>
                  </div>
                  {isExpense && (
                    <div className="field">
                      <label>결제수단</label>
                      <Picker
                        value={form.paymentMethodId}
                        options={paymentOptions}
                        placeholder="미지정"
                        onChange={(value) => set('paymentMethodId', value)}
                      />
                    </div>
                  )}
                  <div className="fixed-widget-form-row">
                    <div className="field">
                      <label>{dayLabel}</label>
                      <NumberInput
                        min="1"
                        max="31"
                        decimal={false}
                        placeholder="25"
                        value={form.day}
                        onChange={(value) => set('day', value)}
                      />
                    </div>
                    <div className="field">
                      <label>금액</label>
                      <NumberInput
                        min="0"
                        step="1"
                        decimal={false}
                        amount
                        placeholder="0"
                        value={form.amount}
                        onChange={(value) => set('amount', value)}
                      />
                    </div>
                  </div>
                  {loanInterestMode && (
                    <LoanInterestCalculator
                      principal={form.loanPrincipal}
                      rate={form.loanRate}
                      months={form.loanMonths}
                      method={form.loanMethod}
                      round={form.loanRound}
                      graceMonths={form.loanGraceMonths}
                      onChange={set}
                      onApply={(amount) => set('amount', String(amount))}
                    />
                  )}
                  <div className="fixed-modal-actions">
                    <button type="button" className="btn" onClick={cancelEdit}>
                      취소
                    </button>
                    <button type="submit" className="btn btn-accent">
                      {editingId ? '수정 완료' : '추가'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}

      {touchDragging && draggingItem && (
        <div
          className="fixed-drag-ghost"
          ref={ghostRef}
          aria-hidden="true"
          style={{
            '--accent': itemColor(draggingItem, itemCategory(draggingItem), categories),
          }}
        >
          <span className="fixed-drag-ghost-name">{itemName(draggingItem)}</span>
          <span className="fixed-drag-ghost-amount">
            {formatKRW(Number(draggingItem.amount) || 0)}
          </span>
        </div>
      )}
    </div>
  )
}

// A merged card standing in for several same-category widgets. Hovering it
// reveals its members; the × button ungroups it.
function BundleWidget({
  unit,
  totalMonthly,
  maxUnitAmount,
  categories,
  isDropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
  onUngroup,
}) {
  const { category, color, items: members, subtotal } = unit
  const share = totalMonthly > 0 ? Math.round((subtotal / totalMonthly) * 100) : 0
  const shareLabel = subtotal > 0 && share === 0 ? '<1%' : `${share}%`
  const barWidth = maxUnitAmount > 0 ? Math.min((subtotal / maxUnitAmount) * 100, 100) : 0

  return (
    <div
      className={`fixed-expense-widget is-bundle${isDropTarget ? ' drop-target' : ''}`}
      data-unit-key={unit.key}
      style={{ '--accent': color }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="fixed-widget-head">
        <span className="fixed-widget-cat">
          <span className="fixed-widget-dot" />
          <span className="fixed-widget-cat-label">묶음 · {members.length}개</span>
        </span>
        <div className="fixed-widget-actions">
          <button
            className="icon-btn danger"
            onClick={onUngroup}
            aria-label={`${category} 묶음 해제`}
            title="그룹 해제"
          >
            ×
          </button>
        </div>
      </div>

      <div className="fixed-widget-main">
        <span className="fixed-expense-amount">{formatKRW(subtotal)}</span>
        <span className="fixed-expense-name">{category}</span>
      </div>

      <div className="fixed-widget-bar">
        <i style={{ width: `${barWidth}%` }} />
      </div>

      <div className="fixed-widget-foot">
        <span className="fixed-widget-share">{shareLabel}</span>
      </div>

      <div className="fixed-bundle-members" role="tooltip">
        <span className="fixed-bundle-members-title">묶음 항목 {members.length}개</span>
        {members.map((m) => (
          <span className="fixed-bundle-member" key={m.id}>
            <span
              className="fixed-bundle-member-dot"
              style={{ background: itemColor(m, category, categories) }}
            />
            <span className="fixed-bundle-member-name">{itemName(m)}</span>
            <span className="fixed-bundle-member-amount">
              {formatKRW(Number(m.amount) || 0)}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
