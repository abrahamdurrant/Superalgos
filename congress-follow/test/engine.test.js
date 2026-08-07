import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Engine } from '../src/engine.js'
import { Store } from '../src/store.js'
import { evaluateTrade, classifySide, tradeKey } from '../src/signals.js'
import { PublicClient } from '../src/public-client.js'

const WATCHLIST = {
  follow: [{ bioGuideId: 'P000197', name: 'Nancy Pelosi', weight: 1, enabled: true }],
  rules: {
    sides: ['BUY', 'SELL'],
    tickerAllowlist: [],
    tickerBlocklist: [],
    minDisclosureLagDays: 0,
    maxDisclosureLagDays: 60,
    allowedTickerTypes: ['CS', 'ST']
  },
  sizing: { mode: 'fixed', notionalUsd: 250, tiers: [], sellMode: 'full' },
  guardrails: { maxNotionalPerTrade: 1000, maxOrdersPerDay: 10, maxOpenPositions: 25, requireHeldPositionToSell: true }
}

const NOW = new Date('2026-08-07T00:00:00Z')

function trade (over = {}) {
  return {
    Representative: 'Nancy Pelosi',
    BioGuideID: 'P000197',
    ReportDate: '2026-08-01',
    TransactionDate: '2026-07-15',
    Ticker: 'NVDA',
    Transaction: 'Purchase',
    Range: '$1,001 - $15,000',
    Amount: '1001',
    House: 'Representatives',
    Party: 'Democratic',
    TickerType: 'ST',
    ...over
  }
}

function newStore () {
  return new Store(join(mkdtempSync(join(tmpdir(), 'cf-')), 'store.json'))
}

class FakeQuiver {
  constructor (rows) { this.rows = rows }
  async liveCongressTrading () { return this.rows }
  // The engine now fetches through the dataset layer.
  async fetchDataset (path) { return path.includes('congresstrading') ? this.rows : [] }
  async congressHoldings () { return [] }
}

class FakeBroker extends PublicClient {
  constructor ({ positions = {}, fail = false } = {}) {
    super({ secretKey: 'x', accountId: 'acct-1' })
    this._positions = positions
    this._fail = fail
    this.placed = []
  }
  async getPositions () {
    if (this._fail) throw new Error('positions unavailable')
    return this._positions
  }
  async placeOrder (body) { this.placed.push(body); return { orderId: body.orderId } }
}

function engineWith (rows, brokerOpts) {
  return new Engine({
    store: newStore(),
    quiver: new FakeQuiver(rows),
    broker: new FakeBroker(brokerOpts),
    watchlist: structuredClone(WATCHLIST)
  })
}

test('classifySide maps Quiver transaction text', () => {
  assert.equal(classifySide('Purchase'), 'BUY')
  assert.equal(classifySide('Sale (Partial)'), 'SELL')
  assert.equal(classifySide('Sale (Full)'), 'SELL')
  assert.equal(classifySide('Exchange'), null)
})

test('watchlist matches by BioGuide ID, not just name', () => {
  const wrongId = evaluateTrade(trade({ BioGuideID: 'X000000' }), WATCHLIST, { now: NOW })
  assert.equal(wrongId.action, 'SKIP', 'a different politician must not match on name alone')
})

test('non-equity ticker types are skipped', () => {
  const bond = evaluateTrade(trade({ TickerType: 'OP' }), WATCHLIST, { now: NOW })
  assert.equal(bond.action, 'SKIP')
  assert.match(bond.reason, /not tradeable as equity/)
})

test('stale disclosures beyond the lag window are skipped', () => {
  const old = evaluateTrade(trade({ TransactionDate: '2026-01-01' }), WATCHLIST, { now: NOW })
  assert.equal(old.action, 'SKIP')
  assert.match(old.reason, /exceeds maximum/)
})

test('a valid purchase produces a sized BUY signal', () => {
  const s = evaluateTrade(trade(), WATCHLIST, { now: NOW })
  assert.equal(s.action, 'BUY')
  assert.equal(s.ticker, 'NVDA')
  assert.equal(s.notionalUsd, 250)
  assert.equal(s.lagDays, 23)
})

