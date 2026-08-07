# congress-follow

Turn congressional stock disclosures from **Quiver Quantitative** into **manually-approved**
orders in a **Public.com** account (including an IRA).

Nothing trades on its own. Each disclosure that matches your watchlist becomes a *pending*
order that sits in a queue until you explicitly approve it.

## Why not SoFi?

SoFi Invest has no trading API, and no third-party bridge can place orders into a SoFi
account — Plaid-style connections to SoFi are read-only. The only ways to automate SoFi
would be browser automation or replaying its private mobile endpoints, both of which
violate SoFi's terms and put the account at risk. Public.com publishes an official,
free brokerage API that works with IRAs, so this tool targets Public instead.

## Install

```bash
cd congress-follow
cp .env.example .env                              # settings only - no secrets
node bin/cli.js secrets set QUIVER_API_KEY        # keys go in the OS keychain
node bin/cli.js secrets set PUBLIC_SECRET_KEY
cp config/watchlist.example.json config/watchlist.json
node bin/cli.js politicians pelosi                # look up BioGuide IDs
node bin/cli.js poll
node bin/cli.js pending
node bin/cli.js approve <id>
```

No dependencies — Node 18.17+ only.

### Keys

Two secrets. **Neither belongs in a file in this repo.** Store them in your OS
keychain, where they are encrypted at rest and unlocked by your login:

```bash
node bin/cli.js secrets set QUIVER_API_KEY      # input is hidden
node bin/cli.js secrets set PUBLIC_SECRET_KEY
node bin/cli.js secrets                         # confirm, without revealing values
node bin/cli.js secrets doctor                  # audit local storage
```

| Secret | Where to get it |
| --- | --- |
| `QUIVER_API_KEY` | <https://www.quiverquant.com/api/> (~$30/mo; Hobbyist and Trader tiers are non-commercial-use only) |
| `PUBLIC_SECRET_KEY` | Public -> Settings -> Security -> API |

`PUBLIC_ACCOUNT_ID` is an identifier, not a credential, and is fine in `.env`.
Set it to pin your IRA if you hold more than one Public account.

## Where the keys live

Resolution order, most secure first. The first hit wins.

| # | Source | At rest | Use when |
| --- | --- | --- | --- |
| 1 | `<VAR>_CMD` — a password-manager command | **Never stored on this machine** | You already use 1Password, `pass`, Bitwarden, gpg, age |
| 2 | **OS keychain** | Encrypted by the OS, unlocked by login | Default recommendation |
| 3 | `<VAR>` environment variable | Plaintext in the process env | Short-lived shells, CI |
| 4 | `.env` file | **Plaintext on disk** | Discouraged — `doctor` flags it |

The keychain backend is chosen per platform. If none is present, the tool tells
you and points at the `_CMD` route instead of silently degrading.

| Platform | Backend | Needs |
| --- | --- | --- |
| macOS | Keychain via `security` | Nothing — built in |
| Windows | DPAPI, encrypted per Windows user | Nothing — PowerShell is built in |
| Linux | Secret Service via `secret-tool` | `sudo apt install libsecret-tools` |

