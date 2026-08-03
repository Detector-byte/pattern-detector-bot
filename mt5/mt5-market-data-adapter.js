"use strict";

/**
 * PipSight Pro — MT5 Market Data Adapter
 *
 * Isolated read-only adapter between the additive MT5 bridge files and the
 * existing Pattern Detector producer layer.
 *
 * Responsibilities:
 * - Read and validate data/mt5-market-history.json.
 * - Read and validate data/mt5-market-data.json.
 * - Select the freshest valid MT5 tick.
 * - Expose rolling closed-candle history by canonical symbol/timeframe.
 * - Convert MT5 candles into existing producer-compatible row shapes.
 * - Apply explicit freshness and minimum-history checks.
 * - Return structured availability results instead of inventing data.
 *
 * This module:
 * - Does not call Twelve Data.
 * - Does not write existing Pattern Detector JSON files.
 * - Does not modify Signal Engine, Pattern Detection, AI confidence,
 *   learning, Telegram, tracker behavior, or dashboard behavior.
 * - Does not change any existing JSON schema.
 */

const fs = require("fs");
const path = require("path");

const {
  SCHEMA_VERSION,
  SOURCE_NAME,
  SUPPORTED_SYMBOLS,
  SUPPORTED_TIMEFRAMES,
  normalizeCanonicalSymbol,
  normalizeTimeframe,
  normalizeTick,
  normalizeClosedCandle
} = require("./mt5-contract");

const {
  HISTORY_SCHEMA_VERSION,
  DEFAULT_OUTPUT_PATH:
    DEFAULT_HISTORY_PATH,
  readHistoryDocument
} = require("./mt5-history-store");

const DEFAULT_SNAPSHOT_PATH =
  path.join(
    __dirname,
    "..",
    "data",
    "mt5-market-data.json"
  );

const DEFAULT_MINIMUM_ROWS = Object.freeze({
  "5m": 200,
  "15m": 100,
  "30m": 50,
  "1H": 100,
  "4H": 30,
  "D1": 200
});

/*
 * These limits are source-selection safeguards, not trading rules.
 * Callers may override them per request.
 */
const DEFAULT_MAX_AGE_MS = Object.freeze({
  tick:
    3 * 60 * 1000,

  "5m":
    30 * 60 * 1000,

  "15m":
    60 * 60 * 1000,

  "30m":
    2 * 60 * 60 * 1000,

  "1H":
    4 * 60 * 60 * 1000,

  "4H":
    16 * 60 * 60 * 1000,

  "D1":
    4 * 24 * 60 * 60 * 1000
});

const DEFAULTS = Object.freeze({
  historyPath:
    DEFAULT_HISTORY_PATH,

  snapshotPath:
    DEFAULT_SNAPSHOT_PATH,

  minimumRows:
    DEFAULT_MINIMUM_ROWS,

  maximumAgeMs:
    DEFAULT_MAX_AGE_MS,

  requireTerminalConnected:
    true,

  requireAccountConnected:
    true,

  allowStale:
    false
});

