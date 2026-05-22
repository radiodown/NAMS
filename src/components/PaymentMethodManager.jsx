import { useState } from 'react'
import { formatKRW } from '../lib/format'
import Picker from './Picker'

const blankForm = () => ({ id: '', name: '', kind: '신용카드', annualFee: '', monthlyLimit: '', monthlyTarget: '' })
const kindOptions = ['신용카드', '체크카드', '현금', '계좌', '간편결제', '기타']

function normalizeKind(kind, name = '') {
  const value = String(kind || '').trim()
  if (value === '카드') return String(name).includes('체크') ? '체크카드' : '신용카드'
  return kindOptions.includes(value) ? value : '신용카드'
}

export default function PaymentMethodManager({
  methods,
  addMethod,
  updateMethod,
  removeMethod,
  showMethods = true,
}) {
  const [form, setForm] = useState(blankForm)
  const editing = Boolean(form.id)
  const canEdit = Boolean(updateMethod)
  const canRemove = Boolean(removeMethod)
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  function submit(e) {
    e.preventDefault()
    const name = form.name.trim()
    if (!name) return alert('결제수단명을 입력하세요.')
    const payload = {
      name,
      kind: form.kind,
      annualFee: form.annualFee === '' ? '' : Number(form.annualFee) || 0,
      monthlyLimit: form.monthlyLimit === '' ? '' : Number(form.monthlyLimit) || 0,
      monthlyTarget: form.monthlyTarget === '' ? '' : Number(form.monthlyTarget) || 0,
    }
    if (editing) updateMethod?.(form.id, payload)
    else addMethod(payload)
    setForm(blankForm())
  }

  function startEdit(method) {
    setForm({
      id: method.id,
      name: method.name,
      kind: normalizeKind(method.kind, method.name),
      annualFee: method.annualFee == null || method.annualFee === '' ? '' : String(method.annualFee),
      monthlyLimit: method.monthlyLimit == null || method.monthlyLimit === '' ? '' : String(method.monthlyLimit),
      monthlyTarget: method.monthlyTarget == null || method.monthlyTarget === '' ? '' : String(method.monthlyTarget),
    })
  }

  function deleteMethod(method) {
    if (window.confirm(`결제수단 '${method.name}'을(를) 삭제할까요?`)) {
      removeMethod(method.id)
      if (form.id === method.id) setForm(blankForm())
    }
  }

  return (
    <div className="payment-manager">
      <form className="payment-form" onSubmit={submit}>
        <div className="payment-field payment-name">
          <span>결제수단명</span>
          <input
            type="text"
            placeholder="예: 신한카드"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
        <div className="payment-field">
          <span>종류</span>
          <Picker
            value={form.kind}
            options={kindOptions}
            placeholder="종류"
            onChange={(value) => set('kind', value)}
          />
        </div>
        <div className="payment-field">
          <span>월 한도</span>
          <input
            type="number"
            min="0"
            placeholder="0"
            value={form.monthlyLimit}
            onChange={(e) => set('monthlyLimit', e.target.value)}
          />
        </div>
        <div className="payment-field">
          <span>연회비</span>
          <input
            type="number"
            min="0"
            placeholder="0"
            value={form.annualFee}
            onChange={(e) => set('annualFee', e.target.value)}
          />
        </div>
        <div className="payment-field">
          <span>월 실적</span>
          <input
            type="number"
            min="0"
            placeholder="0"
            value={form.monthlyTarget}
            onChange={(e) => set('monthlyTarget', e.target.value)}
          />
        </div>
        <div className="payment-form-actions">
          <button type="submit" className="btn btn-sm btn-accent">
            {editing ? '수정' : '추가'}
          </button>
          {editing && (
            <button type="button" className="btn btn-sm" onClick={() => setForm(blankForm())}>
              취소
            </button>
          )}
        </div>
      </form>

      {showMethods && (
        <div className="payment-method-list">
          {methods.map((method) => (
            <div className="payment-method-row" key={method.id}>
              <div>
                <b>{method.name}</b>
                <span>
                  {method.kind}
                  {method.annualFee ? ` · 연회비 ${formatKRW(method.annualFee)}` : ''}
                  {method.monthlyLimit ? ` · 한도 ${formatKRW(method.monthlyLimit)}` : ''}
                  {method.monthlyTarget ? ` · 실적 ${formatKRW(method.monthlyTarget)}` : ''}
                </span>
              </div>
              {(canEdit || canRemove) && (
                <div className="payment-method-actions">
                  {canEdit && (
                    <button className="icon-btn" onClick={() => startEdit(method)} aria-label={`${method.name} 수정`}>
                      ✎
                    </button>
                  )}
                  {canRemove && (
                    <button
                      className="icon-btn danger"
                      onClick={() => deleteMethod(method)}
                      aria-label={`${method.name} 삭제`}
                    >
                      ×
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