test('tiered sizing scales with the reported amount and follow weight', () => {
  const wl = structuredClone(WATCHLIST)
  wl.sizing = { mode: 'tiered', notionalUsd: 0, sellMode: 'full', tiers: [
    { minReportedAmount: 1001, notionalUsd: 150 },
    { minReportedAmount: 50001, notionalUsd: 500 }
  ] }
  assert.equal(evaluateTrade(trade({ Amount: '1001' }), wl, { now: NOW }).notionalUsd, 150)
  assert.equal(evaluateTrade(trade({ Amount: '50001' }), wl, { now: NOW }).notionalUsd, 500)
  wl.follow[0].weight = 0.5
  assert.equal(evaluateTrade(trade({ Amount: '50001' }), wl, { now: NOW }).notionalUsd, 250)
})

test('poll queues pending orders and never re-queues the same disclosure', async () => {
  const engine = engineWith([trade()])
  const first = await engine.poll()
  assert.equal(first.queued.length, 1)
  assert.equal(first.queued[0].status, 'PENDING')

  const second = await engine.poll()
  assert.equal(second.queued.length, 0, 'the same disclosure must not be queued twice')
  assert.equal(engine.store.listOrders('PENDING').length, 1)
})

test('tradeKey is stable across polls and distinct per disclosure', () => {
  assert.equal(tradeKey(trade()), tradeKey(trade()))
  assert.notEqual(tradeKey(trade()), tradeKey(trade({ Ticker: 'AAPL' })))
})

test('approving a BUY sends a margin-free EQUITY order with a UUID idempotency key', async () => {
  process.env.DRY_RUN = 'false'
  const engine = engineWith([trade()])
  const { queued } = await engine.poll()
  const { order } = await engine.approve(queued[0].id)

  assert.equal(order.status, 'SUBMITTED')
  const [body] = engine.broker.placed
  assert.equal(body.instrument.symbol, 'NVDA')
  assert.equal(body.instrument.type, 'EQUITY')
  assert.equal(body.orderSide, 'BUY')
  assert.equal(body.amount, '250')
  assert.equal(body.expiration.timeInForce, 'DAY')
  assert.equal(body.useMargin, false, 'IRAs are cash accounts - margin must be off')
  assert.match(body.orderId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
})

test('selling a stock we do not hold is blocked', async () => {
  process.env.DRY_RUN = 'false'
  const engine = engineWith([trade({ Transaction: 'Sale (Full)' })], { positions: {} })
  const { queued } = await engine.poll()
  await assert.rejects(() => engine.approve(queued[0].id), /cannot short/)
  assert.equal(engine.broker.placed.length, 0)
})

test('a SELL of a held position submits the full share quantity', async () => {
  process.env.DRY_RUN = 'false'
  const engine = engineWith([trade({ Transaction: 'Sale (Full)' })], { positions: { NVDA: 7 } })
  const { queued } = await engine.poll()
  await engine.approve(queued[0].id)
  const [body] = engine.broker.placed
  assert.equal(body.orderSide, 'SELL')
  assert.equal(body.quantity, '7')
  assert.equal(body.amount, undefined, 'sells go out as share quantity, not notional')
})

test('a positions lookup failure blocks approval rather than trading blind', async () => {
  process.env.DRY_RUN = 'false'
  const engine = engineWith([trade()], { fail: true })
  const { queued } = await engine.poll()
  await assert.rejects(() => engine.approve(queued[0].id), /could not read positions/)
  assert.equal(engine.broker.placed.length, 0)
})

test('guardrails block oversized orders unless forced', async () => {
  process.env.DRY_RUN = 'false'
  const engine = engineWith([trade()])
  engine.watchlist.guardrails.maxNotionalPerTrade = 10
  const { queued } = await engine.poll()
  await assert.rejects(() => engine.approve(queued[0].id), /exceeds maxNotionalPerTrade/)
  assert.equal(engine.broker.placed.length, 0)

  await engine.approve(queued[0].id, { force: true })
  assert.equal(engine.broker.placed.length, 1, '--force overrides the guardrail')
})

test('rejected orders are not submittable', async () => {
  const engine = engineWith([trade()])
  const { queued } = await engine.poll()
  engine.reject(queued[0].id, 'not convinced')
  await assert.rejects(() => engine.approve(queued[0].id), /REJECTED, not PENDING/)
})
