import { useCallback } from 'react'
import { createId } from './id'
import { normalizeSimulationScenario } from './investmentSimulation'
import { useStoredSlice } from './store'
import { STORE_PATHS } from './storePaths'

export function useInvestmentSimulations() {
  const [items, setItems] = useStoredSlice(STORE_PATHS.investment.simulations, [])

  const saveItem = useCallback(
    (item) => {
      const id = item?.id || createId()
      const normalized = normalizeSimulationScenario({ ...item, id })
      setItems((prev) => {
        const list = Array.isArray(prev) ? prev : []
        const exists = list.some((scenario) => scenario.id === id)
        if (exists) {
          return list.map((scenario) => (scenario.id === id ? normalized : scenario))
        }
        return [...list, normalized]
      })
      return normalized
    },
    [setItems]
  )

  const updateItem = useCallback(
    (id, patch) => {
      setItems((prev) =>
        (Array.isArray(prev) ? prev : []).map((scenario) =>
          scenario.id === id
            ? normalizeSimulationScenario({ ...scenario, ...patch, id })
            : scenario
        )
      )
    },
    [setItems]
  )

  const removeItem = useCallback(
    (id) => {
      setItems((prev) => (Array.isArray(prev) ? prev : []).filter((scenario) => scenario.id !== id))
    },
    [setItems]
  )

  const replaceAll = useCallback(
    (next) => {
      setItems(Array.isArray(next) ? next.map(normalizeSimulationScenario) : [])
    },
    [setItems]
  )

  return { items, saveItem, updateItem, removeItem, replaceAll }
}
