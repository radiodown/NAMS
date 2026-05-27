#!/usr/bin/env node

import { intArg, parseArgs, readJson, sleep, writeJson, writeText } from '../card-scraper/lib.mjs'

const DEFAULT_SEED_FILE = 'tools/stock-preset-scraper/seed-presets.json'
const DEFAULT_JSON_OUT = 'data/stock-presets/stock-search-presets.json'
const DEFAULT_GENERATED_OUT = 'src/lib/stockSearchPresets.generated.js'
const NAVER_STOCK_BASE_URL = 'https://m.stock.naver.com/api/stocks'
const DEFAULT_PAGE_SIZE = 100

function cleanText(value) {
  return String(value ?? '').trim()
}

function cleanKeywords(value) {
  const seen = new Set()
  return (Array.isArray(value) ? value : [])
    .map(cleanText)
    .filter(Boolean)
    .filter((keyword) => {
      const key = keyword.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function optionalNumber(value) {
  const number = Number(String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function compactPreset(item) {
  return Object.fromEntries(
    Object.entries(item).filter(([, value]) => {
      if (Array.isArray(value)) return true
      return value !== undefined && value !== null && value !== ''
    })
  )
}

function normalizePresetItem(item) {
  const symbol = cleanText(item?.symbol).toUpperCase()
  if (!symbol) return null

  return compactPreset({
    symbol,
    name: cleanText(item?.name) || symbol,
    keywords: cleanKeywords(item?.keywords),
    currency: cleanText(item?.currency).toUpperCase() || undefined,
    exchange: cleanText(item?.exchange) || undefined,
    type: cleanText(item?.type).toUpperCase() || undefined,
    currentPrice: optionalNumber(item?.currentPrice),
    rank: optionalNumber(item?.rank),
  })
}

function suffixForExchange(value) {
  const code = cleanText(value).toUpperCase()
  if (code === 'KQ' || code === 'KOSDAQ') return 'KQ'
  return 'KS'
}

function exchangeLabel(item, fallbackExchange) {
  const value =
    cleanText(item?.stockExchangeType?.nameEng) ||
    cleanText(item?.stockExchangeType?.name) ||
    cleanText(fallbackExchange)
  if (value) return value
  return suffixForExchange(item?.stockExchangeType?.code) === 'KQ' ? 'KOSDAQ' : 'KOSPI'
}

function normalizeNaverItem(item, fallbackExchange, forcedType, rank) {
  const code = cleanText(item?.itemCode || item?.reutersCode)
  if (!/^\d{6}$/.test(code)) return null

  const suffix = suffixForExchange(item?.stockExchangeType?.code || fallbackExchange)
  const stockName = cleanText(item?.stockName || item?.name)
  const typeText = cleanText(item?.stockEndType || item?.type).toUpperCase()
  const type = forcedType || (typeText.includes('ETF') || stockName.toUpperCase().includes('ETF') ? 'ETF' : 'EQUITY')

  return normalizePresetItem({
    symbol: `${code}.${suffix}`,
    name: stockName || code,
    keywords: [],
    currency: 'KRW',
    exchange: exchangeLabel(item, fallbackExchange),
    type,
    currentPrice: optionalNumber(item?.closePriceRaw ?? item?.closePrice),
    rank,
  })
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'NAMS stock preset scraper',
    },
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
  return response.json()
}

function naverListUrl(path, page, pageSize) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  })
  return `${NAVER_STOCK_BASE_URL}/${path}?${params.toString()}`
}

async function scrapeNaverList({ label, path, pages, pageSize, delay, fallbackExchange, forcedType }) {
  const presets = []
  for (let page = 1; page <= pages; page += 1) {
    const url = naverListUrl(path, page, pageSize)
    const data = await fetchJson(url)
    const rows = Array.isArray(data?.stocks) ? data.stocks : []
    console.log(`[stock-presets] ${label} page ${page}: ${rows.length}`)
    rows.forEach((row, index) => {
      const rank = (page - 1) * pageSize + index + 1
      const preset = normalizeNaverItem(row, fallbackExchange, forcedType, rank)
      if (preset) presets.push(preset)
    })
    if (rows.length < pageSize) break
    if (delay > 0 && page < pages) await sleep(delay)
  }
  return presets
}

function mergePresetInto(map, item) {
  const preset = normalizePresetItem(item)
  if (!preset) return

  const prev = map.get(preset.symbol)
  if (!prev) {
    map.set(preset.symbol, preset)
    return
  }

  const prevRank = optionalNumber(prev.rank)
  const presetRank = optionalNumber(preset.rank)
  const rank = prevRank && presetRank ? Math.min(prevRank, presetRank) : prevRank || presetRank

  map.set(preset.symbol, compactPreset({
    symbol: prev.symbol,
    name: prev.name || preset.name,
    keywords: cleanKeywords([...(prev.keywords || []), ...(preset.keywords || [])]),
    currency: preset.currency || prev.currency,
    exchange: preset.exchange || prev.exchange,
    type: preset.type || prev.type,
    currentPrice: preset.currentPrice || prev.currentPrice,
    rank,
  }))
}

function mergePresets(seedItems, scrapedItems) {
  const map = new Map()
  seedItems.forEach((item) => mergePresetInto(map, item))
  scrapedItems.forEach((item) => mergePresetInto(map, item))
  return [...map.values()]
}

function generatedModule(items, meta) {
  return `${[
    '// Generated by tools/stock-preset-scraper/scrape-stock-presets.mjs.',
    '// Do not edit by hand. Re-run `npm run stock:presets` instead.',
    '',
    `export const STOCK_SEARCH_PRESETS_META = Object.freeze(${JSON.stringify(meta, null, 2)})`,
    '',
    `export const STOCK_SEARCH_PRESETS = Object.freeze(${JSON.stringify(items, null, 2)})`,
    '',
  ].join('\n')}\n`
}

async function main() {
  const args = parseArgs()
  const seedFile = cleanText(args.seed) || DEFAULT_SEED_FILE
  const jsonOut = cleanText(args['json-out']) || DEFAULT_JSON_OUT
  const generatedOut = cleanText(args['generated-out']) || DEFAULT_GENERATED_OUT
  const pageSize = Math.max(1, intArg(args['page-size'], DEFAULT_PAGE_SIZE))
  const delay = intArg(args.delay, 120)
  const kospiPages = intArg(args['kospi-pages'], 3)
  const kosdaqPages = intArg(args['kosdaq-pages'], 3)
  const etfPages = intArg(args['etf-pages'], 5)

  const seedItems = (await readJson(seedFile)).map(normalizePresetItem).filter(Boolean)
  const scrapedItems = [
    ...(await scrapeNaverList({
      label: 'KOSPI',
      path: 'marketValue/KOSPI',
      pages: kospiPages,
      pageSize,
      delay,
      fallbackExchange: 'KOSPI',
    })),
    ...(await scrapeNaverList({
      label: 'KOSDAQ',
      path: 'marketValue/KOSDAQ',
      pages: kosdaqPages,
      pageSize,
      delay,
      fallbackExchange: 'KOSDAQ',
    })),
    ...(await scrapeNaverList({
      label: 'ETF',
      path: 'etf',
      pages: etfPages,
      pageSize,
      delay,
      fallbackExchange: 'KOSPI',
      forcedType: 'ETF',
    })),
  ]

  const items = mergePresets(seedItems, scrapedItems)
  const generatedAt = new Date().toISOString()
  const meta = {
    schemaVersion: 1,
    source: 'naver-mobile-stock-api',
    generatedAt,
    seed: seedFile,
    scrape: {
      kospiPages,
      kosdaqPages,
      etfPages,
      pageSize,
    },
    count: items.length,
  }

  await writeJson(jsonOut, { ...meta, items })
  if (!args['no-generate']) {
    await writeText(generatedOut, generatedModule(items, meta))
  }

  console.log(`[stock-presets] seed: ${seedItems.length}`)
  console.log(`[stock-presets] scraped: ${scrapedItems.length}`)
  console.log(`[stock-presets] merged: ${items.length}`)
  console.log(`[stock-presets] wrote ${jsonOut}`)
  if (!args['no-generate']) console.log(`[stock-presets] wrote ${generatedOut}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
