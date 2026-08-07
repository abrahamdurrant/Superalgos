import { log } from './log.js'

/**
 * SEC Form 4 transaction codes. Only P and S are open-market decisions - the
 * rest are compensation mechanics and following them would be noise:
 *   A grant/award   M option exercise   F tax withholding
 *   G gift          X option exercise   D disposition to issuer
 * See https://www.sec.gov/files/forms-3-4-5.pdf
 */
export const MEANINGFUL_FORM4_CODES = new Set(['P', 'S'])

/**
 * Official SEC Form 4 transaction codes.
 * Only P and S are discretionary open-market decisions. Everything else is
 * compensation mechanics, a derivative event, or an administrative transfer,
 * and treating any of them as a conviction trade would be wrong.
 */
export const FORM4_CODES = {
  // General
  P: 'Open-market purchase',
  S: 'Open-market sale',
  V: 'Reported early (voluntary)',
  // Rule 16b-3 exempt
  A: 'Grant or award',
  D: 'Disposition to the issuer',
  F: 'Shares withheld for tax or exercise price',
  I: 'Discretionary plan transaction',
  M: 'Option exercise or conversion (16b-3 exempt)',
  // Derivative securities
  C: 'Conversion of a derivative security',
  E: 'Expiration of a short derivative position',
  H: 'Expiration of a long derivative position, value received',
  O: 'Exercise of an out-of-the-money derivative',
  X: 'Exercise of an in- or at-the-money derivative',
  // Exempt and small acquisitions
  G: 'Bona fide gift',
  L: 'Small acquisition (Rule 16a-6)',
  W: 'Acquired or disposed by will or inheritance',
  Z: 'Voting trust deposit or withdrawal',
  // Other
  J: 'Other acquisition or disposition',
  K: 'Equity swap or similar instrument',
  U: 'Disposition through a tender offer'
}

export function form4Label (code) {
  const c = String(code ?? '').trim().toUpperCase()
  return FORM4_CODES[c] ? `${FORM4_CODES[c]} (${c})` : `Unrecognised Form 4 code (${c || '?'})`
}

export function form4Side (r) {
  const code = String(r.TransactionCode ?? '').trim().toUpperCase()
  if (code === 'P') return 'Purchase'
  if (code === 'S') return 'Sale'
  // Not a discretionary trade. Return the plain-English meaning so the row is
  // self-explanatory and the evaluator skips it with a readable reason.
  return form4Label(code)
}

export function insiderRole (r) {
  if (r.isOfficer && r.officerTitle) return r.officerTitle
  if (r.isOfficer) return 'Officer'
  if (r.isDirector) return 'Director'
  if (r.isTenPercentOwner) return '10% owner'
  return 'Insider'
}

/**
 * Every Quiver dataset that can generate a trade signal, normalised to one shape.
 *
 * Each source reports different field names for the same ideas, so `normalise`
 * maps them onto: who acted, what they traded, which way, how much, and when.
 * `plan` records which subscription tier the dataset needs - a 403 on one
 * dataset must not look like a broken key.
 */
