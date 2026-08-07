import { createHash } from 'node:crypto'

const BUY_WORDS = ['purchase']
const SELL_WORDS = ['sale', 'sold', 'sale (partial)', 'sale (full)']

/**
 * Stable identity for a disclosed trade. Quiver has no per-row id, so we hash the
 * fields that together identify one filing line. Used to guarantee we never queue
 * the same disclosure twice, even across restarts.
 */
/**
 * Field accessors that tolerate either shape: the normalised rows produced by
 * src/datasets.js, or raw Quiver congress rows. Keeping both readable avoids a
 * flag day across the evaluator and its tests.
 */
export const f = {
  actor: t => t.actor ?? t.Representative ?? t.Senator ?? t.Name,
  actorId: t => t.actorId ?? t.BioGuideID,
  ticker: t => t.ticker ?? t.Ticker,
  tickerType: t => t.tickerType ?? t.TickerType,
  transaction: t => t.transaction ?? t.Transaction,
  amount: t => t.amount ?? t.Amount,
  range: t => t.range ?? t.Range,
  transactionDate: t => t.transactionDate ?? t.TransactionDate,
  reportDate: t => t.reportDate ?? t.ReportDate,
  party: t => t.party ?? t.Party,
  chamber: t => t.chamber ?? t.House,
  dataset: t => t.dataset ?? 'congresstrading'
}

export function tradeKey (t) {
  const parts = [
    f.dataset(t), f.actorId(t) || f.actor(t), f.ticker(t),
    f.transaction(t), f.transactionDate(t), f.reportDate(t), f.amount(t)
  ]
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)
}

export function parseDate (value) {
  if (!value) return null
  const d = new Date(String(value).slice(0, 10) + 'T00:00:00Z')
  return Number.isNaN(d.getTime()) ? null : d
}

export function daysBetween (from, to) {
  if (!from || !to) return null
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000)
}

/** Map Quiver's Transaction text onto an order side. */
export function classifySide (transaction) {
  const text = String(transaction || '').trim().toLowerCase()
  if (BUY_WORDS.some(w => text.includes(w))) return 'BUY'
  if (SELL_WORDS.some(w => text.includes(w))) return 'SELL'
  return null // "Exchange" and anything unrecognised are deliberately skipped
}

/** Match a disclosure against the watchlist, by BioGuide ID first then name. */
export function matchFollow (trade, follow) {
  const id = String(f.actorId(trade) || '').trim().toUpperCase()
  const name = String(f.actor(trade) || '').trim().toLowerCase()
  return follow.find(f => {
    if (f.bioGuideId && id && String(f.bioGuideId).trim().toUpperCase() === id) return true
    if (f.bioGuideId && id) return false // ID present on both sides and mismatched
    return f.name && name && f.name.trim().toLowerCase() === name
  }) || null
}

function reportedAmount (trade) {
  const n = Number(String(f.amount(trade) ?? '').replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Resolve the dollar notional for a BUY from the sizing config. */
export function sizeNotional (trade, sizing, followEntry) {
  const weight = Number(followEntry?.weight ?? 1)
  let base
  if (sizing.mode === 'tiered' && Array.isArray(sizing.tiers) && sizing.tiers.length > 0) {
    const amount = reportedAmount(trade)
    const tier = [...sizing.tiers]
      .sort((a, b) => a.minReportedAmount - b.minReportedAmount)
      .filter(t => amount >= t.minReportedAmount)
      .pop()
    base = tier ? tier.notionalUsd : sizing.tiers[0].notionalUsd
  } else {
    base = sizing.notionalUsd
  }
  return Math.round(base * weight * 100) / 100
}

/**
 * Turn one Quiver row into either a signal or a skip with a reason.
 * Pure function - no network, no state - so it is straightforward to test.
 */
export function evaluateTrade (trade, watchlist, { now = new Date() } = {}) {
  const { rules, sizing } = watchlist
  const key = tradeKey(trade)
  // `permanent` decides whether the disclosure is remembered forever. A skip
  // caused by config (watchlist, allow/blocklist, sides) or by time (a lag that
  // has not yet reached the minimum) must be re-evaluated on a later poll,
  // otherwise editing the watchlist is retroactively blind and
  // minDisclosureLagDays discards the very trades it is waiting for.
  const skip = (reason, permanent = true) => ({ key, trade, action: 'SKIP', reason, permanent })

  if (rules.datasets && rules.datasets[f.dataset(trade)] === false) {
    return skip(`dataset ${f.dataset(trade)} disabled`, false)
  }

  const follow = matchFollow(trade, watchlist.follow)
  if (!follow) return skip('not on watchlist', false)

  const side = classifySide(f.transaction(trade))
  if (!side) return skip(`unhandled transaction type "${f.transaction(trade)}"`)
  if (!rules.sides.includes(side)) return skip(`${side} disabled in rules.sides`, false)

  const ticker = String(f.ticker(trade) || '').trim().toUpperCase()
  if (!ticker) return skip('no ticker on disclosure')
  if (rules.tickerBlocklist.map(s => s.toUpperCase()).includes(ticker)) return skip('ticker blocklisted', false)
  if (rules.tickerAllowlist.length > 0 && !rules.tickerAllowlist.map(s => s.toUpperCase()).includes(ticker)) {
    return skip('ticker not on allowlist', false)
  }

  // TickerType filters out options, bonds and other non-equity filings that the
  // EQUITY order path cannot represent.
  const tickerType = String(f.tickerType(trade) || '').trim().toUpperCase()
  if (rules.allowedTickerTypes.length > 0 && tickerType && !rules.allowedTickerTypes.includes(tickerType)) {
    return skip(`ticker type ${tickerType} not tradeable as equity`)
  }

  // The STOCK Act allows up to 45 days before disclosure, so every row is already
  // stale. maxDisclosureLagDays stops us acting on genuinely ancient filings.
  const transactionDate = parseDate(f.transactionDate(trade))
  const lagDays = daysBetween(transactionDate, now)
  if (lagDays == null) return skip('unparseable TransactionDate')
  if (lagDays < rules.minDisclosureLagDays) return skip(`disclosure lag ${lagDays}d below minimum`, false)
  if (lagDays > rules.maxDisclosureLagDays) return skip(`disclosure lag ${lagDays}d exceeds maximum ${rules.maxDisclosureLagDays}d`)

  return {
    key,
    trade,
    action: side,
    ticker,
    follow,
    lagDays,
    reportedAmount: reportedAmount(trade),
    notionalUsd: side === 'BUY' ? sizeNotional(trade, sizing, follow) : null,
    sellMode: side === 'SELL' ? sizing.sellMode : null,
    dataset: f.dataset(trade),
    bucket: follow.bucket ?? null,
    accountId: follow.accountId ?? null
  }
}

/** Evaluate a batch, returning signals and skips separately. */
export function evaluateAll (trades, watchlist, opts) {
  const signals = []
  const skipped = []
  for (const trade of trades) {
    const result = evaluateTrade(trade, watchlist, opts)
    if (result.action === 'SKIP') skipped.push(result)
    else signals.push(result)
  }
  return { signals, skipped }
}
