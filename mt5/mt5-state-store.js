"use strict";

/**
 * PipSight Pro — MT5 State Store
 *
 * Isolated in-memory state manager for authenticated and contract-validated
 * MT5 market-data payloads.
 *
 * Responsibilities:
 * - Merge latest tick data per canonical symbol
 * - Merge latest fully closed candles for all supported timeframes
 * - Reject older tick/candle updates
 * - Preserve last known good values
 * - Compute freshness per symbol and timeframe
 * - Expose safe public snapshots
 * - Track ingestion and merge statistics
 *
 * This module does not alter Pattern Detector, Signal Engine, Pattern Detection,
 * AI confidence, learning, Telegram, tracker behavior, or existing JSON schemas.
 */

const {
  SCHEMA_VERSION,
  SOURCE_NAME,
  SUPPORTED_SYMBOLS,
  SUPPORTED_TIMEFRAMES,
  classifyTickFreshness,
  classifyCandleFreshness,
  normalizeBridgePayload,
  buildEmptyPublishedSnapshot
} = require("./mt5-contract");

const DEFAULTS = Object.freeze({
  tickRetentionMs: 5 * 60 * 1000,
  candleRetentionMs: 7 * 24 * 60 * 60 * 1000,
  maximumClockRegressionMs: 0
});

class Mt5StateStoreError extends Error {
  constructor(
    message,
    code = "STATE_STORE_ERROR",
    details = {}
  ) {
    super(message);
    this.name = "Mt5StateStoreError";
    this.code = code;
    this.details =
      details &&
      typeof details === "object" &&
      !Array.isArray(details)
        ? details
        : {};
  }
}

function normalizeNow(value = new Date()) {
  const date =
    value instanceof Date
      ? new Date(
          value.getTime()
        )
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    throw new Mt5StateStoreError(
      "Current time is invalid",
      "INVALID_CURRENT_TIME"
    );
  }

  return date;
}

function cloneJsonSafe(value) {
  if (
    value === undefined
  ) {
    return undefined;
  }

  return JSON.parse(
    JSON.stringify(value)
  );
}

function getTimestampMs(
  value,
  fieldName
) {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    throw new Mt5StateStoreError(
      `${fieldName} is invalid`,
      "INVALID_TIMESTAMP",
      {
        fieldName,
        value
      }
    );
  }

  return date.getTime();
}

function buildSymbolState(
  canonicalSymbol
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

  return {
    canonicalSymbol,
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
    updatedAt:
      null
  };
}

function buildInternalState() {
  const symbols = {};

  for (
    const symbol of
    SUPPORTED_SYMBOLS
  ) {
    symbols[
      symbol
    ] =
      buildSymbolState(
        symbol
      );
  }

  return {
    schemaVersion:
      SCHEMA_VERSION,
    source:
      SOURCE_NAME,
    updatedAt:
      null,
    stale:
      true,
    bridge: {
      bridgeId:
        null,
      sessionId:
        null,
      requestId:
        null,
      sequence:
        null,
      generatedAtUtc:
        null,
      heartbeatAtUtc:
        null,
      terminalConnected:
        false,
      accountConnected:
        false,
      terminalName:
        null,
      brokerCompany:
        null,
      brokerServer:
        null
    },
    symbols
  };
}

class Mt5StateStore {
  constructor(options = {}) {
    this.options = Object.freeze({
      tickRetentionMs:
        Number.isSafeInteger(
          options.tickRetentionMs
        ) &&
        options.tickRetentionMs > 0
          ? options.tickRetentionMs
          : DEFAULTS.tickRetentionMs,

      candleRetentionMs:
        Number.isSafeInteger(
          options.candleRetentionMs
        ) &&
        options.candleRetentionMs > 0
          ? options.candleRetentionMs
          : DEFAULTS.candleRetentionMs,

      maximumClockRegressionMs:
        Number.isSafeInteger(
          options.maximumClockRegressionMs
        ) &&
        options.maximumClockRegressionMs >= 0
          ? options.maximumClockRegressionMs
          : DEFAULTS.maximumClockRegressionMs
    });

    this.state =
      buildInternalState();

    this.stats = {
      payloadsAccepted: 0,
      payloadsRejected: 0,
      ticksAccepted: 0,
      ticksIgnoredOlder: 0,
      candlesAccepted: 0,
      candlesIgnoredOlder: 0,
      symbolsUpdated: 0,
      snapshotsBuilt: 0
    };
  }

