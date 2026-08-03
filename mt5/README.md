# PipSight Pro — Pattern Detector MT5 Bridge

## Status

This directory contains the isolated MT5 bridge foundation for the Pattern Detector repository.

The bridge is additive. It does not replace or modify the existing Pattern Detector signal pipeline, Pattern Detection logic, AI confidence logic, learning system, Telegram behavior, tracker behavior, or existing JSON outputs.

The MT5 bridge is intended to provide broker-native prices and closed candles for future approved consumers such as broker-price verification and tracker resolution.

## Supported market data

Canonical symbols:

- `GBPJPY`
- `XAUUSD`

Supported timeframes:

- `5m`
- `15m`
- `30m`
- `1H`
- `4H`

Supported data types:

- Live bid/ask ticks
- Fully closed candles
- UTC timestamps
- Per-symbol and per-timeframe freshness state
- Broker symbol metadata
- Duplicate and replay protection

## Architecture

```text
Always-on Windows PC or VPS
        |
        | MetaTrader 5 terminal
        | broker ticks and closed candles
        v
MT5 EA or Python terminal bridge
        |
        | authenticated HTTPS POST
        v
MT5 receiver service
        |
        +-- HMAC authentication
        +-- replay protection
        +-- contract validation
        +-- state merge
        +-- atomic snapshot publication
        |
        v
data/mt5-market-data.json
        |
        v
Approved PipSight Pro consumers
```

GitHub Actions must not be used as a continuous MT5 host. The MT5 terminal must run on an always-on Windows PC or VPS, and the receiver must run on an always-on service.

## Directory structure

```text
mt5/
├── mt5-contract.js
├── mt5-auth.js
├── mt5-replay-store.js
├── mt5-state-store.js
├── mt5-snapshot-writer.js
├── mt5-receiver.js
├── mt5-receiver-start.js
└── README.md
```

Generated additive output:

```text
data/
└── mt5-market-data.json
```

## Module responsibilities

### `mt5-contract.js`

Defines and validates the shared MT5 data contract.

Responsibilities:

- Canonical symbols
- Supported timeframes
- MT5 timeframe names
- Tick validation
- Closed-candle validation
- UTC normalization
- Candle boundary validation
- Freshness classification
- Duplicate identities
- Empty published snapshot generation

### `mt5-auth.js`

Provides HMAC-SHA256 request authentication.

Responsibilities:

- Body hashing
- Canonical request construction
- HMAC signature generation
- Constant-time comparison
- Timestamp validation
- Replay-window validation
- Nonce validation
- Signed header generation

### `mt5-replay-store.js`

Provides in-memory replay and ordering protection.

Responsibilities:

- Nonce replay detection
- Request idempotency
- Bridge session tracking
- Monotonic sequence enforcement
- Session restart handling
- Automatic cleanup
- Bounded memory limits

### `mt5-state-store.js`

Maintains the latest validated MT5 market state.

Responsibilities:

- Latest tick merge
- Latest closed candle merge
- Older tick rejection
- Older candle rejection
- Duplicate suppression
- Last known good preservation
- Freshness calculation
- Public snapshot generation

### `mt5-snapshot-writer.js`

Publishes the additive MT5 JSON snapshot.

Responsibilities:

- Snapshot validation
- Deterministic JSON serialization
- Output directory creation
- Temporary-file write
- Atomic final replacement
- Existing valid file preservation on failure

Default output:

```text
data/mt5-market-data.json
```

### `mt5-receiver.js`

Runs the isolated HTTP receiver.

Default endpoints:

```text
POST /v1/ingest/mt5
GET  /v1/market-data
GET  /v1/market-data/:symbol
GET  /v1/health
```

The receiver combines:

```text
Authentication
→ Replay protection
→ Contract validation
→ State merge
→ Snapshot publication
```

### `mt5-receiver-start.js`

Deployment entry point.

Responsibilities:

- Required environment validation
- Safe startup summary
- Receiver startup
- Startup failure handling

## Required external infrastructure

### MT5 terminal host

Required:

- Always-on Windows PC or Windows VPS
- MetaTrader 5 installed
- Broker account connected
- Required broker symbols visible in Market Watch
- Automatic restart after Windows reboot
- Stable internet connection

### MT5 sender

A later approved phase must provide one of:

- MQL5 Expert Advisor
- Python process connected to the MT5 terminal

The sender must:

