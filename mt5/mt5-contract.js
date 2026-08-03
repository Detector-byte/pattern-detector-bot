"use strict";

/**
 * PipSight Pro — MT5 Bridge Shared Contract
 *
 * Isolated, additive contract for MT5 market-data ingestion and consumption.
 *
 * Scope:
 * - Canonical symbols: GBPJPY, XAUUSD
 * - Supported timeframes: 5m, 15m, 30m, 1H, 4H, D1
 * - Live bid/ask ticks
 * - Fully closed candles only
 * - UTC timestamps
 * - Freshness classification
 * - Duplicate identities
 * - Strict normalization and validation
 *
 * No existing Pattern Detector runtime file imports this module yet.
 * Adding this file alone does not change signal generation, pattern detection,
 * AI confidence, learning, Telegram, tracker behavior, or existing JSON schemas.
 */

const SCHEMA_VERSION = "1.0.0";
const SOURCE_NAME = "MT5_BROKER";

const SUPPORTED_SYMBOLS = Object.freeze([
  "GBPJPY",
  "XAUUSD"
]);

const SUPPORTED_TIMEFRAMES = Object.freeze([
  "5m",
  "15m",
  "30m",
  "1H",
  "4H",
  "D1"
]);

const TIMEFRAME_MINUTES = Object.freeze({
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1H": 60,
  "4H": 240,
  "D1": 1440
});

const MT5_TIMEFRAME_NAMES = Object.freeze({
  "5m": "TIMEFRAME_M5",
  "15m": "TIMEFRAME_M15",
  "30m": "TIMEFRAME_M30",
  "1H": "TIMEFRAME_H1",
  "4H": "TIMEFRAME_H4",
  "D1": "TIMEFRAME_D1"
});

const FRESHNESS = Object.freeze({
  tick: Object.freeze({
    freshMaxAgeSeconds: 15,
    delayedMaxAgeSeconds: 60,
    offlineAfterSeconds: 180
  }),

  candle: Object.freeze({
    freshMaxDelaySeconds: 90,
    delayedMaxDelaySeconds: 180
  })
});

const MAX_FUTURE_SKEW_MS = 30_000;

class Mt5ContractError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "Mt5ContractError";
    this.details =
      details &&
      typeof details === "object" &&
      !Array.isArray(details)
        ? details
        : {};
  }
}

function isPlainObject(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function toFiniteNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function toNonNegativeInteger(value) {
  const number = Number(value);

  if (
    !Number.isInteger(number) ||
    number < 0
  ) {
    return null;
  }

  return number;
}

function normalizeNonEmptyString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized.length > 0
    ? normalized
    : null;
}

function normalizeCanonicalSymbol(value) {
  const symbol =
    normalizeNonEmptyString(value)
      ?.toUpperCase() ||
    null;

  return SUPPORTED_SYMBOLS.includes(symbol)
    ? symbol
    : null;
}

function normalizeBrokerSymbol(value) {
  return normalizeNonEmptyString(value);
}

function normalizeTimeframe(value) {
  const raw =
    normalizeNonEmptyString(value);

  if (!raw) {
    return null;
  }

  const aliases = {
    "5M": "5m",
    "M5": "5m",
    "15M": "15m",
    "M15": "15m",
    "30M": "30m",
    "M30": "30m",
    "1H": "1H",
    "H1": "1H",
    "60M": "1H",
    "4H": "4H",
    "H4": "4H",
    "240M": "4H",
    "1D": "D1",
    "D1": "D1",
    "DAILY": "D1",
    "1440M": "D1"
  };

  const canonical =
    aliases[raw.toUpperCase()] ||
    null;

  return SUPPORTED_TIMEFRAMES.includes(canonical)
    ? canonical
    : null;
}

function normalizeUtcIso(value, fieldName = "timestamp") {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    !(value instanceof Date)
  ) {
    throw new Mt5ContractError(
      `${fieldName} must be a valid UTC timestamp`
    );
  }

  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Mt5ContractError(
      `${fieldName} is invalid`
    );
  }

  return date.toISOString();
}

function getEpochMs(value, fieldName = "timestamp") {
  return new Date(
    normalizeUtcIso(
      value,
      fieldName
    )
  ).getTime();
}