  ingestPayload(
    rawPayload,
    options = {}
  ) {
    const now =
      normalizeNow(
        options.now
      );

    let payload;

    try {
      payload =
        normalizeBridgePayload(
          rawPayload,
          {
            now,
            receivedAtUtc:
              options.receivedAtUtc ??
              now
          }
        );
    } catch (error) {
      this.stats
        .payloadsRejected += 1;

      throw error;
    }

    const result =
      this.mergeNormalizedPayload(
        payload,
        {
          now
        }
      );

    this.stats
      .payloadsAccepted += 1;

    return result;
  }

  mergeNormalizedPayload(
    payload,
    options = {}
  ) {
    const now =
      normalizeNow(
        options.now
      );

    if (
      !payload ||
      typeof payload !==
        "object" ||
      Array.isArray(payload)
    ) {
      throw new Mt5StateStoreError(
        "Normalized payload is invalid",
        "INVALID_NORMALIZED_PAYLOAD"
      );
    }

    if (
      payload.schemaVersion !==
        SCHEMA_VERSION ||
      payload.source !==
        SOURCE_NAME
    ) {
      throw new Mt5StateStoreError(
        "Normalized payload contract does not match",
        "CONTRACT_MISMATCH"
      );
    }

    const updatedSymbols = [];
    const ignored = [];

    for (
      const symbol of
      SUPPORTED_SYMBOLS
    ) {
      const incoming =
        payload.symbols?.[
          symbol
        ];

      if (!incoming) {
        continue;
      }

      const mergeResult =
        this.mergeSymbol(
          symbol,
          incoming,
          {
            now
          }
        );

      if (mergeResult.updated) {
        updatedSymbols.push(
          symbol
        );
      }

      ignored.push(
        ...mergeResult.ignored
      );
    }

    this.state.bridge = {
      bridgeId:
        payload.bridgeId,
      sessionId:
        payload.sessionId,
      requestId:
        payload.requestId,
      sequence:
        payload.sequence,
      generatedAtUtc:
        payload.generatedAtUtc,
      heartbeatAtUtc:
        payload.terminal
          .heartbeatAtUtc,
      terminalConnected:
        payload.terminal
          .connected,
      accountConnected:
        payload.terminal
          .accountConnected,
      terminalName:
        payload.terminal
          .terminalName,
      brokerCompany:
        payload.terminal
          .brokerCompany,
      brokerServer:
        payload.terminal
          .brokerServer
    };

    this.state.updatedAt =
      now.toISOString();

    this.state.stale =
      !payload.terminal
        .connected ||
      !payload.terminal
        .accountConnected;

    this.stats.symbolsUpdated +=
      updatedSymbols.length;

    return {
      accepted: true,
      updatedSymbols,
      ignored,
      bridge: {
        bridgeId:
          payload.bridgeId,
        sessionId:
          payload.sessionId,
        requestId:
          payload.requestId,
        sequence:
          payload.sequence
      },
      updatedAt:
        this.state.updatedAt
    };
  }

  mergeSymbol(
    symbol,
    incoming,
    options = {}
  ) {
    const now =
      normalizeNow(
        options.now
      );

    const current =
      this.state.symbols[
        symbol
      ];

    if (!current) {
      throw new Mt5StateStoreError(
        `Unsupported symbol: ${symbol}`,
        "UNSUPPORTED_SYMBOL"
      );
    }

    let updated = false;
    const ignored = [];

    current.brokerSymbol =
      incoming.brokerSymbol;

    current.digits =
      incoming.digits;

    current.point =
      incoming.point;

    current.tradeMode =
      incoming.tradeMode;

    if (incoming.tick) {
      const tickResult =
        this.mergeTick(
          current,
          incoming.tick
        );

      updated =
        updated ||
        tickResult.updated;

      if (!tickResult.updated) {
        ignored.push({
          type:
            "TICK",
          symbol,
          reason:
            tickResult.reason
        });
      }
    }

    for (
      const timeframe of
      SUPPORTED_TIMEFRAMES
    ) {
      const incomingCandle =
        incoming.candles?.[
          timeframe
        ];

      if (!incomingCandle) {
        continue;
      }

      const candleResult =
        this.mergeCandle(
          current,
          timeframe,
          incomingCandle
        );

      updated =
        updated ||
        candleResult.updated;

      if (!candleResult.updated) {
        ignored.push({
          type:
            "CANDLE",
          symbol,
          timeframe,
          reason:
            candleResult.reason
        });
      }
    }

    if (updated) {
      current.updatedAt =
        now.toISOString();
    }

    return {
      updated,
      ignored
    };
  }

