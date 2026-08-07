import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'
import { UiServer } from '../src/ui-server.js'
import { Engine } from '../src/engine.js'
import { Store } from '../src/store.js'
import { PublicClient } from '../src/public-client.js'

const WATCHLIST = {
  follow: [{ bioGuideId: 'P000197', name: 'Nancy Pelosi', weight: 1, enabled: true }],
  rules: { sides: ['BUY', 'SELL'], tickerAllowlist: [], tickerBlocklist: [], minDisclosureLagDays: 0, maxDisclosureLagDays: 60, allowedTickerTypes: ['CS', 'ST'] },
  sizing: { mode: 'fixed', notionalUsd: 250, tiers: [], sellMode: 'full' },
  guardrails: { maxNotionalPerTrade: 1000, maxOrdersPerDay: 10, maxOpenPositions: 25, requireHeldPositionToSell: true }
}
const trade = () => ({
  Representative: 'Nancy Pelosi', BioGuideID: 'P000197', ReportDate: '2026-08-01',
  TransactionDate: '2026-07-20', Ticker: 'NVDA', Transaction: 'Purchase',
  Range: '$1,001 - $15,000', Amount: '1001', House: 'Representatives', Party: 'Democratic', TickerType: 'ST'
})
class FakeBroker extends PublicClient {
  constructor () { super({ secretKey: 'x', accountId: 'acct' }); this.placed = [] }
  async getPositions () { return { AAPL: 3 } }
  async placeOrder (b) { this.placed.push(b); return { orderId: b.orderId } }
}
async function boot () {
  const engine = new Engine({
    store: new Store(join(mkdtempSync(join(tmpdir(), 'cf-')), 'data', 'store.json')),
    quiver: { async liveCongressTrading () { return [trade()] } },
    broker: new FakeBroker(),
    watchlist: structuredClone(WATCHLIST)
  })
  const ui = new UiServer({ engine, port: 0 })
  const url = await ui.listen()
  return { ui, engine, url, base: new URL(url).origin, token: new URL(url).searchParams.get('token') }
}

test('the server binds to loopback only', async () => {
  const { ui } = await boot()
  try { assert.equal(ui.server.address().address, '127.0.0.1') } finally { ui.close() }
})

test('requests without the token are refused', async () => {
  const { ui, base } = await boot()
  try {
    assert.equal((await fetch(`${base}/api/state`)).status, 403)
    assert.equal((await fetch(`${base}/api/state?token=wrong`)).status, 403)
  } finally { ui.close() }
})

test('a non-localhost Host header is refused, blocking DNS rebinding', async () => {
  // fetch() forbids overriding Host, so drive a raw request instead.
  const { ui, token } = await boot()
  const port = ui.server.address().port
  try {
    const status = await new Promise((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1', port, path: `/api/state?token=${token}`, method: 'GET',
        headers: { host: 'evil.example.com' }
      }, res => { res.resume(); resolve(res.statusCode) })
      req.on('error', reject)
      req.end()
    })
    assert.equal(status, 403, 'a rebound hostname must not reach an order-placing API')
  } finally { ui.close() }
})

test('state exposes the queue, positions and dry-run mode but never a secret', async () => {
  process.env.DRY_RUN = 'true'
  const { ui, engine, base, token } = await boot()
  try {
    await engine.poll()
    const s = await (await fetch(`${base}/api/state?token=${token}`)).json()
    assert.equal(s.dryRun, true)
    assert.equal(s.pending.length, 1)
    assert.equal(s.pending[0].ticker, 'NVDA')
    assert.deepEqual(s.positions, { AAPL: 3 })
    const blob = JSON.stringify(s)
    assert.doesNotMatch(blob, /secretKey|apiKey|accessToken/i, 'no credential may appear in state')
  } finally { ui.close() }
})

test('approving through the UI in dry run sends nothing and keeps the order pending', async () => {
  process.env.DRY_RUN = 'true'
  const { ui, engine, base, token } = await boot()
  try {
    const { queued } = await engine.poll()
    const r = await (await fetch(`${base}/api/approve?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: queued[0].id })
    })).json()
    assert.equal(r.dryRun, true)
    assert.equal(r.status, 'PENDING')
    assert.equal(engine.broker.placed.length, 0)
  } finally { ui.close() }
})

test('approving live actually submits', async () => {
  process.env.DRY_RUN = 'false'
  const { ui, engine, base, token } = await boot()
  try {
    const { queued } = await engine.poll()
    const r = await (await fetch(`${base}/api/approve?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: queued[0].id })
    })).json()
    assert.equal(r.status, 'SUBMITTED')
    assert.equal(engine.broker.placed.length, 1)
  } finally { ui.close() }
})

test('a guardrail rejection is returned as a readable error, not a crash', async () => {
  process.env.DRY_RUN = 'false'
  const { ui, engine, base, token } = await boot()
  try {
    engine.watchlist.guardrails.maxNotionalPerTrade = 1
    const { queued } = await engine.poll()
    const res = await fetch(`${base}/api/approve?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: queued[0].id })
    })
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /exceeds maxNotionalPerTrade/)
    assert.equal(engine.broker.placed.length, 0)
  } finally { ui.close() }
})

test('preview reports what would queue and why the rest was filtered, without persisting', async () => {
  const { ui, engine, base, token } = await boot()
  try {
    const p = await (await fetch(`${base}/api/preview?token=${token}`, { method: 'POST' })).json()
    assert.equal(p.total, 1)
    assert.equal(p.wouldQueue.length, 1)
    assert.equal(engine.store.listOrders().length, 0, 'preview must not create orders')
  } finally { ui.close() }
})

test('GET routes cannot change state', async () => {
  const { ui, base, token } = await boot()
  try {
    for (const p of ['/api/approve', '/api/reject', '/api/poll']) {
      assert.equal((await fetch(`${base}${p}?token=${token}`)).status, 404)
    }
  } finally { ui.close() }
})
