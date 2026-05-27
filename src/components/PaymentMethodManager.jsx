import { useEffect, useMemo, useState } from 'react'
import { formatKRW } from '../lib/format'
import { parseNumberInput } from '../lib/numberInput'
import {
  CARD_PRODUCT_CATALOG,
  CARD_PRODUCT_CATALOG_META,
} from '../lib/cardProductCatalog.generated'
import NumberInput from './NumberInput'
import Picker from './Picker'

const blankForm = () => ({
  id: '',
  name: '',
  kind: '신용카드',
  cardProductId: '',
  cardProductName: '',
  cardProductIssuer: '',
  cardProductSourceUrl: '',
  annualFee: '',
  monthlyLimit: '',
  monthlyTarget: '',
})
const kindOptions = ['신용카드', '체크카드', '현금', '계좌', '간편결제', '기타']

function normalizeKind(kind, name = '') {
  const value = String(kind || '').trim()
  if (value === '카드') return String(name).includes('체크') ? '체크카드' : '신용카드'
  return kindOptions.includes(value) ? value : '신용카드'
}

function compact(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '')
}

function productSearchText(product) {
  return compact([
    product.name,
    product.issuer,
    product.kind,
    ...(product.brands || []),
    ...(product.benefitCategories || []),
    ...(product.benefitSummary || []),
  ].join(' '))
}

function productLabel(product) {
  return [product.issuer, product.name].filter(Boolean).join(' · ')
}

function methodProductLabel(method, product) {
  if (product) return productLabel(product)
  return [method.cardProductIssuer, method.cardProductName].filter(Boolean).join(' · ')
}

