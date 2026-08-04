import { useState, useRef, useEffect } from 'react'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { useLang } from '@/i18n/LanguageContext'
import {
  Search as SearchIcon, ExternalLink, FileText, Loader2, AlertCircle,
  PackageSearch, ShieldCheck, Cpu, ListTree, Store, MessageSquare, Info, Send, SearchX, RefreshCw,
} from 'lucide-react'

// The default prompt auto-sent when the Ask AI tab is first opened for a part.
const buildInitialPrompt = partNumber =>
  `For this Electronics manufacturing part number "${partNumber}" search through the web and Find stockiest and give me detailed information in card format with all default informations available about this part`

// Best unit price for a quantity: the cheapest tier whose break quantity is <= qty.
// Returns null if qty is below every tier's break (i.e. minimum not met).
function unitPriceAt(prices, qty) {
  const eligible = prices.filter(p => p.quantity <= qty)
  if (!eligible.length) return null
  return Math.min(...eligible.map(p => p.amount))
}

function money(n, currency = 'USD') {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n)
}

export default function SourceRawMaterialsSearch() {
  const [term, setTerm] = useState('')
  const [qty, setQty] = useState(1)
  const [phase, setPhase] = useState('idle') // idle | loading | done | error
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [tab, setTab] = useState('overview') // overview | specs | distributors | chat
  const [chat, setChat] = useState({ messages: [], loading: false, error: '' })
  const chatStartedRef = useRef(false)
  const [refreshing, setRefreshing] = useState(false)
  const { t } = useLang()

  async function handleSearch(e, { refresh = false } = {}) {
    e?.preventDefault()
    const q = term.trim()
    if (q.length < 2) return
    if (refresh) {
      setRefreshing(true)
    } else {
      setPhase('loading')
      setError('')
      setResult(null)
      setTab('overview')
      setChat({ messages: [], loading: false, error: '' })
      chatStartedRef.current = false
    }
    try {
      const { data } = await api.get('/part-sourcing/search', { params: { q, ...(refresh ? { refresh: 'true' } : {}) } })
      setResult(data)
      setPhase('done')
    } catch (err) {
      // On refresh, keep the existing cached results rather than blanking the page.
      if (!refresh) {
        setError(err.response?.data?.error || t('sourcing.searchFailed'))
        setPhase('error')
      }
    } finally {
      setRefreshing(false)
    }
  }

  const part = result?.parts?.[0]

  async function sendChat(text, { hidden = false } = {}) {
    const history = [...chat.messages, { role: 'user', content: text, hidden }]
    setChat(c => ({ ...c, messages: history, loading: true, error: '' }))
    try {
      const { data } = await api.post('/part-sourcing/chat', {
        part: {
          partNumber: part.partNumber,
          manufacturer: part.manufacturer,
          description: part.description,
          specifications: part.specifications,
        },
        messages: history.map(m => ({ role: m.role, content: m.content })),
      })
      setChat(c => ({
        ...c,
        messages: [...history, { role: 'assistant', content: data.message, stockists: data.stockists }],
        loading: false,
      }))
    } catch (err) {
      setChat(c => ({ ...c, loading: false, error: err.response?.data?.error || t('chat.chatFailed') }))
    }
  }

  // Auto-run the default prompt the first time the Ask AI tab is opened for a part.
  function ensureChatStarted() {
    if (chatStartedRef.current) return
    chatStartedRef.current = true
    sendChat(buildInitialPrompt(part.partNumber), { hidden: true })
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-3">
        <div className="relative flex-1">
          <SearchIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            autoFocus
            value={term}
            onChange={e => setTerm(e.target.value)}
            placeholder={t('sourcing.placeholder')}
            className="w-full bg-navy-800 border border-navy-600 rounded-xl pl-11 pr-4 py-3.5 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-electric-400 focus:border-transparent"
          />
        </div>
        <button
          type="submit"
          disabled={phase === 'loading' || term.trim().length < 2}
          className="px-6 rounded-xl bg-electric-500 hover:bg-electric-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold flex items-center gap-2 transition-colors"
        >
          {phase === 'loading' ? <Loader2 size={18} className="animate-spin" /> : <SearchIcon size={18} />}
          {t('common.search')}
        </button>
      </form>

      {/* States */}
      {phase === 'idle' && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <PackageSearch size={48} className="text-slate-600 mb-4" />
          <p className="text-slate-400 max-w-sm">{t('sourcing.idle')}</p>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl px-4 py-3">
          <AlertCircle size={18} className="shrink-0" /> {error}
        </div>
      )}

      {phase === 'done' && !part && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <PackageSearch size={48} className="text-slate-600 mb-4" />
          <p className="text-slate-300 font-medium">{t('sourcing.noMatches', { q: result.query })}</p>
          <p className="text-slate-500 text-sm mt-1">{t('sourcing.checkPartNumber')}</p>
        </div>
      )}

      {phase === 'done' && part && (
        <>
          <PartHeader part={part} cacheHit={result.cacheHit} cachedAt={result.cachedAt}
            onRefresh={() => handleSearch(null, { refresh: true })} refreshing={refreshing} />

          {/* Tabs */}
          <div>
            <div className="flex gap-1 border-b border-navy-600">
              <TabButton active={tab === 'overview'} onClick={() => setTab('overview')} icon={Info}
                label={t('sourcing.tabOverview')} />
              <TabButton active={tab === 'specs'} onClick={() => setTab('specs')} icon={ListTree}
                label={t('sourcing.tabSpecs')} count={part.specifications.length} />
              <TabButton active={tab === 'distributors'} onClick={() => setTab('distributors')} icon={Store}
                label={t('sourcing.tabDistributors')} count={part.offerCount} />
              <TabButton active={tab === 'chat'} onClick={() => setTab('chat')} icon={MessageSquare}
                label={t('sourcing.tabAskAi')} />
            </div>

            <div className="pt-5">
              {tab === 'overview' && <OverviewTab part={part} onViewDistributors={() => setTab('distributors')} />}
              {tab === 'specs' && <SpecsTab specifications={part.specifications} />}
              {tab === 'distributors' && <OffersTable offers={part.offers} qty={qty} setQty={setQty} />}
              {tab === 'chat' && <ChatTab part={part} chat={chat} onSend={sendChat} onMount={ensureChatStarted} />}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function TabButton({ active, onClick, icon: Icon, label, count }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
        active ? 'border-electric-400 text-electric-300' : 'border-transparent text-slate-400 hover:text-slate-200'
      )}
    >
      <Icon size={16} /> {label}
      {count != null && <span className="text-xs text-slate-500">({count})</span>}
    </button>
  )
}