function assertNotTooFarInFuture(
  value,
  now = new Date(),
  fieldName = "timestamp"
) {
  const timestampMs =
    getEpochMs(
      value,
      fieldName
    );

  const nowMs =
    getEpochMs(
      now,
      "now"
    );

  if (
    timestampMs >
    nowMs + MAX_FUTURE_SKEW_MS
  ) {
    throw new Mt5ContractError(
      `${fieldName} is too far in the future`,
      {
        timestamp:
          new Date(
            timestampMs
          ).toISOString(),

        now:
          new Date(
            nowMs
          ).toISOString(),

        maxFutureSkewMs:
          MAX_FUTURE_SKEW_MS
      }
    );
  }
}

function normalizeDigits(value) {
  const digits =
    toNonNegativeInteger(value);

  if (
    digits === null ||
    digits > 10
  ) {
    throw new Mt5ContractError(
      "digits must be an integer between 0 and 10"
    );
  }

  return digits;
}

function normalizePoint(value) {
  const point =
    toFiniteNumber(value);

  if (
    point === null ||
    point <= 0
  ) {
    throw new Mt5ContractError(
      "point must be a positive finite number"
    );
  }

  return point;
}

function normalizePositivePrice(
  value,
  fieldName
) {
  const price =
    toFiniteNumber(value);

  if (
    price === null ||
    price <= 0
  ) {
    throw new Mt5ContractError(
      `${fieldName} must be a positive finite number`
    );
  }

  return price;
}

function normalizeOptionalNonNegativeNumber(
  value,
  fieldName
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const number =
    toFiniteNumber(value);

  if (
    number === null ||
    number < 0
  ) {
    throw new Mt5ContractError(
      `${fieldName} must be a non-negative finite number`
    );
  }

  return number;
}

function normalizeBoolean(
  value,
  fieldName
) {
  if (typeof value !== "boolean") {
    throw new Mt5ContractError(
      `${fieldName} must be boolean`
    );
  }

  return value;
}

function getTimeframeDurationMs(timeframe) {
  const canonical =
    normalizeTimeframe(timeframe);

  if (!canonical) {
    throw new Mt5ContractError(
      `unsupported timeframe: ${timeframe}`
    );
  }

  return (
    TIMEFRAME_MINUTES[canonical] *
    60_000
  );
}

function isAlignedToTimeframe(
  timestamp,
  timeframe
) {
  const timestampMs =
    getEpochMs(timestamp);

  const durationMs =
    getTimeframeDurationMs(timeframe);

  return (
    timestampMs %
      durationMs ===
    0
  );
}

function buildCandleIdentity(
  canonicalSymbol,
  timeframe,
  openTimeUtc
) {
  const symbol =
    normalizeCanonicalSymbol(
      canonicalSymbol
    );

  const normalizedTimeframe =
    normalizeTimeframe(
      timeframe
    );

  if (!symbol) {
    throw new Mt5ContractError(
      `unsupported canonical symbol: ${canonicalSymbol}`
    );
  }

  if (!normalizedTimeframe) {
    throw new Mt5ContractError(
      `unsupported timeframe: ${timeframe}`
    );
  }

  const normalizedOpenTime =
    normalizeUtcIso(
      openTimeUtc,
      "openTimeUtc"
    );

  return [
    symbol,
    normalizedTimeframe,
    normalizedOpenTime
  ].join("|");
}

function buildTickIdentity(tick) {
  if (!isPlainObject(tick)) {
    throw new Mt5ContractError(
      "tick must be an object"
    );
  }

  const brokerSymbol =
    normalizeBrokerSymbol(
      tick.brokerSymbol
    );

  const timeMsc =
    toNonNegativeInteger(
      tick.timeMsc
    );

  const bid =
    normalizePositivePrice(
      tick.bid,
      "tick.bid"
    );

  const ask =
    normalizePositivePrice(
      tick.ask,
      "tick.ask"
    );

  if (!brokerSymbol) {
    throw new Mt5ContractError(
      "tick.brokerSymbol is required"
    );
  }

  if (timeMsc === null) {
    throw new Mt5ContractError(
      "tick.timeMsc must be a non-negative integer"
    );
  }

  return [
    brokerSymbol,
    timeMsc,
    bid,
    ask
  ].join("|");
}

