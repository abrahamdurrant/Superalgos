import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Engine } from '../src/engine.js'
import { Store } from '../src/store.js'
import { PublicClient } from '../src/public-client.js'
import { evaluateTrade } from '../src/signals.js'

const WATCHLIST = {
  follow: [{ bioGuideId: 'P000197', name: 'Nancy Pelosi', weight: 1, enabled: true }],
  rules: { sides: ['BUY', 'SELL'], tickerAllowlist: [], tickerBlocklist: [], minDisclosureLagDays: 0, maxDisclosureLagDays: 60, allowedTickerTypes: ['CS', 'ST'] },
  sizing: { mode: 'fixed', notionalUsd: 250, tiers: [], sellMode: 'full' },
  guardrails: { maxNotionalPerTrade: 1000, maxOrdersPerDay: 10, maxOpenPositions: 25, requireHeldPositionToSell: true }
}
const NOW = new Date('2026-08-07T00:00:00Z')
const trade = (o = {}) => ({
  Representative: 'Nancy Pelosi', BioGuideID: 'P000197', ReportDate: '2026-08-01',
  TransactionDate: '2026-07-20', Ticker: 'NVDA', Transaction: 'Purchase',
  Range: '$1,001 - $15,000', Amount: '1001', House: 'Representatives',
  Party: 'Democratic', TickerType: 'ST', ...o
})
const storePath = () => join(mkdtempSync(join(tmpdir(), 'cf-')), 'store.json')

class FakeQuiver {
  constructor (rows) { this.rows = rows }
  async liveCongressTrading () { return this.rows }
  // The engine now fetches through the dataset layer.
  async fetchDataset (path) { return path.includes('congresstrading') ? this.rows : [] }
  async congressHoldings () { return [] }
}
class FakeBroker extends PublicClient {
  constructor ({ positions = {}, failPlace = false } = {}) {
    super({ secretKey: 'x', accountId: 'a' })
    this._p = positions; this._fail = failPlace; this.placed = []
  }
  async getPositions () { return this._p }
  async placeOrder (b) {
    this.placed.push(b)
    if (this._fail) throw new Error('network exploded')
    return { orderId: b.orderId }
  }
  async getOrder (id) { return { status: 'FILLED', orderId: id } }
}
const engineOn = (path, rows, brokerOpts) => new Engine({
  store: new Store(path), quiver: new FakeQuiver(rows),
  broker: new FakeBroker(brokerOpts), watchlist: structuredClone(WATCHLIST)
})

// ---- Finding 1 (CRITICAL): concurrent watch clobbering a submitted order ----
test('a second process polling cannot revert a SUBMITTED order or erase its idempotency key', async () => {
  process.env.DRY_RUN = 'false'
  const path = storePath()

  const watcher = engineOn(path, [trade()])          // long-lived, like `watch`
  const { queued } = await watcher.poll()
  const id = queued[0].id

  const approver = engineOn(path, [trade()])          // separate process
  const { order } = await approver.approve(id)
  assert.equal(order.status, 'SUBMITTED')
  const brokerId = order.brokerOrderId
  assert.ok(brokerId)

  await watcher.poll()                                // the clobbering tick

  const onDisk = JSON.parse(readFileSync(path, 'utf8')).orders[id]
  assert.equal(onDisk.status, 'SUBMITTED', 'must not revert to PENDING')
  assert.equal(onDisk.brokerOrderId, brokerId, 'idempotency key must survive')
  assert.ok(onDisk.submittedAt, 'audit record must survive')

  const fresh = engineOn(path, [])
  assert.equal(fresh.store.listOrders('PENDING').length, 0, 'must not reappear as approvable')
  await assert.rejects(() => fresh.approve(id), /not PENDING/, 'a second approval must be impossible')
})

// ---- Finding 2 / 5 (HIGH): DRY_RUN must not consume the order ----
test('a dry-run approval leaves the order approvable once DRY_RUN is turned off', async () => {
  const path = storePath()
  process.env.DRY_RUN = 'true'
  const e1 = engineOn(path, [trade()])
  const { queued } = await e1.poll()
  const id = queued[0].id

  const dry = await e1.approve(id)
  assert.equal(dry.dryRun, true)
  assert.equal(dry.order.status, 'PENDING', 'dry run must not consume the order')

  process.env.DRY_RUN = 'false'
  const e2 = engineOn(path, [])
  const live = await e2.approve(id)
  assert.equal(live.dryRun, false)
  assert.equal(live.order.status, 'SUBMITTED')
  assert.equal(e2.broker.placed.length, 1, 'the order must actually reach the broker')
})

// ---- Finding 3 (HIGH): an interrupted submit must be recoverable ----
test('a failed submit is marked NEEDS_REVIEW, never silently returned to PENDING', async () => {
  process.env.DRY_RUN = 'false'
  const path = storePath()
  const e = engineOn(path, [trade()], { failPlace: true })
  const { queued } = await e.poll()
  const id = queued[0].id

  await assert.rejects(() => e.approve(id), /may or may not have reached Public/)

  const onDisk = JSON.parse(readFileSync(path, 'utf8')).orders[id]
  assert.equal(onDisk.status, 'NEEDS_REVIEW')
  assert.ok(onDisk.brokerOrderId, 'the idempotency key must be retained for retry')
  assert.ok(onDisk.submitError)

  const fresh = engineOn(path, [])
  assert.equal(fresh.store.listOrders('PENDING').length, 0, 'must not invite a blind resubmit')
})

