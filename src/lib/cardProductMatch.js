const CARD_WORDS = new Set([
  '카드',
  '신용카드',
  '체크카드',
  'credit',
  'check',
  'card',
  '카카오뱅크',
  '케이뱅크',
  '토스뱅크',
])

const ISSUER_ALIAS_MAP = {
  'BC카드': ['bc카드', '비씨카드', 'bc'],
  'KB국민카드': ['kb국민카드', '국민카드', 'kb국민', '국민', 'kb'],
  'NH농협카드': ['nh농협카드', '농협카드', 'nh농협', '농협', 'nh'],
  'IBK기업은행': ['ibk기업은행', '기업은행', 'ibk'],
  'DGB대구은행': ['dgb대구은행', '대구은행', 'dgb'],
  'BNK부산은행': ['bnk부산은행', '부산은행', 'bnk부산'],
  'BNK경남은행': ['bnk경남은행', '경남은행', 'bnk경남'],
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u00a0]/g, ' ')
}

export function compactCardText(value) {
  return normalizeText(value).replace(/[^0-9a-z가-힣]+/g, '')
}

function issuerAliases(issuer) {
  const raw = String(issuer || '').trim()
  if (!raw) return []
  const base = raw.toLowerCase()
  const withoutCard = base.replace(/카드$/g, '')
  const withoutBank = base.replace(/은행$/g, '')
  return [...new Set([base, withoutCard, withoutBank, ...(ISSUER_ALIAS_MAP[raw] || [])])]
    .map(compactCardText)
    .filter(Boolean)
}

function tokenList(value) {
  return normalizeText(value)
    .split(/[^0-9a-z가-힣]+/g)
    .map((token) => token.trim())
    .filter(Boolean)
}

function productIssuerAliases(products) {
  const issuers = new Set((products || []).map((product) => product?.issuer).filter(Boolean))
  return [...issuers].flatMap((issuer) =>
    issuerAliases(issuer).map((alias) => ({ issuer, alias }))
  )
}

function detectIssuer(value, products) {
  const compact = compactCardText(value)
  return productIssuerAliases(products)
    .filter(({ alias }) => alias.length >= 2 && compact.includes(alias))
    .sort((a, b) => b.alias.length - a.alias.length)[0]?.issuer || ''
}

function withoutIssuer(value, issuer) {
  let compact = compactCardText(value)
  issuerAliases(issuer).forEach((alias) => {
    compact = compact.replaceAll(alias, '')
  })
  return compact
}

function meaningfulTokens(value, issuer = '') {
  const issuerParts = new Set(issuerAliases(issuer))
  return tokenList(value)
    .map(compactCardText)
    .filter((token) => token.length >= 2)
    .filter((token) => !CARD_WORDS.has(token))
    .filter((token) => !issuerParts.has(token))
}

function isCardishName(value, products) {
  const compact = compactCardText(value)
  if (!compact) return false
  if (/카드|card|visa|master|amex|jcb|체크|신용/i.test(String(value))) return true
  return Boolean(detectIssuer(value, products))
}

function overlapScore(sourceTokens, productTokens) {
  if (!sourceTokens.length || !productTokens.length) return 0
  const productSet = new Set(productTokens)
  const matched = sourceTokens.filter((token) => productSet.has(token))
  if (!matched.length) return 0
  const coverage = matched.length / Math.max(sourceTokens.length, productTokens.length)
  return 35 + matched.length * 14 + coverage * 28
}

function containmentScore(sourceCore, productCore) {
  if (sourceCore.length < 4 || productCore.length < 4) return 0
  if (sourceCore === productCore) return 120
  if (sourceCore.includes(productCore)) return 96 + (productCore.length / sourceCore.length) * 24
  if (productCore.includes(sourceCore)) return 88 + (sourceCore.length / productCore.length) * 24
  return 0
}

function scoreProduct(source, sourceIssuer, product, sourceCardish) {
  const sourceCompact = compactCardText(source)
  const productNameCompact = compactCardText(product.name)
  const productFullCompact = compactCardText(`${product.issuer || ''}${product.name || ''}`)
  const issuerMatch =
    Boolean(sourceIssuer && product.issuer && sourceIssuer === product.issuer) ||
    issuerAliases(product.issuer).some((alias) => alias && sourceCompact.includes(alias))
  const issuerConflict = Boolean(sourceIssuer && product.issuer && sourceIssuer !== product.issuer)

  if (issuerConflict) return 0

  const sourceCore = withoutIssuer(source, product.issuer).replace(/카드|신용|체크/g, '')
  const productCore = withoutIssuer(product.name, product.issuer).replace(/카드|신용|체크/g, '')
  const sourceTokens = meaningfulTokens(source, product.issuer)
  const productTokens = meaningfulTokens(product.name, product.issuer)
  const hasProductSignal =
    sourceCore.length >= 3 ||
    sourceTokens.some((token) => token.length >= 3 && !issuerAliases(product.issuer).includes(token))

  if (!hasProductSignal) return 0

  let score = 0
  if (sourceCompact === productNameCompact || sourceCompact === productFullCompact) score = 150
  score = Math.max(score, containmentScore(sourceCore, productCore))
  score = Math.max(score, overlapScore(sourceTokens, productTokens))

  if (issuerMatch) score += 32
  if (product.kind && normalizeText(source).includes(normalizeText(product.kind))) score += 8
  if (!sourceCardish) score -= 45

  return Math.max(0, score)
}

export function findCardProductMatch(sourceName, products = []) {
  const name = String(sourceName || '').trim()
  if (!name || !Array.isArray(products) || products.length === 0) return null
  const sourceCardish = isCardishName(name, products)
  if (!sourceCardish) return null

  const sourceIssuer = detectIssuer(name, products)
  const matches = products
    .map((product) => ({
      product,
      score: scoreProduct(name, sourceIssuer, product, sourceCardish),
    }))
    .filter((match) => match.score >= 95)
    .sort((a, b) => b.score - a.score)

  const best = matches[0]
  if (!best) return null
  const runnerUp = matches[1]
  if (runnerUp && best.score - runnerUp.score < 8 && best.score < 132) return null
  return {
    product: best.product,
    score: Math.round(best.score),
    confidence: best.score >= 135 ? 'high' : 'medium',
  }
}

export function cardProductMethodPatch(product) {
  if (!product) return {}
  return {
    kind: product.kind || '신용카드',
    cardProductId: product.id || '',
    cardProductName: product.name || '',
    cardProductIssuer: product.issuer || '',
    cardProductSourceUrl: product.sourceUrl || '',
    annualFee: product.annualFeeMin == null ? '' : product.annualFeeMin,
    monthlyTarget: product.monthlyRequirementMin == null ? '' : product.monthlyRequirementMin,
  }
}