function normalizeTick(
  input,
  context = {}
) {
  if (!isPlainObject(input)) {
    throw new Mt5ContractError(
      "tick must be an object"
    );
  }

  const canonicalSymbol =
    normalizeCanonicalSymbol(
      input.canonicalSymbol ??
      context.canonicalSymbol
    );

  const brokerSymbol =
    normalizeBrokerSymbol(
      input.brokerSymbol ??
      context.brokerSymbol
    );

  if (!canonicalSymbol) {
    throw new Mt5ContractError(
      "tick.canonicalSymbol is unsupported"
    );
  }

  if (!brokerSymbol) {
    throw new Mt5ContractError(
      "tick.brokerSymbol is required"
    );
  }

  const bid =
    normalizePositivePrice(
      input.bid,
      "tick.bid"
    );

  const ask =
    normalizePositivePrice(
      input.ask,
      "tick.ask"
    );

  if (ask < bid) {
    throw new Mt5ContractError(
      "tick.ask cannot be lower than tick.bid",
      {
        bid,
        ask
      }
    );
  }

  const timeUtc =
    normalizeUtcIso(
      input.timeUtc ??
      input.timestamp ??
      input.time,
      "tick.timeUtc"
    );

  assertNotTooFarInFuture(
    timeUtc,
    context.now,
    "tick.timeUtc"
  );

  const timeMsc =
    toNonNegativeInteger(
      input.timeMsc
    );

  if (timeMsc === null) {
    throw new Mt5ContractError(
      "tick.timeMsc must be a non-negative integer"
    );
  }

  const spreadPoints =
    normalizeOptionalNonNegativeNumber(
      input.spreadPoints,
      "tick.spreadPoints"
    );

  const volume =
    normalizeOptionalNonNegativeNumber(
      input.volume,
      "tick.volume"
    );

  const last =
    input.last ===
      undefined ||
    input.last ===
      null
      ? null
      : normalizePositivePrice(
          input.last,
          "tick.last"
        );

  const receivedAtUtc =
    normalizeUtcIso(
      input.receivedAtUtc ??
      context.receivedAtUtc ??
      new Date(),
      "tick.receivedAtUtc"
    );

  const normalized = {
    canonicalSymbol,
    brokerSymbol,
    bid,
    ask,
    last,
    volume,
    timeUtc,
    timeMsc,
    spreadPoints,
    receivedAtUtc
  };

  return {
    ...normalized,
    identity:
      buildTickIdentity(
        normalized
      )
  };
}

