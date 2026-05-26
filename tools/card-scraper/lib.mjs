import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const CARD_GORILLA_BASE_URL = 'https://www.card-gorilla.com'
export const CARD_GORILLA_SITEMAP_URL = `${CARD_GORILLA_BASE_URL}/sitemap-cards.xml`

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const body = token.slice(2)
    const eqIndex = body.indexOf('=')
    if (eqIndex >= 0) {
      args[body.slice(0, eqIndex)] = body.slice(eqIndex + 1)
      continue
    }
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      args[body] = next
      index += 1
    } else {
      args[body] = true
    }
  }
  return args
}

export function intArg(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback
}

export function boolArg(value) {
  return value === true || value === 'true' || value === '1' || value === 'yes'
}

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf-8'))
}

export async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`)
}

export async function writeText(file, value) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, value)
}

export function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

export function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export function stripTags(value) {
  return normalizeWhitespace(
    decodeHtml(
      String(value ?? '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
    )
  )
}

function tagAttributes(tag) {
  const attrs = {}
  String(tag || '').replace(/([\w:-]+)\s*=\s*(['"])(.*?)\2/g, (_, key, quote, value) => {
    attrs[key.toLowerCase()] = decodeHtml(value)
    return ''
  })
  return attrs
}

export function metaMap(html) {
  const map = {}
  for (const match of String(html || '').matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = tagAttributes(match[0])
    const key = attrs.name || attrs.property
    if (key && attrs.content != null) map[key] = attrs.content
  }
  return map
}

export function linkMap(html) {
  const map = {}
  for (const match of String(html || '').matchAll(/<link\b[^>]*>/gi)) {
    const attrs = tagAttributes(match[0])
    if (attrs.rel && attrs.href) map[attrs.rel] = attrs.href
  }
  return map
}

export function extractFirstByClass(html, className, tag = '[a-z0-9]+') {
  const pattern = new RegExp(`<(${tag})\\b[^>]*class=["'][^"']*${escapeRegExp(className)}[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i')
  const match = String(html || '').match(pattern)
  return match ? stripTags(match[2]) : ''
}

export function extractSectionByClass(html, className) {
  const pattern = new RegExp(`<section\\b[^>]*class=["'][^"']*${escapeRegExp(className)}[^"']*["'][^>]*>([\\s\\S]*?)<\\/section>`, 'i')
  return String(html || '').match(pattern)?.[1] || ''
}

export function extractJsonLd(html) {
  const docs = []
  for (const match of String(html || '').matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = decodeHtml(match[1]).trim()
    if (!body) continue
    try {
      docs.push(JSON.parse(body))
    } catch {
      // Ignore malformed analytics snippets. Product data is still available
      // through SEO meta tags on card detail pages.
    }
  }
  return docs
}

export function findJsonLdProduct(docs) {
  const stack = [...docs]
  while (stack.length > 0) {
    const node = stack.shift()
    if (!node || typeof node !== 'object') continue
    if (Array.isArray(node)) {
      stack.push(...node)
      continue
    }
    if (node['@type'] === 'Product') return node
    if (Array.isArray(node['@graph'])) stack.push(...node['@graph'])
  }
  return null
}

export function extractSeoBenefits(html) {
  const section = extractSectionByClass(html, 'seo-card-benefits')
  const benefits = []
  for (const match of section.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const li = match[1]
    const category = stripTags(li.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1] || '')
    const text = stripTags(li.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '')
    if (category || text) benefits.push({ category, text })
  }
  return benefits
}

export function extractSeoList(html, className) {
  const section = extractSectionByClass(html, className)
  return [...section.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => stripTags(match[1]))
    .filter(Boolean)
}

export function splitDotLine(value) {
  return normalizeWhitespace(value)
    .split(/\s*[·|]\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function extractCardId(url) {
  return String(url || '').match(/\/card\/detail\/(\d+)/)?.[1] || ''
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function absoluteCardUrl(pathOrUrl) {
  const value = String(pathOrUrl || '').trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  return `${CARD_GORILLA_BASE_URL}${value.startsWith('/') ? '' : '/'}${value}`
}
