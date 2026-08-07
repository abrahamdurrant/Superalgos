import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Engine } from '../src/engine.js'
import { Store } from '../src/store.js'
import { Settings } from '../src/settings.js'
import { PublicClient } from '../src/public-client.js'
import { mirrorSize, buildAllocations, parseHoldings } from '../src/holdings.js'
import { fetchEnabled, DATASETS } from '../src/datasets.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'cf-'))
const trade = (o = {}) => ({
  Representative: 'Nancy Pelosi', BioGuideID: 'P000197', ReportDate: '2026-08-01',
  TransactionDate: '2026-07-20', Ticker: 'NVDA', Transaction: 'Purchase',
  Range: '$1,001 - $15,000', Amount: '1001', House: 'Representatives',
  Party: 'Democratic', TickerType: 'ST', ...o
})
const WATCHLIST = {
  follow: [{ bioGuideId: 'P000197', name: 'Nancy Pelosi', weight: 1, enabled: true }],
  rules: { sides: ['BUY', 'SELL'], tickerAllowlist: [], tickerBlocklist: [], minDisclosureLagDays: 0, maxDisclosureLagDays: 60, allowedTickerTypes: ['CS', 'ST'] },
  sizing: { mode: 'fixed', notionalUsd: 250, tiers: [], sellMode: 'full' },
  guardrails: { maxNotionalPerTrade: 5000, maxOrdersPerDay: 10, maxOpenPositions: 25, requireHeldPositionToSell: true }
}
class FakeBroker extends PublicClient {
  constructor () { super({ secretKey: 'x', accountId: 'default-acct' }); this.placed = [] }
  async getPositions () { return {} }
  async placeOrder (b, opts = {}) { this.placed.push({ body: b, accountId: opts.accountId ?? 'default-acct' }); return { orderId: b.orderId } }
}
function boot ({ rows = [trade()], settings: patch = {}, holdings = [] } = {}) {
  const dir = tmp()
  const settings = new Settings(join(dir, 'settings.json'))
  settings.update(patch)
  return new Engine({
    store: new Store(join(dir, 'data', 'store.json')),
    quiver: {
      async fetchDataset (p) { return p.includes('congresstrading') ? rows : [] },
      async congressHoldings () { return holdings }
    },
    broker: new FakeBroker(),
    watchlist: structuredClone(WATCHLIST),
    settings
  })
}

// ---- mirror sizing ----
test('mirror sizing uses the actor\'s portfolio allocation against your capital', () => {
  const alloc = buildAllocations([{ Politician: 'Nancy Pelosi', Holdings: [{ Ticker: 'NVDA', Value: 250000 }, { Ticker: 'AAPL', Value: 750000 }] }])
  const r = mirrorSize({ actor: 'Nancy Pelosi', ticker: 'NVDA', allocations: alloc, capitalUsd: 20000, minNotionalUsd: 25, maxNotionalUsd: 100000 })
  assert.equal(r.basis.allocationPct, 25, 'NVDA is 25% of a $1M portfolio')
  assert.equal(r.notionalUsd, 5000, '25% of $20,000')
})

test('mirror sizing is clamped by the configured maximum', () => {
  const alloc = buildAllocations([{ Politician: 'X', Holdings: { NVDA: 100 } }])
  const r = mirrorSize({ actor: 'X', ticker: 'NVDA', allocations: alloc, capitalUsd: 50000, maxNotionalUsd: 1000 })
  assert.equal(r.notionalUsd, 1000)
  assert.equal(r.basis.clampedByMax, true)
})

test('a slice below the minimum is refused with a reason, never sized to zero', () => {
  const alloc = buildAllocations([{ Politician: 'X', Holdings: { NVDA: 1, OTHER: 9999 } }])
  const r = mirrorSize({ actor: 'X', ticker: 'NVDA', allocations: alloc, capitalUsd: 1000, minNotionalUsd: 25 })
  assert.equal(r.notionalUsd, null)
  assert.match(r.reason, /below the \$25 minimum/)
})

test('unparseable holdings do not become an empty portfolio', () => {
  assert.equal(parseHoldings('garbage'), null)
  const { byPolitician, unparsed } = buildAllocations([{ Politician: 'X', Holdings: 'garbage' }])
  assert.equal(byPolitician.size, 0)
  assert.deepEqual(unparsed, ['X'])
})