export default function PaymentMethodManager({
  methods,
  addMethod,
  updateMethod,
  removeMethod,
  view = 'form',
  initialEditId = '',
  onEditRequest,
  resetAfterSubmit = true,
}) {
  const [form, setForm] = useState(blankForm)
  const [cardQuery, setCardQuery] = useState('')
  const [cardSearchOpen, setCardSearchOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [listQuery, setListQuery] = useState('')
  const editing = Boolean(form.id)
  const canAdd = Boolean(addMethod)
  const canEdit = Boolean(updateMethod)
  const canRemove = Boolean(removeMethod)
  const showForm = view === 'form'
  const showList = view === 'list'
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const cardProducts = CARD_PRODUCT_CATALOG
  const cardProductById = useMemo(
    () => new Map(cardProducts.map((product) => [product.id, product])),
    [cardProducts]
  )
  const selectedCardProduct = form.cardProductId ? cardProductById.get(form.cardProductId) : null
  const cardSearchResults = useMemo(() => {
    const query = compact(cardQuery)
    if (!query) return cardProducts.slice(0, 8)
    return cardProducts
      .filter((product) => productSearchText(product).includes(query))
      .slice(0, 8)
  }, [cardProducts, cardQuery])

  useEffect(() => {
    if (editing) setManualOpen(true)
  }, [editing])

  useEffect(() => {
    if (!showForm || !initialEditId) return
    const target = methods.find((m) => m.id === initialEditId)
    if (target) startEdit(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditId, showForm])

  function buildPayload() {
    return {
      name: form.name.trim(),
      kind: form.kind,
      cardProductId: form.cardProductId,
      cardProductName: form.cardProductName,
      cardProductIssuer: form.cardProductIssuer,
      cardProductSourceUrl: form.cardProductSourceUrl,
      annualFee: form.annualFee === '' ? '' : parseNumberInput(form.annualFee) || 0,
      monthlyLimit: form.monthlyLimit === '' ? '' : parseNumberInput(form.monthlyLimit) || 0,
      monthlyTarget: form.monthlyTarget === '' ? '' : parseNumberInput(form.monthlyTarget) || 0,
    }
  }

  function resetForm() {
    setForm(blankForm())
    setCardQuery('')
    setManualOpen(false)
  }

  function submit(e) {
    e?.preventDefault?.()
    const payload = buildPayload()
    if (!payload.name) return alert('결제수단명을 입력하세요.')
    if (editing) updateMethod?.(form.id, payload)
    else if (canAdd) addMethod(payload)
    else return
    if (resetAfterSubmit) resetForm()
    else setManualOpen(true)
  }

  function quickAddFromCard() {
    if (!canAdd) return
    const payload = buildPayload()
    if (!payload.cardProductId) return
    if (!payload.name) return alert('카드 상품을 선택하세요.')
    addMethod(payload)
    resetForm()
  }

  function startEdit(method) {
    setForm({
      id: method.id,
      name: method.name,
      kind: normalizeKind(method.kind, method.name),
      cardProductId: method.cardProductId || '',
      cardProductName: method.cardProductName || '',
      cardProductIssuer: method.cardProductIssuer || '',
      cardProductSourceUrl: method.cardProductSourceUrl || '',
      annualFee: method.annualFee == null || method.annualFee === '' ? '' : String(method.annualFee),
      monthlyLimit: method.monthlyLimit == null || method.monthlyLimit === '' ? '' : String(method.monthlyLimit),
      monthlyTarget: method.monthlyTarget == null || method.monthlyTarget === '' ? '' : String(method.monthlyTarget),
    })
    const product = method.cardProductId ? cardProductById.get(method.cardProductId) : null
    setCardQuery(product ? productLabel(product) : methodProductLabel(method, null))
    setCardSearchOpen(false)
    setManualOpen(true)
  }

  function deleteMethod(method) {
    if (window.confirm(`결제수단 '${method.name}'을(를) 삭제할까요?`)) {
      removeMethod(method.id)
      if (form.id === method.id) resetForm()
    }
  }

  function selectCardProduct(product) {
    setForm((current) => ({
      ...current,
      name: product.name || current.name,
      kind: normalizeKind(product.kind, product.name),
      cardProductId: product.id,
      cardProductName: product.name || '',
      cardProductIssuer: product.issuer || '',
      cardProductSourceUrl: product.sourceUrl || '',
      annualFee:
        product.annualFeeMin == null || product.annualFeeMin === ''
          ? current.annualFee
          : String(product.annualFeeMin),
      monthlyTarget:
        product.monthlyRequirementMin == null || product.monthlyRequirementMin === ''
          ? current.monthlyTarget
          : String(product.monthlyRequirementMin),
    }))
    setCardQuery(productLabel(product))
    setCardSearchOpen(false)
  }

  function clearCardProduct() {
    setForm((current) => ({
      ...current,
      cardProductId: '',
      cardProductName: '',
      cardProductIssuer: '',
      cardProductSourceUrl: '',
    }))
    setCardQuery('')
    setCardSearchOpen(false)
  }

  const filteredMethods = useMemo(() => {
    const query = listQuery.trim().toLowerCase()
    if (!query) return methods
    return methods.filter((method) => {
      const product = cardProductById.get(method.cardProductId)
      return [
        method.name,
        method.kind,
        methodProductLabel(method, product),
        method.annualFee ? `연회비 ${method.annualFee}` : '',
        method.monthlyLimit ? `한도 ${method.monthlyLimit}` : '',
        method.monthlyTarget ? `실적 ${method.monthlyTarget}` : '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [cardProductById, listQuery, methods])

  return (
    <div className="payment-manager">
      {showForm && (
      <div className="payment-group">
        {editing && (
          <div className="payment-group-status">
            <span className="payment-group-badge editing">수정 중</span>
          </div>
        )}
      <form className="payment-form" onSubmit={submit}>
        <section className="payment-section payment-section-auto" aria-label="자동 등록">
          <header className="payment-section-head">
            <div className="payment-section-title">
              <span className="payment-section-badge auto">자동</span>
              <h4>카드 DB에서 검색해 등록</h4>
            </div>
            <p className="payment-section-hint">
              카드 상품을 검색해 선택하면 종류·연회비·실적이 자동으로 채워집니다.
            </p>
          </header>
          <div className="payment-field payment-card-product">
            <span>카드 상품</span>
            <div
              className="card-product-search"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setCardSearchOpen(false)
              }}
            >
              <input
                type="search"
                placeholder={
                  cardProducts.length
                    ? '카드명, 카드사, 혜택 검색'
                    : '카드 DB 생성 후 검색 가능'
                }
                value={cardQuery}
                disabled={cardProducts.length === 0}
                onFocus={() => setCardSearchOpen(true)}
                onChange={(e) => {
                  setCardQuery(e.target.value)
                  setCardSearchOpen(true)
                }}
              />
              {form.cardProductId && (
                <button type="button" className="icon-btn" onClick={clearCardProduct} aria-label="카드 상품 연결 해제">
                  ×
                </button>
              )}
              {cardProducts.length > 0 && cardSearchOpen && (
                <div className="card-product-results">
                  {cardSearchResults.length === 0 ? (
                    <div className="card-product-empty">검색 결과가 없습니다</div>
                  ) : (
                    cardSearchResults.map((product) => (
                      <button
                        type="button"
                        className={`card-product-option${form.cardProductId === product.id ? ' on' : ''}`}
                        key={product.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectCardProduct(product)}
                      >
                        <b>{product.name}</b>
                        <span>
                          {product.issuer} · {product.kind}
                          {product.annualFeeMin ? ` · 연회비 ${formatKRW(product.annualFeeMin)}` : ''}
                          {product.monthlyRequirementMin ? ` · 실적 ${formatKRW(product.monthlyRequirementMin)}` : ' · 실적 없음'}
                        </span>
                        {product.benefitSummary?.length > 0 && (
                          <small>{product.benefitSummary.slice(0, 2).join(' · ')}</small>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {cardProducts.length === 0 ? (
              <small className="payment-field-hint">
                카드 상품 DB가 아직 비어 있습니다.
              </small>
            ) : (
              <small className="payment-field-hint">
                카드 DB {CARD_PRODUCT_CATALOG_META.count || cardProducts.length}개 기준
              </small>
            )}
            {selectedCardProduct && (
              <div className="selected-card-product">
                <span>{productLabel(selectedCardProduct)}</span>
                {selectedCardProduct.sourceUrl && (
                  <a href={selectedCardProduct.sourceUrl} target="_blank" rel="noreferrer">
                    출처
                  </a>
                )}
              </div>
            )}
          </div>
          {selectedCardProduct && !editing && canAdd && (
            <div className="payment-section-actions">
              <button type="button" className="btn btn-sm btn-accent" onClick={quickAddFromCard}>
                이 카드로 즉시 추가
              </button>
              <span className="payment-section-hint inline">
                연회비·실적·종류가 자동 적용됩니다. 세부 조정이 필요하면 아래에서 펼치세요.
              </span>
            </div>
          )}
        </section>

        <section
          className={`payment-section payment-section-manual${manualOpen ? ' open' : ''}`}
          aria-label="수동 설정"
        >
          <button
            type="button"
            className="payment-section-toggle"
            aria-expanded={manualOpen}
            onClick={() => setManualOpen((open) => !open)}
          >
            <div className="payment-section-title">
              <span className="payment-section-badge manual">수동</span>
              <h4>{editing ? '결제수단 수정' : '직접 입력 / 세부 조정'}</h4>
            </div>
            <span className="payment-section-chevron" aria-hidden>
              {manualOpen ? '▾' : '▸'}
            </span>
          </button>
          {!manualOpen && (
            <p className="payment-section-hint">
              현금·계좌·간편결제처럼 DB에 없는 결제수단은 여기서 직접 추가합니다.
            </p>
          )}
          {manualOpen && (
            <div className="payment-section-body">
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
                <NumberInput
                  min="0"
                  decimal={false}
                  placeholder="0"
                  value={form.monthlyLimit}
                  onChange={(value) => set('monthlyLimit', value)}
                />
              </div>
              <div className="payment-field">
                <span>연회비</span>
                <NumberInput
                  min="0"
                  decimal={false}
                  placeholder="0"
                  value={form.annualFee}
                  onChange={(value) => set('annualFee', value)}
                />
              </div>
              <div className="payment-field">
                <span>월 실적</span>
                <NumberInput
                  min="0"
                  decimal={false}
                  placeholder="0"
                  value={form.monthlyTarget}
                  onChange={(value) => set('monthlyTarget', value)}
                />
              </div>
              <div className="payment-form-actions">
                {(editing || canAdd) && (
                  <button type="submit" className="btn btn-sm btn-accent">
                    {editing ? '수정' : '추가'}
                  </button>
                )}
                {editing && canAdd && (
                  <button type="button" className="btn btn-sm" onClick={resetForm}>
                    취소
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </form>
      </div>
      )}

      {showList && (
        <div className="payment-group">
          {methods.length > 5 && (
            <div className="payment-list-search">
              <input
                type="search"
                placeholder="이름, 종류, 카드 상품으로 필터"
                value={listQuery}
                onChange={(e) => setListQuery(e.target.value)}
              />
              {listQuery && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setListQuery('')}
                >
                  초기화
                </button>
              )}
            </div>
          )}
          {methods.length === 0 ? (
            <div className="payment-list-empty">아직 등록된 결제수단이 없습니다.</div>
          ) : filteredMethods.length === 0 ? (
            <div className="payment-list-empty">조건에 맞는 결제수단이 없습니다.</div>
          ) : (
            <ul className="payment-method-list compact">
              {filteredMethods.map((method) => {
                const product = cardProductById.get(method.cardProductId)
                const productLabelText = methodProductLabel(method, product)
                const isEditing = editing && form.id === method.id
                const metaParts = [
                  productLabelText,
                  method.annualFee ? `연회비 ${formatKRW(method.annualFee)}` : '',
                  method.monthlyLimit ? `한도 ${formatKRW(method.monthlyLimit)}` : '',
                  method.monthlyTarget ? `실적 ${formatKRW(method.monthlyTarget)}` : '',
                ].filter(Boolean)
                return (
                  <li
                    className={`payment-method-row compact${isEditing ? ' editing' : ''}`}
                    key={method.id}
                  >
                    <div className="payment-method-row-main">
                      <b>{method.name}</b>
                      <span className="payment-method-row-kind">{method.kind}</span>
                      {metaParts.length > 0 && (
                        <small className="payment-method-row-meta">
                          {metaParts.join(' · ')}
                        </small>
                      )}
                    </div>
                    {(canEdit || canRemove) && (
                      <div className="payment-method-actions">
                        {canEdit && (
                          <button
                            className="icon-btn"
                            onClick={() =>
                              onEditRequest ? onEditRequest(method) : startEdit(method)
                            }
                            aria-label={`${method.name} 수정`}
                            title="수정"
                          >
                            ✎
                          </button>
                        )}
                        {canRemove && (
                          <button
                            className="icon-btn danger"
                            onClick={() => deleteMethod(method)}
                            aria-label={`${method.name} 삭제`}
                            title="삭제"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
