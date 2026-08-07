import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createContext, runInContext } from 'node:vm'
import { renderPage } from '../src/ui-page.js'

const extractJs = html => html.match(/<script>([\s\S]*?)<\/script>/)[1]

/**
 * Run the page's inline script against a minimal DOM.
 *
 * The server tests only ever exercised the API. A syntax error in the page shipped
 * undetected and broke the entire UI - the script died on load, so nothing
 * rendered and no button worked. Executing it here is what catches that class of
 * bug.
 */
function runPage (state, { accounts = [] } = {}) {
  const calls = []
  const els = new Map()
  const mkEl = () => ({
    textContent: '', innerHTML: '', className: '', hidden: false, disabled: false,
    value: '', checked: false, dataset: {}, onclick: null, onchange: null,
    setAttribute () {}, getAttribute () { return null },
    showModal () {}, close () {}, addEventListener () {}
  })
  const el = id => { if (!els.has(id)) els.set(id, mkEl()); return els.get(id) }

  const document = {
    getElementById: el,
    querySelectorAll: () => [],
    querySelector: () => mkEl(),
    body: mkEl()
  }
  const errors = []
  const ctx = createContext({
    document,
    console,
    setInterval: () => 0,
    setTimeout: () => 0,
    URL,
    fetch: async (path) => {
      calls.push(path)
      const body = path.includes('/api/accounts') ? { accounts } : state
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
    },
    reportError: e => errors.push(e)
  })
  ctx.window = ctx
  runInContext(extractJs(renderPage('test-token')), ctx)
  return { calls, el, errors, ctx }
}

const STATE = {
  dryRun: true,
  dryRunForcedByEnv: false,
  accountId: 'ira-1',
  settings: {
    sizing: { mode: 'mirror', capitalUsd: 20000, minNotionalUsd: 25, maxNotionalUsd: 1000 },
    automation: { enabled: false, requireProvenSubmitPath: true },
    routing: { defaultAccountId: 'ira-1' },
    datasets: { congresstrading: true }
  },
  datasetCatalog: [{ id: 'congresstrading', label: 'Congress trading', plan: 'Hobbyist' }],
  datasetStatus: [{ id: 'congresstrading', label: 'Congress trading', ok: true, count: 3 }],
  allocationsLoaded: 12,
  guardrails: { maxNotionalPerTrade: 1000, maxOrdersPerDay: 10, maxOpenPositions: 25 },
  following: [{ name: 'Nancy Pelosi', bioGuideId: 'P000197', weight: 1 }],
  pending: [{
    id: 'abcdef12-0000-0000-0000-000000000000', status: 'PENDING', side: 'BUY', ticker: 'NVDA',
    notionalUsd: 6000, sizeNote: '30% of their portfolio x $20000', dataset: 'congresstrading',
    politician: 'Nancy Pelosi', party: 'Democratic', chamber: 'Representatives',
    transactionDate: '2026-07-20', reportDate: '2026-08-01', reportedRange: '$1,001 - $15,000', lagDays: 18
  }],
  needsReview: [],
  history: [],
  positions: { AAPL: 3 },
  positionsError: null
}

test('the page script parses — a syntax error breaks the entire UI', () => {
  const js = extractJs(renderPage('tok'))
  assert.doesNotThrow(() => new Function(js), 'the inline script must be valid JavaScript')
})

test('the page script contains no raw newline inside a JS string literal', () => {
  const js = extractJs(renderPage('tok'))
  // Regression: a template-literal \n emitted a real newline into a quoted
  // string, which is a syntax error and killed the whole page.
  for (const [i, line] of js.split('\n').entries()) {
    const singles = (line.match(/(?<!\\)'/g) || []).length
    assert.equal(singles % 2, 0, `line ${i + 1} has an unterminated string: ${line.trim().slice(0, 80)}`)
  }
})

test('no bare apostrophe survives inside a single-quoted string', () => {
  // Regression: `politician\'s` inside the template literal collapsed to a bare
  // quote in the emitted JS and broke the page. Escaping is easy to get wrong
  // here, so the guard is structural rather than per-instance.
  const js = extractJs(renderPage('tok'))
  assert.doesNotThrow(() => new Function(js), 'apostrophes must be escaped or avoided')
})

test('the page runs against a DOM and loads state without throwing', async () => {
  const { calls, errors } = runPage(STATE)
  await new Promise(r => setImmediate(r))
  await new Promise(r => setImmediate(r))
  assert.equal(errors.length, 0)
  assert.ok(calls.some(c => c.includes('/api/state')), 'must request state on load')
  assert.ok(calls.every(c => c.includes('token=test-token')), 'every call must carry the token')
})

test('it renders the queue, the mirror basis and the dry-run banner', async () => {
  const { el } = runPage(STATE)
  for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r))
  assert.match(el('mode').textContent, /DRY RUN/)
  assert.match(el('pending').innerHTML, /NVDA/)
  assert.match(el('pending').innerHTML, /Nancy Pelosi/)
  assert.match(el('pending').innerHTML, /30% of their portfolio/, 'the mirror basis must be visible')
  assert.equal(el('pc').textContent, 1)
})

test('live mode is rendered unmistakably', async () => {
  const { el } = runPage({ ...STATE, dryRun: false })
  for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r))
  assert.match(el('mode').textContent, /LIVE/)
  assert.match(el('mode').className, /live/)
})

test('a positions error is surfaced as a banner, not swallowed', async () => {
  const { el } = runPage({ ...STATE, positions: null, positionsError: 'Could not read positions: unrecognised portfolio shape' })
  for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r))
  assert.match(el('banner').innerHTML, /Positions unavailable/)
})

// ---- browser launch ----
test('the browser command is correct per platform', async () => {
  const { browserCommand } = await import('../src/open-browser.js')
  const url = 'http://127.0.0.1:8787/?token=abc123'

  const win = browserCommand(url, 'win32')
  assert.equal(win.cmd, 'cmd')
  // The empty title argument matters: without it `start` treats the quoted URL
  // as the window title and opens nothing.
  assert.deepEqual(win.args, ['/c', 'start', '', url])

  assert.deepEqual(browserCommand(url, 'darwin'), { cmd: 'open', args: [url] })
  assert.deepEqual(browserCommand(url, 'linux'), { cmd: 'xdg-open', args: [url] })
})

test('the launch never throws, so a missing opener cannot kill the server', async () => {
  const { openBrowser } = await import('../src/open-browser.js')
  assert.doesNotThrow(() => openBrowser('http://127.0.0.1:1/?token=x'))
})
