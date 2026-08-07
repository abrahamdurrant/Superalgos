import { randomUUID } from 'node:crypto'
import { config } from './config.js'
import { log } from './log.js'

// Public.com brokerage client.
// Auth flow, account lookup and the place-order body are taken verbatim from
// https://public.com/api/docs/quickstart and .../resources/order-placement/place-order.
export class PublicClient {
  constructor ({ baseUrl = config.public.baseUrl, secretKey, accountId = config.public.accountId } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this._secretKey = secretKey
    this.accountId = accountId
    this._token = null
    this._tokenExpiresAt = 0
  }

  get secretKey () { return this._secretKey ?? config.public.secretKey }

  async #accessToken () {
    // Refresh a minute early so a token never expires mid-request.
    if (this._token && Date.now() < this._tokenExpiresAt - 60_000) return this._token
    const validityInMinutes = config.public.tokenValidityMinutes
    const res = await fetch(`${this.baseUrl}/userapiauthservice/personal/access-tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ secret: this.secretKey, validityInMinutes })
    })
    if (!res.ok) {
      throw new Error(`Public auth failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}. Regenerate the secret at Settings > Security > API.`)
    }
    const body = await res.json()
    const token = body.accessToken || body.access_token
    if (!token) throw new Error(`Public auth returned no accessToken: ${JSON.stringify(body).slice(0, 200)}`)
    this._token = token
    this._tokenExpiresAt = Date.now() + validityInMinutes * 60_000
    log.debug('public access token refreshed', { validityInMinutes })
    return token
  }

  async request (path, { method = 'GET', body } = {}) {
    const token = await this.#accessToken()
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
    const text = await res.text()
    let parsed = null
    try { parsed = text ? JSON.parse(text) : null } catch { parsed = { raw: text } }
    if (!res.ok) {
      const err = new Error(`Public ${method} ${path} failed: HTTP ${res.status} ${text.slice(0, 300)}`)
      err.status = res.status
      err.body = parsed
      throw err
    }
    return parsed
  }

  // GET /userapigateway/trading/account -> { accounts: [{ accountId, accountType, ... }] }
  async getAccounts () {
    const body = await this.request('/userapigateway/trading/account')
    return body?.accounts ?? (Array.isArray(body) ? body : [body])
  }

  // Resolve which account to trade. Prefers an explicitly configured id.
  async resolveAccountId () {
    if (this.accountId) return this.accountId
    const accounts = await this.getAccounts()
    if (accounts.length === 0) throw new Error('Public returned no accounts for this secret key.')
    if (accounts.length > 1) {
      const summary = accounts.map(a => `${a.accountId} (${a.accountType ?? 'unknown type'})`).join(', ')
      throw new Error(`Multiple Public accounts found: ${summary}. Set PUBLIC_ACCOUNT_ID in .env to the one you want to trade.`)
    }
    this.accountId = accounts[0].accountId
    return this.accountId
  }

  async getPortfolio () {
    const accountId = await this.resolveAccountId()
    return this.request(`/userapigateway/trading/${accountId}/portfolio/v2`)
  }

  // Normalise the portfolio payload into { SYMBOL: quantity }.
  async getPositions () {
    const portfolio = await this.getPortfolio()
    const raw = portfolio?.positions ?? portfolio?.equity ?? portfolio?.holdings ?? portfolio?.equityPositions

    // Fail closed. This endpoint's shape is unverified, and silently returning {}
    // would report a fully invested account as empty - which disables the
    // maxOpenPositions cap and makes every held position look unsellable.
    if (!Array.isArray(raw)) {
      throw new Error(
        'Could not read positions: Public returned an unrecognised portfolio shape ' +
        `(top-level keys: ${portfolio && typeof portfolio === 'object' ? Object.keys(portfolio).slice(0, 8).join(', ') || 'none' : typeof portfolio}).\n` +
        '  Refusing to continue rather than treat this as an empty account, which would\n' +
        '  disable the open-position limit and block every sell.\n' +
        '  Report the shape above so the parser can be corrected.')
    }

    const positions = {}
    for (const p of raw) {
      const symbol = p.symbol ?? p.instrument?.symbol
      const qty = Number(p.quantity ?? p.shares ?? p.openQuantity ?? 0)
      if (symbol && qty) positions[symbol] = (positions[symbol] ?? 0) + qty
    }
    return positions
  }

  /**
   * Build a place-order body. Exposed separately so DRY_RUN can show the exact
   * payload that would be sent, and so the orderId can be persisted before submission.
   */
  buildOrderBody ({ orderId = randomUUID(), symbol, side, quantity, amount, orderType = 'MARKET', limitPrice, stopPrice, timeInForce = 'DAY', session = 'CORE', useMargin = false }) {
    if (!symbol) throw new Error('buildOrderBody requires a symbol')
    if ((quantity == null) === (amount == null)) {
      throw new Error('buildOrderBody requires exactly one of quantity or amount')
    }
    if ((orderType === 'LIMIT' || orderType === 'STOP_LIMIT') && limitPrice == null) {
      throw new Error(`${orderType} orders require a limitPrice`)
    }
    if ((orderType === 'STOP' || orderType === 'STOP_LIMIT') && stopPrice == null) {
      throw new Error(`${orderType} orders require a stopPrice`)
    }
    return {
      orderId,
      instrument: { symbol, type: 'EQUITY' },
      orderSide: side,
      orderType,
      expiration: { timeInForce },
      ...(quantity != null ? { quantity: String(quantity) } : {}),
      ...(amount != null ? { amount: String(amount) } : {}),
      ...(limitPrice != null ? { limitPrice: String(limitPrice) } : {}),
      ...(stopPrice != null ? { stopPrice: String(stopPrice) } : {}),
      equityMarketSession: session,
      // IRAs are cash accounts and cannot use margin. Public defaults useMargin to
      // true, so this must be sent explicitly or IRA orders will be rejected.
      useMargin
    }
  }

  // POST /userapigateway/trading/{accountId}/order
  // orderId is the idempotency key: resubmitting the same UUID will not double-fill.
  async placeOrder (orderBody) {
    const accountId = await this.resolveAccountId()
    return this.request(`/userapigateway/trading/${accountId}/order`, { method: 'POST', body: orderBody })
  }

  async getOrder (orderId) {
    const accountId = await this.resolveAccountId()
    return this.request(`/userapigateway/trading/${accountId}/order/${orderId}`)
  }

  async cancelOrder (orderId) {
    const accountId = await this.resolveAccountId()
    return this.request(`/userapigateway/trading/${accountId}/order/${orderId}`, { method: 'DELETE' })
  }
}
