"use strict";

/**
 * PipSight Pro — MT5 History Store
 *
 * Isolated, additive rolling-history store for authenticated and
 * contract-validated MT5 market-data payloads.
 *
 * Responsibilities:
 * - Accept raw bridge payloads or already normalized bridge payloads.
 * - Reuse mt5-contract.js validation and canonical naming.
 * - Keep the latest tick per canonical symbol.
 * - Keep rolling closed-candle history per supported timeframe.
 * - Reject older tick updates.
 * - De-duplicate candles by canonical candle identity/open time.
 * - Replace a same-time candle only when its normalized content changes.
 * - Persist history through an atomic JSON write.
 * - Restore the last valid persisted history on startup.
 * - Expose safe, cloned snapshots for future adapters.
 *
 * This module does not modify Pattern Detector, Signal Engine,
 * Pattern Detection, AI confidence, learning, Telegram, tracker behavior,
 * or any existing JSON schema/output.
 */

const fs = require("fs");
const path = require("path");

const {
  SCHEMA_VERSION: MT5_SCHEMA_VERSION,
  SOURCE_NAME,
  SUPPORTED_SYMBOLS,
  SUPPORTED_TIMEFRAMES,
  normalizeBridgePayload,
  normalizeTick,
  normalizeClosedCandle,
  normalizeCanonicalSymbol,
  normalizeTimeframe,
  classifyTickFreshness,
  classifyCandleFreshness
} = require("./mt5-contract");

const HISTORY_SCHEMA_VERSION = "1.0.0";

const DEFAULT_OUTPUT_PATH =
  path.join(
    __dirname,
    "..",
    "data",
    "mt5-market-history.json"
  );

const DEFAULT_LIMITS = Object.freeze({
  "5m": 1500,
  "15m": 1000,
  "30m": 1000,
  "1H": 800,
  "4H": 500,
  "D1": 600
});

const DEFAULTS = Object.freeze({
  outputPath:
    DEFAULT_OUTPUT_PATH,

  limits:
    DEFAULT_LIMITS,

  indentation:
    2,

  trailingNewline:
    true,

  createDirectory:
    true,

  fsync:
    true,

  autoPersist:
    true,

  maximumClockRegressionMs:
    0
});

