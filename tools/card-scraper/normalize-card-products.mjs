#!/usr/bin/env node
import { readJson, writeJson, parseArgs, splitDotLine, normalizeWhitespace } from './lib.mjs'

const DEFAULT_IN = 'data/card-products/card-gorilla.raw.json'
const DEFAULT_OUT = 'data/card-products/card-products.normalized.json'

const BRAND_NAMES = [
  'VISA',
  'Mastercard',
  'Master',
  'AMEX',
  'American Express',
  'JCB',
  'UnionPay',
  'BC',
  '국내전용',
]

function unique(list) {
  return [...new Set(list.map((value) => normalizeWhitespace(value)).filter(Boolean))]
}

function parseWonValues(text) {
  const values = []
  const source = String(text || '').replace(/[,\[\]]/g, '')
  for (const match of source.matchAll(/(\d+(?:\.\d+)?)\s*만원/g)) {
    values.push(Math.round(Number(match[1]) * 10000))
  }
  for (const match of source.matchAll(/(\d+(?:\.\d+)?)\s*만\s*원/g)) {
    values.push(Math.round(Number(match[1]) * 10000))
  }
  for (const match of source.matchAll(/(\d+)\s*원/g)) {
    values.push(Number(match[1]))
  }
  return values.filter((value) => Number.isFinite(value) && value >= 0)
}

function minMoney(text) {
  const values = parseWonValues(text)
  return values.length ? Math.min(...values) : null
}

function monthlyRequirementText(raw) {
  const condition = raw?.seo?.conditionLine || ''
  const token = splitDotLine(condition).find((part) => /실적|만원|원|없음/.test(part) && !/연회비|국내|해외|VISA|Master|JCB|AMEX|Union|BC/i.test(part))
  if (token) return token
  return condition.includes('없음') ? '없음' : ''
}

function monthlyRequirementMin(raw) {
  const text = monthlyRequirementText(raw)
  if (!text || text.includes('없음')) return 0
  return minMoney(text)
}

function annualFeeMin(raw) {
  if (raw?.offerLowPrice != null && Number.isFinite(Number(raw.offerLowPrice))) {
    return Number(raw.offerLowPrice)
  }
  return minMoney(raw?.annualFeeText)
}

function brands(raw) {
  const haystack = `${raw?.seo?.conditionLine || ''} ${raw?.annualFeeText || ''}`
  return unique(
    BRAND_NAMES.filter((brand) => {
      if (brand === 'Master') return false
      return haystack.toLowerCase().includes(brand.toLowerCase())
    }).map((brand) => (brand === 'American Express' ? 'AMEX' : brand))
  )
}

function kind(raw) {
  const value = raw?.category || ''
  if (value.includes('체크')) return '체크카드'
  if (value.includes('신용')) return '신용카드'
  return '기타'
}

function benefitSummary(raw) {
  const fromLine = splitDotLine(raw?.seo?.benefitLine || '')
  const fromList = (raw?.seo?.benefits || []).map((benefit) => benefit.text)
  return unique([...fromLine, ...fromList]).slice(0, 12)
}

function normalizeCard(raw) {
  const normalizedKind = kind(raw)
  const categories = unique((raw?.seo?.benefits || []).map((benefit) => benefit.category))
  return {
    id: `card-gorilla-${raw.sourceId}`,
    source: raw.source,
    sourceId: raw.sourceId,
    sourceUrl: raw.sourceUrl,
    issuer: raw.issuer || '카드사 미상',
    name: raw.name || '(이름 없음)',
    kind: normalizedKind,
    status: raw.status || 'unknown',
    imageUrl: raw.imageUrl || '',
    annualFeeMin: annualFeeMin(raw),
    annualFeeText: raw.annualFeeText || '',
    monthlyRequirementMin: monthlyRequirementMin(raw),
    monthlyRequirementText: monthlyRequirementText(raw),
    brands: brands(raw),
    benefitCategories: categories,
    benefitSummary: benefitSummary(raw),
    benefits: (raw?.seo?.benefits || []).map((benefit, index) => ({
      id: `${raw.sourceId}-benefit-${index + 1}`,
      category: benefit.category || '기타',
      text: benefit.text || '',
    })),
    awards: raw?.seo?.awards || [],
    raw: {
      category: raw.category || '',
      conditionLine: raw?.seo?.conditionLine || '',
      description: raw?.seo?.description || '',
      sitemapLastmod: raw.sitemapLastmod || '',
      scrapedAt: raw.fetchedAt || raw.scrapedAt || '',
    },
  }
}

async function main() {
  const args = parseArgs()
  const input = args.in || DEFAULT_IN
  const output = args.out || DEFAULT_OUT
  const includeOther = args['include-other'] === true || args['include-other'] === 'true'
  const raw = await readJson(input)
  const sourceItems = Array.isArray(raw.items) ? raw.items : []
  const items = sourceItems.map(normalizeCard).filter((item) => includeOther || item.kind === '신용카드' || item.kind === '체크카드')

  await writeJson(output, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: raw.source || 'card-gorilla',
    sourceSitemap: raw.sourceSitemap || '',
    sourceScrapedAt: raw.scrapedAt || '',
    count: items.length,
    items,
  })

  console.log(`[card-normalizer] wrote ${items.length} cards to ${output}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
