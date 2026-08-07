import { randomUUID } from 'node:crypto'
import { config, loadWatchlist } from './config.js'
import { QuiverClient } from './quiver.js'
import { PublicClient } from './public-client.js'
import { Store } from './store.js'
import { evaluateAll, tradeKey, f } from './signals.js'
import { Settings } from './settings.js'
import { fetchEnabled } from './datasets.js'
import { buildAllocations, mirrorSize } from './holdings.js'
import { log } from './log.js'

export class Engine {
  constructor ({ store, quiver, broker, watchlist, settings } = {}) {
    this.watchlist = watchlist ?? loadWatchlist()
    this.store = store ?? new Store(config.storePath)
    this.quiver = quiver ?? new QuiverClient()
    this.broker = broker ?? new PublicClient()
    this.settings = settings ?? new Settings()
    this.datasetStatus = []
    this.allocations = null
  }

  /** Settings win over the watchlist file for anything the UI can change. */
  get sizingConfig () {
    return { ...this.watchlist.sizing, ...this.settings.data.sizing }
  }

  get isDryRun () {
    // The environment override is authoritative; see Settings.load().
    return this.settings.dryRun
  }

  /** Load disclosed portfolios so allocations can be mirrored. */
  async loadAllocations ({ force = false } = {}) {
    if (this.allocations && !force) return this.allocations
    try {
      const rows = await this.quiver.congressHoldings()
      this.allocations = buildAllocations(rows)
      this.allocations.fetchedAt = new Date().toISOString()
    } catch (err) {
      log.warn(`Could not load holdings for allocation sizing: ${err.message.split('\n')[0]}`)
      this.allocations = { byPolitician: new Map(), unparsed: [], error: err.message.split('\n')[0] }
    }
    return this.allocations
  }

