import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const DEFAULTS = {
  // Live trading is opt-in and stays opt-in.
  dryRun: true,

  automation: {
    enabled: false,
    // Automation submits without a click, so it is gated on placeOrder having
    // actually worked once. That endpoint has never run against real Public
    // infrastructure; proving it manually before handing over the keys is
    // cheap. Turn this off in Settings if you want to skip the gate.
    requireProvenSubmitPath: true,
    pollMinutes: 60
  },

  sizing: {
    // 'mirror'  - match the politician's portfolio allocation
    // 'fixed'   - a flat notional per trade
    // 'tiered'  - scale by the disclosed amount band
    mode: 'mirror',
    capitalUsd: 10000,     // the base that allocation percentages apply to
    minNotionalUsd: 25,    // below this a mirrored slice is not worth the spread
    maxNotionalUsd: 1000,
    sellMode: 'full'
  },

  routing: {
    // Where orders go when nothing more specific applies.
    defaultAccountId: null,
    // bucketName -> accountId
    byBucket: {}
  },

  // Named strategies with their own capital and limits.
  buckets: {},

  // datasetId -> enabled. Unknown ids are ignored.
  datasets: { congresstrading: true }
}

function deepMerge (base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch ?? base
  const out = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
      ? deepMerge(base[k], v)
      : v
  }
  return out
}

export class Settings {
  constructor (path = process.env.SETTINGS_PATH || resolve(root, 'data/settings.json')) {
    this.path = path
    this.load()
  }

  load () {
    const onDisk = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : {}
    this.data = deepMerge(structuredClone(DEFAULTS), onDisk)
    // DRY_RUN in the environment is an override, not a suggestion: it exists so
    // a scripted run can force safety regardless of what the UI last saved.
    if (process.env.DRY_RUN !== undefined) {
      this.data.dryRun = String(process.env.DRY_RUN).toLowerCase() !== 'false'
      this.dryRunForcedByEnv = true
    } else {
      this.dryRunForcedByEnv = false
    }
    return this.data
  }

  save () {
    mkdirSync(dirname(this.path), { recursive: true })
    const { dryRunForcedByEnv, ...rest } = this.data
    writeFileSync(this.path, JSON.stringify(rest, null, 2), { mode: 0o600 })
    return this.data
  }

  /** Apply a partial update and persist. Returns the merged settings. */
  update (patch) {
    if (patch.dryRun === false && this.dryRunForcedByEnv && this.data.dryRun === true) {
      throw new Error('DRY_RUN=true is set in your environment or .env, which overrides this setting. Remove it there to go live.')
    }
    this.data = deepMerge(this.data, patch)
    this.save()
    return this.data
  }

  get dryRun () { return this.data.dryRun !== false }
}