function normalizeClosedCandle(
  input,
  context = {}
) {
  if (!isPlainObject(input)) {
    throw new Mt5ContractError(
      "candle must be an object"
    );
  }

  const canonicalSymbol =
    normalizeCanonicalSymbol(
      input.canonicalSymbol ??
      context.canonicalSymbol
    );

  const brokerSymbol =
    normalizeBrokerSymbol(
      input.brokerSymbol ??
      context.brokerSymbol
    );

  const timeframe =
    normalizeTimeframe(
      input.timeframe ??
      context.timeframe
    );

  if (!canonicalSymbol) {
    throw new Mt5ContractError(
      "candle.canonicalSymbol is unsupported"
    );
  }

  if (!brokerSymbol) {
    throw new Mt5ContractError(
      "candle.brokerSymbol is required"
    );
  }

  if (!timeframe) {
    throw new Mt5ContractError(
      "candle.timeframe is unsupported"
    );
  }

  const closed =
    normalizeBoolean(
      input.closed,
      "candle.closed"
    );

  if (!closed) {
    throw new Mt5ContractError(
      "only fully closed candles are accepted"
    );
  }

  const openTimeUtc =
    normalizeUtcIso(
      input.openTimeUtc ??
      input.openTime ??
      input.timestamp,
      "candle.openTimeUtc"
    );

  const closeTimeUtc =
    normalizeUtcIso(
      input.closeTimeUtc ??
      new Date(
        getEpochMs(
          openTimeUtc
        ) +
        getTimeframeDurationMs(
          timeframe
        )
      ),
      "candle.closeTimeUtc"
    );

  assertNotTooFarInFuture(
    openTimeUtc,
    context.now,
    "candle.openTimeUtc"
  );

  assertNotTooFarInFuture(
    closeTimeUtc,
    context.now,
    "candle.closeTimeUtc"
  );

  if (
    !isAlignedToTimeframe(
      openTimeUtc,
      timeframe
    )
  ) {
    throw new Mt5ContractError(
      "candle.openTimeUtc is not aligned to its timeframe boundary",
      {
        timeframe,
        openTimeUtc
      }
    );
  }

const expectedCloseTimeMs =
  getEpochMs(
    openTimeUtc
  ) +
  getTimeframeDurationMs(
    timeframe
  );

  if (
    getEpochMs(
      closeTimeUtc
    ) !==
    expectedCloseTimeMs
  ) {
    throw new Mt5ContractError(
      "candle.closeTimeUtc does not match the expected timeframe duration",
      {
        timeframe,
        openTimeUtc,
        closeTimeUtc,
        expectedCloseTimeUtc:
          new Date(
            expectedCloseTimeMs
          ).toISOString()
      }
    );
  }

  const open =
    normalizePositivePrice(
      input.open,
      "candle.open"
    );

  const high =
    normalizePositivePrice(
      input.high,
      "candle.high"
    );

  const low =
    normalizePositivePrice(
      input.low,
      "candle.low"
    );

  const close =
    normalizePositivePrice(
      input.close,
      "candle.close"
    );

  if (high < low) {
    throw new Mt5ContractError(
      "candle.high cannot be lower than candle.low"
    );
  }

  if (
    open > high ||
    open < low
  ) {
    throw new Mt5ContractError(
      "candle.open must be inside candle.high/candle.low range"
    );
  }

  if (
    close > high ||
    close < low
  ) {
    throw new Mt5ContractError(
      "candle.close must be inside candle.high/candle.low range"
    );
  }

  const tickVolume =
    normalizeOptionalNonNegativeNumber(
      input.tickVolume,
      "candle.tickVolume"
    );

  const realVolume =
    normalizeOptionalNonNegativeNumber(
      input.realVolume,
      "candle.realVolume"
    );

  const spread =
    normalizeOptionalNonNegativeNumber(
      input.spread,
      "candle.spread"
    );

  const normalized = {
    canonicalSymbol,
    brokerSymbol,
    timeframe,
    mt5Timeframe:
      MT5_TIMEFRAME_NAMES[
        timeframe
      ],
    openTimeUtc,
    closeTimeUtc,
    open,
    high,
    low,
    close,
    tickVolume,
    realVolume,
    spread,
    closed: true,
    source:
      SOURCE_NAME
  };

  return {
    ...normalized,
    identity:
      buildCandleIdentity(
        canonicalSymbol,
        timeframe,
        openTimeUtc
      )
  };
}

function classifyTickFreshness(
  tickTimeUtc,
  options = {}
) {
  const nowMs =
    getEpochMs(
      options.now ??
      new Date(),
      "now"
    );

  const tickTimeMs =
    getEpochMs(
      tickTimeUtc,
      "tickTimeUtc"
    );

  const ageSeconds =
    Math.max(
      0,
      (
        nowMs -
        tickTimeMs
      ) /
      1000
    );

  let state =
    "OFFLINE";

  if (
    ageSeconds <=
    FRESHNESS.tick
      .freshMaxAgeSeconds
  ) {
    state =
      "FRESH";
  } else if (
    ageSeconds <=
    FRESHNESS.tick
      .delayedMaxAgeSeconds
  ) {
    state =
      "DELAYED";
  } else if (
    ageSeconds <=
    FRESHNESS.tick
      .offlineAfterSeconds
  ) {
    state =
      "STALE";
  }

  return {
    state,
    ageSeconds:
      Number(
        ageSeconds.toFixed(3)
      )
  };
}

function classifyCandleFreshness(
  closeTimeUtc,
  options = {}
) {
  const nowMs =
    getEpochMs(
      options.now ??
      new Date(),
      "now"
    );

  const closeTimeMs =
    getEpochMs(
      closeTimeUtc,
      "closeTimeUtc"
    );

  const delaySeconds =
    Math.max(
      0,
      (
        nowMs -
        closeTimeMs
      ) /
      1000
    );

  let state =
    "STALE";

  if (
    delaySeconds <=
    FRESHNESS.candle
      .freshMaxDelaySeconds
  ) {
    state =
      "FRESH";
  } else if (
    delaySeconds <=
    FRESHNESS.candle
      .delayedMaxDelaySeconds
  ) {
    state =
      "DELAYED";
  }

  return {
    state,
    delaySeconds:
      Number(
        delaySeconds.toFixed(3)
      )
  };
}

