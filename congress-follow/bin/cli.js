#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { Engine } from '../src/engine.js'
import { QuiverClient } from '../src/quiver.js'
import { PublicClient } from '../src/public-client.js'
import { config } from '../src/config.js'
import { log } from '../src/log.js'
import { SECRET_VARS, storeSecret, deleteSecret, describeSecrets, doctor, readHidden, keychainName, keychainAvailable, selfTest } from '../src/secrets.js'

const [, , command, ...rest] = process.argv
const flags = new Set(rest.filter(a => a.startsWith('--')))
const args = rest.filter(a => !a.startsWith('--'))

const usd = n => (n == null ? '-' : `$${Number(n).toFixed(2)}`)

function banner () {
  if (config.dryRun) {
    log.warn('DRY_RUN is ON - approved orders are logged, never sent. Set DRY_RUN=false in .env to trade live.')
  } else {
    log.warn('LIVE MODE - approved orders execute with real money in your Public account.')
  }
}

function printOrder (o, verbose = false) {
  const size = o.side === 'BUY' ? usd(o.notionalUsd) : `${o.sellMode} position`
  console.log(`${o.id.slice(0, 8)}  ${o.status.padEnd(9)} ${o.side.padEnd(4)} ${String(o.ticker).padEnd(6)} ${size.padEnd(16)} ${o.politician} (${o.party ?? '?'}/${o.chamber ?? '?'})`)
  console.log(`          disclosed ${o.reportDate} for a ${o.transactionDate} trade of ${o.reportedRange ?? 'unknown size'} - ${o.lagDays}d lag`)
  if (verbose && o.requestBody) console.log('          payload: ' + JSON.stringify(o.requestBody))
}