On Windows the key is encrypted with your Windows account credentials and written
to `%USERPROFILE%\.congress-follow\`. Another user on the same PC cannot decrypt
it, even with the file. Note this is tied to your Windows account, so it does not
survive a reinstall — keep the key recoverable from Public's settings page.

### Pulling from a password manager (strongest option)

Nothing is stored locally at all — the key is fetched fresh on each run and
lives only in memory:

```bash
export QUIVER_API_KEY_CMD='op read op://Private/Quiver/credential'   # 1Password
export PUBLIC_SECRET_KEY_CMD='pass show trading/public-secret'       # pass
# also works with: bw get password <id>, gpg -d, age -d, aws secretsmanager, ...
```

### What the tool does to protect them

- Secrets are passed to the keychain over **stdin**, never as command-line
  arguments — argv is visible to any process via `ps`.
- Terminal input is **hidden** when you run `secrets set`.
- `secrets` prints only a **fingerprint** (`abc...yz (32 chars)`), never a usable value.
- If a `_CMD` fails, its **stderr is not echoed** — a password manager's error output
  can contain the secret itself.
- Public's long-lived secret is exchanged for a **short-lived access token**
  (`PUBLIC_TOKEN_MINUTES`, default 60), so the secret itself is rarely in flight.
- `.env`, `config/watchlist.json` and `data/` are gitignored.

### `secrets doctor`

Audits the things that actually leak keys in practice:

```
[  ok  ] QUIVER_API_KEY is stored in macOS Keychain.
[ RISK ] PUBLIC_SECRET_KEY is read from a plaintext .env file. Move it: secrets set PUBLIC_SECRET_KEY
[ RISK ] .env is mode 644 - readable by other users. chmod 600 .env
[ RISK ] This checkout sits inside a "Dropbox" folder - local secrets would be uploaded to that service.
[  ok  ] .gitignore excludes .env.
[ warn ] data/store.json is mode 644 - it records your positions and order history.
```

Exits non-zero if anything is at RISK, so you can wire it into a pre-run check.

### Beyond this tool

Two things worth doing that no code here can do for you:

- **Scope and rotate.** Treat the Public secret key as the crown jewel: it is the
  one credential that can move money. Rotate it from Public's API settings
  periodically, and immediately if a machine is lost. Revoking it there
  invalidates every token derived from it.
- **Protect the machine.** Full-disk encryption on, and don't run this on a box
  where anyone else has an account. A keychain protects a secret at rest; it
  cannot protect it from someone logged in as you.

## Safety model

- **`DRY_RUN=true` is the default.** Approvals build and log the exact JSON payload but send
  nothing. Public has no paper-trading endpoint, so this dry run is the stand-in for one.
  Run this way until the queue looks right, then set `DRY_RUN=false`.
- **Manual approval always.** `poll` only queues; orders move only when you run `approve`.
- **`useMargin: false` on every order.** Public's API defaults this to `true`, and an IRA is a
  cash account, so sending it explicitly is required.
- **Never shorts.** A `SELL` is refused unless the position is actually held.
- **Fails closed.** If positions can't be read from Public, approval is blocked rather than
  guessing.
- **Idempotent submits.** The order UUID is persisted before the network call, so a retry
  after a crash reuses it and Public dedupes instead of double-filling.

## Watchlist

`config/watchlist.json` controls everything. Match on `bioGuideId` — names are inconsistent
across filings, and matching on name alone can follow the wrong person.

```jsonc
{
  "follow": [{ "bioGuideId": "P000197", "name": "Nancy Pelosi", "weight": 1.0, "enabled": true }],
  "rules": {
    "sides": ["BUY", "SELL"],
    "maxDisclosureLagDays": 60,        // ignore filings older than this
    "allowedTickerTypes": ["CS", "ST"] // common stock only; skips options and bonds
  },
  "sizing": {
    "mode": "fixed",                   // or "tiered", which scales with the disclosed range
    "notionalUsd": 250,
    "sellMode": "full"
  },
  "guardrails": {
    "maxNotionalPerTrade": 1000,
    "maxOrdersPerDay": 10,
    "maxOpenPositions": 25,
    "requireHeldPositionToSell": true
  }
}
```

`weight` scales position size per politician, so you can follow someone at half size.

## Commands

| Command | What it does |
| --- | --- |
| `poll` | Fetch new disclosures, queue matches as pending |
| `watch` | `poll` on a loop (`POLL_MINUTES`, default 60) |
| `pending` | List orders awaiting approval |
| `approve <id>` / `--all` | Submit; `--force` overrides guardrails |
| `reject <id> [reason]` | Drop a pending order |
| `orders [status]` | List everything |
| `sync` | Refresh status of submitted orders |
| `status` | Public accounts and open positions |
| `politicians <query>` | Look up BioGuide IDs |
| `secrets` | Show where each key resolves from |
| `secrets set <VAR>` | Store a key in the OS keychain (hidden input) |
| `secrets rm <VAR>` | Remove a key from the OS keychain |
| `secrets doctor` | Audit local key storage and permissions |

## Things worth knowing before you use this

- **The data is stale by design.** The STOCK Act gives members of Congress up to 45 days to
  disclose. You are never trading on fresh information, and no amount of polling changes that.
  Polling more often than hourly just burns Quiver quota.
- **T+1 settlement.** An IRA is a cash account: sale proceeds aren't reusable until they
  settle. Redeploying unsettled cash causes good-faith violations.
- **Slippage costs more than fees.** Commissions are $0 and regulatory fees run about $0.02 on
  a $250 sell. Bid-ask spread on market orders will cost you far more. The client supports
  `LIMIT` orders via `buildOrderBody` — prefer them for illiquid names.
- **This is not investment advice**, and copying disclosed trades weeks late is not a
  strategy with any guaranteed edge. Size accordingly.

## API surface

Verified against vendor docs:

- Quiver: `GET /beta/live/congresstrading`, `/beta/bulk/congresstrading`,
  `/beta/bulk/congress/politicians` — from Quiver's published OpenAPI schema.
- Public auth (`POST /userapiauthservice/personal/access-tokens`), account lookup
  (`GET /userapigateway/trading/account`) and order placement
  (`POST /userapigateway/trading/{accountId}/order`) — from Public's quickstart and
  place-order reference, including the exact request body shape.

Portfolio, get-order and cancel-order follow the same documented gateway pattern but were
not individually reproduced in the public docs. Confirm those three against your account on
first run (`congress-follow status`); adjust the paths in `src/public-client.js` if Public
returns a 404.

## Tests

```bash
npm test
```

(`npm test` runs Node's built-in test runner against an explicit file list, so it
works on any supported Node version and in any shell. There are still no packages
to install — `npm` is only being used to run the script.)

22 tests cover side classification, watchlist matching, lag and ticker-type filters, sizing,
deduplication across polls, and every guardrail — with both APIs stubbed, so no keys or
network access are needed. Eight of them cover secret handling specifically: resolution
precedence, the actionable missing-key error, and two leak regressions (a failing
password-manager command must not echo its stderr, and `secrets` must never print a
usable value).
