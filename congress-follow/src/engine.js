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
   * Fetch new disclosures and queue anything actionable as a PENDING order.
   * Nothing is sent to the broker here - approval is a separate, explicit step.
   */
  async poll () {
    const trades = await this.quiver.liveCongressTrading({ normalized: true })
    log.info(`Fetched ${trades.length} disclosed trades from Quiver`)

    const fresh = trades.filter(t => !this.store.hasSeen(tradeKey(t)))
    const { signals, skipped } = evaluateAll(fresh, this.watchlist)

    // Record every skip so a disclosure is never reconsidered on the next poll.
    for (const s of skipped) this.store.markSeen(s.key, { outcome: 'SKIPPED', reason: s.reason })

    const queued = []
    for (const signal of signals) {
      // The order UUID is generated and persisted *before* submission so that a
      // retry after a crash reuses it and Public dedupes rather than double-fills.
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
      this.store.putOrder(order)
      this.store.markSeen(signal.key, { outcome: 'QUEUED', orderId: order.id })
      queued.push(order)
    }

    this.store.save()
    log.info(`Queued ${queued.length} pending order(s); skipped ${skipped.length}; ${trades.length - fresh.length} already seen`)
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

    // Persist the UUID before the network call so a crash cannot orphan it.
    order.brokerOrderId = brokerOrderId
    order.requestBody = body
    this.store.putOrder(order)
    this.store.save()

    if (config.dryRun) {
      order.status = 'DRY_RUN'
      order.submittedAt = new Date().toISOString()
      this.store.putOrder(order)
      this.store.save()
      log.warn(`DRY_RUN: not sent. Set DRY_RUN=false in .env to trade for real.`, body)
      return { order, dryRun: true, body }
    }

    const response = await this.broker.placeOrder(body)
    order.status = 'SUBMITTED'
    order.submittedAt = new Date().toISOString()
    order.brokerResponse = response
    this.store.putOrder(order)
    this.store.save()
    log.info(`Submitted ${order.side} ${order.ticker}`, { brokerOrderId })
    return { order, dryRun: false, body, response }
  }

  reject (orderId, reason = 'rejected by user') {
    const order = this.store.getOrder(orderId)
    if (!order) throw new Error(`No order matching "${orderId}".`)
    if (order.status !== 'PENDING') throw new Error(`Order ${order.id} is ${order.status}, not PENDING.`)
    order.status = 'REJECTED'
    order.rejectedAt = new Date().toISOString()
    order.rejectReason = reason
    this.store.putOrder(order)
    this.store.save()
    return order
  }

  /** Refresh the broker-side status of everything we have submitted. */
  async sync () {
    const submitted = this.store.listOrders('SUBMITTED')
    for (const order of submitted) {
      try {
        const remote = await this.broker.getOrder(order.brokerOrderId)
        order.brokerStatus = remote
        const state = String(remote?.status ?? remote?.state ?? '').toUpperCase()
        if (state.includes('FILLED') && !state.includes('PARTIAL')) order.status = 'FILLED'
        else if (state.includes('CANCEL') || state.includes('REJECT')) order.status = 'CLOSED'
        this.store.putOrder(order)
      } catch (err) {
        log.warn(`Could not refresh order ${order.brokerOrderId}: ${err.message}`)
      }
    }
    this.store.save()
    return submitted
  }
}