- Resolve broker symbol suffixes
- Read live bid and ask
- Read fully closed candles
- Convert timestamps to UTC
- Build the approved payload
- Sign every request
- Retry safely without changing request identity
- Maintain session and sequence state

### Receiver host

Required:

- Always-on Node.js service
- HTTPS termination
- Persistent environment configuration
- Restricted secrets access
- Process restart policy
- Health monitoring

The receiver must not depend on GitHub Actions for continuous availability.

## Environment configuration

### Required

```text
MT5_SHARED_SECRET
```

Requirements:

- Minimum 32 characters
- Do not commit to the repository
- Do not include in JSON output
- Do not print in logs
- Use the same secret on the sender and receiver

### Optional

```text
MT5_RECEIVER_HOST
MT5_RECEIVER_PORT
MT5_SNAPSHOT_OUTPUT_PATH
MT5_PUBLIC_READ_ENABLED
```

Default receiver values:

```text
MT5_RECEIVER_HOST=127.0.0.1
MT5_RECEIVER_PORT=8787
MT5_PUBLIC_READ_ENABLED=true
```

Default snapshot path:

```text
data/mt5-market-data.json
```

## Authentication protocol

Expected request headers:

```text
X-Bridge-Id
X-Timestamp
X-Nonce
X-Signature
X-Payload-Hash
X-Auth-Version
```

Canonical signing input:

```text
HTTP_METHOD
REQUEST_PATH
UTC_TIMESTAMP
NONCE
SHA256_BODY
```

Signature:

```text
HMAC_SHA256(sharedSecret, canonicalString)
```

Security defaults:

```text
Replay window: 300 seconds
Maximum future clock skew: 30 seconds
Minimum shared-secret length: 32 characters
Minimum nonce length: 16 characters
Maximum nonce length: 128 characters
```

## Replay and duplicate protection

Replay identity:

```text
bridgeId + nonce
```

Request identity:

```text
bridgeId + sessionId + requestId
```

Candle identity:

```text
canonicalSymbol + timeframe + openTimeUtc
```

A bridge restart must create a new `sessionId`.

Within one session, `sequence` must increase monotonically.

A retry of the same accepted request must preserve:

- `bridgeId`
- `sessionId`
- `requestId`
- `sequence`
- request body
- nonce
- timestamp
- signature headers

## Symbol mapping

Canonical symbols remain stable:

```text
GBPJPY
XAUUSD
```

Broker symbols may include prefixes or suffixes, for example:

```text
GBPJPY.a
GBPJPY-pro
XAUUSDm
```

The sender must publish both:

```text
canonicalSymbol
brokerSymbol
```

Automatic symbol discovery and mapping rules belong in the later MT5 sender phase. They are not implemented by the receiver modules.

## Timeframe mapping

```text
5m  → TIMEFRAME_M5
15m → TIMEFRAME_M15
30m → TIMEFRAME_M30
1H  → TIMEFRAME_H1
4H  → TIMEFRAME_H4
```

Only fully closed candles are accepted.

Open candles must not be published as closed candles.

## Bid and ask handling

The bridge publishes both bid and ask.

For future tracker resolution, the approved consumer must use the correct side of the market:

- A sell position normally closes against ask.
- A buy position normally closes against bid.

No tracker resolution behavior is changed by the files in this directory. Any tracker integration requires separate approval and a separate audit of the current tracker implementation.

## UTC requirements

All transmitted timestamps must be valid UTC timestamps.

Required examples:

```text
2026-08-04T00:30:00.000Z
```

The sender is responsible for converting MT5 terminal or broker timestamps to UTC correctly.

The receiver validates timestamps but does not infer an unknown broker timezone.

## Freshness states

Tick freshness defaults:

```text
FRESH    <= 15 seconds
DELAYED  <= 60 seconds
STALE    <= 180 seconds
OFFLINE  > 180 seconds
```

Closed-candle publication delay defaults:

```text
FRESH    <= 90 seconds after expected close
DELAYED  <= 180 seconds after expected close
STALE    > 180 seconds after expected close
```

Freshness is calculated independently for each symbol and timeframe.

## Start command

From the repository root:

```bash
node mt5/mt5-receiver-start.js
```

Required before start:

```text
MT5_SHARED_SECRET
```

Example for a local development shell:

```bash
MT5_SHARED_SECRET="replace-with-a-secret-at-least-32-characters" \
node mt5/mt5-receiver-start.js
```

Do not use an example secret in production.

## Validation commands

Run from the repository root.

Syntax checks:

