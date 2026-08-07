import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { existsSync, statSync, readFileSync, mkdirSync, chmodSync, unlinkSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { resolve, dirname } from 'node:path'
import { homedir, platform } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const SERVICE = 'congress-follow'

// The only two values that are genuinely sensitive.
export const SECRET_VARS = {
  QUIVER_API_KEY: { account: 'quiver-api-key', label: 'Quiver Quantitative API key' },
  PUBLIC_SECRET_KEY: { account: 'public-secret-key', label: 'Public.com secret key' }
}

const cache = new Map()

/* ------------------------------------------------------------------ *
 * Backend 1: an external command (1Password, pass, Bitwarden, gpg...)  *
 * ------------------------------------------------------------------ */

function fromCommand (varName) {
  const command = process.env[`${varName}_CMD`]
  if (!command) return null
  let out
  try {
    out = execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 })
  } catch (err) {
    // Never echo the command's stderr wholesale - it can contain the secret.
    throw new Error(`${varName}_CMD failed (exit ${err.status ?? '?'}). Run the command yourself to debug.`)
  }
  const value = out.trim()
  return value ? { value, source: `command (${varName}_CMD)` } : null
}

/* ------------------------------------------------------------------ *
 * Backend 2: the operating system keychain                            *
 * ------------------------------------------------------------------ */

const dpapiFile = account => resolve(homedir(), '.congress-follow', `${account}.dpapi`)

// PowerShell single-quoted strings escape a quote by doubling it.
const psQuote = value => `'${String(value).replace(/'/g, "''")}'`

function keychainKind () {
  const p = platform()
  if (p === 'darwin') return 'macos'
  if (p === 'win32') return 'windows'
  return 'libsecret'
}

function have (bin) {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' })
    return true
  } catch { return false }
}

export function keychainAvailable () {
  switch (keychainKind()) {
    case 'macos': return have('security')
    case 'windows': return have('powershell')
    default: return have('secret-tool')
  }
}

export function keychainName () {
  switch (keychainKind()) {
    case 'macos': return 'macOS Keychain'
    case 'windows': return 'Windows DPAPI (per-user encrypted file)'
    default: return 'Secret Service (libsecret)'
  }
}