function normalizeSymbolSnapshot(
  input,
  context = {}
) {
  if (!isPlainObject(input)) {
    throw new Mt5ContractError(
      "symbol snapshot must be an object"
    );
  }

  const canonicalSymbol =
    normalizeCanonicalSymbol(
      input.canonicalSymbol ??
      context.canonicalSymbol
    );

  const brokerSymbol =
    normalizeBrokerSymbol(
      input.brokerSymbol
    );

  if (!canonicalSymbol) {
    throw new Mt5ContractError(
      "symbol snapshot has an unsupported canonicalSymbol"
    );
  }

  if (!brokerSymbol) {
    throw new Mt5ContractError(
      "symbol snapshot requires brokerSymbol"
    );
  }

  const digits =
    normalizeDigits(
      input.digits
    );

  const point =
    normalizePoint(
      input.point
    );

  const tick =
    input.tick
      ? normalizeTick(
          input.tick,
          {
            canonicalSymbol,
            brokerSymbol,
            now:
              context.now,
            receivedAtUtc:
              context.receivedAtUtc
          }
        )
      : null;

  const rawCandles =
    isPlainObject(
      input.candles
    )
      ? input.candles
      : {};

  const candles = {};

  for (
    const timeframe of
    SUPPORTED_TIMEFRAMES
  ) {
    const candle =
      rawCandles[
        timeframe
      ];

    if (!candle) {
      candles[
        timeframe
      ] = null;

      continue;
    }

    candles[
      timeframe
    ] =
      normalizeClosedCandle(
        candle,
        {
          canonicalSymbol,
          brokerSymbol,
          timeframe,
          now:
            context.now
        }
      );
  }

  return {
    canonicalSymbol,
    brokerSymbol,
    digits,
    point,
    tradeMode:
      normalizeNonEmptyString(
        input.tradeMode
      ),
    tick,
    candles
  };
}

function normalizeBridgePayload(
  input,
  options = {}
) {
  if (!isPlainObject(input)) {
    throw new Mt5ContractError(
      "bridge payload must be an object"
    );
  }

  const schemaVersion =
    normalizeNonEmptyString(
      input.schemaVersion
    );

  if (
    schemaVersion !==
    SCHEMA_VERSION
  ) {
    throw new Mt5ContractError(
      `unsupported schemaVersion: ${schemaVersion}`,
      {
        expected:
          SCHEMA_VERSION
      }
    );
  }

  const source =
    normalizeNonEmptyString(
      input.source
    );

  if (
    source !==
    SOURCE_NAME
  ) {
    throw new Mt5ContractError(
      `unsupported source: ${source}`,
      {
        expected:
          SOURCE_NAME
      }
    );
  }

  const bridgeId =
    normalizeNonEmptyString(
      input.bridgeId
    );

  const sessionId =
    normalizeNonEmptyString(
      input.sessionId
    );

  const requestId =
    normalizeNonEmptyString(
      input.requestId
    );

  if (!bridgeId) {
    throw new Mt5ContractError(
      "bridgeId is required"
    );
  }

  if (!sessionId) {
    throw new Mt5ContractError(
      "sessionId is required"
    );
  }

  if (!requestId) {
    throw new Mt5ContractError(
      "requestId is required"
    );
  }

  const sequence =
    toNonNegativeInteger(
      input.sequence
    );

  if (sequence === null) {
    throw new Mt5ContractError(
      "sequence must be a non-negative integer"
    );
  }

  const generatedAtUtc =
    normalizeUtcIso(
      input.generatedAtUtc,
      "generatedAtUtc"
    );

  assertNotTooFarInFuture(
    generatedAtUtc,
    options.now,
    "generatedAtUtc"
  );

  const terminal =
    isPlainObject(
      input.terminal
    )
      ? input.terminal
      : {};

  const terminalConnected =
    normalizeBoolean(
      terminal.connected,
      "terminal.connected"
    );

  const accountConnected =
    terminal.accountConnected ===
      undefined
      ? terminalConnected
      : normalizeBoolean(
          terminal.accountConnected,
          "terminal.accountConnected"
        );

  const heartbeatAtUtc =
    normalizeUtcIso(
      terminal.heartbeatAtUtc ??
      generatedAtUtc,
      "terminal.heartbeatAtUtc"
    );

  assertNotTooFarInFuture(
    heartbeatAtUtc,
    options.now,
    "terminal.heartbeatAtUtc"
  );

  if (
    !isPlainObject(
      input.symbols
    )
  ) {
    throw new Mt5ContractError(
      "symbols must be an object"
    );
  }

  const symbols = {};

  for (
    const symbol of
    SUPPORTED_SYMBOLS
  ) {
    const snapshot =
      input.symbols[
        symbol
      ];

    if (!snapshot) {
      continue;
    }

    symbols[
      symbol
    ] =
      normalizeSymbolSnapshot(
        snapshot,
        {
          canonicalSymbol:
            symbol,
          now:
            options.now,
          receivedAtUtc:
            options.receivedAtUtc
        }
      );
  }

  if (
    Object.keys(
      symbols
    ).length ===
    0
  ) {
    throw new Mt5ContractError(
      "payload contains no supported symbol snapshots"
    );
  }

  return {
    schemaVersion:
      SCHEMA_VERSION,
    source:
      SOURCE_NAME,
    bridgeId,
    sessionId,
    requestId,
    sequence,
    generatedAtUtc,
    terminal: {
      connected:
        terminalConnected,
      accountConnected,
      heartbeatAtUtc,
      terminalName:
        normalizeNonEmptyString(
          terminal.terminalName
        ),
      brokerCompany:
        normalizeNonEmptyString(
          terminal.brokerCompany
        ),
      brokerServer:
        normalizeNonEmptyString(
          terminal.brokerServer
        )
    },
    symbols
  };
}

