import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveSecret } from './secrets.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Minimal .env reader so the tool has no dependencies.
function loadDotEnv () {
  const path = resolve(root, '.env')
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (process.env[key] !== undefined) continue // real env wins
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    // An empty placeholder (KEY=) counts as unset. Otherwise the commented-out
    // stub shipped in .env.example would shadow a real value added lower down
    // the file, and the setting would silently never take effect.
    if (value === '') continue
    process.env[key] = value
    process.env[`__${key}_FROM_DOTENV`] = '1'
  }
}
loadDotEnv()

const DEFAULT_RULES = {
  sides: ['BUY', 'SELL'],
  tickerAllowlist: [],
  tickerBlocklist: [],
  minDisclosureLagDays: 0,
  maxDisclosureLagDays: 60,
  allowedTickerTypes: ['CS', 'ST']
}

const DEFAULT_SIZING = { mode: 'fixed', notionalUsd: 250, tiers: [], sellMode: 'full' }

const DEFAULT_GUARDRAILS = {
  maxNotionalPerTrade: 1000,
  maxOrdersPerDay: 10,
  maxOpenPositions: 25,
  requireHeldPositionToSell: true
}

export const watchlistPath = () => process.env.WATCHLIST_PATH || resolve(root, 'config/watchlist.json')

/** The file exactly as written, so edits preserve comments and unknown keys. */
export function readWatchlistFile (path = watchlistPath()) {
  if (!existsSync(path)) throw new Error(`Watchlist not found at ${path}.`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function writeWatchlistFile (data, path = watchlistPath()) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
  return data
}

export function loadWatchlist (path = process.env.WATCHLIST_PATH || resolve(root, 'config/watchlist.json')) {
  if (!existsSync(path)) {
    throw new Error(`Watchlist not found at ${path}. Copy config/watchlist.example.json to config/watchlist.json and edit it.`)
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const follow = (parsed.follow || []).filter(f => f.enabled !== false)
  return {
    follow,
    rules: { ...DEFAULT_RULES, ...(parsed.rules || {}) },
    sizing: { ...DEFAULT_SIZING, ...(parsed.sizing || {}) },
    guardrails: { ...DEFAULT_GUARDRAILS, ...(parsed.guardrails || {}) }
  }
}

export const config = {
  root,
  storePath: process.env.STORE_PATH || resolve(root, 'data/store.json'),
  // DRY_RUN defaults to true: you must opt in to sending real orders.
  // Read on each access so the value always reflects the current environment.
  get dryRun () { return (process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false' },
  quiver: {
    baseUrl: process.env.QUIVER_BASE_URL || 'https://api.quiverquant.com',
    get apiKey () { return resolveSecret('QUIVER_API_KEY').value }
  },
  public: {
    baseUrl: process.env.PUBLIC_BASE_URL || 'https://api.public.com',
    get secretKey () { return resolveSecret('PUBLIC_SECRET_KEY').value },
    accountId: process.env.PUBLIC_ACCOUNT_ID || null,
    tokenValidityMinutes: Number(process.env.PUBLIC_TOKEN_MINUTES || 60)
  }
}
