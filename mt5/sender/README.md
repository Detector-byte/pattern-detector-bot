# PipSight Pro — MT5 Python Sender

## Purpose

This directory contains the isolated Python sender for the PipSight Pro MT5 bridge.

The sender runs on a Windows PC or VPS that has:

- MetaTrader 5 installed
- Python installed
- An active broker connection
- Internet access to the Pattern Detector MT5 receiver

The sender is completely independent from:

- Signal Engine
- Pattern Detection
- AI Confidence
- Learning
- Telegram
- Existing JSON outputs

Its only responsibility is publishing broker-native MT5 market data to the isolated MT5 receiver.

---

# Directory

```
sender/
├── .env.example
├── mt5_bridge.py
├── requirements.txt
└── README.md
```

---

# Install Python

Install Python 3.11 or newer.

Verify:

```
python --version
```

---

# Install dependencies

```
pip install -r requirements.txt
```

---

# Configure environment

Copy:

```
.env.example
```

to

```
.env
```

Update only the required values.

Never commit:

- .env
- shared secrets
- broker credentials

---

# Required variables

```
MT5_SHARED_SECRET
MT5_RECEIVER_URL
```

---

# Optional variables

```
MT5_BRIDGE_ID
MT5_TERMINAL_PATH
MT5_SYMBOL_GBPJPY
MT5_SYMBOL_XAUUSD
MT5_POLL_SECONDS
MT5_HTTP_TIMEOUT_SECONDS
MT5_MAX_RETRIES
MT5_RETRY_BASE_SECONDS
MT5_SENDER_LOG_LEVEL
MT5_SENDER_STATE_PATH
```

---

# Start sender

```
python mt5_bridge.py
```

Run one publish cycle:

```
python mt5_bridge.py --once
```

---

# Receiver

The sender publishes authenticated requests to:

```
POST /v1/ingest/mt5
```

The receiver validates:

- HMAC signature
- timestamp
- nonce
- replay protection
- payload integrity

---

# Supported symbols

Current canonical symbols:

- GBPJPY
- XAUUSD

Broker suffixes are automatically detected whenever possible.

If detection is ambiguous, configure:

```
MT5_SYMBOL_GBPJPY
MT5_SYMBOL_XAUUSD
```

---

# Supported timeframes

- 5m
- 15m
- 30m
- 1H
- 4H

Only fully closed candles are published.

The currently forming candle is never published.

---

# Tick data

Every publish contains:

- Bid
- Ask
- Spread
- Tick timestamp

---

# Time

All timestamps use UTC.

---

# Retry

Failed requests are retried.

Request identity remains unchanged during retries.

---

# Security

Never expose:

- MT5_SHARED_SECRET
- Broker credentials
- Private endpoints

Always use HTTPS for remote deployments.

---

# Validation

Confirm:

- MT5 terminal connected
- Broker account logged in
- Receiver running
- Shared secret identical
- Symbol mapping correct

---

# Scope

This sender is additive.

It does not modify:

- Pattern Detector
- Signal Engine
- AI Confidence
- Telegram
- Tracker
- Existing JSON outputs
