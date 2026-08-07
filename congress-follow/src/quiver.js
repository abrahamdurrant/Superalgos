import { config } from './config.js'
import { log } from './log.js'

// Quiver Quantitative REST client.
// Schema verified against https://api.quiverquant.com/docs/schema.json (OpenAPI 3.0.3).
export class QuiverClient {
  constructor ({ baseUrl = config.quiver.baseUrl, apiKey = config.quiver.apiKey } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.apiKey = apiKey
  }

  async #get (path, params = {}) {
    const url = new URL(this.baseUrl + path)
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' }
    })
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Quiver rejected the API key (HTTP ${res.status}). Check QUIVER_API_KEY and that your plan covers this dataset.`)
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
