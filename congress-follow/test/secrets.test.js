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