class Mt5MarketDataAdapterError extends Error {
  constructor(
    message,
    code = "MT5_MARKET_DATA_ADAPTER_ERROR",
    details = {}
  ) {
    super(message);

    this.name =
      "Mt5MarketDataAdapterError";

    this.code =
      code;

    this.details =
      isPlainObject(details)
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

function cloneJsonSafe(value) {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(
      JSON.stringify(value)
    );
  } catch (error) {
    throw new Mt5MarketDataAdapterError(
      "Value is not JSON serializable",
      "VALUE_NOT_SERIALIZABLE",
      {
        reason:
          error instanceof Error
            ? error.message
            : String(error)
      }
    );
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
    throw new Mt5MarketDataAdapterError(
      "Current time is invalid",
      "INVALID_CURRENT_TIME"
    );
  }

  return date;
}

function normalizeFilePath(
  value,
  fallback,
  fieldName
) {
  const candidate =
    value === undefined ||
    value === null
      ? fallback
      : value;

  if (
    typeof candidate !== "string" ||
    !candidate.trim()
  ) {
    throw new Mt5MarketDataAdapterError(
      `${fieldName} must be a non-empty path`,
      "INVALID_FILE_PATH",
      {
        fieldName
      }
    );
  }

  return path.resolve(
    candidate.trim()
  );
}

function normalizeNonNegativeInteger(
  value,
  fieldName
) {
  const number =
    Number(value);

  if (
    !Number.isSafeInteger(
      number
    ) ||
    number < 0
  ) {
    throw new Mt5MarketDataAdapterError(
      `${fieldName} must be a non-negative safe integer`,
      "INVALID_INTEGER",
      {
        fieldName,
        value
      }
    );
  }

  return number;
}

function normalizePositiveInteger(
  value,
  fieldName
) {
  const number =
    Number(value);

  if (
    !Number.isSafeInteger(
      number
    ) ||
    number <= 0
  ) {
    throw new Mt5MarketDataAdapterError(
      `${fieldName} must be a positive safe integer`,
      "INVALID_INTEGER",
      {
        fieldName,
        value
      }
    );
  }

  return number;
}

function normalizeMinimumRows(
  value = DEFAULT_MINIMUM_ROWS
) {
  const source =
    isPlainObject(value)
      ? value
      : {};

  const normalized = {};

  for (
    const timeframe of
    SUPPORTED_TIMEFRAMES
  ) {
    normalized[timeframe] =
      normalizeNonNegativeInteger(
        source[timeframe] ??
        DEFAULT_MINIMUM_ROWS[
          timeframe
        ],
        `minimumRows.${timeframe}`
      );
  }

  return Object.freeze(
    normalized
  );
}

function normalizeMaximumAgeMs(
  value = DEFAULT_MAX_AGE_MS
) {
  const source =
    isPlainObject(value)
      ? value
      : {};

  const normalized = {
    tick:
      normalizePositiveInteger(
        source.tick ??
        DEFAULT_MAX_AGE_MS.tick,
        "maximumAgeMs.tick"
      )
  };

  for (
    const timeframe of
    SUPPORTED_TIMEFRAMES
  ) {
    normalized[timeframe] =
      normalizePositiveInteger(
        source[timeframe] ??
        DEFAULT_MAX_AGE_MS[
          timeframe
        ],
        `maximumAgeMs.${timeframe}`
      );
  }

  return Object.freeze(
    normalized
  );
}

function getTimestampMs(
  value,
  fieldName
) {
  const timestamp =
    new Date(value)
      .getTime();

  if (
    !Number.isFinite(
      timestamp
    )
  ) {
    throw new Mt5MarketDataAdapterError(
      `${fieldName} is invalid`,
      "INVALID_TIMESTAMP",
      {
        fieldName,
        value
      }
    );
  }

  return timestamp;
}

function ageMs(
  value,
  now = new Date(),
  fieldName = "timestamp"
) {
  const nowMs =
    normalizeNow(
      now
    ).getTime();

  const valueMs =
    getTimestampMs(
      value,
      fieldName
    );

  return Math.max(
    0,
    nowMs -
      valueMs
  );
}

function formatUtcDateTime(value) {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    throw new Mt5MarketDataAdapterError(
      "Unable to format invalid timestamp",
      "INVALID_TIMESTAMP",
      {
        value
      }
    );
  }

  const iso =
    date.toISOString();

  return (
    iso.slice(0, 10) +
    " " +
    iso.slice(11, 19)
  );
}

function formatUtcDate(value) {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    throw new Mt5MarketDataAdapterError(
      "Unable to format invalid date",
      "INVALID_DATE",
      {
        value
      }
    );
  }

  return date
    .toISOString()
    .slice(0, 10);
}