export const DATASETS = [
  {
    id: 'congresstrading',
    label: 'Congress trading',
    path: '/beta/live/congresstrading',
    plan: 'Hobbyist',
    actorKind: 'politician',
    normalise: r => ({
      actor: r.Representative,
      actorId: r.BioGuideID,
      party: r.Party,
      chamber: r.House,
      ticker: r.Ticker,
      tickerType: r.TickerType,
      transaction: r.Transaction,
      amount: r.Amount,
      range: r.Range,
      transactionDate: r.TransactionDate,
      reportDate: r.ReportDate
    })
  },
  {
    id: 'senatetrading',
    label: 'Senate trading',
    path: '/beta/live/senatetrading',
    plan: 'Hobbyist',
    actorKind: 'politician',
    normalise: r => ({
      actor: r.Senator ?? r.Representative,
      actorId: r.BioGuideID,
      party: r.Party,
      chamber: 'Senate',
      ticker: r.Ticker,
      tickerType: r.TickerType,
      transaction: r.Transaction,
      amount: r.Amount,
      range: r.Range,
      transactionDate: r.TransactionDate ?? r.Date,
      reportDate: r.ReportDate ?? r.Disclosure_Date
    })
  },
  {
    id: 'housetrading',
    label: 'House trading',
    path: '/beta/live/housetrading',
    plan: 'Hobbyist',
    actorKind: 'politician',
    normalise: r => ({
      actor: r.Representative,
      actorId: r.BioGuideID,
      party: r.Party,
      chamber: 'Representatives',
      ticker: r.Ticker,
      tickerType: r.TickerType,
      transaction: r.Transaction,
      amount: r.Amount,
      range: r.Range,
      transactionDate: r.TransactionDate ?? r.Date,
      reportDate: r.ReportDate ?? r.Disclosure_Date
    })
  },
  {
    id: 'insiders',
    label: 'Corporate insiders (Form 4)',
    path: '/beta/live/insiders',
    plan: 'Trader',           // NOT included in Hobbyist
    actorKind: 'insider',
    // Verified against Quiver's OpenAPI schema for /beta/live/insiders.
    normalise: r => {
      const shares = Number(r.Shares) || 0
      const price = Number(r.PricePerShare) || 0
      return {
        actor: r.Name,
        // Form 4 has no stable person id, so identity is the name.
        actorId: null,
        party: null,
        chamber: insiderRole(r),
        ticker: r.Ticker,
        tickerType: 'ST',
        transaction: form4Side(r),
        // Quiver reports shares and price, not a dollar value; compute it.
        amount: shares && price ? Math.round(shares * price) : null,
        range: shares && price ? `$${Math.round(shares * price).toLocaleString()}` : (shares ? `${shares} shares` : null),
        transactionDate: r.Date,
        reportDate: r.fileDate ?? r.Date,
        // Extra context worth keeping for display and filtering.
        insider: {
          transactionCode: r.TransactionCode,
          acquiredDisposed: r.AcquiredDisposedCode,
          shares,
          pricePerShare: price,
          sharesOwnedFollowing: Number(r.SharesOwnedFollowing) || null,
          officerTitle: r.officerTitle || null,
          isDirector: Boolean(r.isDirector),
          isOfficer: Boolean(r.isOfficer),
          isTenPercentOwner: Boolean(r.isTenPercentOwner),
          ownership: r.directOrIndirectOwnership
        }
      }
    }
  }
]

/**
 * Institutional 13F filings. sec13f has a published schema; sec13fchanges
 * documents only its parameters, so its normaliser reads through several
 * plausible key spellings and leaves fields null rather than inventing them.
 * Use `peek` to see the real shape before relying on it.
 */
export const INSTITUTIONAL_DATASETS = [
  {
    id: 'sec13f',
    label: 'Hedge fund holdings (13F)',
    path: '/beta/live/sec13f',
    plan: 'Trader',
    actorKind: 'fund',
    // Verified against the published schema.
    normalise: r => ({
      actor: r.Fund ?? r.Name,
      actorId: null,
      ticker: r.Ticker,
      tickerType: 'ST',
      // A holdings snapshot is a position, not a transaction.
      transaction: 'Holding',
      amount: Number(r.Value) || null,
      shares: Number(r.Shares) || null,
      range: r.Value ? `$${Number(r.Value).toLocaleString()}` : null,
      transactionDate: r.ReportPeriod,
      reportDate: r.Date,
      chamber: r['Put/Call'] ? `${r['Put/Call']} option` : (r.Class || 'Holding')
    })
  },
  {
    id: 'sec13fchanges',
    label: 'Hedge fund position changes (13F)',
    path: '/beta/live/sec13fchanges',
    plan: 'Trader',
    actorKind: 'fund',
    // No published response schema - read tolerantly, invent nothing.
    normalise: r => {
      const change = Number(r.Change ?? r.ChangeInShares ?? r.SharesChange ?? r.Delta)
      const pct = Number(r.PctChange ?? r.PercentChange ?? r['Change%'])
      const side = Number.isFinite(change)
        ? (change > 0 ? 'Purchase' : change < 0 ? 'Sale' : 'Unchanged')
        : (Number.isFinite(pct) ? (pct > 0 ? 'Purchase' : pct < 0 ? 'Sale' : 'Unchanged') : 'Unknown')
      return {
        actor: r.Fund ?? r.Name ?? r.Owner,
        actorId: null,
        ticker: r.Ticker,
        tickerType: 'ST',
        transaction: side,
        amount: Number(r.Value ?? r.ValueChange) || null,
        shares: Number.isFinite(change) ? change : null,
        range: Number.isFinite(pct) ? `${pct > 0 ? '+' : ''}${pct}%` : (Number.isFinite(change) ? `${change > 0 ? '+' : ''}${change} shares` : null),
        transactionDate: r.ReportPeriod ?? r.Period ?? r.Date,
        reportDate: r.Date ?? r.FilingDate,
        chamber: 'Fund'
      }
    }
  }
]