  mergeTick(
    currentSymbol,
    incomingTick
  ) {
    const existing =
      currentSymbol.tick;

    if (existing) {
      const existingTimeMs =
        Number(
          existing.timeMsc
        );

      const incomingTimeMs =
        Number(
          incomingTick.timeMsc
        );

      if (
        incomingTimeMs <
        existingTimeMs -
        this.options
          .maximumClockRegressionMs
      ) {
        this.stats
          .ticksIgnoredOlder += 1;

        return {
          updated: false,
          reason:
            "OLDER_TICK"
        };
      }

      if (
        incomingTimeMs ===
          existingTimeMs &&
        incomingTick.identity ===
          existing.identity
      ) {
        return {
          updated: false,
          reason:
            "DUPLICATE_TICK"
        };
      }
    }

    currentSymbol.tick =
      cloneJsonSafe(
        incomingTick
      );

    this.stats
      .ticksAccepted += 1;

    return {
      updated: true,
      reason:
        "ACCEPTED"
    };
  }

  mergeCandle(
    currentSymbol,
    timeframe,
    incomingCandle
  ) {
    const existing =
      currentSymbol.candles[
        timeframe
      ];

    if (existing) {
      const existingOpenMs =
        getTimestampMs(
          existing.openTimeUtc,
          "existing.openTimeUtc"
        );

      const incomingOpenMs =
        getTimestampMs(
          incomingCandle.openTimeUtc,
          "incoming.openTimeUtc"
        );

      if (
        incomingOpenMs <
        existingOpenMs
      ) {
        this.stats
          .candlesIgnoredOlder += 1;

        return {
          updated: false,
          reason:
            "OLDER_CANDLE"
        };
      }

      if (
        incomingOpenMs ===
          existingOpenMs &&
        incomingCandle.identity ===
          existing.identity &&
        JSON.stringify(
          incomingCandle
        ) ===
          JSON.stringify(
            existing
          )
      ) {
        return {
          updated: false,
          reason:
            "DUPLICATE_CANDLE"
        };
      }
    }

    currentSymbol.candles[
      timeframe
    ] =
      cloneJsonSafe(
        incomingCandle
      );

    this.stats
      .candlesAccepted += 1;

    return {
      updated: true,
      reason:
        "ACCEPTED"
    };
  }

  getSymbol(
    symbol,
    options = {}
  ) {
    const normalized =
      String(
        symbol ?? ""
      )
        .trim()
        .toUpperCase();

    if (
      !SUPPORTED_SYMBOLS.includes(
        normalized
      )
    ) {
      return null;
    }

    const snapshot =
      this.buildSnapshot(
        options
      );

    return cloneJsonSafe(
      snapshot.symbols[
        normalized
      ]
    );
  }

