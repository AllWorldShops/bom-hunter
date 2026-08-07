// Alternative / cross-reference parts.
//
// TrustedParts has no cross-reference endpoint (its ExactMatch:false is a plain
// substring match, so "1936" returns unrelated relays). So we do it in two stages:
//   1. PROPOSE — DeepSeek reads real Tavily web results (cross-reference tables,
//      datasheets, distributor equivalents) and extracts candidate part numbers.
//   2. VERIFY — every candidate is looked up in TrustedParts. Anything that isn't a
//      real, findable part is marked unverified, so a hallucinated MPN can never be
//      presented as a purchasable alternative. Verified ones carry live stock/price.
import prisma from '../lib/prisma.js'
import { tavilySearch, deepseekJson } from '../lib/ai.js'
import { searchParts } from './partSourcing.js'
import { normalizeKey } from './searchAnalytics.js'

const MAX_CANDIDATES = 6 // cap the TrustedParts verification fan-out

// Non-technical noise that never contains a real cross-reference.
const EXCLUDED_DOMAINS = [
  'youtube.com', 'facebook.com', 'linkedin.com', 'reddit.com', 'instagram.com',
  'yahoo.com', 'wsj.com', 'bloomberg.com', 'robinhood.com', 'macrotrends.net',
]

function specLine(part) {
  return (part.specifications || []).map(s => `${s.key}: ${s.value}`).join('; ') || 'n/a'
}