function readJsonFile(
  filePath,
  options = {}
) {
  const normalizedPath =
    normalizeFilePath(
      filePath,
      null,
      "filePath"
    );

  if (
    !fs.existsSync(
      normalizedPath
    )
  ) {
    if (
      options.allowMissing ===
      true
    ) {
      return null;
    }

    throw new Mt5MarketDataAdapterError(
      "Required JSON file does not exist",
      "FILE_MISSING",
      {
        filePath:
          normalizedPath
      }
    );
  }

  let content;

  try {
    content =
      fs.readFileSync(
        normalizedPath,
        "utf8"
      );
  } catch (error) {
    throw new Mt5MarketDataAdapterError(
      "Unable to read JSON file",
      "FILE_READ_FAILED",
      {
        filePath:
          normalizedPath,
        reason:
          error instanceof Error
            ? error.message
            : String(error)
      }
    );
  }

  if (!content.trim()) {
    throw new Mt5MarketDataAdapterError(
      "JSON file is empty",
      "EMPTY_FILE",
      {
        filePath:
          normalizedPath
      }
    );
  }

  try {
    return JSON.parse(
      content
    );
  } catch (error) {
    throw new Mt5MarketDataAdapterError(
      "JSON file contains invalid JSON",
      "INVALID_JSON",
      {
        filePath:
          normalizedPath,
        reason:
          error instanceof Error
            ? error.message
            : String(error)
      }
    );
  }
}

