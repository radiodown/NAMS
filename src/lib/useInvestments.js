import { useCallback } from 'react'
import { createId } from './id'
import { normalizeInvestment, normalizeInvestmentGroup } from './schema'
import { useStoredSlice } from './store'
import { STORE_PATHS } from './storePaths'

// Investment products: 예금 / 적금 / 주식 / 환율. Each has a `kind` and kind-specific fields.
const listOrEmpty = (value) => (Array.isArray(value) ? value : [])

export function useInvestments() {
  const [items, setItems] = useStoredSlice(STORE_PATHS.investment.products, [])
  const [groups, setGroups] = useStoredSlice(STORE_PATHS.investment.groups, [])

  const addItem = useCallback(
    (item) => {
      setItems((prev) => [...listOrEmpty(prev), normalizeInvestment({ ...item, id: createId() })])
    },
    [setItems]
  )

  const updateItem = useCallback(
    (id, patch) => {
      setItems((prev) =>
        listOrEmpty(prev).map((it) => (it.id === id ? normalizeInvestment({ ...it, ...patch, id }) : it))
      )
    },
    [setItems]
  )

  const removeItem = useCallback(
    (id) => {
      setItems((prev) => listOrEmpty(prev).filter((it) => it.id !== id))
    },
    [setItems]
  )

  // Move the `fromId` product into the slot held by `toId`, shifting the rest.
  const moveItem = useCallback(
    (fromId, toId) => {
      setItems((prev) => {
        const current = listOrEmpty(prev)
        const from = current.findIndex((it) => it.id === fromId)
        const to = current.findIndex((it) => it.id === toId)
        if (from < 0 || to < 0 || from === to) return current
        const next = [...current]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        return next
      })
    },
    [setItems]
  )

  const replaceAll = useCallback(
    (next) => {
      setItems(Array.isArray(next) ? next.map(normalizeInvestment) : [])
    },
    [setItems]
  )

  // Assign `itemId` to `groupId`; if groupId is falsy, the item is ungrouped.
  const setItemGroup = useCallback(
    (itemId, groupId) => {
      setItems((prev) =>
        listOrEmpty(prev).map((it) =>
          it.id === itemId ? normalizeInvestment({ ...it, groupId: groupId || '' }) : it
        )
      )
    },
    [setItems]
  )

  // Bundle two items into a fresh group with a default name; returns the new id.
  const groupItems = useCallback(
    (sourceId, targetId, name) => {
      let createdId = ''
      setItems((prev) => {
        const current = listOrEmpty(prev)
        const target = current.find((it) => it.id === targetId)
        if (!target) return current
        const reuseId = target.groupId
        const newId = reuseId || createId()
        createdId = newId
        return current.map((it) => {
          if (it.id === sourceId) return normalizeInvestment({ ...it, groupId: newId })
          if (it.id === targetId && !reuseId) return normalizeInvestment({ ...it, groupId: newId })
          return it
        })
      })
      if (createdId) {
        setGroups((prev) => {
          const current = listOrEmpty(prev)
          if (current.some((g) => g.id === createdId)) return current
          return [...current, normalizeInvestmentGroup({ id: createdId, name: name || '새 그룹' })]
        })
      }
      return createdId
    },
    [setItems, setGroups]
  )

  const renameGroup = useCallback(
    (groupId, name) => {
      setGroups((prev) =>
        listOrEmpty(prev).map((g) => (g.id === groupId ? normalizeInvestmentGroup({ ...g, name }) : g))
      )
    },
    [setGroups]
  )

  // Remove every item's groupId for this group, then delete the group entry.
  const dissolveGroup = useCallback(
    (groupId) => {
      setItems((prev) =>
        listOrEmpty(prev).map((it) =>
          it.groupId === groupId ? normalizeInvestment({ ...it, groupId: '' }) : it
        )
      )
      setGroups((prev) => listOrEmpty(prev).filter((g) => g.id !== groupId))
    },
    [setItems, setGroups]
  )

  // Drop any group entry that no longer has at least one member item.
  const pruneEmptyGroups = useCallback(() => {
    const current = listOrEmpty(groups)
    if (current.length === 0) return
    const used = new Set(listOrEmpty(items).map((it) => it.groupId).filter(Boolean))
    const next = current.filter((g) => used.has(g.id))
    if (next.length !== current.length) setGroups(next)
  }, [items, groups, setGroups])

  return {
    items,
    groups,
    addItem,
    updateItem,
    removeItem,
    moveItem,
    replaceAll,
    setItemGroup,
    groupItems,
    renameGroup,
    dissolveGroup,
    pruneEmptyGroups,
  }
}
