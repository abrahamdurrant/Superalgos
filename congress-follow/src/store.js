import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, openSync, closeSync, unlinkSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { log } from './log.js'

const EMPTY = { seenTrades: {}, orders: {}, meta: { createdAt: null } }

// A lock older than this is assumed to belong to a dead process.
const STALE_LOCK_MS = 30_000
const LOCK_RETRY_MS = 50
const LOCK_TIMEOUT_MS = 10_000

export class Store {
  constructor (path) {
    this.path = path
    this.lockPath = `${path}.lock`
    this.reload()
  }

  /**
   * Re-read from disk, discarding any in-memory copy.
   *
   * Every command except `watch` is a short-lived process, but `watch` holds one
   * Store alive for hours. Without reloading, its stale snapshot would be written
   * back over any state a concurrent `approve` had committed - silently reverting
   * a SUBMITTED order to PENDING and erasing its idempotency key, which allows the
   * same disclosure to be filled twice under two different order ids.
   */
  reload () {
    this.data = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : structuredClone(EMPTY)
    for (const key of Object.keys(EMPTY)) this.data[key] ??= structuredClone(EMPTY[key])
    this.data.meta.createdAt ??= new Date().toISOString()
    return this
  }

  #acquireLock () {
    const deadline = Date.now() + LOCK_TIMEOUT_MS
    for (;;) {
      try {
        // 'wx' fails if the file exists, which makes creation the atomic test.
        closeSync(openSync(this.lockPath, 'wx'))
        return
      } catch (err) {
        if (err.code !== 'EEXIST') throw err
        let age = 0
        try { age = Date.now() - statSync(this.lockPath).mtimeMs } catch { age = Infinity }
        if (age > STALE_LOCK_MS) {
          log.warn(`Removing a stale store lock (${Math.round(age / 1000)}s old).`)
          try { unlinkSync(this.lockPath) } catch { /* another process won the race */ }
          continue
        }
        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for the store lock at ${this.lockPath}. Another congress-follow process may be stuck; remove the file if so.`)
        }
        // Busy-wait briefly. Node has no portable synchronous sleep, and these
        // critical sections are sub-millisecond file writes.
        const until = Date.now() + LOCK_RETRY_MS
        while (Date.now() < until) { /* spin */ }
      }
    }
  }

  #releaseLock () {
    try { unlinkSync(this.lockPath) } catch { /* already gone */ }
  }

  /**
   * Run a read-modify-write under an exclusive lock, against fresh data.
   * All mutations must happen inside the callback; anything mutated outside it
   * can be lost when another process writes.
   */
  withLock (fn) {
    this.#acquireLock()
    try {
      this.reload()
      const result = fn(this)
      this.#save()
      return result
    } finally {
      this.#releaseLock()
    }
  }

  // Write to a temp file then rename, so a crash mid-write cannot corrupt the store.
  #save () {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 })
    renameSync(tmp, this.path)
  }

  hasSeen (key) { return Boolean(this.data.seenTrades[key]) }

  markSeen (key, note) {
    this.data.seenTrades[key] = { at: new Date().toISOString(), ...note }
  }

  putOrder (order) {
    this.data.orders[order.id] = order
    return order
  }

  getOrder (id) {
    if (this.data.orders[id]) return this.data.orders[id]
    // Allow unambiguous short-prefix lookup for CLI ergonomics.
    const matches = Object.keys(this.data.orders).filter(k => k.startsWith(id))
    if (matches.length === 1) return this.data.orders[matches[0]]
    if (matches.length > 1) throw new Error(`Ambiguous order id "${id}" matches ${matches.length} orders.`)
    return null
  }

  listOrders (status) {
    const all = Object.values(this.data.orders)
    const filtered = status ? all.filter(o => o.status === status) : all
    return filtered.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  /**
   * Count real submissions since `isoDate`.
   *
   * Keyed on submittedAt rather than current status: an order the broker later
   * cancelled or rejected still consumed a submission, and counting by status
   * let the daily cap refill during exactly the retry storm it exists to contain.
   */
  countOrdersSince (isoDate) {
    return Object.values(this.data.orders)
      .filter(o => o.submittedAt && o.submittedAt >= isoDate && o.status !== 'DRY_RUN')
      .length
  }
}
