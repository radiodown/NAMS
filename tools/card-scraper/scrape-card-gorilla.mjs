#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CARD_GORILLA_SITEMAP_URL,
  absoluteCardUrl,
  boolArg,
  extractCardId,
  extractFirstByClass,
  extractJsonLd,
  extractSeoBenefits,
  extractSeoList,
  findJsonLdProduct,
  intArg,
  linkMap,
  metaMap,
  normalizeWhitespace,
  parseArgs,
  sleep,
  splitDotLine,
  stripTags,
  writeJson,
} from './lib.mjs'

const DEFAULT_OUT = 'data/card-products/card-gorilla.raw.json'
const DEFAULT_CACHE_DIR = 'tools/card-scraper/.cache/card-gorilla'
const USER_AGENT =
  'Mozilla/5.0 (compatible; NAMSCardCatalogBot/0.1; +https://www.card-gorilla.com/robots.txt)'

function sitemapEntries(xml) {
  return [...String(xml || '').matchAll(/<url>\s*<loc>(.*?)<\/loc>(?:\s*<lastmod>(.*?)<\/lastmod>)?/g)]
    .map((match) => ({
      url: absoluteCardUrl(match[1]),
      lastmod: normalizeWhitespace(match[2] || ''),
    }))
    .filter((entry) => /\/card\/detail\/\d+/.test(entry.url))
}

async function fetchText(url, { timeoutMs = 20000, retries = 2 } = {}) {
  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          'user-agent': USER_AGENT,
        },
        signal: controller.signal,
      })
      const text = await response.text()
      clearTimeout(timer)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      }
      return text
    } catch (error) {
      clearTimeout(timer)
      lastError = error
      if (attempt < retries) await sleep(800 * (attempt + 1))
    }
  }
  throw lastError
}

async function cachedFetch(url, { cacheDir, force }) {
  const id = extractCardId(url)
  const cacheFile = join(cacheDir, `${id || encodeURIComponent(url)}.html`)
  if (!force) {
    try {
      return {
        html: await readFile(cacheFile, 'utf-8'),
        cacheHit: true,
        cacheFile,
      }
    } catch {
      // Cache miss; fetch below.
    }
  }

  const html = await fetchText(url)
  await writeFile(cacheFile, html)
  return { html, cacheHit: false, cacheFile }
}

function parseCardDetail(html, entry, { fetchedAt, cacheHit, cacheFile }) {
  const metas = metaMap(html)
  const links = linkMap(html)
  const docs = extractJsonLd(html)
  const product = findJsonLdProduct(docs)
  const sourceId = extractCardId(entry.url)
  const canonical = links.canonical || entry.url
  const title = stripTags(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
  const rawName =
    extractFirstByClass(html, 'seo-card-hero', 'h1') ||
    String(product?.name || metas['og:title'] || title).replace(/\s*\|\s*카드고릴라\s*$/, '')
  const name = normalizeWhitespace(rawName.replace(/\s*\|\s*카드고릴라\s*$/, ''))
  const brand = normalizeWhitespace(metas.brand || product?.brand?.name || '')
  const category = normalizeWhitespace(metas.category || product?.category || '')
  const benefitLine =
    extractFirstByClass(html, 'seo-card-line-benefits', 'p') ||
    metas.description ||
    metas['og:description'] ||
    product?.description ||
    ''
  const conditionLine = extractFirstByClass(html, 'seo-card-line-conditions', 'p')
  const benefits = extractSeoBenefits(html)
  const awards = extractSeoList(html, 'seo-card-awards')
  const availability = String(product?.offers?.availability || '')
  const discontinuedText = `${title} ${benefitLine} ${conditionLine}`.includes('발급중단')
  const status = discontinuedText
    ? 'discontinued'
    : availability.includes('InStock')
      ? 'active'
      : 'unknown'

  return {
    source: 'card-gorilla',
    sourceId,
    sourceUrl: canonical,
    sitemapUrl: entry.url,
    sitemapLastmod: entry.lastmod,
    fetchedAt,
    cacheHit,
    cacheFile,
    status,
    name,
    issuer: brand,
    category,
    imageUrl: metas.image || metas['og:image'] || product?.image || '',
    annualFeeText: metas.annualFee || product?.offers?.description || '',
    priceCurrency: metas.priceCurrency || product?.offers?.priceCurrency || 'KRW',
    offerLowPrice: product?.offers?.lowPrice ?? null,
    offerHighPrice: product?.offers?.highPrice ?? null,
    seo: {
      title,
      description: normalizeWhitespace(benefitLine),
      primaryLine: extractFirstByClass(html, 'seo-card-line-primary', 'p'),
      benefitLine: normalizeWhitespace(benefitLine),
      conditionLine: normalizeWhitespace(conditionLine),
      conditionTokens: splitDotLine(conditionLine),
      benefits,
      awards,
    },
    relatedCardUrls: [...String(html).matchAll(/href=["'](\/card\/detail\/\d+)["']/g)].map((match) =>
      absoluteCardUrl(match[1])
    ),
  }
}

async function main() {
  const args = parseArgs()
  const out = args.out || DEFAULT_OUT
  const cacheDir = args['cache-dir'] || DEFAULT_CACHE_DIR
  const delayMs = intArg(args['delay-ms'], 300)
  const limit = args.limit == null ? Infinity : intArg(args.limit, Infinity)
  const offset = intArg(args.offset, 0)
  const force = boolArg(args.force)
  const sitemapUrl = args.sitemap || CARD_GORILLA_SITEMAP_URL
  await import('node:fs/promises').then(({ mkdir }) => mkdir(cacheDir, { recursive: true }))

  console.log(`[card-scraper] sitemap: ${sitemapUrl}`)
  const sitemap = await fetchText(sitemapUrl, { timeoutMs: 20000, retries: 2 })
  const targets = sitemapEntries(sitemap).slice(offset, Number.isFinite(limit) ? offset + limit : undefined)
  const fetchedAt = new Date().toISOString()
  const items = []
  const failures = []

  console.log(`[card-scraper] targets: ${targets.length}${Number.isFinite(limit) ? ` (limit ${limit})` : ''}`)
  for (let index = 0; index < targets.length; index += 1) {
    const entry = targets[index]
    const id = extractCardId(entry.url)
    try {
      const fetched = await cachedFetch(entry.url, { cacheDir, force })
      const item = parseCardDetail(fetched.html, entry, {
        fetchedAt,
        cacheHit: fetched.cacheHit,
        cacheFile: fetched.cacheFile,
      })
      items.push(item)
      console.log(
        `[card-scraper] ${index + 1}/${targets.length} #${id} ${item.category || '-'} ${item.issuer || '-'} · ${item.name || '(이름 없음)'}${fetched.cacheHit ? ' cache' : ''}`
      )
    } catch (error) {
      failures.push({ url: entry.url, message: error?.message || String(error) })
      console.warn(`[card-scraper] failed #${id}: ${error?.message || error}`)
    }
    if (delayMs > 0 && index < targets.length - 1) await sleep(delayMs)
  }

  await writeJson(out, {
    schemaVersion: 1,
    source: 'card-gorilla',
    sourceSitemap: sitemapUrl,
    scrapedAt: fetchedAt,
    count: items.length,
    failureCount: failures.length,
    items,
    failures,
  })
  console.log(`[card-scraper] wrote ${items.length} cards to ${out}`)
  if (failures.length) console.log(`[card-scraper] failures: ${failures.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
