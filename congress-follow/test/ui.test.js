import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'
import { UiServer } from '../src/ui-server.js'
import { Engine } from '../src/engine.js'
import { Store } from '../src/store.js'
import { Settings } from '../src/settings.js'
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
  const dir = mkdtempSync(join(tmpdir(), 'cf-'))
  const engine = new Engine({
    settings: new Settings(join(dir, 'settings.json')),
    store: new Store(join(dir, 'data', 'store.json')),
    quiver: {
      async liveCongressTrading () { return [trade()] },
      async fetchDataset (path) { return path.includes('congresstrading') ? [trade()] : [] },
      async congressHoldings () { return [] }
    },
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

test('settings can be changed through the UI and persist', async () => {
  const { ui, engine, base, token } = await boot()
  try {
    const r = await (await fetch(`${base}/api/settings?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sizing: { mode: 'mirror', capitalUsd: 25000 }, datasets: { congresstrading: true, insiders: true } })
    })).json()
    assert.equal(r.settings.sizing.capitalUsd, 25000)
    assert.equal(r.settings.datasets.insiders, true)
    assert.equal(engine.settings.data.sizing.mode, 'mirror')
  } finally { ui.close() }
})

test('the UI cannot switch to live while DRY_RUN is forced in the environment', async () => {
  process.env.DRY_RUN = 'true'
  const { ui, base, token } = await boot()
  try {
    const res = await fetch(`${base}/api/settings?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dryRun: false })
    })
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /overrides this setting/)
  } finally { ui.close(); delete process.env.DRY_RUN }
})

test('a queued order can be amended through the UI before approval', async () => {
  const { ui, engine, base, token } = await boot()
  try {
    const { queued } = await engine.poll()
    const r = await (await fetch(`${base}/api/amend?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: queued[0].id, sizeOverrideUsd: 120, accountId: 'taxable-9', bucket: 'tech' })
    })).json()
    assert.equal(r.order.sizeOverrideUsd, 120)
    assert.equal(r.order.accountId, 'taxable-9')
    assert.equal(r.order.bucket, 'tech')
  } finally { ui.close() }
})

test('state exposes dataset health and the settings the panel edits', async () => {
  const { ui, engine, base, token } = await boot()
  try {
    await engine.poll()
    const s = await (await fetch(`${base}/api/state?token=${token}`)).json()
    assert.ok(Array.isArray(s.datasetCatalog) && s.datasetCatalog.length >= 4)
    assert.ok(s.datasetCatalog.some(d => d.plan === 'Trader'), 'plan tiers must be visible')
    assert.ok(s.settings.sizing && s.settings.automation)
    assert.doesNotMatch(JSON.stringify(s), /secretKey|apiKey/i)
  } finally { ui.close() }
})

test('automation through the UI respects the unproven-submit-path gate', async () => {
  process.env.DRY_RUN = 'false'
  const { ui, engine, base, token } = await boot()
  try {
    engine.settings.update({ automation: { enabled: true, requireProvenSubmitPath: true } })
    const r = await (await fetch(`${base}/api/automate?token=${token}`, { method: 'POST' })).json()
    assert.equal(r.ran, false)
    assert.match(r.reason, /unproven/)
    assert.equal(engine.broker.placed.length, 0)
  } finally { ui.close(); delete process.env.DRY_RUN }
})

test('a plan-gated dataset returns a specific reason, not a list of possibilities', async () => {
  const { ui, engine, base, token } = await boot()
  engine.quiver.fetchDataset = async () => { throw new Error('Quiver /beta/live/sec13f failed: HTTP 403 {"detail":"..."}') }
  try {
    const res = await fetch(`${base}/api/browse?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dataset: 'sec13f' })
    })
    const j = await res.json()
    assert.equal(j.planGated, true)
    assert.equal(j.requiredPlan, 'Trader')
    assert.match(j.error, /requires the Quiver API Trader plan/)
    // The old message speculated about truncated keys and stale copies.
    assert.doesNotMatch(j.error, /truncated|stray characters|regenerated/)
  } finally { ui.close() }
})

test('a non-plan error is still reported verbatim', async () => {
  const { ui, engine, base, token } = await boot()
  engine.quiver.fetchDataset = async () => { throw new Error('socket hang up') }
  try {
    const j = await (await fetch(`${base}/api/browse?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dataset: 'congresstrading' })
    })).json()
    assert.equal(j.planGated, false)
    assert.match(j.error, /socket hang up/)
  } finally { ui.close() }
})

test('a 403 on a Hobbyist dataset is NOT blamed on the plan', async () => {
  const { ui, engine, base, token } = await boot()
  engine.quiver.fetchDataset = async () => { throw new Error('Quiver failed: HTTP 403') }
  try {
    const j = await (await fetch(`${base}/api/browse?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dataset: 'congresstrading' })
    })).json()
    assert.equal(j.planGated, false, 'congress is on Hobbyist, so a 403 means something else')
  } finally { ui.close() }
})

test('follow and unfollow work through the UI', async () => {
  const { mkdirSync, writeFileSync: wf, readFileSync: rf } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'cf-wl-'))
  const wlPath = join(dir, 'watchlist.json')
  mkdirSync(dir, { recursive: true })
  wf(wlPath, JSON.stringify({ follow: [] }))
  process.env.WATCHLIST_PATH = wlPath

  const { ui, base, token } = await boot()
  try {
    const added = await (await fetch(`${base}/api/follow?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nancy Pelosi', bioGuideId: 'P000197' })
    })).json()
    assert.equal(added.ok, true)
    assert.equal(JSON.parse(rf(wlPath, 'utf8')).follow.length, 1)

    const removed = await (await fetch(`${base}/api/unfollow?token=${token}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Nancy Pelosi', bioGuideId: 'P000197' })
    })).json()
    assert.equal(removed.removed, true)
    assert.equal(JSON.parse(rf(wlPath, 'utf8')).follow.length, 0)
  } finally { ui.close(); delete process.env.WATCHLIST_PATH }
})

test('detect-datasets enables exactly what the plan covers', async () => {
  const { ui, engine, base, token } = await boot()
  engine.quiver.probeDatasets = async (list) => list.map(d => ({
    id: d.id, label: d.label, plan: d.plan, ok: d.plan === 'Hobbyist', denied: d.plan !== 'Hobbyist', rows: 1,
    error: d.plan !== 'Hobbyist' ? `not included in your plan (needs ${d.plan})` : undefined
  }))
  try {
    const r = await (await fetch(`${base}/api/detect-datasets?token=${token}`, { method: 'POST' })).json()
    assert.ok(r.enabled.includes('congresstrading'))
    assert.ok(!r.enabled.includes('insiders'), 'a Trader dataset must not be enabled on Hobbyist')
    assert.equal(engine.settings.data.datasets.congresstrading, true)
    assert.equal(engine.settings.data.datasets.insiders, false)
  } finally { ui.close() }
})
