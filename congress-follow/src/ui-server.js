import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { ALL_DATASETS } from './datasets.js'
import { Engine } from './engine.js'
import { log } from './log.js'
import { renderPage } from './ui-page.js'

/**
 * A local control panel for the approval queue.
 *
 * This server can place real orders, so it is deliberately locked down:
 *   - bound to 127.0.0.1 only, never a routable interface
 *   - every request must carry a token minted fresh at startup
 *   - the Host header must be localhost, which blocks DNS-rebinding attacks
 *     where a hostile page resolves its own domain to 127.0.0.1
 *   - state-changing routes are POST only, so no <img> or link can trigger them
 */
export class UiServer {
  constructor ({ engine, port = Number(process.env.UI_PORT || 8787) } = {}) {
    this.engine = engine ?? new Engine()
    this.port = port
    this.token = randomBytes(24).toString('hex')
  }

  #authorised (req) {
    const host = (req.headers.host || '').split(':')[0]
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) return false
    const url = new URL(req.url, 'http://localhost')
    const token = url.searchParams.get('token') || req.headers['x-cf-token']
    return token === this.token
  }

  async #readJson (req) {
    const chunks = []
    let size = 0
    for await (const c of req) {
      size += c.length
      if (size > 64 * 1024) throw new Error('Request body too large')
      chunks.push(c)
    }
    const raw = Buffer.concat(chunks).toString('utf8')
    return raw ? JSON.parse(raw) : {}
  }

  /** Everything the page needs, in one round trip. */
  async #state () {
    const store = this.engine.store.reload()
    const orders = store.listOrders()
    let positions = null
    let positionsError = null
    try {
      positions = await this.engine.broker.getPositions()
    } catch (err) {
      positionsError = err.message
    }
    return {
      dryRun: this.engine.isDryRun,
      dryRunForcedByEnv: this.engine.settings.dryRunForcedByEnv,
      settings: this.engine.settings.data,
      datasetCatalog: ALL_DATASETS().map(d => ({ id: d.id, label: d.label, plan: d.plan })),
      datasetStatus: this.engine.datasetStatus,
      allocationsLoaded: this.engine.allocations ? this.engine.allocations.byPolitician.size : null,
      accountId: this.engine.broker.accountId,
      guardrails: this.engine.watchlist.guardrails,
      following: this.engine.watchlist.follow.map(f => ({ name: f.name, bioGuideId: f.bioGuideId, weight: f.weight ?? 1 })),
      pending: orders.filter(o => o.status === 'PENDING'),
      needsReview: orders.filter(o => o.status === 'NEEDS_REVIEW' || o.status === 'SUBMITTING'),
      history: orders.filter(o => !['PENDING', 'NEEDS_REVIEW', 'SUBMITTING'].includes(o.status)).slice(-60).reverse(),
      positions,
      positionsError
    }
  }

  #route (req, res) {
    const url = new URL(req.url, 'http://localhost')
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, {
        'content-type': type,
        // This page must never be embedded or referenced from elsewhere.
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'cache-control': 'no-store'
      })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    }

    if (!this.#authorised(req)) {
      return send(403, { error: 'Forbidden. Open the URL printed by `congress-follow ui`, which carries a one-time token.' })
    }

    if (req.method === 'GET' && url.pathname === '/') {
      return send(200, renderPage(this.token), 'text/html; charset=utf-8')
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return this.#state().then(s => send(200, s)).catch(e => send(500, { error: e.message }))
    }

    if (req.method === 'POST' && url.pathname === '/api/poll') {
      return this.engine.poll()
        .then(r => send(200, { queued: r.queued.length, skipped: r.skipped.length, total: r.total }))
        .catch(e => send(500, { error: e.message }))
    }

    if (req.method === 'POST' && url.pathname === '/api/preview') {
      return this.engine.preview()
        .then(r => send(200, r))
        .catch(e => send(500, { error: e.message }))
    }

    if (req.method === 'POST' && url.pathname === '/api/settings') {
      return this.#readJson(req)
        .then(patch => {
          const data = this.engine.settings.update(patch)
          // Reloading allocations matters when the sizing basis changes.
          if (patch.sizing?.mode === 'mirror') this.engine.loadAllocations({ force: true }).catch(() => {})
          return send(200, { ok: true, settings: data })
        })
        .catch(e => send(400, { error: e.message }))
    }

    if (req.method === 'POST' && url.pathname === '/api/manual-order') {
      return this.#readJson(req)
        .then(b => this.engine.queueManualOrder(b))
        .then(o => send(200, { ok: true, order: o }))
        .catch(e => send(400, { error: e.message }))
    }

    if (req.method === 'POST' && url.pathname === '/api/detect-datasets') {
      return (async () => {
        const { ALL_DATASETS } = await import('./datasets.js')
        const results = await this.engine.quiver.probeDatasets(ALL_DATASETS())
        const patch = {}
        for (const r of results) patch[r.id] = r.ok
        this.engine.settings.update({ datasets: patch })
        return { results, enabled: results.filter(r => r.ok).map(r => r.id) }
      })().then(r => send(200, r)).catch(e => send(500, { error: e.message }))
    }

    if (req.method === 'POST' && url.pathname === '/api/follow') {
      return this.#readJson(req)
        .then(b => this.engine.follow(b))
        .then(r => send(200, { ok: true, ...r }))
        .catch(e => send(400, { error: e.message }))
    }

    if (req.method === 'POST' && url.pathname === '/api/unfollow') {
      return this.#readJson(req)
        .then(b => this.engine.unfollow(b))
        .then(r => send(200, { ok: true, ...r }))
        .catch(e => send(400, { error: e.message }))
    }

    if (req.method === 'POST' && url.pathname === '/api/actor') {
      return this.#readJson(req)
        .then(b => this.engine.actorTrades(b.actor))
        .then(r => send(200, r))
        .catch(e => send(400, { error: e.message }))
    }

    if (req.method === 'POST' && url.pathname === '/api/performance') {
      return this.#readJson(req)
        .then(b => this.engine.performance({
          groupBy: b.groupBy === 'dataset' ? 'dataset' : 'actor',
          sortBy: b.sortBy,
          minTrades: Number.isFinite(Number(b.minTrades)) ? Number(b.minTrades) : 3
        }))
        .then(r => send(200, r))
        .catch(e => send(500, { error: e.message }))
    }

    if (req.method === 'POST' && url.pathname === '/api/browse') {
      return this.#readJson(req)
        .then(async b => {
          const { datasetById } = await import('./datasets.js')
          const ds = datasetById(b.dataset)
          if (!ds) throw new Error(`Unknown dataset "${b.dataset}"`)
          try {
            const raw = await this.engine.quiver.fetchDataset(ds.path, b.ticker ? { ticker: b.ticker } : {})
            const { byNewest } = await import('./performance.js')
            // Newest first: the API does not guarantee an order, and the most
            // recent disclosure is what matters when deciding to act.
            const rows = raw.map(r => ({ ...ds.normalise(r), dataset: ds.id })).sort(byNewest)
            return { dataset: ds.id, label: ds.label, rows: rows.slice(0, 100) }
          } catch (err) {
            // When a dataset with a known plan requirement is refused, the cause
            // is not ambiguous - say so instead of listing possibilities.
            if (/HTTP 40[13]/.test(err.message) && ds.plan && ds.plan !== 'Hobbyist') {
              const e = new Error(`${ds.label} requires the Quiver API ${ds.plan} plan.`)
              e.planGated = true
              e.dataset = ds.id
              e.requiredPlan = ds.plan
              throw e
            }
            throw err
          }
        })
        .then(r => send(200, r))
        .catch(e => send(400, {
          error: e.message,
          planGated: Boolean(e.planGated),
          requiredPlan: e.requiredPlan ?? null,
          denied: /HTTP 40[13]/.test(e.message)
        }))
    }

    if (req.method === 'POST' && url.pathname === '/api/amend') {
      return this.#readJson(req)
        .then(b => this.engine.amend(b.id, b))
        .then(o => send(200, { ok: true, order: o }))
        .catch(e => send(400, { error: e.message }))
    }

    if (req.method === 'POST' && url.pathname === '/api/automate') {
      return this.engine.runAutomation()
        .then(r => send(200, r))
        .catch(e => send(500, { error: e.message }))
    }

    if (req.method === 'GET' && url.pathname === '/api/accounts') {
      return this.engine.broker.getAccounts()
        .then(a => send(200, { accounts: a }))
        .catch(e => send(500, { error: e.message }))
    }

    if (req.method === 'POST' && url.pathname === '/api/approve') {
      return this.#readJson(req)
        .then(b => this.engine.approve(b.id, { force: Boolean(b.force) }))
        .then(r => send(200, { ok: true, dryRun: r.dryRun, status: r.order.status, body: r.body }))
        .catch(e => send(400, { error: e.message }))
    }

    if (req.method === 'POST' && url.pathname === '/api/reject') {
      return this.#readJson(req)
        .then(b => this.engine.reject(b.id, b.reason || undefined))
        .then(o => send(200, { ok: true, status: o.status }))
        .catch(e => send(400, { error: e.message }))
    }

    if (req.method === 'POST' && url.pathname === '/api/sync') {
      return this.engine.sync()
        .then(o => send(200, { refreshed: o.length }))
        .catch(e => send(500, { error: e.message }))
    }

    return send(404, { error: 'Not found' })
  }

  listen () {
    return new Promise(resolve => {
      this.server = createServer((req, res) => {
        try { this.#route(req, res) } catch (err) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      })
      // 127.0.0.1 only: binding 0.0.0.0 would expose an order-placing endpoint
      // to the local network.
      this.server.listen(this.port, '127.0.0.1', () => {
        const url = `http://127.0.0.1:${this.server.address().port}/?token=${this.token}`
        log.info(`UI listening on 127.0.0.1:${this.server.address().port}`)
        resolve(url)
      })
    })
  }

  close () { this.server?.close() }
}