test('poll falls back to the flat size when an allocation is unknown, and says so', async () => {
  const e = boot({ settings: { sizing: { mode: 'mirror', capitalUsd: 10000 } }, holdings: [] })
  const { queued } = await e.poll()
  assert.equal(queued[0].sizeSource, 'fixed-fallback')
  assert.match(queued[0].sizeNote, /mirror unavailable/)
  assert.equal(queued[0].notionalUsd, 250, 'falls back rather than queueing $0')
})

test('poll sizes from the real allocation when holdings are available', async () => {
  const e = boot({
    settings: { sizing: { mode: 'mirror', capitalUsd: 10000, minNotionalUsd: 1, maxNotionalUsd: 100000 } },
    holdings: [{ Politician: 'Nancy Pelosi', Holdings: [{ Ticker: 'NVDA', Value: 400 }, { Ticker: 'AAPL', Value: 600 }] }]
  })
  const { queued } = await e.poll()
  assert.equal(queued[0].sizeSource, 'mirror')
  assert.equal(queued[0].notionalUsd, 4000, '40% of $10,000')
})

// ---- datasets ----
test('a dataset the plan excludes is reported, not treated as a failure', async () => {
  const quiver = { async fetchDataset (p) { if (p.includes('insiders')) throw new Error('Quiver /beta/live/insiders failed: HTTP 403'); return [trade()] } }
  const { rows, status } = await fetchEnabled(quiver, { congresstrading: true, insiders: true })
  assert.equal(rows.length, 1, 'the working dataset still yields rows')
  const insiders = status.find(s => s.id === 'insiders')
  assert.equal(insiders.ok, false)
  assert.equal(insiders.denied, true)
  assert.match(insiders.error, /needs Trader/)
})

test('every dataset normalises to the same shape', () => {
  for (const ds of DATASETS) {
    const out = ds.normalise({ Representative: 'A', Senator: 'A', Name: 'A', Ticker: 'X', Transaction: 'Purchase', TransactionCode: 'P' })
    for (const k of ['actor', 'ticker', 'transaction', 'transactionDate', 'reportDate']) {
      assert.ok(k in out, `${ds.id} must define ${k}`)
    }
  }
})

test('disabling a dataset stops it generating signals', async () => {
  const e = boot({ settings: { datasets: { congresstrading: false } } })
  const { queued } = await e.poll()
  assert.equal(queued.length, 0)
})

// ---- assignment: account routing, buckets, size override ----
test('a bucket routes its orders to the mapped account', async () => {
  const e = boot({ settings: { routing: { defaultAccountId: 'ira-1', byBucket: { tech: 'taxable-9' } } } })
  e.watchlist.follow[0].bucket = 'tech'
  const { queued } = await e.poll()
  assert.equal(queued[0].bucket, 'tech')
  assert.equal(queued[0].accountId, 'taxable-9', 'bucket route beats the default')
})

test('with no bucket the default account applies', async () => {
  const e = boot({ settings: { routing: { defaultAccountId: 'ira-1' } } })
  const { queued } = await e.poll()
  assert.equal(queued[0].accountId, 'ira-1')
})

test('the routed account is what the order is actually sent to', async () => {
  process.env.DRY_RUN = 'false'
  const e = boot({ settings: { routing: { defaultAccountId: 'ira-1' } } })
  const { queued } = await e.poll()
  await e.approve(queued[0].id)
  assert.equal(e.broker.placed[0].accountId, 'ira-1')
  delete process.env.DRY_RUN
})

test('a per-order size override wins over the computed size', async () => {
  process.env.DRY_RUN = 'false'
  const e = boot()
  const { queued } = await e.poll()
  e.amend(queued[0].id, { sizeOverrideUsd: 75 })
  await e.approve(queued[0].id)
  assert.equal(e.broker.placed[0].body.amount, '75')
  delete process.env.DRY_RUN
})

test('an override is still subject to the guardrails', async () => {
  process.env.DRY_RUN = 'false'
  const e = boot()
  const { queued } = await e.poll()
  e.amend(queued[0].id, { sizeOverrideUsd: 999999 })
  await assert.rejects(() => e.approve(queued[0].id), /exceeds maxNotionalPerTrade/)
  assert.equal(e.broker.placed.length, 0)
  delete process.env.DRY_RUN
})

test('an amended order must still be pending', async () => {
  const e = boot()
  const { queued } = await e.poll()
  e.reject(queued[0].id)
  assert.throws(() => e.amend(queued[0].id, { sizeOverrideUsd: 50 }), /not PENDING/)
})

