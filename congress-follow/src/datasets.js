import { log } from './log.js'

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
    normalise: r => ({
      actor: r.Name ?? r.Insider,
      actorId: r.CIK ?? r.Name,
      party: null,
      chamber: r.Title ?? 'Insider',
      ticker: r.Ticker,
      tickerType: 'ST',
      // Form 4 codes: P = open-market purchase, S = sale.
      transaction: /^p/i.test(String(r.AcquiredDisposedCode ?? r.TransactionCode ?? '')) ? 'Purchase'
        : /^[sd]/i.test(String(r.AcquiredDisposedCode ?? r.TransactionCode ?? '')) ? 'Sale' : r.TransactionCode,
      amount: r.Value ?? r.SharesTraded,
      range: r.Value ? `$${r.Value}` : null,
      transactionDate: r.Date ?? r.TransactionDate,
      reportDate: r.FilingDate ?? r.Date
    })
  }
]

// Company-level datasets: real signals, but not somebody's trade, so they are
// listed separately and are not wired into the follow-a-person flow.
export const CONTEXT_DATASETS = [
  { id: 'govcontractsall', label: 'Government contracts', path: '/beta/live/govcontractsall', plan: 'Hobbyist' },
  { id: 'lobbying', label: 'Corporate lobbying', path: '/beta/live/lobbying', plan: 'Hobbyist' }
]

export const datasetById = id => DATASETS.find(d => d.id === id) ?? CONTEXT_DATASETS.find(d => d.id === id)

/**
 * Fetch every enabled dataset, normalise the rows, and report per-dataset status.
 * A dataset the plan does not cover is reported as unavailable rather than
 * failing the whole poll - "everything available" has to mean exactly that.
 */
export async function fetchEnabled (quiver, enabledMap) {
  const rows = []
  const status = []
  for (const ds of DATASETS) {
    if (!enabledMap?.[ds.id]) continue
    try {
      const raw = await quiver.fetchDataset(ds.path)
      const mapped = raw.map(r => ({ ...ds.normalise(r), dataset: ds.id, _raw: r }))
      rows.push(...mapped)
      status.push({ id: ds.id, label: ds.label, ok: true, count: mapped.length })
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
