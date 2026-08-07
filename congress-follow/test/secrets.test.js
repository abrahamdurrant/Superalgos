import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Each case runs in a fresh process so the resolver's module cache is clean.
function run (script, env = {}) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  }).trim()
}

test('a _CMD backend takes precedence over a plain environment variable', () => {
  const out = run(
    `import { resolveSecret } from './src/secrets.js'
     const r = resolveSecret('QUIVER_API_KEY')
     console.log(JSON.stringify(r))`,
    { QUIVER_API_KEY: 'from-env', QUIVER_API_KEY_CMD: 'printf from-manager' }
  )
  const r = JSON.parse(out)
  assert.equal(r.value, 'from-manager')
  assert.match(r.source, /command/)
})

test('an environment variable is used when no manager or keychain entry exists', () => {
  const r = JSON.parse(run(
    `import { resolveSecret } from './src/secrets.js'
     console.log(JSON.stringify(resolveSecret('QUIVER_API_KEY')))`,
    { QUIVER_API_KEY: 'plain-env-value' }
  ))
  assert.equal(r.value, 'plain-env-value')
  assert.equal(r.source, 'environment variable')
})

test('a missing secret raises an actionable error naming both storage options', () => {
  const out = run(
    `import { resolveSecret } from './src/secrets.js'
     try { resolveSecret('PUBLIC_SECRET_KEY') } catch (e) { console.log(e.message) }`,
    { PUBLIC_SECRET_KEY: '', PUBLIC_SECRET_KEY_CMD: '' }
  )
  assert.match(out, /not configured/)
  assert.match(out, /secrets set PUBLIC_SECRET_KEY/)
  assert.match(out, /_CMD/)
})

test('a failing _CMD does not echo the command output, which could hold the secret', () => {
  const out = run(
    `import { resolveSecret } from './src/secrets.js'
     try { resolveSecret('QUIVER_API_KEY') } catch (e) { console.log(e.message) }`,
    { QUIVER_API_KEY_CMD: 'echo leaked-secret-value >&2; exit 3' }
  )
  assert.match(out, /QUIVER_API_KEY_CMD failed/)
  assert.doesNotMatch(out, /leaked-secret-value/, 'stderr from the manager must not be echoed')
})

test('describeSecrets reports a fingerprint, never the usable value', () => {
  const out = run(
    `import { describeSecrets } from './src/secrets.js'
     console.log(JSON.stringify(describeSecrets()))`,
    { QUIVER_API_KEY: 'supersecretvalue123' }
  )
  assert.doesNotMatch(out, /supersecretvalue123/, 'the full secret must never be printed')
  const quiver = JSON.parse(out).find(s => s.varName === 'QUIVER_API_KEY')
  assert.equal(quiver.configured, true)
  assert.match(quiver.fingerprint, /^sup\.\.\.23 \(19 chars\)$/)
})

test('doctor flags a secret that came from a plaintext .env', () => {
  const out = run(
    `import { doctor } from './src/secrets.js'
     console.log(JSON.stringify(doctor()))`,
    { QUIVER_API_KEY: 'x', __QUIVER_API_KEY_FROM_DOTENV: '1' }
  )
  const findings = JSON.parse(out)
  assert.ok(findings.some(f => f.level === 'bad' && /plaintext \.env/.test(f.msg)))
})

test('doctor confirms .gitignore excludes .env', () => {
  const findings = JSON.parse(run(
    `import { doctor } from './src/secrets.js'
     console.log(JSON.stringify(doctor()))`))
  assert.ok(findings.some(f => f.level === 'ok' && /gitignore excludes \.env/.test(f.msg)))
})

test('doctor warns about an over-long access token lifetime', () => {
  const findings = JSON.parse(run(
    `import { doctor } from './src/secrets.js'
     console.log(JSON.stringify(doctor()))`,
    { PUBLIC_TOKEN_MINUTES: '1440' }))
  assert.ok(findings.some(f => f.level === 'warn' && /shorter access-token lifetime/i.test(f.msg)))
})

test('the hidden prompt fails with an actionable message when stdin is not a terminal', async () => {
  // Regression: this previously shelled out to `read -s` under /bin/bash,
  // which does not exist on Windows.
  const out = run(
    `import { readHidden } from './src/secrets.js'
     readHidden('x: ').then(() => console.log('RESOLVED'), e => console.log(e.message))`
  )
  assert.match(out, /Not an interactive terminal/)
  assert.match(out, /--stdin/)
})

