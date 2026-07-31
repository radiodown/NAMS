import { categoryColor, categoryIcon } from '../lib/categoryPresentation'

export default function CategoryBadge({ category, icons = {} }) {
  const label = String(category || '미분류').trim() || '미분류'
  const icon = categoryIcon(label, icons)

  return (
    <span className="category-badge" style={{ '--category-color': categoryColor(label) }}>
      {icon ? (
        <span className="category-badge-icon" aria-hidden="true">{icon}</span>
      ) : (
        <i aria-hidden="true" />
      )}
      <span>{label}</span>
    </span>
  )
}