// ---- automation ----
test('automation is off unless enabled', async () => {
  const e = boot()
  const r = await e.runAutomation()
  assert.equal(r.ran, false)
})

test('live automation refuses to run until the submit path has been proven once', async () => {
  process.env.DRY_RUN = 'false'
  const e = boot({ settings: { automation: { enabled: true, requireProvenSubmitPath: true } } })
  const r = await e.runAutomation()
  assert.equal(r.ran, false)
  assert.match(r.reason, /submit path is unproven/)
  assert.equal(e.broker.placed.length, 0)
  delete process.env.DRY_RUN
})

test('automation runs once the gate is cleared, and submits within the guardrails', async () => {
  process.env.DRY_RUN = 'false'
  const e = boot({ settings: { automation: { enabled: true, requireProvenSubmitPath: false } } })
  const r = await e.runAutomation()
  assert.equal(r.ran, true)
  assert.equal(r.results.filter(x => x.ok).length, 1)
  assert.equal(e.broker.placed.length, 1)
  delete process.env.DRY_RUN
})

test('automation reports blocked orders instead of aborting the run', async () => {
  process.env.DRY_RUN = 'false'
  const e = boot({ rows: [trade(), trade({ Ticker: 'AAPL' })], settings: { automation: { enabled: true, requireProvenSubmitPath: false } } })
  e.watchlist.guardrails.maxNotionalPerTrade = 1
  const r = await e.runAutomation()
  assert.equal(r.results.length, 2)
  assert.equal(r.results.every(x => !x.ok), true)
  assert.equal(e.broker.placed.length, 0)
  delete process.env.DRY_RUN
})

// ---- settings ----
test('settings persist and DRY_RUN in the environment overrides the stored value', () => {
  const path = join(tmp(), 'settings.json')
  const s = new Settings(path)
  s.update({ dryRun: false, sizing: { capitalUsd: 50000 } })
  assert.equal(new Settings(path).data.sizing.capitalUsd, 50000)

  process.env.DRY_RUN = 'true'
  const forced = new Settings(path)
  assert.equal(forced.dryRun, true, 'the environment wins')
  assert.throws(() => forced.update({ dryRun: false }), /overrides this setting/)
  delete process.env.DRY_RUN
})

// ---- manual orders from any dataset row ----
test('a manual order can be queued for any ticker, amount and account', async () => {
  const e = boot()
  const o = e.queueManualOrder({ ticker: 'msft', notionalUsd: 500, accountId: 'taxable-9', source: 'trumpstocktrades' })
  assert.equal(o.ticker, 'MSFT')
  assert.equal(o.notionalUsd, 500)
  assert.equal(o.accountId, 'taxable-9')
  assert.equal(o.status, 'PENDING')
  assert.equal(o.manual, true)
})

test('a manual order still passes through the guardrails at approval', async () => {
  process.env.DRY_RUN = 'false'
  const e = boot()
  e.watchlist.guardrails.maxNotionalPerTrade = 100
  const o = e.queueManualOrder({ ticker: 'MSFT', notionalUsd: 500 })
  await assert.rejects(() => e.approve(o.id), /exceeds maxNotionalPerTrade/)
  assert.equal(e.broker.placed.length, 0)
  delete process.env.DRY_RUN
})

test('a manual order is actually submitted to its chosen account', async () => {
  process.env.DRY_RUN = 'false'
  const e = boot()
  const o = e.queueManualOrder({ ticker: 'MSFT', notionalUsd: 500, accountId: 'taxable-9' })
  await e.approve(o.id)
  assert.equal(e.broker.placed[0].accountId, 'taxable-9')
  assert.equal(e.broker.placed[0].body.amount, '500')
  delete process.env.DRY_RUN
})

test('implausible tickers and sizes are refused', async () => {
  const e = boot()
  assert.throws(() => e.queueManualOrder({ ticker: 'not a ticker', notionalUsd: 100 }), /not a plausible ticker/)
  assert.throws(() => e.queueManualOrder({ ticker: 'MSFT', notionalUsd: 0 }), /positive dollar amount/)
  assert.throws(() => e.queueManualOrder({ ticker: 'MSFT', notionalUsd: -5 }), /positive dollar amount/)
})

