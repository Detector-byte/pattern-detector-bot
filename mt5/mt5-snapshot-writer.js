"use strict";

/**
 * PipSight Pro — MT5 Snapshot Writer
 *
 * Atomic publisher for the additive MT5 market-data snapshot.
 *
 * Responsibilities:
 * - Accept a snapshot object or Mt5StateStore instance
 * - Validate the MT5 contract identity
 * - Serialize deterministic JSON
 * - Create the output directory when required
 * - Write through a temporary file
 * - Atomically replace data/mt5-market-data.json
 * - Preserve the previous valid file if publication fails
 *
 * This module does not modify any existing Pattern Detector JSON output.
 */

const fs = require("fs");
const path = require("path");

const {
  SCHEMA_VERSION,
  SOURCE_NAME,
  SUPPORTED_SYMBOLS,
  SUPPORTED_TIMEFRAMES,
  buildEmptyPublishedSnapshot
} = require("./mt5-contract");

const DEFAULT_OUTPUT_PATH =
  path.join(
    __dirname,
    "..",
    "data",
    "mt5-market-data.json"
  );

const DEFAULTS = Object.freeze({
  outputPath:
    DEFAULT_OUTPUT_PATH,
  indentation:
    2,
  trailingNewline:
    true,
  createDirectory:
    true,
  fsync:
    true
});

