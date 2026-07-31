import { useMemo, useState } from 'react'
import {
  categoryColor,
  categoryIcon,
  normalizeCategoryIcon,
} from '../lib/categoryPresentation'
import { isLoanInterestCategory } from '../lib/loanInterest'
import { withUndo } from '../lib/store'
import { useEscapeDismiss } from '../lib/useEscapeDismiss'

const blankEditor = () => ({
  original: '',
  name: '',
  icon: '',
})

export default function CategoryManagerModal({
  type,
  categories = [],
  icons = {},
  addCategory,
  updateCategory,
  removeCategory,
  setCategoryIcon,
  onClose,
}) {
  const [editor, setEditor] = useState(blankEditor)
  const [search, setSearch] = useState('')
  useEscapeDismiss(onClose)
  const editing = Boolean(editor.original)
  const query = search.trim().toLocaleLowerCase('ko-KR')
  const visibleCategories = useMemo(
    () =>
      query
        ? categories.filter((category) => category.toLocaleLowerCase('ko-KR').includes(query))
        : categories,
    [categories, query]
  )

  function resetEditor() {
    setEditor(blankEditor())
  }

  function beginEdit(name) {
    setEditor({
      original: name,
      name,
      icon: categoryIcon(name, icons),
    })
  }

  function submitCategory(event) {
    event.preventDefault()
    const name = editor.name.trim()
    if (!name) {
      window.alert('카테고리 이름을 입력하세요.')
      return
    }
    if (name !== editor.original && categories.includes(name)) {
      window.alert('이미 등록된 카테고리입니다.')
      return
    }

    const saved = editing
      ? editor.original === name || updateCategory?.(type, editor.original, name)
      : addCategory?.(type, name)
    if (!saved) return

    setCategoryIcon?.(type, name, editor.icon)
    resetEditor()
  }

  function deleteCategory(name) {
    if (!window.confirm(`카테고리 '${name}'을(를) 삭제할까요?`)) return
    withUndo(`카테고리 '${name}' 삭제`, () => removeCategory?.(type, name))
    if (editor.original === name) resetEditor()
  }

  function updateIcon(value) {
    setEditor((current) => ({ ...current, icon: normalizeCategoryIcon(value) }))
  }

  return (
    <div className="fixed-modal-backdrop">
      <div
        className="fixed-modal category-modal category-manager-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${type} 카테고리 관리`}
      >
        <div className="category-manager-body">
          <form className={`category-manager-editor${editing ? ' editing' : ''}`} onSubmit={submitCategory}>
            <div className="category-manager-editor-head">
              <div>
                <h4>{editing ? `'${editor.original}' 수정` : '새 카테고리 만들기'}</h4>
              </div>
              <div className="category-manager-editor-tools">
                {editing && <span className="category-manager-mode editing">수정 중</span>}
                <button className="fixed-modal-close" type="button" onClick={onClose} aria-label="닫기">
                  ×
                </button>
              </div>
            </div>

            <div className="category-manager-fields">
              <label className="category-manager-emoji-field">
                <span>이모지</span>
                <input
                  className="category-manager-field-input emoji"
                  type="text"
                  value={editor.icon}
                  placeholder="🐾"
                  onChange={(event) => updateIcon(event.target.value)}
                  aria-label="카테고리 이모지"
                />
              </label>

              <label className="category-manager-name-field">
                <span>카테고리 이름</span>
                <input
                  className="category-manager-field-input"
                  type="text"
                  value={editor.name}
                  placeholder="예: 반려동물"
                  onChange={(event) =>
                    setEditor((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>
            </div>

            <div className="category-manager-editor-actions">
              {editing && (
                <button type="button" className="btn btn-sm" onClick={resetEditor}>
                  취소
                </button>
              )}
              <button type="submit" className="btn btn-sm btn-accent">
                {editing ? '변경사항 저장' : '추가'}
              </button>
            </div>
          </form>

          <section className="category-manager-library" aria-label="카테고리 목록">
            <div className="category-manager-library-head">
              <div className="category-manager-library-title">
                <h4>카테고리 목록</h4>
                <span>{categories.length}개</span>
              </div>
              <label className="category-manager-search">
                <span className="sr-only">카테고리 검색</span>
                <span className="category-manager-search-control">
                  <i aria-hidden="true">⌕</i>
                  <input
                    type="search"
                    value={search}
                    placeholder="검색"
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </span>
              </label>
            </div>

            <div className="category-manager-list">
              {visibleCategories.length === 0 ? (
                <div className="category-manager-empty">검색 결과가 없습니다.</div>
              ) : (
                visibleCategories.map((name) => {
                  const icon = categoryIcon(name, icons)
                  return (
                    <div
                      className={`category-manager-row${editor.original === name ? ' editing' : ''}`}
                      style={{ '--category-color': categoryColor(name) }}
                      key={name}
                    >
                      <button
                        type="button"
                        className="category-manager-row-icon"
                        onClick={() => beginEdit(name)}
                        aria-label={`${name} 아이콘 및 이름 수정`}
                      >
                        {icon || '—'}
                      </button>
                      <div className="category-manager-row-copy">
                        <strong>{name}</strong>
                        {editor.original === name && <small>현재 수정 중</small>}
                      </div>
                      {isLoanInterestCategory(name) && <span className="mini-tag">이자계산기</span>}
                      <div className="category-manager-row-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => beginEdit(name)}
                          aria-label={`${name} 수정`}
                          title="수정"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={() => deleteCategory(name)}
                          aria-label={`${name} 삭제`}
                          title="삭제"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
