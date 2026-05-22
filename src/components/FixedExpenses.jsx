import { useMemo, useState } from 'react'
import { STAGE_META } from '../lib/categories'
import { formatKRW } from '../lib/format'
import { createId } from '../lib/id'
import Picker from './Picker'
import PlusIcon from './PlusIcon'

const blankForm = () => ({ name: '', category: '', paymentMethodId: '', amount: '', day: '', color: '' })

// Per-category accent palette so each small widget reads as distinct.
const WIDGET_COLORS = [
  '#dc2626', '#ea580c', '#d97706', '#16a34a', '#0891b2',
  '#2563eb', '#7c3aed', '#c026d3', '#db2777', '#0d9488',
]

function colorForCategory(category, categories) {
  const idx = categories.indexOf(category)
  if (idx >= 0) return WIDGET_COLORS[idx % WIDGET_COLORS.length]
  let hash = 0
  for (let i = 0; i < category.length; i += 1) {
    hash = (hash + category.charCodeAt(i) * (i + 1)) % WIDGET_COLORS.length
  }
  return WIDGET_COLORS[hash]
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

export default function FixedExpenses({
  items,
  addItem,
  updateItem,
  removeItem,
  categories = STAGE_META.지출.categories,
  addCategory,
  paymentMethods = [],
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [form, setForm] = useState(blankForm)
  const [editingId, setEditingId] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [draggingId, setDraggingId] = useState(null)
  const [dropKey, setDropKey] = useState(null)

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
        map.set(category, {
          category,
          color: colorForCategory(category, categories),
          items: [],
          subtotal: 0,
        })
      }
      const group = map.get(category)
      group.items.push(it)
      group.subtotal += Number(it.amount) || 0
    })
    return order.map((category) => map.get(category))
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
    return units
  }, [groups, bundleCounts])

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
    form.color || colorForCategory(form.category.trim() || '기타', categories)

  function submitForm(e) {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!form.name.trim()) {
      alert('항목명을 입력하세요.')
      return
    }
    if (!amount || amount <= 0) {
      alert('금액을 0보다 큰 값으로 입력하세요.')
      return
    }
    const day = form.day === '' ? '' : Math.min(Math.max(Number(form.day) || 1, 1), 31)
    const payload = {
      name: form.name.trim(),
      category: form.category.trim() || '기타',
      color: selectedColor,
      paymentMethodId: form.paymentMethodId,
      paymentMethod:
        paymentMethods.find((method) => method.id === form.paymentMethodId)?.name || '미지정',
      amount,
      day,
    }
    addCategory?.('지출', payload.category)
    if (editingId) {
      updateItem(editingId, payload)
      setEditingId(null)
    } else {
      addItem(payload)
    }
    setForm(blankForm())
    setFormOpen(false)
  }

  function openAdd() {
    setEditingId(null)
    setForm(blankForm())
    setCollapsed(false)
    setFormOpen(true)
  }

  function startEdit(it) {
    const day = itemDay(it)
    setEditingId(it.id)
    setForm({
      name: itemName(it) === '(이름 없음)' ? '' : itemName(it),
      category: itemCategory(it),
      paymentMethodId:
        itemPaymentMethodId(it) ||
        paymentMethods.find((method) => method.name === it?.paymentMethod)?.id ||
        '',
      amount: String(it.amount || ''),
      day: day === '' ? '' : String(day),
      color: itemColor(it, itemCategory(it), categories),
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
        `고정지출 '${itemName(it)}'을(를) 삭제할까요?`
      )
    ) {
      removeItem(it.id)
      if (editingId === it.id) cancelEdit()
    }
  }

  const draggingItem = draggingId ? items.find((it) => it.id === draggingId) || null : null

  // A widget may only be dropped onto a same-category target, never itself.
  function canDrop(unit) {
    if (!draggingItem) return false
    const cat = draggingItem.category || '기타'
    if (unit.type === 'single') {
      return unit.it.id !== draggingItem.id && (unit.it.category || '기타') === cat
    }
    return unit.category === cat
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

  function ungroupBundle(groupId) {
    items
      .filter((it) => it.groupId === groupId)
      .forEach((it) => updateItem(it.id, { groupId: '' }))
  }

  return (
    <div className="fixed-section" style={{ '--accent': STAGE_META.지출.color }}>
      <div className="fixed-head">
        <button className="fixed-toggle" onClick={() => setCollapsed((c) => !c)}>
          <span className={`chevron${collapsed ? '' : ' open'}`}>▶</span>
          <h2 className="section-title" style={{ margin: 0 }}>고정지출</h2>
        </button>
        <div className="fixed-summary">
          <span className="fixed-summary-total">월 {formatKRW(totalMonthly)}</span>
          <span className="fixed-summary-sub">
            위젯 {items.length}개 · 카테고리 {groups.length}개
          </span>
        </div>
        <button className="fixed-add-btn" onClick={openAdd} aria-label="고정지출 위젯 추가">
          <PlusIcon />
        </button>
      </div>

      {!collapsed && (
        <>
          {items.length === 0 ? (
            <div className="fixed-widget-grid">
              <div className="fixed-empty-widget">
                <strong>등록된 위젯 없음</strong>
                <span>+ 버튼으로 월세, 구독료, 보험료를 추가하세요.</span>
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
                      style={{ '--accent': widgetColor }}
                      draggable
                      onDragStart={(e) => handleDragStart(e, it)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => handleDragOver(e, unit)}
                      onDragLeave={(e) => handleDragLeave(e, unit)}
                      onDrop={(e) => handleDrop(e, unit)}
                    >
                      <div className="fixed-widget-head">
                        <span className="fixed-widget-cat">
                          <span className="fixed-widget-dot" />
                          <span className="fixed-widget-cat-label">{unit.category}</span>
                        </span>
                        <div className="fixed-widget-actions">
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
                            : '결제일 미설정'}
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
                      placeholder="예: 넷플릭스"
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
                        {WIDGET_COLORS.map((color) => (
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
                  <div className="field">
                    <label>결제수단</label>
                    <Picker
                      value={form.paymentMethodId}
                      options={paymentOptions}
                      placeholder="미지정"
                      onChange={(value) => set('paymentMethodId', value)}
                    />
                  </div>
                  <div className="fixed-widget-form-row">
                    <div className="field">
                      <label>결제일</label>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        inputMode="numeric"
                        placeholder="25"
                        value={form.day}
                        onChange={(e) => set('day', e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label>금액</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        placeholder="0"
                        value={form.amount}
                        onChange={(e) => set('amount', e.target.value)}
                      />
                    </div>
                  </div>
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