function PartHeader({ part, cacheHit, cachedAt, onRefresh, refreshing }) {
  const { t, lang } = useLang()
  const locale = lang === 'zh' ? 'zh-CN' : 'en-SG'
  return (
    <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 flex flex-wrap items-start gap-6">
      <div className="w-20 h-20 rounded-lg bg-navy-900 border border-navy-600 flex items-center justify-center shrink-0 overflow-hidden">
        {part.imageUrl
          ? <img src={part.imageUrl} alt="" className="w-full h-full object-contain" />
          : <Cpu size={28} className="text-slate-600" />}
      </div>

      <div className="flex-1 min-w-[240px]">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-2xl font-bold text-slate-100">{part.partNumber}</h2>
          <span className="text-slate-400">{t('sourcing.by')} {part.manufacturer}</span>
        </div>
        {part.description && <p className="text-slate-400 mt-1">{part.description}</p>}
        <div className="flex items-center gap-4 mt-3 flex-wrap">
          {part.productUrl && (
            <a href={part.productUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-electric-300 hover:text-electric-400 text-sm">
              <ExternalLink size={14} /> {t('sourcing.partDetails')}
            </a>
          )}
          {part.datasheetUrl && (
            <a href={part.datasheetUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-electric-300 hover:text-electric-400 text-sm">
              <FileText size={14} /> {t('sourcing.datasheet')}
            </a>
          )}
          {part.lifecycleRisk && <span className="text-xs text-slate-500">{t('sourcing.lifecycle', { v: part.lifecycleRisk })}</span>}
          {part.isAffectedByTariff && <span className="text-xs text-amber-400">{t('sourcing.tariff')}</span>}
        </div>
        {cachedAt && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-slate-500">
              {cacheHit ? t('sourcing.cachedOn', { date: new Date(cachedAt).toLocaleString(locale) }) : t('sourcing.live')}
            </span>
            {onRefresh && (
              <button onClick={onRefresh} disabled={refreshing}
                className="inline-flex items-center gap-1 text-xs text-electric-300 hover:text-electric-400 disabled:opacity-50">
                <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? t('sourcing.refreshing') : t('sourcing.refresh')}
              </button>
            )}
          </div>
        )}
      </div>

      {part.priceRange && (
        <div className="text-right shrink-0">
          <p className="text-xs text-slate-500 uppercase tracking-wide">{t('sourcing.priceRange')}</p>
          <p className="text-lg font-semibold text-slate-100 mt-1">
            {money(part.priceRange.min, part.priceRange.currency)} – {money(part.priceRange.max, part.priceRange.currency)}
          </p>
        </div>
      )}
    </div>
  )
}