function validateSnapshotDocument(
  document,
  options = {}
) {
  const now =
    normalizeNow(
      options.now
    );

  if (!isPlainObject(document)) {
    throw new Mt5MarketDataAdapterError(
      "MT5 snapshot must be an object",
      "INVALID_SNAPSHOT"
    );
  }

  if (
    document.schemaVersion !==
    SCHEMA_VERSION
  ) {
    throw new Mt5MarketDataAdapterError(
      "MT5 snapshot schemaVersion is unsupported",
      "SNAPSHOT_SCHEMA_MISMATCH",
      {
        expected:
          SCHEMA_VERSION,
        received:
          document.schemaVersion ??
          null
      }
    );
  }

  if (
    document.source !==
    SOURCE_NAME
  ) {
    throw new Mt5MarketDataAdapterError(
      "MT5 snapshot source is unsupported",
      "SNAPSHOT_SOURCE_MISMATCH",
      {
        expected:
          SOURCE_NAME,
        received:
          document.source ??
          null
      }
    );
  }

  if (
    typeof document.updatedAt !==
      "string" ||
    Number.isNaN(
      Date.parse(
        document.updatedAt
      )
    )
  ) {
    throw new Mt5MarketDataAdapterError(
      "MT5 snapshot updatedAt is invalid",
      "INVALID_SNAPSHOT_UPDATED_AT"
    );
  }

  if (
    typeof document.stale !==
    "boolean"
  ) {
    throw new Mt5MarketDataAdapterError(
      "MT5 snapshot stale must be boolean",
      "INVALID_SNAPSHOT_STALE"
    );
  }

  if (
    !isPlainObject(
      document.bridge
    ) ||
    !isPlainObject(
      document.symbols
    )
  ) {
    throw new Mt5MarketDataAdapterError(
      "MT5 snapshot bridge/symbols state is invalid",
      "INVALID_SNAPSHOT_SHAPE"
    );
  }

  const normalized = {
    schemaVersion:
      SCHEMA_VERSION,

    source:
      SOURCE_NAME,

    updatedAt:
      new Date(
        document.updatedAt
      ).toISOString(),

    stale:
      document.stale,

    bridge:
      cloneJsonSafe(
        document.bridge
      ),

    symbols:
      {}
  };

  for (
    const symbol of
    SUPPORTED_SYMBOLS
  ) {
    const source =
      document.symbols[
        symbol
      ];

    if (!isPlainObject(source)) {
      throw new Mt5MarketDataAdapterError(
        `MT5 snapshot is missing symbol ${symbol}`,
        "SNAPSHOT_MISSING_SYMBOL",
        {
          symbol
        }
      );
    }

    const brokerSymbol =
      typeof source.brokerSymbol ===
        "string" &&
      source.brokerSymbol.trim()
        ? source.brokerSymbol.trim()
        : null;

    const target = {
      canonicalSymbol:
        symbol,

      brokerSymbol,

      digits:
        Number.isInteger(
          source.digits
        )
          ? source.digits
          : null,

      point:
        Number.isFinite(
          Number(
            source.point
          )
        )
          ? Number(
              source.point
            )
          : null,

      tradeMode:
        source.tradeMode ??
        null,

      tick:
        null,

      candles:
        {},

      freshness:
        isPlainObject(
          source.freshness
        )
          ? cloneJsonSafe(
              source.freshness
            )
          : null
    };

    if (source.tick) {
      target.tick =
        normalizeTick(
          source.tick,
          {
            canonicalSymbol:
              symbol,
            brokerSymbol,
            now,
            receivedAtUtc:
              source.tick
                .receivedAtUtc ??
              now
          }
        );
    }

    if (
      !isPlainObject(
        source.candles
      )
    ) {
      throw new Mt5MarketDataAdapterError(
        `MT5 snapshot candles are invalid for ${symbol}`,
        "INVALID_SNAPSHOT_CANDLES",
        {
          symbol
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
        candle
          ? normalizeClosedCandle(
              candle,
              {
                canonicalSymbol:
                  symbol,
                brokerSymbol,
                timeframe,
                now
              }
            )
          : null;
    }

    normalized.symbols[
      symbol
    ] =
      target;
  }

  return normalized;
}

function loadMt5HistoryDocument(
  options = {}
) {
  const historyPath =
    normalizeFilePath(
      options.historyPath,
      DEFAULT_HISTORY_PATH,
      "historyPath"
    );

  return readHistoryDocument(
    historyPath,
    {
      now:
        options.now,
      limits:
        options.limits
    }
  );
}

function loadMt5Snapshot(
  options = {}
) {
  const snapshotPath =
    normalizeFilePath(
      options.snapshotPath,
      DEFAULT_SNAPSHOT_PATH,
      "snapshotPath"
    );

  const raw =
    readJsonFile(
      snapshotPath,
      {
        allowMissing:
          options.allowMissing ===
          true
      }
    );

  if (!raw) {
    return null;
  }

  return validateSnapshotDocument(
    raw,
    {
      now:
        options.now
    }
  );
}

function selectNewestTick(
  ...ticks
) {
  let selected =
    null;

  for (const tick of ticks) {
    if (!tick) {
      continue;
    }

    if (!selected) {
      selected =
        tick;

      continue;
    }

    const selectedTime =
      Number(
        selected.timeMsc
      );

    const candidateTime =
      Number(
        tick.timeMsc
      );

    if (
      Number.isFinite(
        candidateTime
      ) &&
      (
        !Number.isFinite(
          selectedTime
        ) ||
        candidateTime >
          selectedTime
      )
    ) {
      selected =
        tick;
    }
  }

  return selected
    ? cloneJsonSafe(
        selected
      )
    : null;
}

function convertMt5CandleToTimeRow(
  candle
) {
  if (!candle) {
    return null;
  }

  return {
    time:
      formatUtcDateTime(
        candle.openTimeUtc
      ),

    open:
      Number(
        candle.open
      ),

    high:
      Number(
        candle.high
      ),

    low:
      Number(
        candle.low
      ),

    close:
      Number(
        candle.close
      )
  };
}

function convertMt5CandleToDailyRow(
  candle
) {
  if (!candle) {
    return null;
  }

  return {
    date:
      formatUtcDate(
        candle.openTimeUtc
      ),

    open:
      Number(
        candle.open
      ),

    high:
      Number(
        candle.high
      ),

    low:
      Number(
        candle.low
      ),

    close:
      Number(
        candle.close
      )
  };
}

function normalizeRequestedLimit(
  value,
  fallback
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  return normalizeNonNegativeInteger(
    value,
    "limit"
  );
}

function buildUnavailableResult(
  reason,
  details = {}
) {
  return {
    available:
      false,

    reason,

    data:
      null,

    metadata: {
      source:
        SOURCE_NAME,

      ...cloneJsonSafe(
        details
      )
    }
  };
}

function buildAvailableResult(
  data,
  metadata = {}
) {
  return {
    available:
      true,

    reason:
      null,

    data:
      cloneJsonSafe(
        data
      ),

    metadata: {
      source:
        SOURCE_NAME,

      ...cloneJsonSafe(
        metadata
      )
    }
  };
}

class Mt5MarketDataAdapter {
  constructor(options = {}) {
    this.options =
      Object.freeze({
        historyPath:
          normalizeFilePath(
            options.historyPath,
            DEFAULT_HISTORY_PATH,
            "historyPath"
          ),

        snapshotPath:
          normalizeFilePath(
            options.snapshotPath,
            DEFAULT_SNAPSHOT_PATH,
            "snapshotPath"
          ),

        minimumRows:
          normalizeMinimumRows(
            options.minimumRows
          ),

        maximumAgeMs:
          normalizeMaximumAgeMs(
            options.maximumAgeMs
          ),

        requireTerminalConnected:
          options.requireTerminalConnected !==
          false,

        requireAccountConnected:
          options.requireAccountConnected !==
          false,

        allowStale:
          options.allowStale ===
          true
      });
  }

  load(options = {}) {
    const now =
      normalizeNow(
        options.now
      );

    let history =
      null;

    let snapshot =
      null;

    let historyError =
      null;

    let snapshotError =
      null;

    try {
      history =
        loadMt5HistoryDocument({
          historyPath:
            this.options
              .historyPath,
          now
        });
    } catch (error) {
      historyError =
        error;
    }

    try {
      snapshot =
        loadMt5Snapshot({
          snapshotPath:
            this.options
              .snapshotPath,
          now,
          allowMissing:
            true
        });
    } catch (error) {
      snapshotError =
        error;
    }

    if (
      !history &&
      !snapshot
    ) {
      throw new Mt5MarketDataAdapterError(
        "No usable MT5 history or snapshot is available",
        "MT5_DATA_UNAVAILABLE",
        {
          historyPath:
            this.options
              .historyPath,
          snapshotPath:
            this.options
              .snapshotPath,
          historyError:
            historyError
              ? {
                  name:
                    historyError.name,
                  code:
                    historyError.code ??
                    null,
                  message:
                    historyError.message
                }
              : null,
          snapshotError:
            snapshotError
              ? {
                  name:
                    snapshotError.name,
                  code:
                    snapshotError.code ??
                    null,
                  message:
                    snapshotError.message
                }
              : null
        }
      );
    }

    return {
      now:
        now.toISOString(),

      history,

      snapshot,

      diagnostics: {
        historyLoaded:
          Boolean(history),

        snapshotLoaded:
          Boolean(snapshot),

        historyError:
          historyError
            ? {
                name:
                  historyError.name,
                code:
                  historyError.code ??
                  null,
                message:
                  historyError.message
              }
            : null,

        snapshotError:
          snapshotError
            ? {
                name:
                  snapshotError.name,
                code:
                  snapshotError.code ??
                  null,
                message:
                  snapshotError.message
              }
            : null
      }
    };
  }

  checkConnection(
    loaded
  ) {
    const bridge =
      loaded.snapshot?.bridge ??
      loaded.history?.bridge ??
      {};

    if (
      this.options
        .requireTerminalConnected &&
      bridge.terminalConnected !==
        true
    ) {
      return {
        available:
          false,
        reason:
          "TERMINAL_DISCONNECTED",
        bridge:
          cloneJsonSafe(
            bridge
          )
      };
    }

    if (
      this.options
        .requireAccountConnected &&
      bridge.accountConnected !==
        true
    ) {
      return {
        available:
          false,
        reason:
          "ACCOUNT_DISCONNECTED",
        bridge:
          cloneJsonSafe(
            bridge
          )
      };
    }

    return {
      available:
        true,
      reason:
        null,
      bridge:
        cloneJsonSafe(
          bridge
        )
    };
  }

  checkMt5Availability(
    options = {}
  ) {
    let loaded;

    try {
      loaded =
        this.load(
          options
        );
    } catch (error) {
      return buildUnavailableResult(
        error.code ??
        "MT5_DATA_UNAVAILABLE",
        {
          message:
            error.message,
          details:
            error.details ??
            {}
        }
      );
    }

    const connection =
      this.checkConnection(
        loaded
      );

    if (
      !connection.available
    ) {
      return buildUnavailableResult(
        connection.reason,
        {
          bridge:
            connection.bridge,
          diagnostics:
            loaded.diagnostics
        }
      );
    }

    return buildAvailableResult(
      {
        historyLoaded:
          Boolean(
            loaded.history
          ),

        snapshotLoaded:
          Boolean(
            loaded.snapshot
          ),

        bridge:
          connection.bridge
      },
      {
        checkedAt:
          loaded.now,

        diagnostics:
          loaded.diagnostics
      }
    );
  }

  getMt5Tick(
    symbol,
    options = {}
  ) {
    const canonicalSymbol =
      normalizeCanonicalSymbol(
        symbol
      );

    if (!canonicalSymbol) {
      return buildUnavailableResult(
        "UNSUPPORTED_SYMBOL",
        {
          symbol,
          supportedSymbols:
            SUPPORTED_SYMBOLS
        }
      );
    }

    let loaded;

    try {
      loaded =
        this.load(
          options
        );
    } catch (error) {
      return buildUnavailableResult(
        error.code ??
        "MT5_DATA_UNAVAILABLE",
        {
          message:
            error.message,
          details:
            error.details ??
            {}
        }
      );
    }

    const connection =
      this.checkConnection(
        loaded
      );

    if (
      !connection.available
    ) {
      return buildUnavailableResult(
        connection.reason,
        {
          symbol:
            canonicalSymbol,
          bridge:
            connection.bridge,
          diagnostics:
            loaded.diagnostics
        }
      );
    }

    const historyTick =
      loaded.history
        ?.symbols
        ?.[canonicalSymbol]
        ?.tick ??
      null;

    const snapshotTick =
      loaded.snapshot
        ?.symbols
        ?.[canonicalSymbol]
        ?.tick ??
      null;

    const tick =
      selectNewestTick(
        historyTick,
        snapshotTick
      );

    if (!tick) {
      return buildUnavailableResult(
        "TICK_MISSING",
        {
          symbol:
            canonicalSymbol,
          diagnostics:
            loaded.diagnostics
        }
      );
    }

    const tickAgeMs =
      ageMs(
        tick.timeUtc,
        options.now,
        "tick.timeUtc"
      );

    const maximumAgeMs =
      options.maximumAgeMs ===
        undefined
        ? this.options
            .maximumAgeMs
            .tick
        : normalizePositiveInteger(
            options.maximumAgeMs,
            "maximumAgeMs"
          );

    const stale =
      tickAgeMs >
      maximumAgeMs;

    const allowStale =
      options.allowStale ===
        undefined
        ? this.options
            .allowStale
        : options.allowStale ===
          true;

    if (
      stale &&
      !allowStale
    ) {
      return buildUnavailableResult(
        "TICK_STALE",
        {
          symbol:
            canonicalSymbol,
          ageMs:
            tickAgeMs,
          maximumAgeMs,
          tickTimeUtc:
            tick.timeUtc
        }
      );
    }

    return buildAvailableResult(
      tick,
      {
        symbol:
          canonicalSymbol,
        brokerSymbol:
          tick.brokerSymbol,
        ageMs:
          tickAgeMs,
        maximumAgeMs,
        stale,
        selectedFrom:
          snapshotTick &&
          tick.identity ===
            snapshotTick.identity
            ? "snapshot"
            : "history",
        diagnostics:
          loaded.diagnostics
      }
    );
  }

  getMt5Candles(
    symbol,
    timeframe,
    options = {}
  ) {
    const canonicalSymbol =
      normalizeCanonicalSymbol(
        symbol
      );

    const canonicalTimeframe =
      normalizeTimeframe(
        timeframe
      );

    if (!canonicalSymbol) {
      return buildUnavailableResult(
        "UNSUPPORTED_SYMBOL",
        {
          symbol,
          supportedSymbols:
            SUPPORTED_SYMBOLS
        }
      );
    }

    if (!canonicalTimeframe) {
      return buildUnavailableResult(
        "UNSUPPORTED_TIMEFRAME",
        {
          timeframe,
          supportedTimeframes:
            SUPPORTED_TIMEFRAMES
        }
      );
    }

    let loaded;

    try {
      loaded =
        this.load(
          options
        );
    } catch (error) {
      return buildUnavailableResult(
        error.code ??
        "MT5_DATA_UNAVAILABLE",
        {
          message:
            error.message,
          details:
            error.details ??
            {}
        }
      );
    }

    const connection =
      this.checkConnection(
        loaded
      );

    if (
      !connection.available
    ) {
      return buildUnavailableResult(
        connection.reason,
        {
          symbol:
            canonicalSymbol,
          timeframe:
            canonicalTimeframe,
          bridge:
            connection.bridge,
          diagnostics:
            loaded.diagnostics
        }
      );
    }

    const historyRows =
      loaded.history
        ?.symbols
        ?.[canonicalSymbol]
        ?.candles
        ?.[canonicalTimeframe];

    if (
      !Array.isArray(
        historyRows
      )
    ) {
      return buildUnavailableResult(
        "HISTORY_SERIES_MISSING",
        {
          symbol:
            canonicalSymbol,
          timeframe:
            canonicalTimeframe,
          diagnostics:
            loaded.diagnostics
        }
      );
    }

    const requestedLimit =
      normalizeRequestedLimit(
        options.limit,
        historyRows.length
      );

    const rows =
      requestedLimit === 0
        ? []
        : historyRows.slice(
            -requestedLimit
          );

    const minimumRows =
      options.minimumRows ===
        undefined
        ? this.options
            .minimumRows[
              canonicalTimeframe
            ]
        : normalizeNonNegativeInteger(
            options.minimumRows,
            "minimumRows"
          );

    if (
      rows.length <
      minimumRows
    ) {
      return buildUnavailableResult(
        "INSUFFICIENT_HISTORY",
        {
          symbol:
            canonicalSymbol,
          timeframe:
            canonicalTimeframe,
          availableRows:
            rows.length,
          minimumRows,
          storedRows:
            historyRows.length
        }
      );
    }

    const latest =
      rows[
        rows.length - 1
      ] ??
      null;

    if (!latest) {
      return buildUnavailableResult(
        "HISTORY_EMPTY",
        {
          symbol:
            canonicalSymbol,
          timeframe:
            canonicalTimeframe
        }
      );
    }

    const latestAgeMs =
      ageMs(
        latest.closeTimeUtc,
        options.now,
        "latest.closeTimeUtc"
      );

    const maximumAgeMs =
      options.maximumAgeMs ===
        undefined
        ? this.options
            .maximumAgeMs[
              canonicalTimeframe
            ]
        : normalizePositiveInteger(
            options.maximumAgeMs,
            "maximumAgeMs"
          );

    const stale =
      latestAgeMs >
      maximumAgeMs;

    const allowStale =
      options.allowStale ===
        undefined
        ? this.options
            .allowStale
        : options.allowStale ===
          true;

    if (
      stale &&
      !allowStale
    ) {
      return buildUnavailableResult(
        "CANDLES_STALE",
        {
          symbol:
            canonicalSymbol,
          timeframe:
            canonicalTimeframe,
          latestCloseTimeUtc:
            latest.closeTimeUtc,
          ageMs:
            latestAgeMs,
          maximumAgeMs,
          availableRows:
            rows.length
        }
      );
    }

    return buildAvailableResult(
      rows,
      {
        symbol:
          canonicalSymbol,
        timeframe:
          canonicalTimeframe,
        availableRows:
          rows.length,
        storedRows:
          historyRows.length,
        minimumRows,
        latestOpenTimeUtc:
          latest.openTimeUtc,
        latestCloseTimeUtc:
          latest.closeTimeUtc,
        ageMs:
          latestAgeMs,
        maximumAgeMs,
        stale,
        diagnostics:
          loaded.diagnostics
      }
    );
  }

  getMt5LatestCandle(
    symbol,
    timeframe,
    options = {}
  ) {
    const result =
      this.getMt5Candles(
        symbol,
        timeframe,
        {
          ...options,
          limit:
            1,
          minimumRows:
            1
        }
      );

    if (!result.available) {
      return result;
    }

    return buildAvailableResult(
      result.data[0] ??
      null,
      result.metadata
    );
  }

  getScalpRows(
    symbol,
    options = {}
  ) {
    const result =
      this.getMt5Candles(
        symbol,
        "5m",
        options
      );

    if (!result.available) {
      return result;
    }

    return buildAvailableResult(
      result.data
        .map(
          convertMt5CandleToTimeRow
        )
        .filter(Boolean),
      {
        ...result.metadata,
        outputShape:
          "time-open-high-low-close"
      }
    );
  }

  getIntradayRows(
    symbol,
    options = {}
  ) {
    const result =
      this.getMt5Candles(
        symbol,
        "1H",
        options
      );

    if (!result.available) {
      return result;
    }

    return buildAvailableResult(
      result.data
        .map(
          convertMt5CandleToTimeRow
        )
        .filter(Boolean),
      {
        ...result.metadata,
        outputShape:
          "time-open-high-low-close"
      }
    );
  }

  getDailyRows(
    symbol,
    options = {}
  ) {
    const result =
      this.getMt5Candles(
        symbol,
        "D1",
        options
      );

    if (!result.available) {
      return result;
    }

    return buildAvailableResult(
      result.data
        .map(
          convertMt5CandleToDailyRow
        )
        .filter(Boolean),
      {
        ...result.metadata,
        outputShape:
          "date-open-high-low-close"
      }
    );
  }

  getDisplayPrice(
    symbol,
    options = {}
  ) {
    const tickResult =
      this.getMt5Tick(
        symbol,
        options
      );

    if (!tickResult.available) {
      return tickResult;
    }

    const side =
      typeof options.side ===
        "string"
        ? options.side
            .trim()
            .toUpperCase()
        : "MID";

    const tick =
      tickResult.data;

    let price;

    if (side === "BID") {
      price =
        tick.bid;
    } else if (side === "ASK") {
      price =
        tick.ask;
    } else if (side === "LAST") {
      price =
        tick.last ??
        (
          tick.bid +
          tick.ask
        ) /
        2;
    } else if (side === "MID") {
      price =
        (
          tick.bid +
          tick.ask
        ) /
        2;
    } else {
      return buildUnavailableResult(
        "UNSUPPORTED_PRICE_SIDE",
        {
          side,
          supportedSides: [
            "BID",
            "ASK",
            "MID",
            "LAST"
          ]
        }
      );
    }

    return buildAvailableResult(
      Number(price),
      {
        ...tickResult.metadata,
        side,
        bid:
          tick.bid,
        ask:
          tick.ask,
        last:
          tick.last
      }
    );
  }
}

function createMt5MarketDataAdapter(
  options = {}
) {
  return new Mt5MarketDataAdapter(
    options
  );
}

module.exports = Object.freeze({
  DEFAULT_SNAPSHOT_PATH,
  DEFAULT_HISTORY_PATH,
  DEFAULT_MINIMUM_ROWS,
  DEFAULT_MAX_AGE_MS,
  DEFAULTS,
  Mt5MarketDataAdapterError,
  Mt5MarketDataAdapter,
  isPlainObject,
  cloneJsonSafe,
  normalizeNow,
  normalizeFilePath,
  normalizeMinimumRows,
  normalizeMaximumAgeMs,
  getTimestampMs,
  ageMs,
  formatUtcDateTime,
  formatUtcDate,
  readJsonFile,
  validateSnapshotDocument,
  loadMt5HistoryDocument,
  loadMt5Snapshot,
  selectNewestTick,
  convertMt5CandleToTimeRow,
  convertMt5CandleToDailyRow,
  buildUnavailableResult,
  buildAvailableResult,
  createMt5MarketDataAdapter
});
