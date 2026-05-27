import { useCallback, useMemo } from 'react'
import {
  applyBuy,
  applySell,
  defaultMockPortfolio,
  normalizeMockPortfolio,
} from './mockInvestment'
import { useStoredSlice } from './store'
import { STORE_PATHS } from './storePaths'

export function useMockInvestment() {
  const fallbackPortfolio = useMemo(() => defaultMockPortfolio(), [])
  const [raw, setRaw] = useStoredSlice(
    STORE_PATHS.mockInvest.portfolio,
    fallbackPortfolio
  )
  const portfolio = useMemo(() => normalizeMockPortfolio(raw), [raw])

  const setStartingCash = useCallback(
    (amount) => {
      setRaw((prev) => {
        const current = normalizeMockPortfolio(prev)
        if (current.trades.length > 0) return current
        const safe = Math.max(0, Number(amount) || 0)
        return normalizeMockPortfolio({
          ...current,
          startingCash: safe,
          cash: safe,
        })
      })
    },
    [setRaw]
  )

  const buy = useCallback(
    (params) => {
      setRaw((prev) => applyBuy(normalizeMockPortfolio(prev), params))
    },
    [setRaw]
  )

  const sell = useCallback(
    (params) => {
      setRaw((prev) => applySell(normalizeMockPortfolio(prev), params))
    },
    [setRaw]
  )

  const reset = useCallback(
    (startingCash) => {
      const safe = Math.max(0, Number(startingCash) || 0)
      setRaw(
        normalizeMockPortfolio({
          startingCash: safe,
          cash: safe,
          createdAt: '',
          realizedPnL: 0,
          positions: [],
          trades: [],
        })
      )
    },
    [setRaw]
  )

  const replaceAll = useCallback(
    (next) => {
      setRaw(normalizeMockPortfolio(next))
    },
    [setRaw]
  )

  return { portfolio, setStartingCash, buy, sell, reset, replaceAll }
}
