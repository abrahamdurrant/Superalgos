import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { QuiverClient } from '../src/quiver.js'

// Spin a stub that accepts only one auth scheme, so we can prove which the
// client sends and that it falls back correctly.
function stubQuiver ({ accepts }) {
  const seen = []
  const server = createServer((req, res) => {
    const auth = req.headers.authorization || ''
    seen.push(auth.split(' ')[0])
    if (!auth.startsWith(accepts + ' ')) {
      res.statusCode = 401
      res.end('{"detail":"Invalid token."}')
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify([{ Representative: 'Nancy Pelosi', Ticker: 'NVDA' }]))
  })
  return new Promise(resolve => {
    server.listen(0, () => resolve({
      url: `http://localhost:${server.address().port}`,
      seen,
      close: () => server.close()
    }))
  })
}

test('sends the "Token" scheme first, matching Quiver\'s own client', async () => {
  const s = await stubQuiver({ accepts: 'Token' })
  try {
    const q = new QuiverClient({ baseUrl: s.url, apiKey: 'k' })
    const rows = await q.liveCongressTrading()
    assert.equal(rows.length, 1)
    assert.equal(s.seen[0], 'Token', 'first attempt must use Token, not Bearer')
    assert.equal(s.seen.length, 1, 'no fallback needed when Token works')
  } finally { s.close() }
})

test('falls back to "Bearer" if Token is rejected', async () => {
  const s = await stubQuiver({ accepts: 'Bearer' })
  try {
    const q = new QuiverClient({ baseUrl: s.url, apiKey: 'k' })
    const rows = await q.liveCongressTrading()
    assert.equal(rows.length, 1)
    assert.deepEqual(s.seen, ['Token', 'Bearer'], 'tries Token then Bearer')
  } finally { s.close() }
})

test('reuses the working scheme instead of retrying both every call', async () => {
  const s = await stubQuiver({ accepts: 'Bearer' })
  try {
    const q = new QuiverClient({ baseUrl: s.url, apiKey: 'k' })
    await q.liveCongressTrading()
    await q.liveCongressTrading()
    assert.deepEqual(s.seen, ['Token', 'Bearer', 'Bearer'], 'second call goes straight to the known-good scheme')
  } finally { s.close() }
})

test('a 401 on both schemes tries both before giving up', async () => {
  const s = await stubQuiver({ accepts: 'NOPE' })
  try {
    const q = new QuiverClient({ baseUrl: s.url, apiKey: 'k' })
    await assert.rejects(() => q.liveCongressTrading(), /rejected this request \(HTTP 401\)/)
    assert.deepEqual(s.seen, ['Token', 'Bearer'], 'both schemes attempted before failing')
  } finally { s.close() }
})

test('probe() reports every endpoint and scheme without throwing on 401', async () => {
  const s = await stubQuiver({ accepts: 'NOPE' })
  try {
    const q = new QuiverClient({ baseUrl: s.url, apiKey: 'k' })
    const rows = await q.probe()
    assert.equal(rows.length, 8, '4 endpoints x 2 schemes')
    assert.ok(rows.every(r => r.status === 401))
    assert.ok(rows.every(r => typeof r.body === 'string'))
  } finally { s.close() }
})

test('requests carry the X-CSRFToken header the vendor client sends', async () => {
  let headers = null
  const server = createServer((req, res) => {
    headers = req.headers
    res.setHeader('content-type', 'application/json')
    res.end('[]')
  })
  await new Promise(r => server.listen(0, r))
  try {
    const q = new QuiverClient({ baseUrl: `http://localhost:${server.address().port}`, apiKey: 'k' })
    await q.liveCongressTrading()
    assert.ok(headers['x-csrftoken'], 'X-CSRFToken must be sent')
    assert.equal(headers.authorization, 'Token k')
    assert.equal(headers.accept, 'application/json')
  } finally { server.close() }
})

test('the auth error no longer blames the subscription outright', async () => {
  const s = await stubQuiver({ accepts: 'NOPE' })
  try {
    const q = new QuiverClient({ baseUrl: s.url, apiKey: 'k' })
    await assert.rejects(() => q.liveCongressTrading(), err => {
      assert.doesNotMatch(err.message, /almost certainly the subscription/)
      assert.match(err.message, /does NOT by itself mean your subscription is wrong/)
      assert.match(err.message, /quiver-check/)
      return true
    })
  } finally { s.close() }
})

test('politicians() unwraps the {data:[...]} envelope the live API actually returns', async () => {
  // Verified against the live API: this endpoint wraps rows, unlike the trading
  // endpoints. The old code checked Array.isArray and silently returned [].
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: [{ BioGuideID: null, CandidateID: 'H2LA03121', Name: 'Holden Hoggatt' }] }))
  })
  await new Promise(r => server.listen(0, r))
  try {
    const q = new QuiverClient({ baseUrl: `http://localhost:${server.address().port}`, apiKey: 'k' })
    const rows = await q.politicians()
    assert.equal(rows.length, 1, 'must unwrap data[], not return empty')
    assert.equal(rows[0].Name, 'Holden Hoggatt')
  } finally { server.close() }
})

test('an unrecognised response shape yields empty but is not silent', async () => {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ unexpected: 'shape' }))
  })
  await new Promise(r => server.listen(0, r))
  try {
    const q = new QuiverClient({ baseUrl: `http://localhost:${server.address().port}`, apiKey: 'k' })
    const rows = await q.liveCongressTrading()
    assert.deepEqual(rows, [])
  } finally { server.close() }
})

test('findPoliticians prefers IDs confirmed in the trade feed', async () => {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url.includes('congresstrading')) {
      res.end(JSON.stringify([
        { Representative: 'Nancy Pelosi', BioGuideID: 'P000197', Party: 'Democratic', House: 'Representatives' }
      ]))
    } else {
      res.end(JSON.stringify({ data: [{ BioGuideID: null, Name: 'Nancy Pelosi Jr' }] }))
    }
  })
  await new Promise(r => server.listen(0, r))
  try {
    const q = new QuiverClient({ baseUrl: `http://localhost:${server.address().port}`, apiKey: 'k' })
    const hits = await q.findPoliticians('pelosi')
    assert.equal(hits.length, 2)
    assert.equal(hits[0].bioGuideId, 'P000197', 'trade-feed entries rank first')
    assert.equal(hits[0].seenTrading, true)
    assert.equal(hits[1].seenTrading, false)
  } finally { server.close() }
})