/** Included in Hobbyist. Bulk-only - there is no live variant. */
export const SPECIAL_DATASETS = [
  {
    id: 'trumpstocktrades',
    label: 'Donald Trump stock trades',
    path: '/beta/bulk/trumpstocktrades',
    plan: 'Hobbyist',
    actorKind: 'politician',
    // Verified against the published schema.
    normalise: r => ({
      actor: 'Donald Trump',
      actorId: 'TRUMP',
      party: 'Republican',
      chamber: 'Executive',
      ticker: r.Ticker,
      tickerType: 'ST',
      transaction: r.Transaction,
      amount: r.Amount,
      range: r.Amount,
      company: r.Company,
      transactionDate: r.Traded,
      reportDate: r.Filed
    })
  }
]

// Company-level datasets: real signals, but not somebody's trade, so they are
// listed separately and are not wired into the follow-a-person flow.
export const CONTEXT_DATASETS = [
  {
    id: 'govcontractsall',
    label: 'Government contracts',
    path: '/beta/live/govcontractsall',
    plan: 'Hobbyist',
    // Company-level: there is no person or fund to follow, so these cannot
    // generate a follow-based signal. Browsable, not pollable.
    signalSource: false,
    normalise: r => ({ actor: r.Company ?? r.Agency ?? null, ticker: r.Ticker, transaction: 'Contract',
      amount: Number(r.Amount) || null, range: r.Amount ? `$${Number(r.Amount).toLocaleString()}` : null,
      transactionDate: r.Date, reportDate: r.Date, chamber: r.Agency ?? 'Government' })
  },
  {
    id: 'lobbying',
    label: 'Corporate lobbying',
    path: '/beta/live/lobbying',
    plan: 'Hobbyist',
    signalSource: false,
    normalise: r => ({ actor: r.Client ?? r.Company ?? null, ticker: r.Ticker, transaction: 'Lobbying',
      amount: Number(r.Amount) || null, range: r.Amount ? `$${Number(r.Amount).toLocaleString()}` : null,
      transactionDate: r.Date, reportDate: r.Date, chamber: r.Issue ?? 'Lobbying' })
  }
]

/** Datasets that can actually produce a follow-based trade signal. */
export const SIGNAL_DATASETS = () =>
  [...DATASETS, ...SPECIAL_DATASETS, ...INSTITUTIONAL_DATASETS].filter(d => d.signalSource !== false)

export const ALL_DATASETS = () => [...DATASETS, ...SPECIAL_DATASETS, ...INSTITUTIONAL_DATASETS, ...CONTEXT_DATASETS]
export const datasetById = id => ALL_DATASETS().find(d => d.id === id)

/**
 * Fetch every enabled dataset, normalise the rows, and report per-dataset status.
 * A dataset the plan does not cover is reported as unavailable rather than
 * failing the whole poll - "everything available" has to mean exactly that.
 */
export async function fetchEnabled (quiver, enabledMap, { maxRowsPerDataset = Infinity } = {}) {
  const rows = []
  const status = []
  for (const ds of SIGNAL_DATASETS()) {
    if (!enabledMap?.[ds.id]) continue
    try {
      const raw = await quiver.fetchDataset(ds.path)
      let mapped = raw.map(r => ({ ...ds.normalise(r), dataset: ds.id, _raw: r }))
      const total = mapped.length

      // Some feeds return tens of thousands of rows. Keep the newest, because
      // only new disclosures can produce a new signal - and say how many were
      // dropped rather than truncating silently.
      let truncated = 0
      if (mapped.length > maxRowsPerDataset) {
        const { byNewest } = await import('./performance.js')
        mapped = [...mapped].sort(byNewest).slice(0, maxRowsPerDataset)
        truncated = total - mapped.length
        log.warn(`dataset ${ds.id}: kept the ${mapped.length} newest of ${total} rows (${truncated} older not evaluated). Raise sizing.maxRowsPerDataset to widen this.`)
      }

      rows.push(...mapped)
      status.push({ id: ds.id, label: ds.label, ok: true, count: mapped.length, total, truncated })
      log.debug(`dataset ${ds.id}: ${mapped.length} rows`)
    } catch (err) {
      const denied = /HTTP 40[13]/.test(err.message)
      status.push({
        id: ds.id,
        label: ds.label,
        ok: false,
        denied,
        plan: ds.plan,
        error: denied
          ? `Not included in your plan (needs ${ds.plan}).`
          : err.message.split('\n')[0]
      })
      log.warn(`dataset ${ds.id} unavailable: ${denied ? 'plan' : err.message.split('\n')[0]}`)
    }
  }
  return { rows, status }
}
