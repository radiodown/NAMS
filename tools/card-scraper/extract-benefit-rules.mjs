#!/usr/bin/env node
import { normalizeWhitespace, parseArgs, readJson, writeJson } from './lib.mjs'

const DEFAULT_IN = 'data/card-products/card-products.normalized.json'
const DEFAULT_OUT = 'data/card-products/card-benefit-rules.json'

const CATEGORY_RULES = [
  { appCategory: '교통', keywords: ['대중교통', '교통', '버스', '지하철', '택시', '주유', '철도', '기차', '고속버스'] },
  { appCategory: '통신', keywords: ['통신', '이동통신', '휴대폰', 'SKT', 'KT', 'LG U+', '인터넷'] },
  { appCategory: '식비', keywords: ['카페', '커피', '스타벅스', '배달', '음식', '외식', '레스토랑', '편의점'] },
  { appCategory: '생활용품', keywords: ['마트', '쇼핑', '백화점', '온라인몰', '쿠팡', '생활', '편의점'] },
  { appCategory: '문화/여가', keywords: ['영화', 'OTT', '디지털콘텐츠', '구독', '여행', '호텔', '항공', '테마파크', '공연'] },
  { appCategory: '의료/건강', keywords: ['병원', '약국', '의료', '헬스', '건강'] },
  { appCategory: '교육', keywords: ['교육', '학원', '도서', '서점', '온라인강의'] },
  { appCategory: '보험', keywords: ['보험'] },
]

function categoryForBenefit(benefit) {
  const text = `${benefit.category || ''} ${benefit.text || ''}`.toLowerCase()
  const rule = CATEGORY_RULES.find((item) =>
    item.keywords.some((keyword) => text.includes(keyword.toLowerCase()))
  )
  return rule?.appCategory || ''
}

function benefitType(text) {
  if (/캐시백/i.test(text)) return 'cashback'
  if (/적립|포인트|마일/i.test(text)) return 'reward'
  if (/할인|결제일할인|청구할인/i.test(text)) return 'discount'
  return 'service'
}

function parsePercent(text) {
  const source = String(text || '')
  const range = source.match(/(\d+(?:\.\d+)?)\s*[~∼-]\s*(\d+(?:\.\d+)?)\s*%/)
  if (range) {
    return {
      rateMin: Number(range[1]),
      rateMax: Number(range[2]),
    }
  }
  const single = source.match(/(\d+(?:\.\d+)?)\s*%/)
  if (single) {
    const rate = Number(single[1])
    return { rateMin: rate, rateMax: rate }
  }
  return { rateMin: null, rateMax: null }
}

function parseFixedAmount(text) {
  const source = String(text || '').replace(/,/g, '')
  const liter = source.match(/(?:리터\s*당|L\s*당|\/\s*L)\s*(\d+)\s*원/i) || source.match(/(\d+)\s*원\s*(?:\/\s*L|리터)/i)
  if (liter) return { amount: Number(liter[1]), unit: 'liter' }
  const won = source.match(/(\d+)\s*원/)
  if (won) return { amount: Number(won[1]), unit: 'transaction' }
  return { amount: null, unit: '' }
}

function confidenceFor(rule) {
  let score = 0.25
  if (rule.appCategory) score += 0.2
  if (rule.type !== 'service') score += 0.15
  if (rule.rateMax != null || rule.fixedAmount != null) score += 0.3
  if (rule.monthlyRequirementMin != null) score += 0.1
  return Math.min(0.9, Number(score.toFixed(2)))
}

function ruleFromBenefit(card, benefit) {
  const text = normalizeWhitespace(benefit.text)
  const percent = parsePercent(text)
  const fixed = parseFixedAmount(text)
  const rule = {
    id: benefit.id,
    cardProductId: card.id,
    sourceId: card.sourceId,
    issuer: card.issuer,
    cardName: card.name,
    appCategory: categoryForBenefit(benefit),
    sourceCategory: benefit.category || '기타',
    type: benefitType(text),
    rateMin: percent.rateMin,
    rateMax: percent.rateMax,
    fixedAmount: fixed.amount,
    fixedAmountUnit: fixed.unit,
    monthlyCap: null,
    monthlyRequirementMin: card.monthlyRequirementMin,
    rawText: text,
    parser: 'seo-benefit-heuristic-v1',
  }
  return { ...rule, confidence: confidenceFor(rule) }
}

async function main() {
  const args = parseArgs()
  const input = args.in || DEFAULT_IN
  const output = args.out || DEFAULT_OUT
  const catalog = await readJson(input)
  const cards = Array.isArray(catalog.items) ? catalog.items : []
  const rules = cards.flatMap((card) => (card.benefits || []).map((benefit) => ruleFromBenefit(card, benefit)))

  await writeJson(output, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: catalog.source || 'card-gorilla',
    sourceCatalogGeneratedAt: catalog.generatedAt || '',
    count: rules.length,
    rules,
  })

  console.log(`[card-rules] wrote ${rules.length} rules to ${output}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
