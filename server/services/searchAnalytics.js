import prisma from '../lib/prisma.js'

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000 // Pecko operates in Singapore time.

// "Results shown" = total distributor offers across all parts in a result.
export function countOffers(result) {
  return (result?.parts || []).reduce((n, p) => n + (p.offerCount || p.offers?.length || 0), 0)
}

// Cache key: part number normalized so "193643-1", " 193643-1 ", "193643-1a"/"A" collapse sensibly.
export function normalizeKey(q) {
  return q.trim().toUpperCase()
}

export async function getCached(key) {
  const row = await prisma.searchCache.findUnique({ where: { partNumber: key } })
  if (!row) return null
  const result = JSON.parse(row.result)
  result.cachedAt = row.refreshedAt
  return result
}

// Save/refresh a part's cached result — only when it actually found parts, so an
// empty "no match" isn't cached (a later search can retry it live).
// ponytail: cache key is the part number only; the UI never sends exact/inStock/currency,
// so per-option cache variants aren't needed. Add them to the key if that changes.
export async function saveCache(key, query, result) {
  if (!result?.parts?.length) return
  const data = { query, result: JSON.stringify(result), resultCount: countOffers(result), refreshedAt: new Date() }
  await prisma.searchCache.upsert({
    where: { partNumber: key },
    create: { partNumber: key, ...data },
    update: data,
  })
}

export async function logSearch({ userId, username, key, resultCount, cacheHit }) {
  await prisma.searchLog.create({
    data: { userId: userId || null, username: username || 'Unknown', partNumber: key, resultCount, cacheHit },
  })
}

function startOfTodaySGT() {
  const sgt = new Date(Date.now() + SGT_OFFSET_MS)
  const midnightSgtAsUtc = Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate())
  return new Date(midnightSgtAsUtc - SGT_OFFSET_MS)
}

export async function getStats() {
  const today = startOfTodaySGT()
  const [
    searchesToday, searchesTotal, todayUsers, uniqueParts,
    resultsAgg, cachedParts, cacheHitCount, recent,
  ] = await Promise.all([
    prisma.searchLog.count({ where: { createdAt: { gte: today } } }),
    prisma.searchLog.count(),
    prisma.searchLog.findMany({ where: { createdAt: { gte: today } }, distinct: ['userId'], select: { userId: true } }),
    prisma.searchLog.findMany({ distinct: ['partNumber'], select: { partNumber: true } }),
    prisma.searchLog.aggregate({ _sum: { resultCount: true } }),
    prisma.searchCache.count(),
    prisma.searchLog.count({ where: { cacheHit: true } }),
    prisma.searchLog.findMany({
      orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, username: true, partNumber: true, resultCount: true, cacheHit: true, createdAt: true },
    }),
  ])
  return {
    searchesToday,
    usersToday: todayUsers.length,
    searchesTotal,
    uniqueParts: uniqueParts.length,
    totalResultsShown: resultsAgg._sum.resultCount || 0,
    cachedParts,
    cacheHitCount,
    liveCount: searchesTotal - cacheHitCount,
    recent,
  }
}