function buildEmptyPublishedSnapshot(
  options = {}
) {
  const updatedAt =
    normalizeUtcIso(
      options.updatedAt ??
      new Date(),
      "updatedAt"
    );

  const symbols = {};

  for (
    const symbol of
    SUPPORTED_SYMBOLS
  ) {
    const candles = {};

    for (
      const timeframe of
      SUPPORTED_TIMEFRAMES
    ) {
      candles[
        timeframe
      ] = null;
    }

    symbols[
      symbol
    ] = {
      canonicalSymbol:
        symbol,
      brokerSymbol:
        null,
      digits:
        null,
      point:
        null,
      tradeMode:
        null,
      tick:
        null,
      candles,
      freshness: {
        tick: {
          state:
            "OFFLINE",
          ageSeconds:
            null
        },
        candles:
          Object.fromEntries(
            SUPPORTED_TIMEFRAMES
              .map(
                timeframe => [
                  timeframe,
                  {
                    state:
                      "STALE",
                    delaySeconds:
                      null
                  }
                ]
              )
          )
      }
    };
  }

  return {
    schemaVersion:
      SCHEMA_VERSION,
    source:
      SOURCE_NAME,
    updatedAt,
    stale: true,
    bridge: {
      bridgeId:
        null,
      sessionId:
        null,
      requestId:
        null,
      sequence:
        null,
      heartbeatAtUtc:
        null,
      terminalConnected:
        false,
      accountConnected:
        false
    },
    symbols
  };
}

module.exports = Object.freeze({
  SCHEMA_VERSION,
  SOURCE_NAME,
  SUPPORTED_SYMBOLS,
  SUPPORTED_TIMEFRAMES,
  TIMEFRAME_MINUTES,
  MT5_TIMEFRAME_NAMES,
  FRESHNESS,
  MAX_FUTURE_SKEW_MS,
  Mt5ContractError,
  isPlainObject,
  toFiniteNumber,
  normalizeCanonicalSymbol,
  normalizeBrokerSymbol,
  normalizeTimeframe,
  normalizeUtcIso,
  getTimeframeDurationMs,
  isAlignedToTimeframe,
  buildCandleIdentity,
  buildTickIdentity,
  normalizeTick,
  normalizeClosedCandle,
  classifyTickFreshness,
  classifyCandleFreshness,
  normalizeSymbolSnapshot,
  normalizeBridgePayload,
  buildEmptyPublishedSnapshot
});
