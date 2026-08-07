import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'

const EMPTY = { seenTrades: {}, orders: {}, meta: { createdAt: null } }

export class Store {
  constructor (path) {
    this.path = path
    this.data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : structuredClone(EMPTY)
    for (const key of Object.keys(EMPTY)) this.data[key] ??= structuredClone(EMPTY[key])
    this.data.meta.createdAt ??= new Date().toISOString()
  }

  // Write to a temp file then rename, so a crash mid-write cannot corrupt the store.
  save () {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
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

  countOrdersSince (isoDate, statuses = ['SUBMITTED', 'FILLED']) {
    return Object.values(this.data.orders)
      .filter(o => statuses.includes(o.status) && (o.submittedAt || '') >= isoDate).length
  }
}