// ---- per-source allocation ----
test('a per-actor allocation overrides the global capital base', async () => {
  const e = boot({
    settings: {
      sizing: { mode: 'mirror', capitalUsd: 10000, minNotionalUsd: 1, maxNotionalUsd: 999999 },
      allocations: { 'actor:nancy pelosi': { capitalUsd: 50000, accountId: 'ira-x' } }
    },
    holdings: [{ Politician: 'Nancy Pelosi', Holdings: [{ Ticker: 'NVDA', Value: 200 }, { Ticker: 'AAPL', Value: 800 }] }]
  })
  const { queued } = await e.poll()
  assert.equal(queued[0].notionalUsd, 10000, '20% of the $50,000 allocated to her, not the $10,000 default')
  assert.equal(queued[0].accountId, 'ira-x')
})

test('a dataset allocation applies when no actor allocation exists', () => {
  const e = boot({ settings: { allocations: { 'dataset:congresstrading': { capitalUsd: 7777, accountId: 'acct-d' } } } })
  const a = e.settings.allocationFor({ actor: 'Nobody', dataset: 'congresstrading' })
  assert.equal(a.capitalUsd, 7777)
  assert.equal(a.source, 'dataset')
})

// ---- performance honesty ----
test('performance reports no-return sources as unmeasurable, never as 0%', async () => {
  const { analyse } = await import('../src/performance.js')
  const rows = [
    { actor: 'HasData', ticker: 'A', transaction: 'Purchase', transactionDate: '2026-08-01', dataset: 'congresstrading', _raw: { PriceChange: 12, ExcessReturn: 8 } },
    { actor: 'NoData', ticker: 'B', transaction: 'Purchase', transactionDate: '2026-08-01', dataset: 'senatetrading', _raw: {} }
  ]
  const r = analyse(rows, { now: new Date('2026-08-07T00:00:00Z') })
  const has = r.sources.find(s => s.key === 'HasData')
  const none = r.sources.find(s => s.key === 'NoData')
  assert.equal(has.measurable, true)
  assert.equal(has.windows.all.avgReturnPct, 12)
  assert.equal(none.measurable, false)
  assert.equal(none.windows.all.avgReturnPct, null, 'must be null, not 0')
  assert.equal(none.windows.all.coverage, 0)
})

test('performance windows narrow correctly by trade age', async () => {
  const { analyse } = await import('../src/performance.js')
  const now = new Date('2026-08-07T00:00:00Z')
  const mk = (d, pc) => ({ actor: 'X', ticker: 'T', transaction: 'Purchase', transactionDate: d, dataset: 'congresstrading', _raw: { PriceChange: pc } })
  const r = analyse([mk('2026-08-07', 1), mk('2026-07-20', 10), mk('2025-06-01', 100)], { now })
  const w = r.sources[0].windows
  assert.equal(w.day.trades, 1)
  assert.equal(w.month.trades, 2)
  assert.equal(w.year.trades, 2)
  assert.equal(w.all.trades, 3)
})

test('the Trump dataset normalises to the shared shape', async () => {
  const { datasetById } = await import('../src/datasets.js')
  const ds = datasetById('trumpstocktrades')
  const n = ds.normalise({ Ticker: 'DJT', Company: 'Trump Media', Transaction: 'Purchase', Amount: '$1,000,001 - $5,000,000', Filed: '2026-08-01', Traded: '2026-07-15', ExcessReturn: 4.2 })
  assert.equal(n.ticker, 'DJT')
  assert.equal(n.actor, 'Donald Trump')
  assert.equal(n.transaction, 'Purchase')
  assert.equal(n.transactionDate, '2026-07-15')
  assert.equal(n.reportDate, '2026-08-01')
})

test('insider grants and option exercises are not mistaken for purchases', async () => {
  const { datasetById, form4Side } = await import('../src/datasets.js')
  const ds = datasetById('insiders')
  assert.equal(form4Side({ TransactionCode: 'P' }), 'Purchase')
  assert.equal(form4Side({ TransactionCode: 'S' }), 'Sale')
  for (const code of ['A', 'M', 'F', 'G', 'X']) {
    assert.match(form4Side({ TransactionCode: code }), /^Form4:/, `${code} must not look like a trade`)
  }
  const n = ds.normalise({ Ticker: 'NVDA', Name: 'Jensen Huang', TransactionCode: 'S', Shares: 1000, PricePerShare: 100, Date: '2026-08-01', fileDate: '2026-08-03', officerTitle: 'CEO', isOfficer: true })
  assert.equal(n.amount, 100000, 'value is shares x price, which the API does not provide directly')
  assert.equal(n.chamber, 'CEO')
})
