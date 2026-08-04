import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useLang } from '@/i18n/LanguageContext'
import { Search, Users, Layers, ListChecks, Database, Activity } from 'lucide-react'

function StatCard({ label, value, icon: Icon, color }) {
  return (
    <div className="bg-navy-900 border border-navy-700 rounded-xl p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center ${color}`}><Icon size={20} /></div>
      <div>
        <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-slate-100 font-mono mt-0.5">{value ?? '—'}</p>
      </div>
    </div>
  )
}

export default function SourceRawMaterialsDashboard() {
  const { t, lang } = useLang()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/part-sourcing/search-stats').then(res => setStats(res.data)).finally(() => setLoading(false))
  }, [])

  const locale = lang === 'zh' ? 'zh-CN' : 'en-SG'

  if (loading) {
    return (
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => <div key={i} className="bg-navy-900 border border-navy-700 rounded-xl h-24 animate-pulse" />)}
      </div>
    )
  }

  const cards = [
    { label: t('srmDash.searchesToday'), value: stats.searchesToday, icon: Search, color: 'bg-electric-500/20 text-electric-300' },
    { label: t('srmDash.usersToday'), value: stats.usersToday, icon: Users, color: 'bg-purple-500/20 text-purple-300' },
    { label: t('srmDash.totalSearches'), value: stats.searchesTotal, icon: Activity, color: 'bg-sky-500/20 text-sky-300' },
    { label: t('srmDash.uniqueParts'), value: stats.uniqueParts, icon: Layers, color: 'bg-amber-500/20 text-amber-300' },
    { label: t('srmDash.resultsShown'), value: stats.totalResultsShown, icon: ListChecks, color: 'bg-emerald-500/20 text-emerald-300' },
    { label: t('srmDash.cachedParts'), value: stats.cachedParts, icon: Database, color: 'bg-rose-500/20 text-rose-300' },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        {cards.map(c => <StatCard key={c.label} {...c} />)}
      </div>

      <div className="bg-navy-900 border border-navy-700 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-navy-700">
          <h3 className="font-semibold text-slate-100">{t('srmDash.recentSearches')}</h3>
          <span className="text-xs text-slate-500">{t('srmDash.cacheLive')}: {stats.cacheHitCount} / {stats.liveCount}</span>
        </div>
        {!stats.recent.length ? (
          <div className="p-12 text-center">
            <Search size={36} className="mx-auto text-slate-600 mb-3" />
            <p className="text-slate-400">{t('srmDash.noSearches')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-navy-800 border-b border-navy-700">
                  {[t('srmDash.colPart'), t('srmDash.colUser'), t('srmDash.colTime'), t('srmDash.colResults'), t('srmDash.colSource')].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-slate-400 font-medium text-xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.recent.map((r, i) => (
                  <tr key={r.id} className={i % 2 === 0 ? 'bg-navy-900' : 'bg-navy-800/50'}>
                    <td className="px-4 py-3 text-slate-100 font-mono">{r.partNumber}</td>
                    <td className="px-4 py-3 text-slate-300">{r.username}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{new Date(r.createdAt).toLocaleString(locale)}</td>
                    <td className="px-4 py-3 text-slate-200 font-mono">{r.resultCount}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${r.cacheHit ? 'bg-navy-700 text-slate-400' : 'bg-emerald-500/15 text-emerald-300'}`}>
                        {r.cacheHit ? t('srmDash.cached') : t('srmDash.live')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
