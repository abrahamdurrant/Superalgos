import { log } from './log.js'

const num = v => {
  const n = Number(String(v ?? '').replace(/[$,%\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Quiver's congressholdings rows carry a `Holdings` field whose exact shape is
 * not documented. Accept the plausible encodings rather than assuming one, and
 * refuse to guess if none match - a silently empty portfolio would make every
 * allocation 0% and quietly size every trade to nothing.
 */
export function parseHoldings (holdings) {
  let h = holdings
  if (typeof h === 'string') {
    try { h = JSON.parse(h) } catch { return null }
  }
  const out = {}

  if (Array.isArray(h)) {
    for (const row of h) {
      if (!row || typeof row !== 'object') continue
      const ticker = String(row.Ticker ?? row.ticker ?? row.Symbol ?? row.symbol ?? '').trim().toUpperCase()
      const value = num(row.Value ?? row.value ?? row.Amount ?? row.amount ?? row.MarketValue ?? row.Shares ?? row.Weight)
      if (ticker && value != null && value > 0) out[ticker] = (out[ticker] ?? 0) + value
    }
    return Object.keys(out).length ? out : null
  }

  if (h && typeof h === 'object') {
    for (const [k, v] of Object.entries(h)) {
      const ticker = String(k).trim().toUpperCase()
      const value = typeof v === 'object' ? num(v?.Value ?? v?.value ?? v?.Amount) : num(v)
      if (ticker && value != null && value > 0) out[ticker] = value
    }
    return Object.keys(out).length ? out : null
  }

  return null
}

/** Normalise a name for matching across datasets with inconsistent formatting. */
const key = name => String(name ?? '').toLowerCase().replace(/[^a-z]/g, '')

/**
 * Build ticker -> fraction-of-portfolio for each politician.
 * Returns { byPolitician: Map, unparsed: [...] } so callers can surface how many
 * rows could not be read instead of treating them as empty portfolios.
 */
export function buildAllocations (rows) {
  const byPolitician = new Map()
  const unparsed = []
  for (const row of rows ?? []) {
    const holdings = parseHoldings(row.Holdings)
    if (!holdings) { unparsed.push(row.Politician ?? '(unnamed)'); continue }
    const total = Object.values(holdings).reduce((a, b) => a + b, 0)
    if (!(total > 0)) { unparsed.push(row.Politician ?? '(unnamed)'); continue }
    const weights = {}
    for (const [ticker, value] of Object.entries(holdings)) weights[ticker] = value / total
    byPolitician.set(key(row.Politician), { name: row.Politician, total, weights })
  }
  if (unparsed.length) log.warn(`Could not read holdings for ${unparsed.length} politician(s); allocation sizing will fall back for them.`)
  return { byPolitician, unparsed }
}

/**
 * Size a BUY by mirroring the actor's portfolio allocation.
 *
 * Returns { notionalUsd, basis } or { notionalUsd: null, reason } when the
 * allocation is unknown, so the caller can fall back explicitly rather than
 * silently sizing to zero.
 */
export function mirrorSize ({ actor, ticker, allocations, capitalUsd, weight = 1, minNotionalUsd = 0, maxNotionalUsd = Infinity }) {
  const entry = allocations?.byPolitician?.get(key(actor))
  if (!entry) return { notionalUsd: null, reason: `no disclosed holdings for ${actor}` }

  const fraction = entry.weights[String(ticker).toUpperCase()]
  if (!fraction) return { notionalUsd: null, reason: `${actor} discloses no position in ${ticker}` }

  const raw = fraction * capitalUsd * weight
  const clamped = Math.min(raw, maxNotionalUsd)
  if (clamped < minNotionalUsd) {
    return {
      notionalUsd: null,
      reason: `mirrored slice is $${raw.toFixed(2)} (${(fraction * 100).toFixed(2)}% of portfolio), below the $${minNotionalUsd} minimum`
    }
  }
  return {
    notionalUsd: Math.round(clamped * 100) / 100,
    basis: {
      allocationPct: Math.round(fraction * 10000) / 100,
      politicianPortfolioUsd: entry.total,
      capitalUsd,
      weight,
      clampedByMax: raw > maxNotionalUsd
    }
  }
}