async function proposeCandidates(part) {
  const query = `"${part.partNumber}" ${part.manufacturer || ''} cross reference equivalent alternative replacement part`
  const search = await tavilySearch(query, { maxResults: 12, excludeDomains: EXCLUDED_DOMAINS })
  if (!search.configured) return { candidates: [], configured: false }

  const resultsBlock = search.results.length
    ? search.results.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${(r.content || '').slice(0, 600)}`).join('\n\n')
    : '(No web results found.)'

  const system = `You find ALTERNATIVE / CROSS-REFERENCE parts for one electronics component, for a wire-harness manufacturer's procurement team.

ORIGINAL PART:
- Part number: ${part.partNumber}
- Manufacturer: ${part.manufacturer || 'unknown'}
- Description: ${part.description || 'n/a'}
- Specifications: ${specLine(part)}

RULES — obey exactly:
1. Propose only real MANUFACTURER PART NUMBERS that appear verbatim in the SEARCH RESULTS below. NEVER invent, guess, or recall a part number from memory.
2. Do NOT propose the original part (${part.partNumber}) or a mere re-packaging of it.
3. Prefer parts that are functionally interchangeable — matching the key electrical/mechanical specs above (current rating, wire gauge, contact type, mounting, etc.).
4. You did NOT browse the web; you are only reading the results provided.
5. If the results contain no genuine alternative, return an empty list. An empty list is a correct answer — a wrong part number is not.

Reply with ONE JSON object and nothing else:
{
  "alternatives": [
    { "partNumber": "exact MPN as written in the results", "manufacturer": "maker of that part", "reason": "one short sentence on why it's an alternative and any difference to check", "sourceUrl": "the result URL it came from" }
  ],
  "note": "one short plain-text sentence of context, or \\"\\""
}

SEARCH RESULTS:
${resultsBlock}`

  const parsed = await deepseekJson({ system, messages: [{ role: 'user', content: `Find alternative parts for ${part.partNumber}.` }] })
  const seenUrls = new Set(search.results.map(r => r.url))
  const origin = normalizeKey(part.partNumber)

  const candidates = (Array.isArray(parsed?.alternatives) ? parsed.alternatives : [])
    .filter(a => a?.partNumber && normalizeKey(a.partNumber) !== origin)
    .map(a => ({
      partNumber: String(a.partNumber).trim(),
      manufacturer: a.manufacturer || '',
      reason: a.reason || '',
      // Only keep a source link the search actually returned.
      sourceUrl: seenUrls.has(a.sourceUrl) ? a.sourceUrl : null,
    }))

  // De-dupe by part number, keep the first (highest-ranked) mention.
  const byKey = new Map()
  for (const c of candidates) if (!byKey.has(normalizeKey(c.partNumber))) byKey.set(normalizeKey(c.partNumber), c)

  return { candidates: [...byKey.values()].slice(0, MAX_CANDIDATES), note: parsed?.note || '', configured: true }
}

// Look the candidate up in TrustedParts. Matching on the returned part number (rather
// than trusting ExactMatch) tolerates formatting differences without accepting a
// loosely-related substring hit.
async function verifyCandidate(candidate) {
  const key = normalizeKey(candidate.partNumber)
  try {
    const found = await searchParts(candidate.partNumber)
    const match = (found.parts || []).find(p => normalizeKey(p.partNumber || '') === key)
    if (!match) return { ...candidate, verified: false }

    const inStock = (match.offers || []).reduce((n, o) => n + (o.stock?.quantity > 0 ? o.stock.quantity : 0), 0)
    return {
      ...candidate,
      verified: true,
      manufacturer: match.manufacturer || candidate.manufacturer,
      description: match.description || '',
      productUrl: match.productUrl || null,
      datasheetUrl: match.datasheetUrl || null,
      distributorCount: match.offerCount || 0,
      inStock,
      priceRange: match.priceRange || null,
    }
  } catch {
    // A lookup failure is not evidence the part is fake — just leave it unverified.
    return { ...candidate, verified: false }
  }
}

// ── Similar products ─────────────────────────────────────────────────────────
// Same-maker siblings from the same part-number family. TrustedParts' partial match
// is only a substring match ("1936" also returns relays), so a candidate must ALSO
// share real specifications with the original before we call it similar.
const MIN_SHARED_SPECS = 2

function specMap(part) {
  return Object.fromEntries((part.specifications || [])
    .filter(s => s?.key && s?.value)
    .map(s => [String(s.key).trim().toLowerCase(), String(s.value).trim().toLowerCase()]))
}

function sharedSpecs(origSpecs, cand) {
  const b = specMap(cand)
  const matches = Object.keys(origSpecs).filter(k => k in b && b[k] === origSpecs[k])
  return matches
}

// "193643-1" → ["193643", "193643-", "19364", "1936"] — progressively looser family keys.
function familyPrefixes(pn) {
  const out = []
  const dash = pn.lastIndexOf('-')
  if (dash >= 4) out.push(pn.slice(0, dash))
  for (const len of [6, 5, 4]) if (pn.length > len) out.push(pn.slice(0, len))
  return [...new Set(out)]
}

export async function findSimilarParts(part, { refresh = false } = {}) {
  const cacheKey = `SIM:${normalizeKey(part.partNumber)}`
  if (!refresh) {
    const row = await prisma.alternativesCache.findUnique({ where: { partNumber: cacheKey } })
    if (row) return { ...JSON.parse(row.result), cachedAt: row.refreshedAt, cacheHit: true }
  }

  const origKey = normalizeKey(part.partNumber)
  const origSpecs = specMap(part)
  const manufacturers = part.manufacturer ? [part.manufacturer] : []
  const found = new Map()

  // Widen the family prefix progressively. The narrowest prefix usually returns only
  // the part itself, so all three widths are tried before scoring (~1s each, cached after).
  for (const prefix of familyPrefixes(part.partNumber).slice(0, 3)) {
    try {
      const res = await searchParts(prefix, { manufacturers })
      for (const p of res.parts || []) {
        const k = normalizeKey(p.partNumber || '')
        if (k && k !== origKey && !found.has(k)) found.set(k, p)
      }
    } catch { /* a prefix that errors just contributes nothing */ }
    if (found.size >= 25) break
  }

  const similar = [...found.values()]
    .map(p => {
      const matches = sharedSpecs(origSpecs, p)
      const inStock = (p.offers || []).reduce((n, o) => n + (o.stock?.quantity > 0 ? o.stock.quantity : 0), 0)
      return {
        partNumber: p.partNumber,
        manufacturer: p.manufacturer,
        description: p.description || '',
        productUrl: p.productUrl || null,
        datasheetUrl: p.datasheetUrl || null,
        distributorCount: p.offerCount || 0,
        priceRange: p.priceRange || null,
        inStock,
        matchedSpecs: matches,
        differences: (p.specifications || [])
          .filter(s => origSpecs[String(s.key).trim().toLowerCase()] !== undefined
            && origSpecs[String(s.key).trim().toLowerCase()] !== String(s.value).trim().toLowerCase())
          .slice(0, 3)
          .map(s => ({ key: s.key, value: s.value })),
      }
    })
    // Substring luck is not similarity — demand genuine shared specifications.
    .filter(p => p.matchedSpecs.length >= MIN_SHARED_SPECS)
    .sort((a, b) => (b.matchedSpecs.length - a.matchedSpecs.length) ||
      ((b.inStock > 0) - (a.inStock > 0)) || (b.distributorCount - a.distributorCount))
    .slice(0, 8)

  const result = { similar }
  if (similar.length) {
    const data = { result: JSON.stringify(result), refreshedAt: new Date() }
    await prisma.alternativesCache.upsert({
      where: { partNumber: cacheKey },
      create: { partNumber: cacheKey, ...data },
      update: data,
    })
  }
  return { ...result, cachedAt: new Date(), cacheHit: false }
}

export async function findAlternatives(part, { refresh = false } = {}) {
  const key = normalizeKey(part.partNumber)

  if (!refresh) {
    const row = await prisma.alternativesCache.findUnique({ where: { partNumber: key } })
    if (row) return { ...JSON.parse(row.result), cachedAt: row.refreshedAt, cacheHit: true }
  }

  const { candidates, note, configured } = await proposeCandidates(part)
  const alternatives = (await Promise.all(candidates.map(verifyCandidate)))
    // Verified first, then by availability, then by distributor breadth.
    .sort((a, b) =>
      (b.verified - a.verified) ||
      ((b.inStock > 0) - (a.inStock > 0)) ||
      ((b.distributorCount || 0) - (a.distributorCount || 0)))

  const result = { alternatives, note: note || '', searchConfigured: configured }
  // Don't cache an empty list — a later attempt may do better.
  if (alternatives.length) {
    const data = { result: JSON.stringify(result), refreshedAt: new Date() }
    await prisma.alternativesCache.upsert({
      where: { partNumber: key },
      create: { partNumber: key, ...data },
      update: data,
    })
  }
  return { ...result, cachedAt: new Date(), cacheHit: false }
}
