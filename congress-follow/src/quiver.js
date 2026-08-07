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

  async #fetchWith (scheme, url) {
    return fetch(url, {
      headers: { Authorization: `${scheme} ${this.apiKey}`, Accept: 'application/json' }
    })
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
        `Quiver rejected the API key (HTTP ${res.status}) using both the "Token" and "Bearer" auth schemes.\n` +
        '  The key itself is being sent correctly, so this is almost certainly the subscription:\n' +
        '  the Quiver API has no free tier, and a web Premium plan does NOT include API access.\n' +
        '  Congress Trading requires the API Hobbyist plan ($30/mo, or $25/mo billed annually).\n' +
        '  Verify at https://api.quiverquant.com/pricing/ and check the key at https://www.quiverquant.com/api/')
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
    const rows = await this.#get('/beta/live/congresstrading', { representative, normalized })
    log.debug('quiver live congresstrading', { count: Array.isArray(rows) ? rows.length : 0 })
    return Array.isArray(rows) ? rows : []
  }

  // GET /beta/bulk/congresstrading -> paginated history, useful for backfill/backtests.
  async bulkCongressTrading ({ bioguideId, date, ticker, page = 1, pageSize = 100, nonstock = false, normalized = true, version = 'V2' } = {}) {
    const rows = await this.#get('/beta/bulk/congresstrading', {
      bioguide_id: bioguideId, date, ticker, page, page_size: pageSize, nonstock, normalized, version
    })
    return Array.isArray(rows) ? rows : []
  }

  // GET /beta/bulk/congress/politicians -> roster, used to resolve names to BioGuide IDs.
  async politicians () {
    const rows = await this.#get('/beta/bulk/congress/politicians', {})
    return Array.isArray(rows) ? rows : []
  }
}