  buildSnapshot(
    options = {}
  ) {
    const now =
      normalizeNow(
        options.now
      );

    const snapshot =
      buildEmptyPublishedSnapshot({
        updatedAt:
          this.state.updatedAt ??
          now
      });

    snapshot.stale =
      this.state.stale;

    snapshot.bridge = {
      bridgeId:
        this.state.bridge
          .bridgeId,
      sessionId:
        this.state.bridge
          .sessionId,
      requestId:
        this.state.bridge
          .requestId,
      sequence:
        this.state.bridge
          .sequence,
      heartbeatAtUtc:
        this.state.bridge
          .heartbeatAtUtc,
      terminalConnected:
        this.state.bridge
          .terminalConnected,
      accountConnected:
        this.state.bridge
          .accountConnected
    };

    for (
      const symbol of
      SUPPORTED_SYMBOLS
    ) {
      const source =
        this.state.symbols[
          symbol
        ];

      const target =
        snapshot.symbols[
          symbol
        ];

      target.brokerSymbol =
        source.brokerSymbol;

      target.digits =
        source.digits;

      target.point =
        source.point;

      target.tradeMode =
        source.tradeMode;

      target.tick =
        cloneJsonSafe(
          source.tick
        );

      if (source.tick) {
        target.freshness.tick =
          classifyTickFreshness(
            source.tick.timeUtc,
            {
              now
            }
          );
      }

      for (
        const timeframe of
        SUPPORTED_TIMEFRAMES
      ) {
        const candle =
          source.candles[
            timeframe
          ];

        target.candles[
          timeframe
        ] =
          cloneJsonSafe(
            candle
          );

        if (candle) {
          target.freshness
            .candles[
              timeframe
            ] =
            classifyCandleFreshness(
              candle.closeTimeUtc,
              {
                now
              }
            );
        }
      }
    }

    snapshot.stale =
      this.computeGlobalStale(
        snapshot
      );

    this.stats
      .snapshotsBuilt += 1;

    return snapshot;
  }

  computeGlobalStale(
    snapshot
  ) {
    if (
      !snapshot.bridge
        .terminalConnected ||
      !snapshot.bridge
        .accountConnected
    ) {
      return true;
    }

    let hasFreshData =
      false;

    for (
      const symbol of
      SUPPORTED_SYMBOLS
    ) {
      const value =
        snapshot.symbols[
          symbol
        ];

      if (
        value.freshness
          .tick.state ===
        "FRESH"
      ) {
        hasFreshData =
          true;

        break;
      }

      for (
        const timeframe of
        SUPPORTED_TIMEFRAMES
      ) {
        if (
          value.freshness
            .candles[
              timeframe
            ].state ===
          "FRESH"
        ) {
          hasFreshData =
            true;

          break;
        }
      }

      if (hasFreshData) {
        break;
      }
    }

    return !hasFreshData;
  }

  prune(
    options = {}
  ) {
    const now =
      normalizeNow(
        options.now
      );

    const nowMs =
      now.getTime();

    let removedTicks = 0;
    let removedCandles = 0;

    for (
      const symbol of
      SUPPORTED_SYMBOLS
    ) {
      const value =
        this.state.symbols[
          symbol
        ];

      if (value.tick) {
        const tickTimeMs =
          getTimestampMs(
            value.tick.timeUtc,
            "tick.timeUtc"
          );

        if (
          nowMs -
          tickTimeMs >
          this.options
            .tickRetentionMs
        ) {
          value.tick =
            null;

          removedTicks += 1;
        }
      }

      for (
        const timeframe of
        SUPPORTED_TIMEFRAMES
      ) {
        const candle =
          value.candles[
            timeframe
          ];

        if (!candle) {
          continue;
        }

        const closeTimeMs =
          getTimestampMs(
            candle.closeTimeUtc,
            "candle.closeTimeUtc"
          );

        if (
          nowMs -
          closeTimeMs >
          this.options
            .candleRetentionMs
        ) {
          value.candles[
            timeframe
          ] = null;

          removedCandles += 1;
        }
      }
    }

    return {
      removedTicks,
      removedCandles,
      prunedAt:
        now.toISOString()
    };
  }

  clear() {
    this.state =
      buildInternalState();

    return true;
  }

  getStats() {
    return {
      ...this.stats,
      updatedAt:
        this.state.updatedAt,
      bridgeId:
        this.state.bridge
          .bridgeId,
      sessionId:
        this.state.bridge
          .sessionId,
      sequence:
        this.state.bridge
          .sequence,
      terminalConnected:
        this.state.bridge
          .terminalConnected,
      accountConnected:
        this.state.bridge
          .accountConnected
    };
  }
}

module.exports = Object.freeze({
  DEFAULTS,
  Mt5StateStoreError,
  Mt5StateStore,
  normalizeNow,
  cloneJsonSafe,
  getTimestampMs,
  buildSymbolState,
  buildInternalState
});