async function main () {
  switch (command) {
    case 'poll': {
      banner()
      const engine = new Engine()
      const { queued, skipped, total } = await engine.poll()
      console.log(`\n${total} disclosures fetched, ${queued.length} queued, ${skipped.length} skipped.\n`)
      queued.forEach(o => printOrder(o))
      if (queued.length) console.log(`\nReview with: congress-follow pending`)
      break
    }

    case 'watch': {
      banner()
      const minutes = Number(process.env.POLL_MINUTES || 60)
      const engine = new Engine()
      const tick = async () => {
        try { await engine.poll() } catch (err) { log.error(`Poll failed: ${err.message}`) }
      }
      await tick()
      log.info(`Watching. Polling every ${minutes} minute(s). Ctrl-C to stop.`)
      setInterval(tick, minutes * 60_000)
      break
    }

    case 'pending': {
      const engine = new Engine()
      const pending = engine.store.listOrders('PENDING')
      if (pending.length === 0) { console.log('No pending orders.'); break }
      console.log(`${pending.length} order(s) awaiting your approval:\n`)
      pending.forEach(o => printOrder(o, flags.has('--verbose')))
      console.log(`\nApprove with: congress-follow approve <id>   Reject with: congress-follow reject <id>`)
      break
    }

    case 'orders': {
      const engine = new Engine()
      const all = engine.store.listOrders(args[0]?.toUpperCase())
      if (all.length === 0) { console.log('No orders.'); break }
      all.forEach(o => printOrder(o, flags.has('--verbose')))
      break
    }

    case 'approve': {
      banner()
      const engine = new Engine()
      const targets = flags.has('--all') ? engine.store.listOrders('PENDING').map(o => o.id) : args
      if (targets.length === 0) throw new Error('Usage: congress-follow approve <id> [--force] | --all')
      for (const id of targets) {
        try {
          const { order, dryRun } = await engine.approve(id, { force: flags.has('--force') })
          console.log(`${dryRun ? 'DRY_RUN' : 'SUBMITTED'}: ${order.side} ${order.ticker} (${order.id.slice(0, 8)})`)
        } catch (err) {
          console.error(`SKIPPED ${id.slice(0, 8)}: ${err.message}`)
        }
      }
      break
    }

    case 'reject': {
      const engine = new Engine()
      if (args.length === 0) throw new Error('Usage: congress-follow reject <id> [reason]')
      const order = engine.reject(args[0], args.slice(1).join(' ') || undefined)
      console.log(`Rejected ${order.side} ${order.ticker} (${order.id.slice(0, 8)})`)
      break
    }

    case 'sync': {
      const engine = new Engine()
      const synced = await engine.sync()
      console.log(`Refreshed ${synced.length} submitted order(s).`)
      synced.forEach(o => printOrder(o))
      break
    }

    case 'status': {
      banner()
      const broker = new PublicClient()
      const accounts = await broker.getAccounts()
      console.log('Public accounts:')
      accounts.forEach(a => console.log(`  ${a.accountId}  ${a.accountType ?? ''}`))
      const positions = await broker.getPositions()
      const symbols = Object.keys(positions)
      console.log(`\nOpen positions (${symbols.length}):`)
      symbols.forEach(s => console.log(`  ${s.padEnd(6)} ${positions[s]}`))
      break
    }

    case 'secrets': {
      const sub = args[0]
      const varName = args[1]?.toUpperCase()
      const known = Object.keys(SECRET_VARS)

      if (sub === 'set') {
        if (!known.includes(varName)) throw new Error(`Unknown secret "${args[1] ?? ''}". One of: ${known.join(', ')}`)
        if (!keychainAvailable()) {
          throw new Error(`No OS keychain found on this system.\n  Use a password manager instead, e.g.:\n    export ${varName}_CMD='op read op://Private/Item/credential'`)
        }
        // --stdin lets you pipe from another tool without the value hitting the screen.
        const value = flags.has('--stdin')
          ? readFileSync(0, 'utf8').trim()
          : await readHidden(`Paste ${SECRET_VARS[varName].label} (input hidden): `)
        if (!value) throw new Error('No value provided.')
        storeSecret(varName, value)
        console.log(`Stored ${varName} in ${keychainName()}.`)
        console.log('It is encrypted at rest and never written into this repo.')
        break
      }

      if (sub === 'rm' || sub === 'delete') {
        if (!known.includes(varName)) throw new Error(`Unknown secret "${args[1] ?? ''}". One of: ${known.join(', ')}`)
        console.log(deleteSecret(varName) ? `Removed ${varName} from ${keychainName()}.` : `${varName} was not in ${keychainName()}.`)
        break
      }

      if (sub === 'selftest') {
        console.log(`Testing round-trip through ${keychainName()}...\n`)
        const r = selfTest()
        if (r.ok) {
          console.log(`PASS  ${r.detail}`)
          console.log(`\nYour keychain works. Keys stored here will read back correctly.`)
        } else {
          console.log(`FAIL  at the "${r.stage}" stage`)
          console.log(`      ${r.detail}`)
          process.exitCode = 1
        }
        break
      }

      if (sub === 'doctor') {
        const findings = doctor()
        const icon = { ok: '  ok  ', warn: ' warn ', bad: ' RISK ' }
        for (const f of findings) console.log(`[${icon[f.level]}] ${f.msg}`)
        const bad = findings.filter(f => f.level === 'bad').length
        const warn = findings.filter(f => f.level === 'warn').length
        console.log(`\n${findings.length} checks - ${bad} risk(s), ${warn} warning(s).`)
        if (bad > 0) process.exitCode = 1
        break
      }

      // default: status
      console.log(`Keychain backend: ${keychainName()}${keychainAvailable() ? '' : ' (unavailable)'}\n`)
      for (const s of describeSecrets()) {
        const state = s.error ? 'UNREADABLE' : (s.configured ? 'configured' : 'MISSING   ')
        console.log(`${s.varName.padEnd(20)} ${state}  ${s.source ?? ''} ${s.fingerprint ? `[${s.fingerprint}]` : ''}`)
        if (s.error) console.log(`  ${s.error.split('\n').join('\n  ')}`)
      }
      console.log(`\nSet one with: congress-follow secrets set <VAR>`)
      break
    }

    case 'politicians': {
      const quiver = new QuiverClient()
      const roster = await quiver.politicians()
      const q = args.join(' ').toLowerCase()
      const hits = q ? roster.filter(p => JSON.stringify(p).toLowerCase().includes(q)) : roster
      console.log(`${hits.length} match(es):`)
      hits.slice(0, 50).forEach(p => {
        console.log(`  ${String(p.BioGuideID ?? p.bioguide_id ?? '?').padEnd(10)} ${p.Representative ?? p.Name ?? ''} ${p.Party ?? ''} ${p.House ?? ''}`)
      })
      break
    }

    default:
      console.log(`congress-follow - queue congressional-disclosure trades for manual approval on Public.com

Usage:
  congress-follow poll                 Fetch new disclosures and queue matching trades
  congress-follow watch                Poll on a loop (POLL_MINUTES, default 60)
  congress-follow pending [--verbose]  List orders awaiting approval
  congress-follow approve <id>         Approve and submit one order (--force overrides guardrails)
  congress-follow approve --all        Approve every pending order
  congress-follow reject <id> [reason] Reject an order
  congress-follow orders [status]      List all orders, optionally filtered
  congress-follow sync                 Refresh status of submitted orders
  congress-follow status               Show Public accounts and open positions
  congress-follow politicians <query>  Look up BioGuide IDs for your watchlist

Secrets:
  congress-follow secrets              Show where each key resolves from
  congress-follow secrets set <VAR>    Store a key in the OS keychain (hidden input)
  congress-follow secrets rm <VAR>     Remove a key from the OS keychain
  congress-follow secrets selftest     Prove the OS keychain round-trips on this machine
  congress-follow secrets doctor       Audit local key storage and file permissions

Safety: DRY_RUN defaults to true. Nothing reaches Public until you set DRY_RUN=false.`)
  }
}

main().catch(err => { log.error(err.message); process.exitCode = 1 })
