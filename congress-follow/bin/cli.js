#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { Engine } from '../src/engine.js'
import { QuiverClient } from '../src/quiver.js'
import { PublicClient } from '../src/public-client.js'
import { UiServer } from '../src/ui-server.js'
import { openBrowser } from '../src/open-browser.js'
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
      const engine = new Engine()
      const auto = engine.settings.data.automation ?? {}
      const minutes = Number(process.env.POLL_MINUTES || auto.pollMinutes || 60)
      const tick = async () => {
        try {
          if (auto.enabled) {
            const r = await engine.runAutomation()
            if (!r.ran) log.warn(`Automation did not run: ${r.reason}`)
          } else {
            await engine.poll()
          }
        } catch (err) { log.error(`Tick failed: ${err.message}`) }
      }
      await tick()
      log.info(`Watching. ${(engine.settings.data.automation ?? {}).enabled ? 'Automation ON' : 'Queue only'}; every ${minutes} minute(s). Ctrl-C to stop.`)
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
          console.log(`${dryRun ? 'DRY_RUN (still pending)' : 'SUBMITTED'}: ${order.side} ${order.ticker} (${order.id.slice(0, 8)})`)
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
        const res = storeSecret(varName, value)
        if (res.removedWhitespace > 0) {
          console.log(`Note: removed ${res.removedWhitespace} whitespace character(s) from what you pasted.`)
          console.log('      Tokens never contain spaces - this usually means the value wrapped')
          console.log('      across two lines on the page you copied it from.')
        }
        console.log(`Stored ${varName} in ${keychainName()} (${res.stored} characters).`)
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

    case 'ui': {
      banner()
      const ui = new UiServer({ port: Number(args[0]) || undefined })
      const url = await ui.listen()
      const opened = flags.has('--no-open') ? false : openBrowser(url)
      console.log(opened ? '\nControl panel ready — opening your browser.' : '\nControl panel ready.')
      console.log('\n  ' + url + '\n')
      if (opened) console.log('If the browser did not open, paste that URL yourself.')
      console.log('Bound to 127.0.0.1 only, and the token is required on every request,')
      console.log('so nothing else on your network or in another browser tab can reach it.')
      console.log('The token changes each time you start it. Ctrl-C to stop.')
      break
    }

    case 'buy':
    case 'sell': {
      const engine = new Engine()
      const ticker = args[0]
      const amount = args[1]
      if (!ticker) throw new Error(`Usage: congress-follow ${command} <TICKER> ${command === 'buy' ? '<amount>' : ''} [--account <id>]`)
      const aIdx = rest.indexOf('--account')
      const order = engine.queueManualOrder({
        ticker,
        notionalUsd: amount,
        side: command.toUpperCase(),
        accountId: aIdx !== -1 ? rest[aIdx + 1] : null,
        note: 'entered manually'
      })
      console.log(`Queued ${order.side} ${order.ticker}` + (order.notionalUsd ? ` for ${usd(order.notionalUsd)}` : '') +
        (order.accountId ? ` in ${order.accountId}` : ' in the default account'))
      console.log(`\nIt is PENDING and passes the guardrails at approval:`)
      console.log(`  congress-follow approve ${order.id.slice(0, 8)}`)
      break
    }

    case 'follow':
    case 'unfollow': {
      const engine = new Engine()
      const who = args.join(' ')
      if (!who) throw new Error(`Usage: congress-follow ${command} "Nancy Pelosi" [--id P000197]`)
      const iIdx = rest.indexOf('--id')
      const bioGuideId = iIdx !== -1 ? rest[iIdx + 1] : null
      if (command === 'follow') {
        const r = engine.follow({ name: who, bioGuideId })
        if (r.alreadyFollowing) { console.log(`Already following ${who}.`); break }
        console.log(`Now following ${who}${bioGuideId ? ` (${bioGuideId})` : ''}.`)
        if (r.nameOnly) {
          console.log('No BioGuide ID given, so matching is by name only, which is less reliable.')
          console.log(`Find the id with: congress-follow politicians ${who.split(' ').pop()}`)
        }
      } else {
        const r = engine.unfollow({ name: who, bioGuideId })
        console.log(r.removed ? `Unfollowed ${who}. ${r.remaining} still followed.` : `Not currently following "${who}".`)
      }
      break
    }

    case 'trades': {
      const engine = new Engine()
      const who = args.join(' ')
      if (!who) throw new Error('Usage: congress-follow trades "Nancy Pelosi"')
      const r = await engine.actorTrades(who)
      if (r.count === 0) {
        console.log(`No disclosed trades found for "${who}" in the enabled datasets.`)
        console.log('Names must match the feed exactly — try: congress-follow politicians ' + who.split(' ').pop())
        break
      }
      console.log(`${r.count} disclosed trade(s) for ${who}, newest first:\n`)
      for (const t of r.trades.slice(0, 40)) {
        const ret = t.priceChangePct == null ? '' :
          `   since: ${t.priceChangePct >= 0 ? '+' : ''}${Number(t.priceChangePct).toFixed(1)}%` +
          (t.excessVsSpyPct == null ? '' : ` (vs SPY ${t.excessVsSpyPct >= 0 ? '+' : ''}${Number(t.excessVsSpyPct).toFixed(1)}%)`)
        console.log(`  ${String(t.transactionDate ?? '?').padEnd(11)} ${String(t.side).padEnd(5)} ${String(t.ticker ?? '—').padEnd(7)} ${String(t.range ?? '—').padEnd(24)}${ret}`)
        console.log(`              disclosed ${t.reportDate ?? '?'} · ${t.dataset}`)
      }
      if (r.count > 40) console.log(`\n  … ${r.count - 40} older.`)
      break
    }

    case 'performance': {
      const engine = new Engine()
      const groupBy = flags.has('--by-dataset') ? 'dataset' : 'actor'
      const sIdx = rest.indexOf('--sort')
      const mIdx = rest.indexOf('--min-trades')
      const p = await engine.performance({
        groupBy,
        sortBy: sIdx !== -1 ? rest[sIdx + 1] : 'year',
        minTrades: mIdx !== -1 ? Number(rest[mIdx + 1]) : 3
      })
      const pct = v => v === null || v === undefined ? '    —' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%'

      console.log(`Average return per disclosed trade, by ${groupBy}, best ${p.sortBy} first.`)
      console.log(`Sources with fewer than ${p.minTrades} measured trades are listed below the ranked set.`)
      console.log('This is NOT a portfolio return - see the caveats below.\n')
      console.log('  ' + 'Source'.padEnd(26) + 'Trades  ' + ['24h', '30d', '365d', 'all'].map(h => h.padStart(8)).join('') + '   vs SPY (all)')
      for (const s of p.sources.slice(0, 25)) {
        if (!s.measurable) {
          console.log('  ' + String(s.key).slice(0, 25).padEnd(26) + String(s.windows.all.trades).padStart(6) + '   (no return data for this source)')
          continue
        }
        const thin = s.thinSample ? '  thin sample' : ''
        console.log('  ' + String(s.key).slice(0, 25).padEnd(26) + String(s.windows.all.trades).padStart(6) + '  ' +
          ['day', 'month', 'year', 'all'].map(w => pct(s.windows[w].avgReturnPct).padStart(8)).join('') +
          '   ' + pct(s.windows.all.avgExcessVsSpyPct) + thin)
      }
      console.log('\nCaveats:')
      console.log('  - A source with one lucky trade can show a huge return. Those are ranked')
      console.log('    below sources with a real sample; raise --min-trades to be stricter.')
      console.log('  - Return data exists only for congress trading. Senate, House, insiders')
      console.log('    and 13F carry none, so they show as unmeasurable rather than 0%.')
      console.log('  - These are per-trade averages, unweighted by position size.')
      console.log('  - They measure the politician\'s entry, not yours - you buy up to 45 days later.')
      console.log('  - No price history is available, so a true daily/monthly/annual portfolio')
      console.log('    return cannot be computed from this API.')
      break
    }

    case 'peek': {
      const { datasetById, ALL_DATASETS } = await import('../src/datasets.js')
      const which = args[0]
      if (!which) {
        console.log('Usage: congress-follow peek <dataset> [--raw] [--ticker SYM]\n\nDatasets:')
        for (const d of ALL_DATASETS()) console.log(`  ${d.id.padEnd(18)} ${d.label.padEnd(36)} ${d.plan}`)
        break
      }
      const ds = datasetById(which)
      if (!ds) throw new Error(`Unknown dataset "${which}". Run \`peek\` with no argument to list them.`)

      const quiver = new QuiverClient()
      const params = {}
      const tIdx = rest.indexOf('--ticker')
      if (tIdx !== -1 && rest[tIdx + 1]) params.ticker = rest[tIdx + 1]

      let rows
      try {
        rows = await quiver.fetchDataset(ds.path, params)
      } catch (err) {
        if (/HTTP 40[13]/.test(err.message)) {
          console.log(`${ds.label} is not included in your plan (needs ${ds.plan}).`)
          console.log('Congress/Senate/House trading are on Hobbyist; insiders and 13F need Trader ($75/mo).')
          console.log('See https://api.quiverquant.com/pricing/')
          process.exitCode = 1
          break
        }
        throw err
      }

      console.log(`${ds.label} — ${rows.length} row(s) from ${ds.path}\n`)
      if (rows.length === 0) { console.log('(empty)'); break }

      // The real field names matter: two of these datasets publish no response schema.
      console.log('Fields present: ' + Object.keys(rows[0]).join(', ') + '\n')
      if (flags.has('--raw')) {
        console.log(JSON.stringify(rows.slice(0, 3), null, 2))
        break
      }
      for (const r of rows.slice(0, 15)) {
        const n = ds.normalise(r)
        const size = n.amount ? '$' + Number(n.amount).toLocaleString() : (n.range ?? '—')
        console.log(`  ${String(n.transaction).padEnd(10)} ${String(n.ticker ?? '—').padEnd(7)} ${size.padEnd(16)} ${String(n.actor ?? '—').slice(0, 28).padEnd(30)} ${n.chamber ?? ''}`)
        console.log(`             traded ${n.transactionDate ?? '?'} · filed ${n.reportDate ?? '?'}`)
      }
      if (rows.length > 15) console.log(`\n  … ${rows.length - 15} more. Add --raw to see full records.`)
      break
    }

    case 'quiver-check': {
      const quiver = new QuiverClient()
      const { describeSecrets } = await import('../src/secrets.js')
      const key = describeSecrets().find(x => x.varName === 'QUIVER_API_KEY')
      console.log(`Stored key: ${key?.fingerprint ?? 'MISSING'}  (source: ${key?.source ?? 'none'})`)
      console.log('Compare that character count against the token on https://www.quiverquant.com/api/\n')

      const rows = await quiver.probe()
      let okAny = false
      for (const r of rows) {
        const mark = r.status === 200 ? 'OK  ' : `${r.status ?? 'ERR'}`
        if (r.status === 200) okAny = true
        console.log(`${mark.padEnd(5)} ${r.scheme.padEnd(6)} ${r.name.padEnd(24)} ${r.body.replace(/\s+/g, ' ').slice(0, 90)}`)
      }

      console.log('')
      const codes = new Set(rows.map(r => r.status))
      if (okAny && codes.size > 1) {
        console.log('Diagnosis: some endpoints work and others do not, so the key is VALID.')
        console.log('           The failing datasets are not entitled by your plan.')
      } else if (!okAny && codes.size === 1 && codes.has(401)) {
        console.log('Diagnosis: every endpoint returns 401 on both schemes.')
        console.log('           That points at the key itself - most likely truncated, stale, or')
        console.log('           regenerated since you stored it. Re-copy it and run:')
        console.log('             node bin/cli.js secrets rm QUIVER_API_KEY')
        console.log('             node bin/cli.js secrets set QUIVER_API_KEY')
      } else if (okAny) {
        console.log('Diagnosis: the key works. Everything needed by this tool is reachable.')
      }
      break
    }

    case 'politicians': {
      const quiver = new QuiverClient()
      const hits = await quiver.findPoliticians(args.join(' '))
      if (hits.length === 0) {
        console.log('No matches. Try a surname on its own, e.g. "pelosi".')
        break
      }
      const usable = hits.filter(h => h.bioGuideId)
      console.log(`${hits.length} match(es); ${usable.length} with a BioGuide ID you can follow:\n`)
      for (const h of hits) {
        const id = h.bioGuideId ?? '(no BioGuide ID)'
        const mark = h.seenTrading ? 'trades seen' : 'roster only'
        console.log(`  ${String(id).padEnd(12)} ${String(h.name).padEnd(28)} ${String(h.party ?? '').padEnd(12)} ${String(h.chamber ?? '').padEnd(16)} ${mark}`)
      }
      if (usable.length > 0) {
        console.log('\nAdd to config/watchlist.json, e.g.:')
        const e = usable[0]
        console.log(`  { "bioGuideId": "${e.bioGuideId}", "name": "${e.name}", "weight": 1.0, "enabled": true }`)
      } else {
        console.log('\nNone of these carry a BioGuide ID in the trade feed, so they cannot be')
        console.log('matched reliably. Pick someone marked "trades seen".')
      }
      break
    }

    default:
      console.log(`congress-follow - queue congressional-disclosure trades for manual approval on Public.com

Usage:
  congress-follow ui [port]            Open the approval control panel (--no-open to skip launching)
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
  congress-follow buy <TICKER> <amt>   Queue a trade directly (--account <id>)
  congress-follow sell <TICKER>        Queue a full-position sell
  congress-follow follow <name>        Add someone to the watchlist (--id <BioGuideID>)
  congress-follow unfollow <name>      Remove them
  congress-follow trades <name>        One person's trades, newest first
  congress-follow performance          Per-source returns, best 365d first
                                       (--sort year|all|month|excess|trades, --min-trades N, --by-dataset)
  congress-follow peek <dataset>       Inspect a dataset's real rows (--raw for full records)
  congress-follow quiver-check         Probe each Quiver endpoint and diagnose a 401

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
