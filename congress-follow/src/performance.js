import { f } from './signals.js'

/**
 * Performance measurement from disclosed trades.
 *
 * IMPORTANT about what these numbers are. Quiver publishes, per congressional
 * trade, the stock's price change since the transaction date and its excess
 * return against SPY. Those are the only return figures in the API - no
 * endpoint exposes a price time series, so a genuine time-weighted portfolio
 * return (a real "annual return") cannot be computed here.
 *
 * What is reported instead is the AVERAGE RETURN PER DISCLOSED TRADE, grouped
 * by when the trade happened. That is a real, defensible measure of how a
 * source's picks have performed. It is NOT what you would have earned:
 *   - it ignores position sizing, so a huge trade counts the same as a tiny one
 *   - it ignores when you would actually have bought, which is up to 45 days
 *     later than the politician did
 *   - it has survivorship and disclosure-lag effects baked in
 *   - it is a point-in-time snapshot to today, not a compounded series
 *
 * Senate, House, insider and 13F rows carry no return fields at all, so those
 * sources report coverage 0 rather than a fabricated number.
 */

export const WINDOWS = [
  { id: 'day', label: 'Last 24h', days: 1 },
  { id: 'month', label: 'Last 30d', days: 30 },
  { id: 'year', label: 'Last 365d', days: 365 },
  { id: 'all', label: 'All in feed', days: Infinity }
]

const num = v => {
  // Number(null) and Number('') are both 0, which would turn "no return data"
  // into a real-looking 0% return. Reject empties before coercing.
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function daysAgo (dateStr, now) {
  if (!dateStr) return null
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return null
  return (now.getTime() - d.getTime()) / 86_400_000
}

/** Aggregate one set of rows into the stats we can honestly report. */
function summarise (rows) {
  const withReturn = rows.filter(r => num(r._priceChange) !== null)
  const returns = withReturn.map(r => num(r._priceChange))
  const excess = withReturn.map(r => num(r._excessReturn)).filter(v => v !== null)
  const buys = rows.filter(r => r._side === 'BUY').length

  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null
  const median = a => {
    if (!a.length) return null
    const s = [...a].sort((x, y) => x - y)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }

  return {
    trades: rows.length,
    buys,
    sells: rows.length - buys,
    // How many of these rows actually have return data behind them.
    coverage: withReturn.length,
    avgReturnPct: mean(returns),
    medianReturnPct: median(returns),
    avgExcessVsSpyPct: mean(excess),
    winRatePct: returns.length ? (returns.filter(r => r > 0).length / returns.length) * 100 : null
  }
}

/**
 * Build performance by source. `rows` are normalised dataset rows; the return
 * fields live on the raw record, so they are read from `_raw`.
 */
export function analyse (rows, { now = new Date(), groupBy = 'actor' } = {}) {
  const prepared = (rows ?? []).map(r => {
    const raw = r._raw ?? {}
    const t = String(f.transaction(r) ?? '').toLowerCase()
    return {
      ...r,
      _side: t.includes('purchase') ? 'BUY' : t.includes('sale') ? 'SELL' : 'OTHER',
      _priceChange: num(raw.PriceChange),
      _excessReturn: num(raw.ExcessReturn),
      _spyChange: num(raw.SPYChange),
      _age: daysAgo(f.transactionDate(r), now)
    }
  })

  const keyOf = r => groupBy === 'dataset' ? (r.dataset ?? 'unknown') : (f.actor(r) ?? 'unknown')
  const groups = new Map()
  for (const r of prepared) {
    const k = keyOf(r)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(r)
  }

  const out = []
  for (const [key, group] of groups) {
    const windows = {}
    for (const w of WINDOWS) {
      const inWindow = group.filter(r => r._age !== null && r._age <= w.days)
      windows[w.id] = summarise(inWindow)
    }
    out.push({
      key,
      dataset: group[0]?.dataset ?? null,
      party: f.party(group[0] ?? {}) ?? null,
      chamber: f.chamber(group[0] ?? {}) ?? null,
      // A source with no return data anywhere is reported as unmeasurable
      // rather than as a 0% performer.
      measurable: windows.all.coverage > 0,
      windows
    })
  }

  out.sort((a, b) => (b.windows.all.trades ?? 0) - (a.windows.all.trades ?? 0))
  return { sources: out, generatedAt: now.toISOString() }
}
