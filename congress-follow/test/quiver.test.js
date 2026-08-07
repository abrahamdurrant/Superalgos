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

test('a 401 on both schemes blames the subscription, not the key format', async () => {
  const s = await stubQuiver({ accepts: 'NOPE' })
  try {
    const q = new QuiverClient({ baseUrl: s.url, apiKey: 'k' })
    await assert.rejects(() => q.liveCongressTrading(), err => {
      assert.match(err.message, /both the "Token" and "Bearer"/)
      assert.match(err.message, /no free tier/)
      assert.match(err.message, /web Premium plan does NOT include API access/)
      return true
    })
    assert.deepEqual(s.seen, ['Token', 'Bearer'])
  } finally { s.close() }
})
