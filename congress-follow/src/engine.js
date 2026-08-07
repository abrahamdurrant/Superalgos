import { randomUUID } from 'node:crypto'
import { config, loadWatchlist } from './config.js'
import { QuiverClient } from './quiver.js'
import { PublicClient } from './public-client.js'
import { Store } from './store.js'
import { evaluateAll, tradeKey } from './signals.js'
import { log } from './log.js'

export class Engine {
  constructor ({ store, quiver, broker, watchlist } = {}) {
    this.watchlist = watchlist ?? loadWatchlist()
    this.store = store ?? new Store(config.storePath)
    this.quiver = quiver ?? new QuiverClient()
    this.broker = broker ?? new PublicClient()
  }

  /**
   * Evaluate the live feed WITHOUT persisting anything.
   *
   * Lets the UI show what would queue and, just as usefully, what is being
   * filtered out and why - so the watchlist and rules can be tuned before a
   * poll commits any of it to the store.
   */
  async preview () {
    const trades = await this.quiver.liveCongressTrading({ normalized: true })
    const { signals, skipped } = evaluateAll(trades, this.watchlist)
    const seen = t => this.store.hasSeen(tradeKey(t))
    return {
      total: trades.length,
      wouldQueue: signals.filter(s => !seen(s.trade)),
      alreadyHandled: signals.filter(s => seen(s.trade)),
      filtered: skipped.map(s => ({
        reason: s.reason,
        reconsiderable: s.permanent === false,
        ticker: s.trade.Ticker,
        politician: s.trade.Representative,
        transaction: s.trade.Transaction,
        range: s.trade.Range,
        transactionDate: s.trade.TransactionDate,
        reportDate: s.trade.ReportDate
      }))
    }
  }

  /**
   * Fetch new disclosures and queue anything actionable as a PENDING order.
   * Nothing is sent to the broker here - approval is a separate, explicit step.
   */
  async poll () {
    const trades = await this.quiver.liveCongressTrading({ normalized: true })
    log.info(`Fetched ${trades.length} disclosed trades from Quiver`)

    const fresh = trades.filter(t => !this.store.hasSeen(tradeKey(t)))
    const { signals, skipped } = evaluateAll(fresh, this.watchlist)

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
          notionalUsd: signal.notionalUsd,
          sellMode: signal.sellMode,
          politician: signal.trade.Representative,
          bioGuideId: signal.trade.BioGuideID,
          party: signal.trade.Party,
          chamber: signal.trade.House,
          transactionDate: signal.trade.TransactionDate,
          reportDate: signal.trade.ReportDate,
          reportedRange: signal.trade.Range,
          reportedAmount: signal.reportedAmount,
          lagDays: signal.lagDays,
          source: 'quiver/live/congresstrading'
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

    if (order.side === 'BUY' && order.notionalUsd > g.maxNotionalPerTrade) {
      problems.push(`notional $${order.notionalUsd} exceeds maxNotionalPerTrade $${g.maxNotionalPerTrade}`)
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
    let body
    if (order.side === 'BUY') {
      body = this.broker.buildOrderBody({
        orderId: brokerOrderId, symbol: order.ticker, side: 'BUY', amount: order.notionalUsd
      })
    } else {
      const held = positions[order.ticker] ?? 0
      const qty = order.sellMode === 'full' ? held : Math.floor(held / 2)
      if (!(qty > 0)) throw new Error(`Nothing to sell for ${order.ticker}.`)
      body = this.broker.buildOrderBody({
        orderId: brokerOrderId, symbol: order.ticker, side: 'SELL', quantity: qty
      })
    }

    if (config.dryRun) {
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
      response = await this.broker.placeOrder(body)
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