class Mt5SnapshotWriterError extends Error {
  constructor(
    message,
    code = "SNAPSHOT_WRITER_ERROR",
    details = {}
  ) {
    super(message);
    this.name =
      "Mt5SnapshotWriterError";
    this.code =
      code;
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

function normalizeOutputPath(value) {
  const candidate =
    typeof value === "string"
      ? value.trim()
      : "";

  if (!candidate) {
    throw new Mt5SnapshotWriterError(
      "Output path is required",
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
    throw new Mt5SnapshotWriterError(
      "Indentation must be an integer between 0 and 8",
      "INVALID_INDENTATION"
    );
  }

  return indentation;
}

function cloneJsonSafe(value) {
  try {
    return JSON.parse(
      JSON.stringify(value)
    );
  } catch (error) {
    throw new Mt5SnapshotWriterError(
      "Snapshot is not JSON serializable",
      "SNAPSHOT_NOT_SERIALIZABLE",
      {
        reason:
          error.message
      }
    );
  }
}

function validateSnapshotShape(
  snapshot
) {
  if (!isPlainObject(snapshot)) {
    throw new Mt5SnapshotWriterError(
      "Snapshot must be an object",
      "INVALID_SNAPSHOT"
    );
  }

  if (
    snapshot.schemaVersion !==
    SCHEMA_VERSION
  ) {
    throw new Mt5SnapshotWriterError(
      "Snapshot schemaVersion does not match the MT5 contract",
      "SCHEMA_VERSION_MISMATCH",
      {
        expected:
          SCHEMA_VERSION,
        received:
          snapshot.schemaVersion ??
          null
      }
    );
  }

  if (
    snapshot.source !==
    SOURCE_NAME
  ) {
    throw new Mt5SnapshotWriterError(
      "Snapshot source does not match the MT5 contract",
      "SOURCE_MISMATCH",
      {
        expected:
          SOURCE_NAME,
        received:
          snapshot.source ??
          null
      }
    );
  }

  if (
    typeof snapshot.updatedAt !==
      "string" ||
    Number.isNaN(
      new Date(
        snapshot.updatedAt
      ).getTime()
    )
  ) {
    throw new Mt5SnapshotWriterError(
      "Snapshot updatedAt is invalid",
      "INVALID_UPDATED_AT"
    );
  }

  if (
    typeof snapshot.stale !==
    "boolean"
  ) {
    throw new Mt5SnapshotWriterError(
      "Snapshot stale must be boolean",
      "INVALID_STALE_STATE"
    );
  }

  if (
    !isPlainObject(
      snapshot.bridge
    )
  ) {
    throw new Mt5SnapshotWriterError(
      "Snapshot bridge must be an object",
      "INVALID_BRIDGE_STATE"
    );
  }

  if (
    !isPlainObject(
      snapshot.symbols
    )
  ) {
    throw new Mt5SnapshotWriterError(
      "Snapshot symbols must be an object",
      "INVALID_SYMBOLS_STATE"
    );
  }

  for (
    const symbol of
    SUPPORTED_SYMBOLS
  ) {
    const value =
      snapshot.symbols[
        symbol
      ];

    if (!isPlainObject(value)) {
      throw new Mt5SnapshotWriterError(
        `Snapshot is missing symbol ${symbol}`,
        "MISSING_SYMBOL",
        {
          symbol
        }
      );
    }

    if (
      value.canonicalSymbol !==
      symbol
    ) {
      throw new Mt5SnapshotWriterError(
        `Snapshot canonical symbol mismatch for ${symbol}`,
        "SYMBOL_MISMATCH",
        {
          symbol,
          received:
            value.canonicalSymbol ??
            null
        }
      );
    }

    if (
      !isPlainObject(
        value.candles
      )
    ) {
      throw new Mt5SnapshotWriterError(
        `Snapshot candles are invalid for ${symbol}`,
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
      if (
        !Object.prototype
          .hasOwnProperty.call(
            value.candles,
            timeframe
          )
      ) {
        throw new Mt5SnapshotWriterError(
          `Snapshot is missing ${symbol} ${timeframe} candle slot`,
          "MISSING_TIMEFRAME",
          {
            symbol,
            timeframe
          }
        );
      }
    }
  }

  return true;
}

function resolveSnapshot(
  source,
  options = {}
) {
  if (
    source &&
    typeof source.buildSnapshot ===
      "function"
  ) {
    return source.buildSnapshot({
      now:
        options.now
    });
  }

  if (isPlainObject(source)) {
    return source;
  }

  throw new Mt5SnapshotWriterError(
    "Source must be a snapshot object or expose buildSnapshot()",
    "INVALID_SNAPSHOT_SOURCE"
  );
}

function serializeSnapshot(
  snapshot,
  options = {}
) {
  validateSnapshotShape(
    snapshot
  );

  const indentation =
    normalizeIndentation(
      options.indentation
    );

  let output;

  try {
    output =
      JSON.stringify(
        snapshot,
        null,
        indentation
      );
  } catch (error) {
    throw new Mt5SnapshotWriterError(
      "Snapshot serialization failed",
      "SERIALIZATION_FAILED",
      {
        reason:
          error.message
      }
    );
  }

  if (
    options.trailingNewline !==
    false
  ) {
    output += "\n";
  }

  return output;
}

function ensureDirectory(
  directoryPath
) {
  try {
    fs.mkdirSync(
      directoryPath,
      {
        recursive: true
      }
    );
  } catch (error) {
    throw new Mt5SnapshotWriterError(
      "Unable to create snapshot output directory",
      "DIRECTORY_CREATE_FAILED",
      {
        directoryPath,
        reason:
          error.message
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
  let descriptor = null;

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
  let descriptor = null;

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

function atomicWriteText(
  outputPath,
  content,
  options = {}
) {
  const normalizedOutputPath =
    normalizeOutputPath(
      outputPath
    );

  if (
    typeof content !==
    "string"
  ) {
    throw new Mt5SnapshotWriterError(
      "Content must be a string",
      "INVALID_CONTENT"
    );
  }

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
    throw new Mt5SnapshotWriterError(
      "Snapshot output directory does not exist",
      "OUTPUT_DIRECTORY_MISSING",
      {
        directory
      }
    );
  }

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

    throw new Mt5SnapshotWriterError(
      "Atomic snapshot write failed",
      "ATOMIC_WRITE_FAILED",
      {
        outputPath:
          normalizedOutputPath,
        temporaryPath,
        reason:
          error.message
      }
    );
  }

  return {
    outputPath:
      normalizedOutputPath,
    bytes:
      Buffer.byteLength(
        content,
        "utf8"
      )
  };
}

function readSnapshot(
  outputPath =
    DEFAULT_OUTPUT_PATH
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
    throw new Mt5SnapshotWriterError(
      "Existing snapshot could not be read",
      "SNAPSHOT_READ_FAILED",
      {
        outputPath:
          normalizedOutputPath,
        reason:
          error.message
      }
    );
  }

  validateSnapshotShape(
    parsed
  );

  return parsed;
}

function initializeSnapshot(
  options = {}
) {
  const outputPath =
    normalizeOutputPath(
      options.outputPath ??
      DEFAULT_OUTPUT_PATH
    );

  if (
    fs.existsSync(
      outputPath
    )
  ) {
    return {
      created: false,
      outputPath,
      snapshot:
        readSnapshot(
          outputPath
        )
    };
  }

  const snapshot =
    buildEmptyPublishedSnapshot({
      updatedAt:
        options.updatedAt ??
        new Date()
    });

  const result =
    writeSnapshot(
      snapshot,
      {
        ...options,
        outputPath
      }
    );

  return {
    created: true,
    outputPath:
      result.outputPath,
    snapshot:
      result.snapshot
  };
}

function writeSnapshot(
  source,
  options = {}
) {
  const outputPath =
    normalizeOutputPath(
      options.outputPath ??
      DEFAULT_OUTPUT_PATH
    );

  const resolved =
    resolveSnapshot(
      source,
      {
        now:
          options.now
      }
    );

  const snapshot =
    cloneJsonSafe(
      resolved
    );

  validateSnapshotShape(
    snapshot
  );

  const content =
    serializeSnapshot(
      snapshot,
      {
        indentation:
          options.indentation,
        trailingNewline:
          options.trailingNewline
      }
    );

  const writeResult =
    atomicWriteText(
      outputPath,
      content,
      {
        createDirectory:
          options.createDirectory,
        fsync:
          options.fsync
      }
    );

  return {
    written: true,
    outputPath:
      writeResult.outputPath,
    bytes:
      writeResult.bytes,
    schemaVersion:
      snapshot.schemaVersion,
    source:
      snapshot.source,
    updatedAt:
      snapshot.updatedAt,
    stale:
      snapshot.stale,
    snapshot
  };
}

class Mt5SnapshotWriter {
  constructor(options = {}) {
    this.options =
      Object.freeze({
        outputPath:
          normalizeOutputPath(
            options.outputPath ??
            DEFAULT_OUTPUT_PATH
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
          false
      });

    this.stats = {
      writesSucceeded: 0,
      writesFailed: 0,
      lastWriteAt:
        null,
      lastFailureAt:
        null,
      lastFailureCode:
        null,
      lastBytes:
        0
    };
  }

  initialize(options = {}) {
    try {
      const result =
        initializeSnapshot({
          ...this.options,
          ...options,
          outputPath:
            this.options
              .outputPath
        });

      if (result.created) {
        this.stats
          .writesSucceeded += 1;

        this.stats
          .lastWriteAt =
          new Date()
            .toISOString();
      }

      return result;
    } catch (error) {
      this.recordFailure(
        error
      );

      throw error;
    }
  }

  write(
    source,
    options = {}
  ) {
    try {
      const result =
        writeSnapshot(
          source,
          {
            ...this.options,
            ...options,
            outputPath:
              this.options
                .outputPath
          }
        );

      this.stats
        .writesSucceeded += 1;

      this.stats
        .lastWriteAt =
        new Date()
          .toISOString();

      this.stats
        .lastFailureCode =
        null;

      this.stats
        .lastBytes =
        result.bytes;

      return result;
    } catch (error) {
      this.recordFailure(
        error
      );

      throw error;
    }
  }

  read() {
    return readSnapshot(
      this.options
        .outputPath
    );
  }

  exists() {
    return fs.existsSync(
      this.options
        .outputPath
    );
  }

  recordFailure(error) {
    this.stats
      .writesFailed += 1;

    this.stats
      .lastFailureAt =
      new Date()
        .toISOString();

    this.stats
      .lastFailureCode =
      error?.code ||
      "UNKNOWN_ERROR";
  }

  getStats() {
    return {
      ...this.stats,
      outputPath:
        this.options
          .outputPath
    };
  }
}

module.exports = Object.freeze({
  DEFAULT_OUTPUT_PATH,
  DEFAULTS,
  Mt5SnapshotWriterError,
  Mt5SnapshotWriter,
  isPlainObject,
  normalizeOutputPath,
  normalizeIndentation,
  cloneJsonSafe,
  validateSnapshotShape,
  resolveSnapshot,
  serializeSnapshot,
  ensureDirectory,
  buildTemporaryPath,
  atomicWriteText,
  readSnapshot,
  initializeSnapshot,
  writeSnapshot
});