class Mt5HistoryStoreError extends Error {
  constructor(
    message,
    code = "MT5_HISTORY_STORE_ERROR",
    details = {}
  ) {
    super(message);

    this.name =
      "Mt5HistoryStoreError";

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
    throw new Mt5HistoryStoreError(
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
    throw new Mt5HistoryStoreError(
      "Current time is invalid",
      "INVALID_CURRENT_TIME"
    );
  }

  return date;
}

function normalizeOutputPath(value) {
  const candidate =
    typeof value === "string"
      ? value.trim()
      : "";

  if (!candidate) {
    throw new Mt5HistoryStoreError(
      "History output path is required",
      "INVALID_OUTPUT_PATH"
    );
  }

  return path.resolve(
    candidate
  );
}

function normalizeIndentation(value) {
  const indentation =
    value === undefined
      ? DEFAULTS.indentation
      : Number(value);

  if (
    !Number.isInteger(
      indentation
    ) ||
    indentation < 0 ||
    indentation > 8
  ) {
    throw new Mt5HistoryStoreError(
      "Indentation must be an integer between 0 and 8",
      "INVALID_INDENTATION"
    );
  }

  return indentation;
}

function normalizeMaximumClockRegressionMs(value) {
  if (value === undefined) {
    return DEFAULTS.maximumClockRegressionMs;
  }

  const normalized =
    Number(value);

  if (
    !Number.isSafeInteger(
      normalized
    ) ||
    normalized < 0
  ) {
    throw new Mt5HistoryStoreError(
      "maximumClockRegressionMs must be a non-negative safe integer",
      "INVALID_CLOCK_REGRESSION"
    );
  }

  return normalized;
}

function normalizeLimits(value = DEFAULT_LIMITS) {
  const source =
    isPlainObject(value)
      ? value
      : {};

  const limits = {};

  for (
    const timeframe of
    SUPPORTED_TIMEFRAMES
  ) {
    const candidate =
      source[timeframe] ??
      DEFAULT_LIMITS[timeframe];

    if (
      !Number.isSafeInteger(
        candidate
      ) ||
      candidate <= 0
    ) {
      throw new Mt5HistoryStoreError(
        `History limit for ${timeframe} must be a positive safe integer`,
        "INVALID_HISTORY_LIMIT",
        {
          timeframe,
          value:
            candidate
        }
      );
    }

    limits[timeframe] =
      candidate;
  }

  return Object.freeze(
    limits
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
    throw new Mt5HistoryStoreError(
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

function buildEmptySymbolHistory(
  canonicalSymbol
) {
  const candles = {};

  for (
    const timeframe of
    SUPPORTED_TIMEFRAMES
  ) {
    candles[timeframe] = [];
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

function buildEmptyHistoryDocument(
  options = {}
) {
  const now =
    normalizeNow(
      options.now
    );

  const symbols = {};

  for (
    const symbol of
    SUPPORTED_SYMBOLS
  ) {
    symbols[symbol] =
      buildEmptySymbolHistory(
        symbol
      );
  }

  return {
    historySchemaVersion:
      HISTORY_SCHEMA_VERSION,

    mt5SchemaVersion:
      MT5_SCHEMA_VERSION,

    source:
      SOURCE_NAME,

    createdAt:
      now.toISOString(),

    updatedAt:
      now.toISOString(),

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

    limits:
      normalizeLimits(
        options.limits
      ),

    symbols
  };
}

function candleKey(candle) {
  if (
    !candle ||
    typeof candle !== "object"
  ) {
    throw new Mt5HistoryStoreError(
      "Candle is invalid",
      "INVALID_CANDLE_KEY"
    );
  }

  if (
    typeof candle.identity === "string" &&
    candle.identity
  ) {
    return candle.identity;
  }

  return [
    candle.canonicalSymbol,
    candle.timeframe,
    candle.openTimeUtc
  ].join("|");
}

function compareCandlesByOpenTime(
  left,
  right
) {
  return (
    getTimestampMs(
      left.openTimeUtc,
      "left.openTimeUtc"
    ) -
    getTimestampMs(
      right.openTimeUtc,
      "right.openTimeUtc"
    )
  );
}

function sanitizeCandleArray(
  rows,
  context,
  limit
) {
  const byKey =
    new Map();

  if (!Array.isArray(rows)) {
    return [];
  }

  for (const raw of rows) {
    const normalized =
      normalizeClosedCandle(
        raw,
        context
      );

    byKey.set(
      candleKey(
        normalized
      ),
      normalized
    );
  }

  return Array.from(
    byKey.values()
  )
    .sort(
      compareCandlesByOpenTime
    )
    .slice(
      -limit
    );
}

function validateHistoryDocument(
  document,
  options = {}
) {
  const now =
    normalizeNow(
      options.now
    );

  const limits =
    normalizeLimits(
      options.limits ??
      document?.limits
    );

  if (!isPlainObject(document)) {
    throw new Mt5HistoryStoreError(
      "History document must be an object",
      "INVALID_HISTORY_DOCUMENT"
    );
  }

  if (
    document.historySchemaVersion !==
    HISTORY_SCHEMA_VERSION
  ) {
    throw new Mt5HistoryStoreError(
      "History schema version is unsupported",
      "HISTORY_SCHEMA_VERSION_MISMATCH",
      {
        expected:
          HISTORY_SCHEMA_VERSION,
        received:
          document.historySchemaVersion ??
          null
      }
    );
  }

  if (
    document.mt5SchemaVersion !==
    MT5_SCHEMA_VERSION
  ) {
    throw new Mt5HistoryStoreError(
      "MT5 contract schema version is unsupported",
      "MT5_SCHEMA_VERSION_MISMATCH",
      {
        expected:
          MT5_SCHEMA_VERSION,
        received:
          document.mt5SchemaVersion ??
          null
      }
    );
  }

  if (
    document.source !==
    SOURCE_NAME
  ) {
    throw new Mt5HistoryStoreError(
      "History source does not match the MT5 contract",
      "SOURCE_MISMATCH",
      {
        expected:
          SOURCE_NAME,
        received:
          document.source ??
          null
      }
    );
  }

  const createdAt =
    new Date(
      document.createdAt
    );

  const updatedAt =
    new Date(
      document.updatedAt
    );

  if (
    Number.isNaN(
      createdAt.getTime()
    ) ||
    Number.isNaN(
      updatedAt.getTime()
    )
  ) {
    throw new Mt5HistoryStoreError(
      "History createdAt/updatedAt is invalid",
      "INVALID_HISTORY_TIMESTAMP"
    );
  }

  if (
    typeof document.stale !==
    "boolean"
  ) {
    throw new Mt5HistoryStoreError(
      "History stale must be boolean",
      "INVALID_STALE_STATE"
    );
  }

  if (
    !isPlainObject(
      document.bridge
    )
  ) {
    throw new Mt5HistoryStoreError(
      "History bridge state is invalid",
      "INVALID_BRIDGE_STATE"
    );
  }

  if (
    !isPlainObject(
      document.symbols
    )
  ) {
    throw new Mt5HistoryStoreError(
      "History symbols state is invalid",
      "INVALID_SYMBOLS_STATE"
    );
  }

  const normalized =
    buildEmptyHistoryDocument({
      now:
        createdAt,
      limits
    });

  normalized.createdAt =
    createdAt.toISOString();

  normalized.updatedAt =
    updatedAt.toISOString();

  normalized.stale =
    document.stale;

  normalized.bridge = {
    ...normalized.bridge,
    ...cloneJsonSafe(
      document.bridge
    )
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
      throw new Mt5HistoryStoreError(
        `History is missing symbol ${symbol}`,
        "MISSING_SYMBOL",
        {
          symbol
        }
      );
    }

    const target =
      normalized.symbols[
        symbol
      ];

    target.brokerSymbol =
      typeof source.brokerSymbol === "string"
        ? source.brokerSymbol
        : null;

    target.digits =
      Number.isInteger(
        source.digits
      )
        ? source.digits
        : null;

    target.point =
      Number.isFinite(
        Number(
          source.point
        )
      )
        ? Number(
            source.point
          )
        : null;

    target.tradeMode =
      source.tradeMode ??
      null;

    target.updatedAt =
      typeof source.updatedAt === "string" &&
      !Number.isNaN(
        Date.parse(
          source.updatedAt
        )
      )
        ? new Date(
            source.updatedAt
          ).toISOString()
        : null;

    if (source.tick) {
      target.tick =
        normalizeTick(
          source.tick,
          {
            canonicalSymbol:
              symbol,
            brokerSymbol:
              target.brokerSymbol,
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
      throw new Mt5HistoryStoreError(
        `History candles are invalid for ${symbol}`,
        "INVALID_CANDLES",
        {
          symbol
        }
      );
    }

    for (
      const timeframe of
      SUPPORTED_TIMEFRAMES
    ) {
      target.candles[
        timeframe
      ] =
        sanitizeCandleArray(
          source.candles[
            timeframe
          ],
          {
            canonicalSymbol:
              symbol,
            brokerSymbol:
              target.brokerSymbol,
            timeframe,
            now
          },
          limits[
            timeframe
          ]
        );
    }
  }

  normalized.limits =
    limits;

  return normalized;
}

function ensureDirectory(
  directoryPath
) {
  try {
    fs.mkdirSync(
      directoryPath,
      {
        recursive:
          true
      }
    );
  } catch (error) {
    throw new Mt5HistoryStoreError(
      "Unable to create history output directory",
      "DIRECTORY_CREATE_FAILED",
      {
        directoryPath,
        reason:
          error instanceof Error
            ? error.message
            : String(error)
      }
    );
  }
}

function buildTemporaryPath(
  outputPath
) {
  const directory =
    path.dirname(
      outputPath
    );

  const basename =
    path.basename(
      outputPath
    );

  const unique =
    [
      process.pid,
      Date.now(),
      Math.random()
        .toString(16)
        .slice(2)
    ].join("-");

  return path.join(
    directory,
    `.${basename}.${unique}.tmp`
  );
}

function fsyncFile(
  filePath
) {
  let descriptor =
    null;

  try {
    descriptor =
      fs.openSync(
        filePath,
        "r"
      );

    fs.fsyncSync(
      descriptor
    );
  } finally {
    if (
      descriptor !==
      null
    ) {
      fs.closeSync(
        descriptor
      );
    }
  }
}

function fsyncDirectory(
  directoryPath
) {
  let descriptor =
    null;

  try {
    descriptor =
      fs.openSync(
        directoryPath,
        "r"
      );

    fs.fsyncSync(
      descriptor
    );
  } catch (error) {
    if (
      process.platform !==
      "win32"
    ) {
      throw error;
    }
  } finally {
    if (
      descriptor !==
      null
    ) {
      fs.closeSync(
        descriptor
      );
    }
  }
}

function serializeHistoryDocument(
  document,
  options = {}
) {
  const indentation =
    normalizeIndentation(
      options.indentation
    );

  let serialized;

  try {
    serialized =
      JSON.stringify(
        document,
        null,
        indentation
      );
  } catch (error) {
    throw new Mt5HistoryStoreError(
      "History serialization failed",
      "SERIALIZATION_FAILED",
      {
        reason:
          error instanceof Error
            ? error.message
            : String(error)
      }
    );
  }

  if (
    options.trailingNewline !==
    false
  ) {
    serialized += "\n";
  }

  return serialized;
}

function atomicWriteHistory(
  outputPath,
  document,
  options = {}
) {
  const normalizedOutputPath =
    normalizeOutputPath(
      outputPath
    );

  const normalizedDocument =
    validateHistoryDocument(
      cloneJsonSafe(
        document
      ),
      {
        now:
          options.now,
        limits:
          options.limits ??
          document?.limits
      }
    );

  const directory =
    path.dirname(
      normalizedOutputPath
    );

  if (
    options.createDirectory !==
    false
  ) {
    ensureDirectory(
      directory
    );
  } else if (
    !fs.existsSync(
      directory
    )
  ) {
    throw new Mt5HistoryStoreError(
      "History output directory does not exist",
      "OUTPUT_DIRECTORY_MISSING",
      {
        directory
      }
    );
  }

  const content =
    serializeHistoryDocument(
      normalizedDocument,
      options
    );

  const temporaryPath =
    buildTemporaryPath(
      normalizedOutputPath
    );

  let temporaryCreated =
    false;

  try {
    fs.writeFileSync(
      temporaryPath,
      content,
      {
        encoding:
          "utf8",
        flag:
          "wx",
        mode:
          0o600
      }
    );

    temporaryCreated =
      true;

    if (
      options.fsync !==
      false
    ) {
      fsyncFile(
        temporaryPath
      );
    }

    fs.renameSync(
      temporaryPath,
      normalizedOutputPath
    );

    temporaryCreated =
      false;

    if (
      options.fsync !==
      false
    ) {
      fsyncDirectory(
        directory
      );
    }
  } catch (error) {
    if (
      temporaryCreated &&
      fs.existsSync(
        temporaryPath
      )
    ) {
      try {
        fs.unlinkSync(
          temporaryPath
        );
      } catch {
        // Preserve the original publication error.
      }
    }

    throw new Mt5HistoryStoreError(
      "Atomic history write failed",
      "ATOMIC_WRITE_FAILED",
      {
        outputPath:
          normalizedOutputPath,
        temporaryPath,
        reason:
          error instanceof Error
            ? error.message
            : String(error)
      }
    );
  }

  return {
    written:
      true,
    outputPath:
      normalizedOutputPath,
    bytes:
      Buffer.byteLength(
        content,
        "utf8"
      ),
    document:
      normalizedDocument
  };
}

function readHistoryDocument(
  outputPath =
    DEFAULT_OUTPUT_PATH,
  options = {}
) {
  const normalizedOutputPath =
    normalizeOutputPath(
      outputPath
    );

  if (
    !fs.existsSync(
      normalizedOutputPath
    )
  ) {
    return null;
  }

  let parsed;

  try {
    parsed =
      JSON.parse(
        fs.readFileSync(
          normalizedOutputPath,
          "utf8"
        )
      );
  } catch (error) {
    throw new Mt5HistoryStoreError(
      "Existing history could not be read",
      "HISTORY_READ_FAILED",
      {
        outputPath:
          normalizedOutputPath,
        reason:
          error instanceof Error
            ? error.message
            : String(error)
      }
    );
  }

  return validateHistoryDocument(
    parsed,
    {
      now:
        options.now,
      limits:
        options.limits ??
        parsed?.limits
    }
  );
}

function mergeTick(
  currentTick,
  incomingTick,
  maximumClockRegressionMs
) {
  if (!currentTick) {
    return {
      updated:
        true,
      value:
        cloneJsonSafe(
          incomingTick
        ),
      reason:
        "ACCEPTED"
    };
  }

  const existingTimeMsc =
    Number(
      currentTick.timeMsc
    );

  const incomingTimeMsc =
    Number(
      incomingTick.timeMsc
    );

  if (
    incomingTimeMsc <
    existingTimeMsc -
      maximumClockRegressionMs
  ) {
    return {
      updated:
        false,
      value:
        currentTick,
      reason:
        "OLDER_TICK"
    };
  }

  if (
    incomingTimeMsc ===
      existingTimeMsc &&
    incomingTick.identity ===
      currentTick.identity &&
    JSON.stringify(
      incomingTick
    ) ===
      JSON.stringify(
        currentTick
      )
  ) {
    return {
      updated:
        false,
      value:
        currentTick,
      reason:
        "DUPLICATE_TICK"
    };
  }

  return {
    updated:
      true,
    value:
      cloneJsonSafe(
        incomingTick
      ),
    reason:
      "ACCEPTED"
  };
}

function mergeCandleIntoHistory(
  rows,
  incomingCandle,
  limit
) {
  const normalizedRows =
    Array.isArray(rows)
      ? rows
      : [];

  const incomingKey =
    candleKey(
      incomingCandle
    );

  const byKey =
    new Map();

  for (const row of normalizedRows) {
    byKey.set(
      candleKey(row),
      row
    );
  }

  const existing =
    byKey.get(
      incomingKey
    );

  if (
    existing &&
    JSON.stringify(existing) ===
      JSON.stringify(
        incomingCandle
      )
  ) {
    return {
      updated:
        false,
      rows:
        normalizedRows,
      reason:
        "DUPLICATE_CANDLE"
    };
  }

  byKey.set(
    incomingKey,
    cloneJsonSafe(
      incomingCandle
    )
  );

  const mergedRows =
    Array.from(
      byKey.values()
    )
      .sort(
        compareCandlesByOpenTime
      )
      .slice(
        -limit
      );

  return {
    updated:
      true,
    rows:
      mergedRows,
    reason:
      existing
        ? "REPLACED_SAME_CANDLE"
        : "APPENDED"
  };
}

class Mt5HistoryStore {
  constructor(options = {}) {
    this.options =
      Object.freeze({
        outputPath:
          normalizeOutputPath(
            options.outputPath ??
            DEFAULT_OUTPUT_PATH
          ),

        limits:
          normalizeLimits(
            options.limits
          ),

        indentation:
          normalizeIndentation(
            options.indentation
          ),

        trailingNewline:
          options.trailingNewline !==
          false,

        createDirectory:
          options.createDirectory !==
          false,

        fsync:
          options.fsync !==
          false,

        autoPersist:
          options.autoPersist !==
          false,

        maximumClockRegressionMs:
          normalizeMaximumClockRegressionMs(
            options.maximumClockRegressionMs
          )
      });

    this.state =
      buildEmptyHistoryDocument({
        limits:
          this.options.limits
      });

    this.stats = {
      payloadsAccepted:
        0,
      payloadsRejected:
        0,
      ticksAccepted:
        0,
      ticksIgnoredOlder:
        0,
      ticksIgnoredDuplicate:
        0,
      candlesAppended:
        0,
      candlesReplaced:
        0,
      candlesIgnoredDuplicate:
        0,
      symbolsUpdated:
        0,
      persistSucceeded:
        0,
      persistFailed:
        0,
      restoresSucceeded:
        0,
      restoresFailed:
        0,
      lastPersistAt:
        null,
      lastRestoreAt:
        null,
      lastFailureCode:
        null
    };

    if (
      options.loadExisting !==
      false
    ) {
      this.restore({
        allowMissing:
          true
      });
    }
  }

  restore(options = {}) {
    try {
      const existing =
        readHistoryDocument(
          this.options.outputPath,
          {
            now:
              options.now,
            limits:
              this.options.limits
          }
        );

      if (!existing) {
        if (
          options.allowMissing ===
          false
        ) {
          throw new Mt5HistoryStoreError(
            "History file does not exist",
            "HISTORY_FILE_MISSING",
            {
              outputPath:
                this.options.outputPath
            }
          );
        }

        return {
          restored:
            false,
          missing:
            true,
          outputPath:
            this.options.outputPath
        };
      }

      this.state =
        existing;

      this.stats
        .restoresSucceeded += 1;

      this.stats
        .lastRestoreAt =
        new Date()
          .toISOString();

      this.stats
        .lastFailureCode =
        null;

      return {
        restored:
          true,
        missing:
          false,
        outputPath:
          this.options.outputPath,
        document:
          this.getSnapshot({
            includeFreshness:
              false
          })
      };
    } catch (error) {
      this.stats
        .restoresFailed += 1;

      this.stats
        .lastFailureCode =
        error?.code ||
        "UNKNOWN_ERROR";

      throw error;
    }
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

    return this.ingestNormalizedPayload(
      payload,
      {
        now,
        persist:
          options.persist
      }
    );
  }

  ingestNormalizedPayload(
    payload,
    options = {}
  ) {
    const now =
      normalizeNow(
        options.now
      );

    if (
      !isPlainObject(payload) ||
      payload.schemaVersion !==
        MT5_SCHEMA_VERSION ||
      payload.source !==
        SOURCE_NAME
    ) {
      this.stats
        .payloadsRejected += 1;

      throw new Mt5HistoryStoreError(
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

      const result =
        this.mergeSymbol(
          symbol,
          incoming,
          {
            now
          }
        );

      if (result.updated) {
        updatedSymbols.push(
          symbol
        );
      }

      ignored.push(
        ...result.ignored
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

    this.stats
      .payloadsAccepted += 1;

    this.stats
      .symbolsUpdated +=
      updatedSymbols.length;

    const shouldPersist =
      options.persist ===
        undefined
        ? this.options
            .autoPersist
        : options.persist ===
          true;

    let persistence =
      null;

    if (shouldPersist) {
      persistence =
        this.persist({
          now
        });
    }

    return {
      accepted:
        true,
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
        this.state.updatedAt,
      persistence
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
      throw new Mt5HistoryStoreError(
        `Unsupported symbol: ${symbol}`,
        "UNSUPPORTED_SYMBOL"
      );
    }

    let updated =
      false;

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
        mergeTick(
          current.tick,
          incoming.tick,
          this.options
            .maximumClockRegressionMs
        );

      if (tickResult.updated) {
        current.tick =
          tickResult.value;

        this.stats
          .ticksAccepted += 1;

        updated =
          true;
      } else {
        if (
          tickResult.reason ===
          "OLDER_TICK"
        ) {
          this.stats
            .ticksIgnoredOlder += 1;
        }

        if (
          tickResult.reason ===
          "DUPLICATE_TICK"
        ) {
          this.stats
            .ticksIgnoredDuplicate += 1;
        }

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

      const result =
        mergeCandleIntoHistory(
          current.candles[
            timeframe
          ],
          incomingCandle,
          this.options
            .limits[
              timeframe
            ]
        );

      if (result.updated) {
        current.candles[
          timeframe
        ] =
          result.rows;

        if (
          result.reason ===
          "REPLACED_SAME_CANDLE"
        ) {
          this.stats
            .candlesReplaced += 1;
        } else {
          this.stats
            .candlesAppended += 1;
        }

        updated =
          true;
      } else {
        this.stats
          .candlesIgnoredDuplicate += 1;

        ignored.push({
          type:
            "CANDLE",
          symbol,
          timeframe,
          reason:
            result.reason
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

  persist(options = {}) {
    try {
      const now =
        normalizeNow(
          options.now
      );

      const result =
        atomicWriteHistory(
          this.options.outputPath,
          this.state,
          {
            now,
            limits:
              this.options.limits,
            indentation:
              this.options
                .indentation,
            trailingNewline:
              this.options
                .trailingNewline,
            createDirectory:
              this.options
                .createDirectory,
            fsync:
              this.options
                .fsync
          }
        );

      this.state =
        result.document;

      this.stats
        .persistSucceeded += 1;

      this.stats
        .lastPersistAt =
        new Date()
          .toISOString();

      this.stats
        .lastFailureCode =
        null;

      return {
        written:
          result.written,
        outputPath:
          result.outputPath,
        bytes:
          result.bytes,
        updatedAt:
          result.document
            .updatedAt
      };
    } catch (error) {
      this.stats
        .persistFailed += 1;

      this.stats
        .lastFailureCode =
        error?.code ||
        "UNKNOWN_ERROR";

      throw error;
    }
  }

  getSymbol(
    symbol,
    options = {}
  ) {
    const canonical =
      normalizeCanonicalSymbol(
        symbol
      );

    if (!canonical) {
      return null;
    }

    const snapshot =
      this.getSnapshot(
        options
      );

    return cloneJsonSafe(
      snapshot.symbols[
        canonical
      ]
    );
  }

  getCandles(
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

    if (
      !canonicalSymbol ||
      !canonicalTimeframe
    ) {
      return [];
    }

    const rows =
      this.state
        .symbols[
          canonicalSymbol
        ]
        .candles[
          canonicalTimeframe
        ];

    const requestedLimit =
      options.limit ===
        undefined
        ? rows.length
        : Number(
            options.limit
          );

    if (
      !Number.isSafeInteger(
        requestedLimit
      ) ||
      requestedLimit < 0
    ) {
      throw new Mt5HistoryStoreError(
        "Requested candle limit must be a non-negative safe integer",
        "INVALID_REQUEST_LIMIT"
      );
    }

    if (requestedLimit === 0) {
      return [];
    }

    return cloneJsonSafe(
      rows.slice(
        -requestedLimit
      )
    );
  }

  getLatestCandle(
    symbol,
    timeframe
  ) {
    const rows =
      this.getCandles(
        symbol,
        timeframe,
        {
          limit:
            1
        }
      );

    return rows[0] ??
      null;
  }

  getLatestTick(symbol) {
    const canonical =
      normalizeCanonicalSymbol(
        symbol
      );

    if (!canonical) {
      return null;
    }

    return cloneJsonSafe(
      this.state
        .symbols[
          canonical
        ]
        .tick
    );
  }

  getSnapshot(options = {}) {
    const now =
      normalizeNow(
        options.now
      );

    const includeFreshness =
      options.includeFreshness !==
      false;

    const snapshot =
      cloneJsonSafe(
        this.state
      );

    snapshot.limits =
      cloneJsonSafe(
        this.options.limits
      );

    if (!includeFreshness) {
      return snapshot;
    }

    for (
      const symbol of
      SUPPORTED_SYMBOLS
    ) {
      const value =
        snapshot.symbols[
          symbol
        ];

      value.freshness = {
        tick:
          value.tick
            ? classifyTickFreshness(
                value.tick.timeUtc,
                {
                  now
                }
              )
            : {
                state:
                  "OFFLINE",
                ageSeconds:
                  null
              },

        candles:
          {}
      };

      for (
        const timeframe of
        SUPPORTED_TIMEFRAMES
      ) {
        const rows =
          value.candles[
            timeframe
          ];

        const latest =
          rows[
            rows.length - 1
          ] ??
          null;

        value.freshness
          .candles[
            timeframe
          ] =
          latest
            ? classifyCandleFreshness(
                latest.closeTimeUtc,
                {
                  now
                }
              )
            : {
                state:
                  "STALE",
                delaySeconds:
                  null
              };
      }
    }

    snapshot.stale =
      this.computeGlobalStale(
        snapshot
      );

    return snapshot;
  }

  computeGlobalStale(snapshot) {
    if (
      !snapshot.bridge
        .terminalConnected ||
      !snapshot.bridge
        .accountConnected
    ) {
      return true;
    }

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
          ?.tick
          ?.state ===
        "FRESH"
      ) {
        return false;
      }

      for (
        const timeframe of
        SUPPORTED_TIMEFRAMES
      ) {
        if (
          value.freshness
            ?.candles
            ?.[timeframe]
            ?.state ===
          "FRESH"
        ) {
          return false;
        }
      }
    }

    return true;
  }

  clear(options = {}) {
    this.state =
      buildEmptyHistoryDocument({
        now:
          options.now,
        limits:
          this.options.limits
      });

    if (
      options.persist ===
      true ||
      (
        options.persist ===
          undefined &&
        this.options
          .autoPersist
      )
    ) {
      this.persist({
        now:
          options.now
      });
    }

    return true;
  }

  getStats() {
    return {
      ...this.stats,
      outputPath:
        this.options
          .outputPath,
      updatedAt:
        this.state
          .updatedAt,
      bridgeId:
        this.state
          .bridge
          .bridgeId,
      sessionId:
        this.state
          .bridge
          .sessionId,
      sequence:
        this.state
          .bridge
          .sequence,
      terminalConnected:
        this.state
          .bridge
          .terminalConnected,
      accountConnected:
        this.state
          .bridge
          .accountConnected,
      limits:
        cloneJsonSafe(
          this.options
            .limits
        )
    };
  }
}

module.exports = Object.freeze({
  HISTORY_SCHEMA_VERSION,
  MT5_SCHEMA_VERSION,
  SOURCE_NAME,
  DEFAULT_OUTPUT_PATH,
  DEFAULT_LIMITS,
  DEFAULTS,
  Mt5HistoryStoreError,
  Mt5HistoryStore,
  isPlainObject,
  cloneJsonSafe,
  normalizeNow,
  normalizeOutputPath,
  normalizeIndentation,
  normalizeLimits,
  getTimestampMs,
  buildEmptySymbolHistory,
  buildEmptyHistoryDocument,
  candleKey,
  compareCandlesByOpenTime,
  sanitizeCandleArray,
  validateHistoryDocument,
  ensureDirectory,
  buildTemporaryPath,
  serializeHistoryDocument,
  atomicWriteHistory,
  readHistoryDocument,
  mergeTick,
  mergeCandleIntoHistory
});
