// TrustedParts.com Inventory API v2 client + response normalizer.
// Contract (from https://api.trustedparts.com/swagger/inventory-api-v2/swagger.json):
//   POST https://api.trustedparts.com/v2/search
//   Auth: header `X-Api-Key: {key}` (CompanyId/ApiKey are also accepted in the body).
//   Body: { CompanyId, ApiKey, Queries: [{ SearchToken }], CurrencyCode, ExactMatch, InStockOnly }
//   Response: { PartResults: [{ ..., Distributors: [{ Name, DistributorResults: [...] }] }], ErrorMessage }
// NOTE: the API has no lead-time field — the "Factory Lead Time" seen on trustedparts.com
// is website-only data, so we don't surface it here.

const API_URL = 'https://api.trustedparts.com/v2/search'

// Flatten one part's nested Distributors[] → DistributorResults[] into a flat list of offers.
function toOffers(part) {
  const offers = []
  for (const dist of part.Distributors || []) {
    for (const r of dist.DistributorResults || []) {
      const prices = (r.Pricing?.Prices || []).map(p => ({
        quantity: p.Quantity,
        amount: p.Amount,
        formatted: p.FormattedAmount || p.Text,
      }))
      const links = r.Links || []
      const rohs = (r.Compliance?.RoHS || [])[0]?.IsCompliant ?? null
      offers.push({
        distributor: dist.Name,
        distributorId: dist.Id,
        distributorPartNumber: r.DistributorPartNumber,
        description: r.Description,
        packaging: (r.Packaging || []).map(p => p.PackageType).filter(Boolean).join(', ') || null,
        moq: r.Pricing?.MinimumQuantity ?? (r.Packaging || [])[0]?.MinimumOrderQuantity ?? null,
        currency: r.Pricing?.CurrencyCode || null,
        rohs,
        stock: {
          quantity: r.Stock?.QuantityOnHand ?? null,
          availability: r.Stock?.Availability || null,
        },
        prices,
        buyUrl: linkOf(links, 'View'),
        datasheetUrl: linkOf(links, 'Datasheet'),
      })
    }
  }
  return offers
}

function linkOf(links, type) {
  return links.find(l => (l.Type || '').toLowerCase() === type.toLowerCase())?.Url || null
}

// Cheapest and most-expensive single-unit price across every offer, for the header summary.
function priceRange(offers) {
  const amounts = offers.flatMap(o => o.prices.map(p => p.amount)).filter(a => a != null)
  if (!amounts.length) return null
  return { min: Math.min(...amounts), max: Math.max(...amounts), currency: offers[0]?.currency || 'USD' }
}

function normalizePart(part) {
  const offers = toOffers(part)
  return {
    partNumber: part.PartNumber,
    manufacturer: part.Manufacturer,
    manufacturerId: part.ManufacturerId,
    productUrl: part.ProductUrl,
    // The API repeats the description on each distributor row; use the first non-empty one.
    description: offers.find(o => o.description)?.description || null,
    lifecycleRisk: part.LifecycleRisk || null,
    supplyChainRisk: part.SupplyChainRisk || null,
    isAffectedByTariff: part.IsAffectedByTariff || false,
    specifications: (part.Specifications || []).map(s => ({ key: s.Key, value: s.Value })),
    // Datasheet links are per-distributor; surface the first available as the part's canonical one.
    datasheetUrl: offers.find(o => o.datasheetUrl)?.datasheetUrl || null,
    imageUrl: linkOf(part.Distributors?.flatMap(d => d.DistributorResults?.flatMap(r => r.Links || []) || []) || [], 'Image'),
    priceRange: priceRange(offers),
    offerCount: offers.length,
    offers,
  }
}

export async function searchParts(searchToken, opts = {}) {
  const apiKey = process.env.TRUSTEDPARTS_API_KEY
  const companyId = process.env.TRUSTEDPARTS_COMPANY_ID
  const missing = [
    !apiKey && 'TRUSTEDPARTS_API_KEY',
    !companyId && 'TRUSTEDPARTS_COMPANY_ID',
  ].filter(Boolean)
  if (missing.length) {
    const err = new Error(`TrustedParts API is not configured. Missing env var(s): ${missing.join(', ')}. Set these as Railway Variables on this service/environment.`)
    err.status = 503
    throw err
  }

  const body = {
    CompanyId: companyId,
    ApiKey: apiKey,
    // Manufacturers narrows a partial-match search to one maker's catalogue (used by
    // the Similar Products lookup); omitted entirely for a normal search.
    Queries: [{ SearchToken: searchToken, ...(opts.manufacturers?.length ? { Manufacturers: opts.manufacturers } : {}) }],
    CurrencyCode: opts.currency || 'USD',
    ExactMatch: !!opts.exactMatch,
    InStockOnly: !!opts.inStockOnly,
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = new Error(`TrustedParts API returned HTTP ${res.status}`)
    err.status = 502
    throw err
  }

  const data = await res.json()
  if (data.ErrorMessage) {
    const err = new Error(data.ErrorMessage)
    err.status = 502
    throw err
  }

  return {
    query: searchToken,
    parts: (data.PartResults || []).map(normalizePart),
  }
}