  /**
   * Resolve the dollar size for a BUY, honouring the selected sizing mode.
   * Returns { notionalUsd, sizeSource, sizeNote } - never silently zero.
   */
  #resolveSize (signal) {
    const sizing = this.sizingConfig
    if (sizing.mode !== 'mirror') {
      return { notionalUsd: signal.notionalUsd, sizeSource: sizing.mode, sizeNote: null }
    }
    const bucket = signal.bucket ? this.settings.data.buckets?.[signal.bucket] : null
    const alloc = this.settings.allocationFor({
      actor: signal.trade && f.actor(signal.trade),
      dataset: signal.dataset
    })
    // Bucket capital wins if set, then any per-source allocation, then global.
    const capitalUsd = bucket?.capitalUsd ?? alloc.capitalUsd
    const r = mirrorSize({
      actor: signal.trade && f.actor(signal.trade),
      ticker: signal.ticker,
      allocations: this.allocations,
      capitalUsd,
      weight: signal.follow?.weight ?? 1,
      minNotionalUsd: sizing.minNotionalUsd ?? 0,
      maxNotionalUsd: sizing.maxNotionalUsd ?? Infinity
    })
    if (r.notionalUsd == null) {
      // Fall back to the flat size rather than queueing a zero-dollar order.
      return {
        notionalUsd: signal.notionalUsd,
        sizeSource: 'fixed-fallback',
        sizeNote: `mirror unavailable: ${r.reason}`
      }
    }
    return { notionalUsd: r.notionalUsd, sizeSource: 'mirror', sizeNote: `${r.basis.allocationPct}% of their portfolio x $${r.basis.capitalUsd}`, sizeBasis: r.basis }
  }

  /**
   * Evaluate the live feed WITHOUT persisting anything.
   *
   * Lets the UI show what would queue and, just as usefully, what is being
   * filtered out and why - so the watchlist and rules can be tuned before a
   * poll commits any of it to the store.
   */
  async preview () {
    const { rows: trades, status } = await fetchEnabled(this.quiver, { ...this.settings.data.datasets })
    this.datasetStatus = status
    if (this.sizingConfig.mode === 'mirror') await this.loadAllocations()
    const wl = { ...this.watchlist, rules: { ...this.watchlist.rules, datasets: this.settings.data.datasets } }
    const { signals, skipped } = evaluateAll(trades, wl)
    const seen = t => this.store.hasSeen(tradeKey(t))
    return {
      total: trades.length,
      wouldQueue: signals.filter(s => !seen(s.trade)),
      alreadyHandled: signals.filter(s => seen(s.trade)),
      datasets: status,
      filtered: skipped.map(s => ({
        reason: s.reason,
        reconsiderable: s.permanent === false,
        dataset: f.dataset(s.trade),
        ticker: f.ticker(s.trade),
        politician: f.actor(s.trade),
        transaction: f.transaction(s.trade),
        range: f.range(s.trade),
        transactionDate: f.transactionDate(s.trade),
        reportDate: f.reportDate(s.trade)
      }))
    }
  }

  /** Every disclosed trade by one person, newest first. */
  async actorTrades (actorName) {
    const { rows, status } = await fetchEnabled(this.quiver, { ...this.settings.data.datasets })
    this.datasetStatus = status
    const { tradesFor } = await import('./performance.js')
    const trades = tradesFor(rows, actorName)
    return {
      actor: actorName,
      trades,
      count: trades.length,
      allocation: this.settings.allocationFor({ actor: actorName })
    }
  }

  /**
   * Performance by source, from whatever return data the API actually carries.
   * See src/performance.js for exactly what these numbers are and are not.
   */
  async performance ({ groupBy = 'actor', sortBy = 'year', minTrades = 3 } = {}) {
    const { rows, status } = await fetchEnabled(this.quiver, { ...this.settings.data.datasets })
    this.datasetStatus = status
    const { analyse } = await import('./performance.js')
    const result = analyse(rows, { groupBy, sortBy, minTrades })
    return {
      ...result,
      groupBy,
      datasets: status,
      // Which sources can be measured at all, so the UI never implies otherwise.
      returnsAvailableFor: ['congresstrading'],
      allocations: this.settings.data.allocations ?? {}
    }
  }

  /**
   * Fetch new disclosures and queue anything actionable as a PENDING order.
   * Nothing is sent to the broker here - approval is a separate, explicit step.
   */
  async poll () {
    const enabled = { ...this.settings.data.datasets }
    const { rows: trades, status } = await fetchEnabled(this.quiver, enabled)
    this.datasetStatus = status
    const okCount = status.filter(s => s.ok).length
    log.info(`Fetched ${trades.length} rows from ${okCount}/${status.length} dataset(s)`)
    if (this.sizingConfig.mode === 'mirror') await this.loadAllocations()

    const fresh = trades.filter(t => !this.store.hasSeen(tradeKey(t)))
    const wl = { ...this.watchlist, rules: { ...this.watchlist.rules, datasets: this.settings.data.datasets } }
    const { signals, skipped } = evaluateAll(fresh, wl)

    const queued = []
    this.store.withLock(store => {
      // Only remember skips that can never become actionable. A skip caused by
      // config or by a lag that has not yet elapsed must be reconsidered later,
      // or editing the watchlist would be retroactively blind.
      for (const s of skipped) {
        if (s.permanent !== false) store.markSeen(s.key, { outcome: 'SKIPPED', reason: s.reason })
      }

      for (const signal of signals) {
        if (store.hasSeen(signal.key)) continue // another process queued it first
        const order = {
          id: randomUUID(),
          status: 'PENDING',
          createdAt: new Date().toISOString(),
          tradeKey: signal.key,
          side: signal.action,
          ticker: signal.ticker,
          ...(signal.action === 'BUY' ? this.#resolveSize(signal) : { notionalUsd: null, sizeSource: null, sizeNote: null }),
          sellMode: signal.sellMode,
          dataset: signal.dataset,
          bucket: signal.bucket,
          accountId: signal.accountId
            ?? (signal.bucket ? this.settings.data.routing?.byBucket?.[signal.bucket] : null)
            ?? this.settings.allocationFor({ actor: f.actor(signal.trade), dataset: signal.dataset }).accountId
            ?? null,
          politician: f.actor(signal.trade),
          bioGuideId: f.actorId(signal.trade),
          party: f.party(signal.trade),
          chamber: f.chamber(signal.trade),
          transactionDate: f.transactionDate(signal.trade),
          reportDate: f.reportDate(signal.trade),
          reportedRange: f.range(signal.trade),
          reportedAmount: signal.reportedAmount,
          lagDays: signal.lagDays,
          source: `quiver/${signal.dataset}`
        }
        store.putOrder(order)
        store.markSeen(signal.key, { outcome: 'QUEUED', orderId: order.id })
        queued.push(order)
      }
    })

    const deferred = skipped.filter(s => s.permanent === false).length
    log.info(`Queued ${queued.length} pending order(s); skipped ${skipped.length} (${deferred} re-checkable later); ${trades.length - fresh.length} already seen`)
    return { queued, skipped, total: trades.length }
  }

  /** Checks that depend on live account state, run at approval time. */
  async #checkGuardrails (order) {
    const g = this.watchlist.guardrails
    const problems = []

    const notional = order.sizeOverrideUsd ?? order.notionalUsd
    if (order.side === 'BUY' && notional > g.maxNotionalPerTrade) {
      problems.push(`notional $${notional} exceeds maxNotionalPerTrade $${g.maxNotionalPerTrade}`)
    }
    if (order.side === 'BUY' && !(notional > 0)) {
      problems.push('no size resolved for this order')
    }

    const todayStart = new Date().toISOString().slice(0, 10)
    this.store.reload() // guardrails must see other processes' submissions
    const todayCount = this.store.countOrdersSince(todayStart)
    if (todayCount >= g.maxOrdersPerDay) {
      problems.push(`already submitted ${todayCount} order(s) today, limit is ${g.maxOrdersPerDay}`)
    }

    let positions = {}
    try {
      positions = await this.broker.getPositions()
    } catch (err) {
      // Never let a positions lookup failure silently green-light a sell.
      problems.push(`could not read positions from Public: ${err.message}`)
      return { problems, positions }
    }

    if (order.side === 'SELL' && g.requireHeldPositionToSell) {
      const held = positions[order.ticker] ?? 0
      if (held <= 0) {
        problems.push(`no open position in ${order.ticker} to sell (IRAs cannot short)`)
      }
    }

    if (order.side === 'BUY' && !positions[order.ticker]) {
      const open = Object.keys(positions).length
      if (open >= g.maxOpenPositions) {
        problems.push(`already holding ${open} positions, limit is ${g.maxOpenPositions}`)
      }
    }

    return { problems, positions }
  }

  /**
   * Submit a previously queued order after explicit human approval.
   * Honours DRY_RUN, which builds and logs the exact payload without sending it.
   */
  async approve (orderId, { force = false } = {}) {
    const order = this.store.getOrder(orderId)
    if (!order) throw new Error(`No order matching "${orderId}".`)
    if (order.status !== 'PENDING') throw new Error(`Order ${order.id} is ${order.status}, not PENDING.`)

    const { problems, positions } = await this.#checkGuardrails(order)
    if (problems.length > 0 && !force) {
      const err = new Error(`Guardrails blocked this order:\n  - ${problems.join('\n  - ')}\nRe-run with --force to override.`)
      err.problems = problems
      throw err
    }
    if (problems.length > 0) log.warn('Guardrails overridden with --force', { problems })

    const brokerOrderId = order.brokerOrderId ?? randomUUID()
    // A per-order override beats the computed size; a per-order account beats
    // the bucket route, which beats the default.
    const notional = order.sizeOverrideUsd ?? order.notionalUsd
    let body
    if (order.side === 'BUY') {
      body = this.broker.buildOrderBody({
        orderId: brokerOrderId, symbol: order.ticker, side: 'BUY', amount: notional
      })
    } else {
      const held = positions[order.ticker] ?? 0
      const qty = order.sellMode === 'full' ? held : Math.floor(held / 2)
      if (!(qty > 0)) throw new Error(`Nothing to sell for ${order.ticker}.`)
      body = this.broker.buildOrderBody({
        orderId: brokerOrderId, symbol: order.ticker, side: 'SELL', quantity: qty
      })
    }

    if (this.isDryRun) {
      // Deliberately leave the order PENDING. Marking it consumed would make the
      // documented workflow - dry-run first, then flip DRY_RUN=false - place
      // nothing at all, because approve() only accepts PENDING and poll() will
      // never re-queue a disclosure it has already recorded as seen.
      this.store.withLock(store => {
        const o = store.getOrder(order.id)
        o.lastDryRunAt = new Date().toISOString()
        o.lastDryRunBody = body
        store.putOrder(o)
      })
      log.warn('DRY_RUN: not sent. The order stays PENDING so it can be approved for real later.', body)
      return { order: this.store.getOrder(order.id), dryRun: true, body }
    }

    // Persist an in-flight marker BEFORE the request. If the process dies mid-flight
    // the order is not left looking untouched, and the same idempotency key is
    // reused on retry so the broker can dedupe.
    this.store.withLock(store => {
      const o = store.getOrder(order.id)
      o.status = 'SUBMITTING'
      o.brokerOrderId = brokerOrderId
      o.requestBody = body
      o.submitStartedAt = new Date().toISOString()
      store.putOrder(o)
    })

    let response
    try {
      response = await this.broker.placeOrder(body, { accountId: order.accountId ?? undefined })
    } catch (err) {
      // The request may still have reached the broker. Never silently revert to
      // PENDING - that invites a duplicate submission under a fresh key.
      this.store.withLock(store => {
        const o = store.getOrder(order.id)
        o.status = 'NEEDS_REVIEW'
        o.submitError = err.message
        store.putOrder(o)
      })
      throw new Error(
        `Submitting ${order.side} ${order.ticker} failed: ${err.message}\n` +
        `  The order may or may not have reached Public. It is marked NEEDS_REVIEW and\n` +
        `  will NOT be resubmitted automatically. Check your Public account, then:\n` +
        `    congress-follow sync                 (re-checks broker order ${brokerOrderId})\n` +
        `    congress-follow reject ${order.id.slice(0, 8)}   (if it never landed and you do not want it)`)
    }

    const saved = this.store.withLock(store => {
      const o = store.getOrder(order.id)
      o.status = 'SUBMITTED'
      o.submittedAt = new Date().toISOString()
      o.brokerResponse = response
      store.putOrder(o)
      return o
    })
    log.info(`Submitted ${order.side} ${order.ticker}`, { brokerOrderId })
    return { order: saved, dryRun: false, body, response }
  }

  /**
   * One automation cycle: poll, then submit everything that passes the
   * guardrails. Returns a report rather than throwing, so a single bad order
   * cannot stop the rest.
   *
   * Automation is gated on placeOrder having succeeded at least once. That path
   * has never run against real Public infrastructure, and a first execution
   * discovered by an unattended loop is a bad way to find out it is wrong.
   * Clear the gate in Settings once you have submitted one order by hand.
   */
  async runAutomation () {
    const auto = this.settings.data.automation ?? {}
    if (!auto.enabled) return { ran: false, reason: 'automation disabled' }

    if (!this.isDryRun && auto.requireProvenSubmitPath) {
      const proven = this.store.reload().listOrders()
        .some(o => o.brokerResponse && ['SUBMITTED', 'FILLED', 'CLOSED'].includes(o.status))
      if (!proven) {
        return {
          ran: false,
          reason: 'No order has ever been submitted successfully, so the submit path is unproven. ' +
                  'Approve one manually first, or turn off requireProvenSubmitPath in Settings.'
        }
      }
    }

    const polled = await this.poll()
    const results = []
    for (const order of this.store.reload().listOrders('PENDING')) {
      try {
        const r = await this.approve(order.id)
        results.push({ id: order.id, ticker: order.ticker, side: order.side, ok: true, dryRun: r.dryRun })
      } catch (err) {
        results.push({ id: order.id, ticker: order.ticker, side: order.side, ok: false, error: err.message.split('\n')[0] })
      }
    }
    log.info(`Automation: queued ${polled.queued.length}, submitted ${results.filter(r => r.ok).length}, blocked ${results.filter(r => !r.ok).length}`)
    return { ran: true, queued: polled.queued.length, results }
  }

  reject (orderId, reason = 'rejected by user') {
    const order = this.store.getOrder(orderId)
    if (!order) throw new Error(`No order matching "${orderId}".`)
    if (order.status !== 'PENDING') throw new Error(`Order ${order.id} is ${order.status}, not PENDING.`)
    return this.store.withLock(store => {
      const o = store.getOrder(orderId)
      o.status = 'REJECTED'
      o.rejectedAt = new Date().toISOString()
      o.rejectReason = reason
      store.putOrder(o)
      return o
    })
  }

  /** Refresh the broker-side status of everything we have submitted. */
  /**
   * Queue an order for a ticker directly, bypassing the watchlist.
   *
   * This is how a row seen while browsing any dataset becomes a trade: pick the
   * ticker, the dollar amount and the account. It still lands as PENDING and
   * still passes every guardrail at approval, so it is not a back door around
   * the safety model - only around signal generation.
   */
  queueManualOrder ({ ticker, notionalUsd, accountId = null, bucket = null, side = 'BUY', note = null, source = 'manual' } = {}) {
    const sym = String(ticker ?? '').trim().toUpperCase()
    if (!/^[A-Z][A-Z.\-]{0,9}$/.test(sym)) throw new Error(`"${ticker}" is not a plausible ticker symbol.`)
    if (!['BUY', 'SELL'].includes(side)) throw new Error('Side must be BUY or SELL.')
    const amount = side === 'BUY' ? Number(notionalUsd) : null
    if (side === 'BUY' && !(Number.isFinite(amount) && amount > 0)) {
      throw new Error('A BUY needs a positive dollar amount.')
    }
    return this.store.withLock(store => {
      const order = {
        id: randomUUID(),
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        tradeKey: null,          // manual orders are not tied to a disclosure
        side,
        ticker: sym,
        notionalUsd: amount,
        sizeSource: 'manual',
        sizeNote: note,
        sellMode: side === 'SELL' ? 'full' : null,
        dataset: source,
        bucket,
        accountId: accountId ?? this.settings.data.routing?.defaultAccountId ?? null,
        politician: null,
        manual: true,
        source
      }
      store.putOrder(order)
      return order
    })
  }

  /** Adjust a pending order before approval: size, destination account, bucket. */
  amend (orderId, { sizeOverrideUsd, accountId, bucket } = {}) {
    return this.store.withLock(store => {
      const o = store.getOrder(orderId)
      if (!o) throw new Error(`No order matching "${orderId}".`)
      if (o.status !== 'PENDING') throw new Error(`Order ${o.id} is ${o.status}, not PENDING.`)
      if (sizeOverrideUsd !== undefined) {
        const n = sizeOverrideUsd === null ? null : Number(sizeOverrideUsd)
        if (n !== null && !(Number.isFinite(n) && n > 0)) throw new Error('Size override must be a positive number.')
        o.sizeOverrideUsd = n
      }
      if (accountId !== undefined) o.accountId = accountId || null
      if (bucket !== undefined) o.bucket = bucket || null
      o.amendedAt = new Date().toISOString()
      store.putOrder(o)
      return o
    })
  }

  async sync () {
    // SUBMITTING and NEEDS_REVIEW are in-flight or unresolved: they carry a
    // brokerOrderId and must be chased, not ignored.
    const submitted = [
      ...this.store.listOrders('SUBMITTED'),
      ...this.store.listOrders('SUBMITTING'),
      ...this.store.listOrders('NEEDS_REVIEW')
    ].filter(o => o.brokerOrderId)
    for (const order of submitted) {
      try {
        const remote = await this.broker.getOrder(order.brokerOrderId)
        const state = String(remote?.status ?? remote?.state ?? '').toUpperCase()
        this.store.withLock(store => {
          const o = store.getOrder(order.id)
          o.brokerStatus = remote
          // A broker record proves it landed, so an unresolved order resolves here.
          o.submittedAt ??= o.submitStartedAt ?? new Date().toISOString()
          if (state.includes('FILLED') && !state.includes('PARTIAL')) o.status = 'FILLED'
          else if (state.includes('CANCEL') || state.includes('REJECT')) o.status = 'CLOSED'
          else o.status = 'SUBMITTED'
          store.putOrder(o)
        })
      } catch (err) {
        log.warn(`Could not refresh order ${order.brokerOrderId}: ${err.message}`)
      }
    }
    return submitted
  }
}

