// Shared Tavily (web search) + DeepSeek (LLM) clients.
// DeepSeek cannot browse, so anything factual it says must be grounded in real
// Tavily results and — where possible — verified against a source of truth.

const TAVILY_URL = 'https://api.tavily.com/search'
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
export const DEEPSEEK_MODEL = 'deepseek-v4-flash'

function httpError(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

// Returns { results, configured }. configured=false when no key is set, so callers
// can degrade gracefully instead of pretending they searched.
export async function tavilySearch(query, { maxResults = 10, searchDepth = 'advanced', excludeDomains = [] } = {}) {
  const key = process.env.TAVILY_API_KEY
  if (!key) return { results: [], configured: false }

  const res = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      query: query.slice(0, 380),
      max_results: maxResults,
      search_depth: searchDepth,
      ...(excludeDomains.length ? { exclude_domains: excludeDomains } : {}),
    }),
  })
  if (!res.ok) throw httpError(`Tavily search returned HTTP ${res.status}`, 502)
  const data = await res.json()
  return { results: data.results || [], configured: true }
}

// Raw text completion. Pass json:true to force a single JSON object back.
export async function deepseekChat({ system, messages = [], json = false, temperature = 0.2 }) {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) throw httpError('AI is not configured. Set DEEPSEEK_API_KEY.', 503)

  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  })
  if (!res.ok) throw httpError(`DeepSeek API returned HTTP ${res.status}`, 502)
  const data = await res.json()
  const raw = data.choices?.[0]?.message?.content?.trim()
  if (!raw) throw httpError('DeepSeek returned an empty response.', 502)
  return raw
}

// deepseekChat + JSON.parse, returning null instead of throwing on malformed output.
export async function deepseekJson(opts) {
  const raw = await deepseekChat({ ...opts, json: true })
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