function OverviewTab({ part, onViewDistributors }) {
  const { t } = useLang()
  const inStock = part.offers.filter(o => o.stock.quantity > 0).length
  const rohsCompliant = part.offers.some(o => o.rohs === true)
  const topSpecs = part.specifications.slice(0, 6)

  const stats = [
    { label: t('sourcing.bestPrice'), value: part.priceRange ? money(part.priceRange.min, part.priceRange.currency) : '—', sub: t('sourcing.lowestUnit') },
    { label: t('sourcing.distributors'), value: part.offerCount, sub: t('sourcing.withStock', { n: inStock }) },
    { label: t('sourcing.rohs'), value: rohsCompliant ? t('sourcing.compliant') : '—', sub: rohsCompliant ? t('sourcing.perDistributor') : t('sourcing.notReported') },
    { label: t('sourcing.lifecycleLabel'), value: part.lifecycleRisk || t('sourcing.lifecycleActive'), sub: part.isAffectedByTariff ? t('sourcing.tariff') : t('sourcing.riskStatus') },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="bg-navy-800 border border-navy-600 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide">{s.label}</p>
            <p className="text-xl font-semibold text-slate-100 mt-1">{s.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-200">{t('sourcing.keySpecs')}</h3>
          <button onClick={onViewDistributors} className="text-sm text-electric-300 hover:text-electric-400">
            {t('sourcing.viewOffers', { n: part.offerCount })}
          </button>
        </div>
        {topSpecs.length ? (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
            {topSpecs.map((s, i) => (
              <div key={i} className="flex justify-between gap-4 py-1.5 border-b border-navy-700">
                <dt className="text-slate-400 text-sm">{s.key}</dt>
                <dd className="text-slate-100 text-sm font-medium text-right">{s.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-slate-500 text-sm">{t('sourcing.noSpecs')}</p>
        )}
      </div>
    </div>
  )
}

function SpecsTab({ specifications }) {
  const { t } = useLang()
  if (!specifications.length) {
    return <p className="text-slate-500 text-sm py-8 text-center">{t('sourcing.noSpecs')}</p>
  }
  return (
    <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-navy-600">
        {specifications.map((s, i) => (
          <div key={i} className="bg-navy-800 px-5 py-3 flex justify-between gap-4">
            <dt className="text-slate-400 text-sm">{s.key}</dt>
            <dd className="text-slate-100 text-sm font-medium text-right">{s.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function ChatTab({ part, chat, onSend, onMount }) {
  const { t } = useLang()
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => { onMount() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chat.messages, chat.loading])

  // Hide the auto-run default prompt from the transcript (it's system-like).
  const visible = chat.messages.filter(m => !m.hidden)

  function submit(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text || chat.loading) return
    setInput('')
    onSend(text)
  }

  return (
    <div className="bg-navy-800 border border-navy-600 rounded-xl flex flex-col h-[32rem]">
      <div className="px-5 py-3 border-b border-navy-600 flex items-center gap-2">
        <MessageSquare size={16} className="text-electric-300" />
        <h3 className="font-semibold text-slate-200">{t('chat.askAbout', { part: part.partNumber })}</h3>
        <span className="text-xs text-slate-500 ml-auto">{t('chat.tagline')}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {visible.length === 0 && !chat.loading && (
          <p className="text-slate-500 text-sm text-center py-8">{t('chat.searching')}</p>
        )}
        {visible.map((m, i) => <ChatBubble key={i} message={m} />)}
        {chat.loading && (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <Loader2 size={16} className="animate-spin" /> {t('chat.searchingThinking')}
          </div>
        )}
        {chat.error && (
          <div className="flex items-center gap-2 text-red-300 text-sm">
            <AlertCircle size={16} /> {chat.error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="p-3 border-t border-navy-600 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={t('chat.placeholder', { part: part.partNumber })}
          className="flex-1 bg-navy-900 border border-navy-600 rounded-lg px-4 py-2.5 text-slate-100 placeholder:text-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-electric-400"
        />
        <button type="submit" disabled={chat.loading || !input.trim()}
          className="px-4 rounded-lg bg-electric-500 hover:bg-electric-400 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center gap-2">
          <Send size={16} />
        </button>
      </form>
    </div>
  )
}

function ChatBubble({ message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap bg-electric-500/20 text-slate-100">
          {message.content}
        </div>
      </div>
    )
  }

  const cards = message.stockists || []
  // No cards AND no text → show a clear "nothing found" panel instead of a blank turn.
  if (!cards.length && !message.content) {
    return <NoResults />
  }
  return (
    <div className="space-y-3">
      {message.content && (
        <div className="max-w-[90%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap bg-navy-900 border border-navy-600 text-slate-200">
          {message.content}
        </div>
      )}
      {cards.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {cards.map((s, i) => <StockistCard key={i} s={s} />)}
        </div>
      )}
    </div>
  )
}

function NoResults() {
  const { t } = useLang()
  return (
    <div className="bg-navy-900 border border-navy-600 rounded-xl p-8 flex flex-col items-center text-center">
      <SearchX size={32} className="text-slate-600 mb-3" />
      <p className="text-slate-300 font-medium">{t('chat.noStockistsTitle')}</p>
      <p className="text-slate-500 text-sm mt-1 max-w-xs">{t('chat.noStockistsBody')}</p>
    </div>
  )
}

function StockistCard({ s }) {
  const { t } = useLang()
  return (
    <div className="bg-navy-900 border border-navy-600 rounded-xl p-4 flex flex-col gap-2 hover:border-electric-500/50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Store size={16} className="text-electric-300 shrink-0" />
          <p className="font-semibold text-slate-100 truncate">{s.name}</p>
        </div>
        {s.stock && (
          <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 whitespace-nowrap">{s.stock}</span>
        )}
      </div>
      {(s.price || s.note) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {s.price && <span className="text-slate-200">{s.price}</span>}
          {s.note && <span className="text-xs text-amber-400/90">{s.note}</span>}
        </div>
      )}
      <a href={s.url} target="_blank" rel="noreferrer"
        className="mt-auto inline-flex items-center gap-1 text-xs text-electric-300 hover:text-electric-400">
        <ExternalLink size={12} className="shrink-0" /> {t('chat.viewListing')}
      </a>
    </div>
  )
}

function OffersTable({ offers, qty, setQty }) {
  const { t } = useLang()
  return (
    <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-navy-600">
        <h3 className="font-semibold text-slate-200">{t('sourcing.distributors')}</h3>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          {t('sourcing.qty')}
          <input
            type="number" min={1} value={qty}
            onChange={e => setQty(Math.max(1, Number(e.target.value) || 1))}
            className="w-24 bg-navy-900 border border-navy-600 rounded-lg px-3 py-1.5 text-slate-100 text-right focus:outline-none focus:ring-2 focus:ring-electric-400"
          />
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-navy-600">
              <th className="px-5 py-3 font-medium">{t('sourcing.colDistributor')}</th>
              <th className="px-3 py-3 font-medium">{t('sourcing.colMoq')}</th>
              <th className="px-3 py-3 font-medium">{t('sourcing.colPkg')}</th>
              <th className="px-3 py-3 font-medium">{t('sourcing.colAvailability')}</th>
              <th className="px-3 py-3 font-medium">{t('sourcing.colRohs')}</th>
              <th className="px-3 py-3 font-medium">{t('sourcing.colOrderPricing')}</th>
              <th className="px-3 py-3 font-medium text-right">{t('sourcing.colTotal', { n: qty })}</th>
              <th className="px-5 py-3 font-medium text-right">{t('sourcing.colBuy')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-700">
            {offers.map((o, i) => {
              const unit = unitPriceAt(o.prices, qty)
              const belowMoq = o.moq != null && qty < o.moq
              const total = unit != null && !belowMoq ? unit * qty : null
              return (
                <tr key={i} className="hover:bg-navy-700/40">
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-100">{o.distributor}</div>
                    {o.distributorPartNumber && <div className="text-xs text-slate-500 font-mono">{o.distributorPartNumber}</div>}
                  </td>
                  <td className="px-3 py-3 text-slate-300">{o.moq != null ? o.moq.toLocaleString() : '—'}</td>
                  <td className="px-3 py-3 text-slate-400">{o.packaging || '—'}</td>
                  <td className="px-3 py-3 text-slate-400 max-w-[180px]">
                    {o.stock.quantity > 0
                      ? <span className="text-emerald-400">{t('sourcing.inStock', { n: o.stock.quantity.toLocaleString() })}</span>
                      : <span>{o.stock.availability || t('sourcing.outOfStock')}</span>}
                  </td>
                  <td className="px-3 py-3">
                    {o.rohs === true ? <ShieldCheck size={16} className="text-emerald-400" />
                      : o.rohs === false ? <span className="text-xs text-slate-500">{t('sourcing.no')}</span>
                      : <span className="text-xs text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="space-y-0.5">
                      {o.prices.length
                        ? o.prices.slice(0, 3).map((p, j) => (
                            <div key={j} className="text-xs text-slate-400 whitespace-nowrap">
                              <span className="text-slate-500">{p.quantity.toLocaleString()}+</span> {p.formatted || money(p.amount, o.currency)}
                            </div>
                          ))
                        : <span className="text-xs text-slate-600">—</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    {belowMoq
                      ? <span className="text-xs text-slate-500">{t('sourcing.minNotMet')}</span>
                      : <span className="font-semibold text-slate-100">{money(total, o.currency)}</span>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      {o.datasheetUrl && (
                        <a href={o.datasheetUrl} target="_blank" rel="noreferrer" title="Datasheet"
                          className="text-slate-500 hover:text-slate-300"><FileText size={16} /></a>
                      )}
                      {o.buyUrl && (
                        <a href={o.buyUrl} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-electric-500/20 hover:bg-electric-500/30 text-electric-300 text-xs font-medium whitespace-nowrap">
                          {t('sourcing.buy')} <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