function fromKeychain (varName) {
  const { account } = SECRET_VARS[varName]
  if (!keychainAvailable()) return null
  try {
    let value
    switch (keychainKind()) {
      case 'macos':
        value = execFileSync('security',
          ['find-generic-password', '-s', SERVICE, '-a', account, '-w'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        break
      case 'windows': {
        const file = dpapiFile(account)
        if (!existsSync(file)) return null
        // ReadAllText + Trim, not Get-Content -Raw: Set-Content appends a CRLF and
        // ConvertTo-SecureString rejects the trailing newline, which used to fail
        // silently and report a stored key as "not configured".
        try {
          value = execFileSync('powershell', ['-NoProfile', '-Command',
            `$e = [IO.File]::ReadAllText(${psQuote(file)}).Trim(); ` +
            '$s = ConvertTo-SecureString $e; ' +
            '[Runtime.InteropServices.Marshal]::PtrToStringAuto(' +
            '[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))'
          ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
        } catch (err) {
          // The file exists but will not decrypt. Never let this look like
          // "no key stored" - that sends you hunting in the wrong place.
          throw new Error(
            `Found an encrypted key at ${file} but could not decrypt it.\n` +
            '  DPAPI ties the key to the Windows account that stored it, so this happens\n' +
            '  after a reinstall or profile change. Re-store it:\n' +
            `    node bin/cli.js secrets rm ${varName}\n` +
            `    node bin/cli.js secrets set ${varName}`)
        }
        break
      }
      default:
        value = execFileSync('secret-tool',
          ['lookup', 'service', SERVICE, 'account', account],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    }
    const trimmed = String(value).trim()
    return trimmed ? { value: trimmed, source: keychainName() } : null
  } catch {
    return null // not stored yet, or the keychain is locked
  }
}

/** Store a secret. The value is passed via stdin or an interactive prompt, never argv. */
export function storeSecret (varName, value) {
  const { account, label } = SECRET_VARS[varName]
  if (!keychainAvailable()) {
    throw new Error(`No OS keychain available on this system (${keychainName()} tooling not found).`)
  }
  switch (keychainKind()) {
    case 'macos': {
      // -U updates in place if the item already exists.
      const r = spawnSync('security',
        ['add-generic-password', '-s', SERVICE, '-a', account, '-l', label, '-U', '-w', value],
        { stdio: ['ignore', 'ignore', 'pipe'] })
      if (r.status !== 0) throw new Error(`macOS Keychain write failed: ${r.stderr}`)
      break
    }
    case 'windows': {
      const file = dpapiFile(account)
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
      const r = spawnSync('powershell', ['-NoProfile', '-Command',
        `$in = [Console]::In.ReadToEnd().Trim(); ` +
        `$enc = ConvertTo-SecureString $in -AsPlainText -Force | ConvertFrom-SecureString; ` +
        `[IO.File]::WriteAllText(${psQuote(file)}, $enc)`
      ], { input: value, stdio: ['pipe', 'ignore', 'pipe'] })
      if (r.status !== 0) throw new Error(`DPAPI write failed: ${r.stderr}`)
      chmodSync(file, 0o600)
      break
    }
    default: {
      const r = spawnSync('secret-tool',
        ['store', '--label', `${SERVICE}: ${label}`, 'service', SERVICE, 'account', account],
        { input: value, stdio: ['pipe', 'ignore', 'pipe'] })
      if (r.status !== 0) throw new Error(`Secret Service write failed: ${r.stderr}`)
    }
  }
  cache.delete(varName)
}

export function deleteSecret (varName) {
  const { account } = SECRET_VARS[varName]
  try {
    switch (keychainKind()) {
      case 'macos':
        execFileSync('security', ['delete-generic-password', '-s', SERVICE, '-a', account], { stdio: 'ignore' })
        break
      case 'windows': {
        const file = dpapiFile(account)
        if (existsSync(file)) unlinkSync(file)
        break
      }
      default:
        execFileSync('secret-tool', ['clear', 'service', SERVICE, 'account', account], { stdio: 'ignore' })
    }
    cache.delete(varName)
    return true
  } catch { return false }
}

/* ------------------------------------------------------------------ *
 * Resolution order                                                     *
 * ------------------------------------------------------------------ */

/**
 * Resolve a secret, most secure source first:
 *   1. <VAR>_CMD   - fetched from a password manager at run time, never at rest here
 *   2. OS keychain - encrypted at rest, unlocked by your login
 *   3. <VAR>       - process environment
 *   4. .env        - plaintext on disk (discouraged; flagged by `secrets doctor`)
 * Returns { value, source }. Never log the value.
 */
export function resolveSecret (varName, { required = true } = {}) {
  if (cache.has(varName)) return cache.get(varName)

  const found =
    fromCommand(varName) ??
    fromKeychain(varName) ??
    (process.env[varName]
      ? { value: process.env[varName], source: process.env[`__${varName}_FROM_DOTENV`] ? '.env file (plaintext)' : 'environment variable' }
      : null)

  if (!found) {
    if (!required) return null
    throw new Error(
      `${varName} is not configured.\n` +
      `  Recommended:  node bin/cli.js secrets set ${varName}      (stores in ${keychainName()})\n` +
      `  Or from 1Password/pass:  export ${varName}_CMD='op read op://vault/item/field'`
    )
  }
  cache.set(varName, found)
  return found
}

/** Describe where each secret would come from, without revealing any value. */
export function describeSecrets () {
  return Object.keys(SECRET_VARS).map(varName => {
    let found = null
    let error = null
    try {
      found = resolveSecret(varName, { required: false })
    } catch (err) {
      // A stored-but-unreadable key is a distinct state from "not configured".
      error = err.message
    }
    return {
      varName,
      configured: Boolean(found),
      error,
      source: found?.source ?? null,
      // Enough to confirm you stored the right thing, not enough to use.
      fingerprint: found ? `${found.value.slice(0, 3)}...${found.value.slice(-2)} (${found.value.length} chars)` : null
    }
  })
}

/**
 * Round-trip a throwaway value through the OS keychain to prove it works on
 * this machine. Lets you validate the whole path before you own any real key.
 */
export function selfTest () {
  const probe = `selftest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const varName = 'QUIVER_API_KEY'
  const original = SECRET_VARS[varName].account
  SECRET_VARS[varName].account = 'selftest-probe'
  try {
    if (!keychainAvailable()) {
      return { ok: false, backend: keychainName(), stage: 'availability', detail: 'No keychain tooling found on this system.' }
    }
    try { storeSecret(varName, probe) } catch (err) {
      return { ok: false, backend: keychainName(), stage: 'write', detail: err.message }
    }
    cache.delete(varName)
    let readBack
    try { readBack = fromKeychain(varName) } catch (err) {
      return { ok: false, backend: keychainName(), stage: 'read', detail: err.message }
    }
    if (!readBack) return { ok: false, backend: keychainName(), stage: 'read', detail: 'Wrote a value but read back nothing.' }
    if (readBack.value !== probe) {
      return { ok: false, backend: keychainName(), stage: 'compare', detail: `Read back ${readBack.value.length} chars, expected ${probe.length}. The value was altered in transit.` }
    }
    return { ok: true, backend: keychainName(), stage: 'complete', detail: `Stored, read back and matched a ${probe.length}-character probe.` }
  } finally {
    try { deleteSecret(varName) } catch { /* best effort cleanup */ }
    SECRET_VARS[varName].account = original
    cache.delete(varName)
  }
}

/* ------------------------------------------------------------------ *
 * Local hygiene checks                                                 *
 * ------------------------------------------------------------------ */

const CLOUD_MARKERS = ['Dropbox', 'Google Drive', 'GoogleDrive', 'OneDrive', 'iCloud', 'Mobile Documents', 'Sync.com', 'pCloud', 'Box Sync']

export function doctor () {
  const findings = []
  const ok = (msg) => findings.push({ level: 'ok', msg })
  const warn = (msg) => findings.push({ level: 'warn', msg })
  const bad = (msg) => findings.push({ level: 'bad', msg })

  // 1. Where are the secrets coming from?
  for (const { varName, configured, source, error } of describeSecrets()) {
    if (error) { bad(`${varName} is stored but could not be read. ${error.split('\n')[0]}`); continue }
    if (!configured) { warn(`${varName} is not configured.`); continue }
    if (source?.includes('command')) ok(`${varName} resolves from a password manager at run time.`)
    else if (source === keychainName()) ok(`${varName} is stored in ${keychainName()}.`)
    else if (source?.includes('.env')) bad(`${varName} is read from a plaintext .env file. Move it: secrets set ${varName}`)
    else warn(`${varName} comes from the environment - fine for a shell session, but it lands in shell history and child processes.`)
  }

  // 2. Plaintext .env on disk
  const envPath = resolve(root, '.env')
  if (existsSync(envPath)) {
    const mode = statSync(envPath).mode & 0o777
    const holdsSecret = Object.keys(SECRET_VARS).some(v => new RegExp(`^${v}\\s*=\\s*\\S`, 'm').test(readFileSync(envPath, 'utf8')))
    if (holdsSecret) {
      bad('.env contains a secret in plaintext. Anything that can read your home directory can read it.')
      if (mode & 0o077) bad(`.env is mode ${mode.toString(8)} - readable by other users. chmod 600 .env`)
    } else {
      ok('.env exists but holds no secrets (settings only).')
    }
  } else {
    ok('No .env file on disk.')
  }

  // 3. Cloud-synced checkout
  const marker = CLOUD_MARKERS.find(m => root.includes(m))
  if (marker) bad(`This checkout sits inside a "${marker}" folder - local secrets would be uploaded to that service.`)
  else ok('Checkout is not inside a known cloud-sync folder.')

  // 4. .gitignore coverage
  const giPath = resolve(root, '.gitignore')
  const gi = existsSync(giPath) ? readFileSync(giPath, 'utf8') : ''
  if (gi.includes('.env')) ok('.gitignore excludes .env.')
  else bad('.gitignore does not exclude .env - a commit could publish your keys.')

  // 5. Order-history store permissions
  const storePath = process.env.STORE_PATH || resolve(root, 'data/store.json')
  if (existsSync(storePath)) {
    const mode = statSync(storePath).mode & 0o777
    if (mode & 0o077) warn(`${storePath} is mode ${mode.toString(8)} - it records your positions and order history.`)
    else ok('Order store is not world-readable.')
  }

  // 6. Token lifetime
  const minutes = Number(process.env.PUBLIC_TOKEN_MINUTES || 60)
  if (minutes > 240) warn(`PUBLIC_TOKEN_MINUTES is ${minutes}. A shorter access-token lifetime limits the damage if one leaks.`)
  else ok(`Public access tokens expire after ${minutes} minute(s).`)

  return findings
}

/**
 * Read a line from the terminal without echoing it.
 * Uses readline with a muted output stream so it works identically on
 * Windows, macOS and Linux - shelling out to `read -s` would be Unix-only.
 */
export function readHidden (promptText) {
  return new Promise((res, rej) => {
    if (!process.stdin.isTTY) {
      rej(new Error('Not an interactive terminal. Pipe the secret instead:\n  echo|set /p="KEY"| node bin/cli.js secrets set VAR --stdin'))
      return
    }
    let muted = false
    const muffled = new Writable({
      write (chunk, encoding, done) {
        if (!muted) process.stdout.write(chunk, encoding)
        done()
      }
    })
    const rl = createInterface({ input: process.stdin, output: muffled, terminal: true })
    rl.question(promptText, answer => {
      rl.close()
      process.stdout.write('\n')
      res(answer.trim())
    })
    muted = true // everything after the prompt itself is swallowed
  })
}
