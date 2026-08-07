import { config } from './config.js'
import { log } from './log.js'

// Quiver Quantitative REST client.
// Schema verified against https://api.quiverquant.com/docs/schema.json (OpenAPI 3.0.3).
export class QuiverClient {
  constructor ({ baseUrl = config.quiver.baseUrl, apiKey = config.quiver.apiKey } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.apiKey = apiKey
    // Quiver's published OpenAPI schema declares `scheme: bearer`, but their own
    // official Python client sends `Authorization: Token <key>`. The two disagree,
    // and the wrong prefix returns a bare 401 that looks exactly like an expired
    // subscription. Try the scheme their client actually uses first, then fall back.
    this._schemes = ['Token', 'Bearer']
    this._scheme = null
  }

  /**
   * Quiver is inconsistent: the trading endpoints return a bare array, while
   * /beta/bulk/congress/politicians wraps rows in {"data": [...]}. Silently
   * treating an unrecognised shape as "no rows" hides a real API change behind
   * an empty result, so warn loudly instead.
   */
  #rows (body, path) {
    if (Array.isArray(body)) return body
    if (body && Array.isArray(body.data)) return body.data
    if (body && Array.isArray(body.results)) return body.results
    log.warn(`Quiver ${path} returned an unrecognised shape (${body === null ? 'null' : typeof body}${body && !Array.isArray(body) ? ': keys ' + Object.keys(body).slice(0, 6).join(',') : ''}). Treating as empty.`)
    return []
  }

  // Quiver's official Python client sends a hardcoded X-CSRFToken alongside the
  // Authorization header. Their backend is Django REST Framework, which can reject
  // requests without it. Mirroring their client exactly removes a variable.
  static CSRF = 'TyTJwjuEC7VV7mOqZ622haRaaUr0x0Ng4nrwSRFKQs7vdoBcJlK9qjAS69ghzhFu'

  async #fetchWith (scheme, url) {
    return fetch(url, {
      headers: {
        accept: 'application/json',
        'X-CSRFToken': QuiverClient.CSRF,
        Authorization: `${scheme} ${this.apiKey}`
      }
    })
  }

  /**
   * Probe several endpoints and report the raw status and body for each.
   * Distinguishes a bad key (every endpoint 401s identically) from a plan that
   * does not entitle one particular dataset (mixed statuses).
   */
  async probe () {
    const targets = [
      { name: 'live congress trading', path: '/beta/live/congresstrading' },
      { name: 'bulk congress trading', path: '/beta/bulk/congresstrading?page=1&page_size=1' },
      { name: 'politicians roster', path: '/beta/bulk/congress/politicians' },
      { name: 'historical by ticker', path: '/beta/historical/congresstrading/AAPL' }
    ]
    const results = []
    for (const t of targets) {
      for (const scheme of ['Token', 'Bearer']) {
        let status = null
        let body = ''
        try {
          const res = await this.#fetchWith(scheme, new URL(this.baseUrl + t.path))
          status = res.status
          body = (await res.text()).slice(0, 160)
        } catch (err) {
          body = `request failed: ${err.message}`
        }
        results.push({ ...t, scheme, status, body })
      }
    }
    return results
  }

  async #get (path, params = {}) {
    const url = new URL(this.baseUrl + path)
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }

    // Once a scheme authenticates, reuse it for the rest of the session.
    const candidates = this._scheme ? [this._scheme] : this._schemes
    let res
    for (const scheme of candidates) {
      res = await this.#fetchWith(scheme, url)
      if (res.status !== 401 && res.status !== 403) {
        if (!this._scheme) {
          this._scheme = scheme
          log.debug(`Quiver accepted the "${scheme}" auth scheme`)
        }
        break
      }
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Quiver rejected this request (HTTP ${res.status}) on ${path} using both the "Token" and "Bearer" schemes.\n` +
        '  This does NOT by itself mean your subscription is wrong. Possible causes:\n' +
        '    - the stored key is truncated or has stray characters (check the char count:\n' +
        '        node bin/cli.js secrets)\n' +
        '    - your plan does not entitle this particular dataset, even if others work\n' +
        '    - the key was regenerated on quiverquant.com and the stored copy is stale\n' +
        '  Run the per-endpoint diagnostic to tell these apart:\n' +
        '        node bin/cli.js quiver-check')
    }
    if (res.status === 429) {
      throw new Error('Quiver rate limit hit (HTTP 429). Increase POLL_MINUTES or reduce watchlist size.')
    }
    if (!res.ok) {
      throw new Error(`Quiver ${path} failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`)
    }
    return res.json()
  }

  // GET /beta/live/congresstrading -> recently disclosed congressional trades.
  async liveCongressTrading ({ representative, normalized = true } = {}) {
    const body = await this.#get('/beta/live/congresstrading', { representative, normalized })
    const rows = this.#rows(body, '/beta/live/congresstrading')
    log.debug('quiver live congresstrading', { count: rows.length })
    return rows
  }

  // GET /beta/bulk/congresstrading -> paginated history, useful for backfill/backtests.
  async bulkCongressTrading ({ bioguideId, date, ticker, page = 1, pageSize = 100, nonstock = false, normalized = true, version = 'V2' } = {}) {
    const body = await this.#get('/beta/bulk/congresstrading', {
      bioguide_id: bioguideId, date, ticker, page, page_size: pageSize, nonstock, normalized, version
    })
    return this.#rows(body, '/beta/bulk/congresstrading')
  }

  // GET /beta/bulk/congress/politicians -> roster, used to resolve names to BioGuide IDs.
  /** Fetch any dataset path and return its rows, whatever envelope it uses. */
  async fetchDataset (path, params = {}) {
    const body = await this.#get(path, params)
    return this.#rows(body, path)
  }

  /** Disclosed portfolio holdings, used for allocation-mirroring sizing. */
  async congressHoldings () {
    return this.fetchDataset('/beta/live/congressholdings')
  }

  async politicians () {
    // Verified against the live API: this endpoint wraps rows in {"data": [...]}.
    const body = await this.#get('/beta/bulk/congress/politicians', {})
    return this.#rows(body, '/beta/bulk/congress/politicians')
  }

  /**
   * Find the BioGuide ID to put in a watchlist.
   *
   * The roster endpoint carries null BioGuideID for some entries, and the
   * watchlist must match whatever the *trading* feed reports - so search the
   * live trade feed too and mark which IDs are confirmed usable.
   */
  async findPoliticians (query) {
    const q = String(query || '').toLowerCase().trim()
    const match = name => !q || String(name || '').toLowerCase().includes(q)
    const byId = new Map()

    const trades = await this.liveCongressTrading({ normalized: true }).catch(() => [])
    for (const t of trades) {
      if (!match(t.Representative)) continue
      const key = t.BioGuideID || `name:${t.Representative}`
      if (!byId.has(key)) {
        byId.set(key, {
          bioGuideId: t.BioGuideID || null,
          name: t.Representative,
          party: t.Party || null,
          chamber: t.House || null,
          seenTrading: true
        })
      }
    }

    const roster = await this.politicians().catch(() => [])
    for (const p of roster) {
      const name = p.Name || p.Representative
      if (!match(name)) continue
      const key = p.BioGuideID || `name:${name}`
      if (byId.has(key)) continue
      byId.set(key, {
        bioGuideId: p.BioGuideID || null,
        name,
        party: p.Party || null,
        chamber: p.House || p.Chamber || null,
        seenTrading: false
      })
    }

    // Entries confirmed in the trade feed are the ones a watchlist can match.
    return [...byId.values()].sort((a, b) => Number(b.seenTrading) - Number(a.seenTrading))
  }
}
