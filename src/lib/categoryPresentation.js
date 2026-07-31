const CATEGORY_COLORS = {
  식비: '#f97316',
  '주거/관리': '#6366f1',
  교통: '#0284c7',
  통신: '#0891b2',
  생활용품: '#0d9488',
  '의료/건강': '#e11d48',
  '문화/여가': '#9333ea',
  교육: '#65a30d',
  경조사: '#db2777',
  '기부/후원': '#059669',
  보험: '#475569',
  급여: '#16a34a',
  보너스: '#0d9488',
  사업소득: '#2563eb',
  '이자/배당': '#7c3aed',
  용돈: '#db2777',
  환급: '#0891b2',
  중고판매: '#d97706',
  기타: '#64748b',
  미분류: '#64748b',
}

const CATEGORY_ICONS = {
  식비: '🍽️',
  '주거/관리': '🏠',
  교통: '🚌',
  대중교통: '🚌',
  통신: '📱',
  생활용품: '🛒',
  '의료/건강': '🏥',
  '문화/여가': '🎭',
  도서공연: '🎟️',
  교육: '📚',
  운동: '🏋️',
  경조사: '🎁',
  '기부/후원': '💝',
  기부금: '💝',
  보험: '🛡️',
  급여: '💵',
  보너스: '🎉',
  성과급: '🎉',
  사업소득: '💼',
  프로젝트: '💼',
  '이자/배당': '📈',
  용돈: '👛',
  환급: '↩️',
  중고판매: '♻️',
  월세수입: '🏘️',
  기타: '•••',
  미분류: '?',
}

const FALLBACK_COLORS = [
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#65a30d',
  '#059669',
  '#0d9488',
  '#0891b2',
  '#2563eb',
  '#4f46e5',
  '#7c3aed',
  '#c026d3',
  '#db2777',
]

function categoryHash(value) {
  return Array.from(String(value || '')).reduce(
    (hash, character) => ((hash << 5) - hash + character.codePointAt(0)) | 0,
    0
  )
}

export function categoryColor(category) {
  const name = String(category || '미분류').trim() || '미분류'
  return CATEGORY_COLORS[name] || FALLBACK_COLORS[Math.abs(categoryHash(name)) % FALLBACK_COLORS.length]
}

export function normalizeCategoryIcon(icon) {
  return Array.from(String(icon ?? '').trim()).slice(0, 8).join('')
}

export function defaultCategoryIcon(category) {
  const name = String(category || '미분류').trim() || '미분류'
  return CATEGORY_ICONS[name] || '•'
}

export function categoryIcon(category, iconOverrides = {}) {
  const name = String(category || '미분류').trim() || '미분류'
  if (Object.prototype.hasOwnProperty.call(iconOverrides || {}, name)) {
    return normalizeCategoryIcon(iconOverrides[name])
  }
  return defaultCategoryIcon(name)
}