test('sync() chases orders left in an unresolved state', async () => {
  process.env.DRY_RUN = 'false'
  const path = storePath()
  const e = engineOn(path, [trade()], { failPlace: true })
  const { queued } = await e.poll()
  await assert.rejects(() => e.approve(queued[0].id))

  const e2 = engineOn(path, [])
  await e2.sync()
  const onDisk = JSON.parse(readFileSync(path, 'utf8')).orders[queued[0].id]
  assert.equal(onDisk.status, 'FILLED', 'the broker record resolves it')
  assert.ok(onDisk.submittedAt, 'a resolved order must count as submitted')
})

// ---- Finding 4 (HIGH): unknown portfolio shape must fail closed ----
test('an unrecognised portfolio shape throws instead of reporting an empty account', async () => {
  const c = new PublicClient({ secretKey: 'x', accountId: 'a' })
  c.getPortfolio = async () => ({ somethingElse: [{ symbol: 'NVDA', quantity: 5 }] })
  await assert.rejects(() => c.getPositions(), /unrecognised portfolio shape/)
})

test('a recognised portfolio shape still parses', async () => {
  const c = new PublicClient({ secretKey: 'x', accountId: 'a' })
  c.getPortfolio = async () => ({ positions: [{ symbol: 'NVDA', quantity: '5' }] })
  assert.deepEqual(await c.getPositions(), { NVDA: 5 })
})

// ---- Findings 6 / 7 (MEDIUM): reversible skips must not be permanent ----
test('config-dependent skips are marked re-checkable, permanent ones are not', () => {
  const off = evaluateTrade(trade({ BioGuideID: 'X000000', Representative: 'Someone Else' }), WATCHLIST, { now: NOW })
  assert.equal(off.permanent, false, 'not-on-watchlist must be reconsidered after an edit')

  const early = evaluateTrade(trade(), { ...WATCHLIST, rules: { ...WATCHLIST.rules, minDisclosureLagDays: 999 } }, { now: NOW })
  assert.equal(early.permanent, false, 'a lag that has not yet elapsed must be reconsidered')

  const opt = evaluateTrade(trade({ TickerType: 'OP' }), WATCHLIST, { now: NOW })
  assert.notEqual(opt.permanent, false, 'an option can never become an equity order')
})

test('adding someone to the watchlist later picks up a disclosure skipped before', async () => {
  const path = storePath()
  const rows = [trade({ BioGuideID: 'T000193', Representative: 'Tommy Tuberville' })]

  const before = engineOn(path, rows)
  assert.equal((await before.poll()).queued.length, 0)

  const after = engineOn(path, rows)
  after.watchlist.follow.push({ bioGuideId: 'T000193', name: 'Tommy Tuberville', weight: 1, enabled: true })
  assert.equal((await after.poll()).queued.length, 1, 'the earlier disclosure must be re-evaluated')
})

// ---- Finding 8 (LOW): the daily cap must not refill on rejection ----
test('a cancelled order still counts against the daily submission cap', async () => {
  process.env.DRY_RUN = 'false'
  const path = storePath()
  const e = engineOn(path, [trade()])
  const { queued } = await e.poll()
  await e.approve(queued[0].id)

  const today = new Date().toISOString().slice(0, 10)
  assert.equal(e.store.countOrdersSince(today), 1)

  e.store.withLock(store => {           // simulate sync() seeing a rejection
    const o = store.getOrder(queued[0].id)
    o.status = 'CLOSED'
    store.putOrder(o)
  })
  assert.equal(e.store.countOrdersSince(today), 1, 'a rejection must not free up capacity')
})

test('dry runs never count against the daily submission cap', async () => {
  process.env.DRY_RUN = 'true'
  const path = storePath()
  const e = engineOn(path, [trade()])
  const { queued } = await e.poll()
  await e.approve(queued[0].id)
  assert.equal(e.store.countOrdersSince(new Date().toISOString().slice(0, 10)), 0)
})

// ---- Regression: locking must work before the data directory exists ----
test('a first run creates the data directory rather than failing on the lock file', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'cf-')), 'nested', 'deeper', 'store.json')
  const store = new Store(path)                    // directory does not exist yet
  store.withLock(s => s.markSeen('k', { outcome: 'TEST' }))
  assert.equal(store.hasSeen('k'), true)
  assert.ok(JSON.parse(readFileSync(path, 'utf8')).seenTrades.k)
})

test('poll() succeeds on a completely fresh install', async () => {
  process.env.DRY_RUN = 'true'
  const path = join(mkdtempSync(join(tmpdir(), 'cf-')), 'data', 'store.json')
  const e = engineOn(path, [trade()])
  const { queued } = await e.poll()                // this threw ENOENT before the fix
  assert.equal(queued.length, 1)
})