test('secrets module contains no Unix-only shell-outs', () => {
  const src = readFileSync(resolve(root, 'src/secrets.js'), 'utf8')
  assert.doesNotMatch(src, /\/bin\/bash/, 'must not depend on bash')
  assert.doesNotMatch(src, /execFileSync\('rm'/, 'must not depend on Unix rm')
  assert.doesNotMatch(src, /\/dev\/tty/, 'must not depend on /dev/tty')
})

test('PowerShell paths containing an apostrophe are escaped, not broken', () => {
  const src = readFileSync(resolve(root, 'src/secrets.js'), 'utf8')
  assert.match(src, /psQuote/, 'DPAPI commands must quote paths through psQuote')
  // Both the read and write commands must use it.
  assert.equal((src.match(/psQuote\(file\)/g) || []).length, 2)
})

test('the Windows DPAPI path trims before decrypting', () => {
  // Regression: Set-Content appended a CRLF that ConvertTo-SecureString rejected,
  // so a successfully stored key reported as "not configured" with no error.
  const src = readFileSync(resolve(root, 'src/secrets.js'), 'utf8')
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(code, /Set-Content/, 'Set-Content appends a newline that breaks decryption')
  assert.doesNotMatch(code, /Get-Content/, 'Get-Content -Raw returns the trailing newline')
  assert.match(code, /ReadAllText\(\$\{psQuote\(file\)\}\)\.Trim\(\)/, 'the read path must trim')
  assert.match(code, /WriteAllText/, 'the write path must not append a newline')
})

test('a stored-but-unreadable key is reported, never silently treated as absent', () => {
  const src = readFileSync(resolve(root, 'src/secrets.js'), 'utf8')
  // The Windows read catch must throw rather than fall through to null.
  assert.match(src, /could not decrypt it/)
  // describeSecrets must convert that throw into a reported error, not crash.
  assert.match(src, /error = err\.message/)
})

test('describeSecrets never throws, even when a backend fails', () => {
  const out = run(
    `import { describeSecrets } from './src/secrets.js'
     const r = describeSecrets()
     console.log(JSON.stringify(r.map(x => ({ v: x.varName, c: x.configured, e: Boolean(x.error) }))))`
  )
  const rows = JSON.parse(out)
  assert.equal(rows.length, 2)
  assert.ok(rows.every(r => typeof r.c === 'boolean'))
})

test('selfTest reports a structured failure instead of throwing when no keychain exists', () => {
  const out = run(
    `import { selfTest } from './src/secrets.js'
     console.log(JSON.stringify(selfTest()))`
  )
  const r = JSON.parse(out)
  assert.equal(typeof r.ok, 'boolean')
  assert.ok(['availability', 'write', 'read', 'compare', 'complete'].includes(r.stage))
  assert.ok(r.backend && r.detail)
})

test('selfTest restores the real account name after running', () => {
  const out = run(
    `import { selfTest, SECRET_VARS } from './src/secrets.js'
     const before = SECRET_VARS.QUIVER_API_KEY.account
     selfTest()
     console.log(JSON.stringify({ before, after: SECRET_VARS.QUIVER_API_KEY.account }))`
  )
  const { before, after } = JSON.parse(out)
  assert.equal(after, before, 'the probe account name must not leak into normal operation')
  assert.equal(after, 'quiver-api-key')
})

test('an empty .env placeholder does not shadow a real value set later in the file', () => {
  // Regression: .env.example ships `PUBLIC_ACCOUNT_ID=`. Appending the real value
  // at the bottom left the empty line winning, so the setting silently never applied.
  const src = readFileSync(resolve(root, 'src/config.js'), 'utf8')
  assert.match(src, /if \(value === ''\) continue/, 'empty values must be treated as unset')
})

test('a real value in .env is still applied', () => {
  const out = run(
    `import { config } from './src/config.js'
     console.log(JSON.stringify({ id: config.public.accountId }))`,
    { PUBLIC_ACCOUNT_ID: '5OC36413' }
  )
  assert.equal(JSON.parse(out).id, '5OC36413')
})

test('sanitizeSecret strips every whitespace form a browser copy can introduce', async () => {
  const { sanitizeSecret } = await import('../src/secrets.js')
  assert.equal(sanitizeSecret('abc def'), 'abcdef', 'plain space')
  assert.equal(sanitizeSecret('abc\ndef'), 'abcdef', 'newline at a line wrap')
  assert.equal(sanitizeSecret('abc\r\ndef'), 'abcdef', 'CRLF')
  assert.equal(sanitizeSecret('abc\tdef'), 'abcdef', 'tab')
  assert.equal(sanitizeSecret('abc def'), 'abcdef', 'non-breaking space')
  assert.equal(sanitizeSecret('abc​def'), 'abcdef', 'zero-width space')
  assert.equal(sanitizeSecret('﻿abc'), 'abc', 'BOM')
  assert.equal(sanitizeSecret('  abc  '), 'abc', 'surrounding whitespace')
})

test('a key stored with whitespace is cleaned at read time, without re-entry', () => {
  // Regression: Quiver returned "Invalid Token header. Token should not contain
  // spaces." because a token copied across a line wrap carried a newline.
  const out = run(
    `import { resolveSecret } from './src/secrets.js'
     console.log(JSON.stringify(resolveSecret('QUIVER_API_KEY').value))`,
    { QUIVER_API_KEY: 'abc def\nghi' }
  )
  assert.equal(JSON.parse(out), 'abcdefghi')
})

test('the resolved key can never produce a multi-part Authorization header', () => {
  const out = run(
    `import { resolveSecret } from './src/secrets.js'
     const v = resolveSecret('QUIVER_API_KEY').value
     console.log(JSON.stringify(('Token ' + v).split(' ').length))`,
    { QUIVER_API_KEY: 'has one space' }
  )
  assert.equal(JSON.parse(out), 2, 'header must split into exactly [scheme, token]')
})