```bash
node --check mt5/mt5-contract.js
node --check mt5/mt5-auth.js
node --check mt5/mt5-replay-store.js
node --check mt5/mt5-state-store.js
node --check mt5/mt5-snapshot-writer.js
node --check mt5/mt5-receiver.js
node --check mt5/mt5-receiver-start.js
```

Module load checks:

```bash
node -e "require('./mt5/mt5-contract')"
node -e "require('./mt5/mt5-auth')"
node -e "require('./mt5/mt5-replay-store')"
node -e "require('./mt5/mt5-state-store')"
node -e "require('./mt5/mt5-snapshot-writer')"
node -e "require('./mt5/mt5-receiver')"
node -e "require('./mt5/mt5-receiver-start')"
```

Expected result:

```text
No syntax error
No missing-module error
Exit code 0
```

## Health checks

Receiver health:

```text
GET /v1/health
```

Complete market snapshot:

```text
GET /v1/market-data
```

Single-symbol snapshot:

```text
GET /v1/market-data/GBPJPY
GET /v1/market-data/XAUUSD
```

Before the first valid MT5 ingestion, health may be degraded and the snapshot may be stale. That is expected.

## Failure behavior

### MT5 terminal unavailable

Expected behavior:

- No new authenticated payload
- Existing last known good data remains available
- Freshness becomes stale or offline
- Existing Pattern Detector pipeline remains unchanged

### Receiver unavailable

Expected sender behavior:

- Retry with bounded backoff
- Do not generate uncontrolled duplicate requests
- Preserve request identity for an exact retry
- Create a new request only for new market data

### Invalid signature

Receiver response:

```text
401
```

### Replay, stale request, or out-of-order sequence

Receiver response:

```text
409
```

### Invalid MT5 payload contract

Receiver response:

```text
422
```

### Snapshot write failure

Expected behavior:

- Receiver reports an internal storage error
- Temporary file is cleaned up when possible
- Previous valid snapshot remains intact

## Logging rules

Logs may include:

- Bridge ID
- Request ID
- Session ID
- Sequence
- Result code
- Freshness state
- Health state

Logs must not include:

- Shared secret
- Full HMAC secret material
- Account password
- Broker password
- Private terminal credentials

## No-change zones

The isolated bridge must not modify without separate audit and explicit approval:

- Signal Engine
- Pattern Detection
- AI confidence
- Strategy filters
- Telegram behavior
- Learning
- AI Memory
- Existing tracker behavior
- Existing JSON schemas
- Existing workflows
- Existing runtime entry scripts

The current Twelve Data signal-generation path remains available and unchanged.

## Current integration boundary

The current safe boundary is:

```text
External MT5 sender
→ isolated receiver
→ data/mt5-market-data.json
```

No current Pattern Detector consumer is connected automatically.

No PipSight tracker consumer is connected automatically.

Those integrations require separate approval.

## Deployment checklist

Before production deployment verify:

- Windows PC or VPS is always on
- MT5 terminal reconnects after restart
- Broker symbols are mapped correctly
- Sender publishes bid and ask
- Sender publishes all approved timeframes
- Sender publishes only fully closed candles
- UTC conversion is verified against known candles
- Receiver is behind HTTPS
- Shared secret is not committed
- Firewall exposes only required ports
- Receiver process restarts automatically
- Health endpoint is monitored
- Snapshot output is writable
- Old data becomes stale instead of appearing fresh
- Twelve Data fallback remains available
- Existing Pattern Detector tests still pass

## Rollback

The isolated MT5 bridge can be rolled back without changing the existing Pattern Detector pipeline.

Stop the receiver process, then remove or disable:

```text
mt5/mt5-receiver-start.js
mt5/mt5-receiver.js
mt5/mt5-snapshot-writer.js
mt5/mt5-state-store.js
mt5/mt5-replay-store.js
mt5/mt5-auth.js
mt5/mt5-contract.js
```

Optional generated output:

```text
data/mt5-market-data.json
```

Because no existing runtime entry point imports these modules automatically, removing the isolated bridge should not change the existing Pattern Detector behavior.

## Pending implementation phases

Not yet covered by these receiver modules:

- MQL5 EA or Python MT5 sender
- Broker suffix discovery
- Persistent sender session and sequence storage
- Receiver deployment configuration
- HTTPS reverse proxy configuration
- Process manager configuration
- Repository publishing automation
- PipSight tracker consumption
- Tracker fallback logic
- Signal Engine consumption

Each pending phase requires its own audit, design approval, implementation, and validation.
