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
cp .env.example .env                              # add your two keys
cp config/watchlist.example.json config/watchlist.json
node bin/cli.js politicians pelosi                # look up BioGuide IDs
node bin/cli.js poll
node bin/cli.js pending
node bin/cli.js approve <id>
```

No dependencies — Node 18.17+ only.

### Keys

| Variable | Where to get it |
| --- | --- |
| `QUIVER_API_KEY` | <https://www.quiverquant.com/api/> (~$30/mo; Hobbyist and Trader tiers are non-commercial-use only) |
| `PUBLIC_SECRET_KEY` | Public → Settings → Security → API |
| `PUBLIC_ACCOUNT_ID` | Optional. Auto-discovered unless you hold more than one account — set it to pin your IRA. |

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
node --test 'test/*.test.js'
```

14 tests cover side classification, watchlist matching, lag and ticker-type filters, sizing,
deduplication across polls, and every guardrail — with both APIs stubbed, so no keys or
network access are needed.
