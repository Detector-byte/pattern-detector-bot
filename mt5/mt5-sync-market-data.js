"use strict";

/**
 * PipSight Pro — MT5 Market Data Sync
 *
 * Isolated GitHub Actions / worker synchronization utility.
 *
 * Responsibilities:
 * - Read the public MT5 receiver base URL from environment.
 * - Download the latest market snapshot and rolling market history.
 * - Validate both documents before publication.
 * - Atomically write the exact local files consumed by
 *   mt5-market-data-adapter.js.
 * - Preserve existing local files when the receiver is unavailable,
 *   returns invalid data, or times out.
 * - Exit successfully on synchronization unavailability so the existing
 *   producer-level Twelve Data and local-cache fallbacks can continue.
 *
 * This file does not modify Signal Engine, Pattern Detection, AI confidence,
 * Telegram, dashboard schemas, or any existing producer output schema.
 */

const fs = require("fs");
const path = require("path");

const {
  validateSnapshotDocument
} = require("./mt5-market-data-adapter");

const {
  validateHistoryDocument
} = require("./mt5-history-store");

const DEFAULTS = Object.freeze({
  receiverBaseUrl:
    "",

  marketDataPath:
    "/v1/market-data",

  marketHistoryPath:
    "/v1/market-history",

  snapshotOutputPath:
    path.join(
      __dirname,
      "..",
      "data",
      "mt5-market-data.json"
    ),

  historyOutputPath:
    path.join(
      __dirname,
      "..",
      "data",
      "mt5-market-history.json"
    ),

  timeoutMs:
    15_000,

  userAgent:
    "PipSight-MT5-Sync/1.0"
});

class Mt5MarketDataSyncError extends Error {
  constructor(
    message,
    code = "MT5_MARKET_DATA_SYNC_ERROR",
    details = {}
  ) {
    super(message);

    this.name =
      "Mt5MarketDataSyncError";

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

function normalizeOptionalString(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value)
    .trim();
}

function normalizePositiveInteger(
  value,
  fallback,
  fieldName
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return fallback;
  }

  const number =
    Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    throw new Mt5MarketDataSyncError(
      `${fieldName} must be a positive safe integer`,
      "INVALID_CONFIGURATION",
      {
        fieldName,
        value
      }
    );
  }

  return number;
}

function normalizeEndpointPath(
  value,
  fallback,
  fieldName
) {
  const candidate =
    normalizeOptionalString(
      value
    ) ||
    fallback;

  if (
    !candidate.startsWith("/") ||
    candidate.includes("\r") ||
    candidate.includes("\n")
  ) {
    throw new Mt5MarketDataSyncError(
      `${fieldName} must be an absolute URL path`,
      "INVALID_CONFIGURATION",
      {
        fieldName
      }
    );
  }

  return (
    candidate.length > 1 &&
    candidate.endsWith("/")
      ? candidate.slice(0, -1)
      : candidate
  );
}

function normalizeOutputPath(
  value,
  fallback,
  fieldName
) {
  const candidate =
    normalizeOptionalString(
      value
    ) ||
    fallback;

  if (
    !candidate ||
    candidate.includes("\0") ||
    candidate.includes("\r") ||
    candidate.includes("\n")
  ) {
    throw new Mt5MarketDataSyncError(
      `${fieldName} is invalid`,
      "INVALID_CONFIGURATION",
      {
        fieldName
      }
    );
  }

  return path.resolve(
    candidate
  );
}

function normalizeReceiverBaseUrl(value) {
  const raw =
    normalizeOptionalString(
      value
    );

  if (!raw) {
    return "";
  }

  let url;

  try {
    url =
      new URL(raw);
  } catch (error) {
    throw new Mt5MarketDataSyncError(
      "MT5 receiver base URL is invalid",
      "INVALID_RECEIVER_URL",
      {
        reason:
          error instanceof Error
            ? error.message
            : String(error)
      }
    );
  }

  if (
    url.protocol !== "https:" &&
    url.protocol !== "http:"
  ) {
    throw new Mt5MarketDataSyncError(
      "MT5 receiver URL must use HTTP or HTTPS",
      "INVALID_RECEIVER_PROTOCOL",
      {
        protocol:
          url.protocol
      }
    );
  }

  if (
    url.protocol === "http:" &&
    url.hostname !== "127.0.0.1" &&
    url.hostname !== "localhost"
  ) {
    throw new Mt5MarketDataSyncError(
      "Remote MT5 receiver URL must use HTTPS",
      "INSECURE_REMOTE_RECEIVER_URL",
      {
        hostname:
          url.hostname
      }
    );
  }

  url.pathname =
    url.pathname.replace(
      /\/+$/,
      ""
    );

  url.search = "";
  url.hash = "";

  return url.toString()
    .replace(
      /\/$/,
      ""
    );
}

function buildEndpointUrl(
  baseUrl,
  endpointPath
) {
  if (!baseUrl) {
    throw new Mt5MarketDataSyncError(
      "MT5 receiver base URL is not configured",
      "RECEIVER_URL_NOT_CONFIGURED"
    );
  }

  return new URL(
    endpointPath,
    `${baseUrl}/`
  );
}

function normalizeError(error) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(
    typeof error === "string"
      ? error
      : "Unknown error"
  );
}

async function fetchJson(
  url,
  options = {}
) {
  const timeoutMs =
    normalizePositiveInteger(
      options.timeoutMs,
      DEFAULTS.timeoutMs,
      "timeoutMs"
    );

  const controller =
    new AbortController();

  const timeoutHandle =
    setTimeout(
      () => {
        controller.abort();
      },
      timeoutMs
    );

  try {
    const response =
      await fetch(
        url,
        {
          method:
            "GET",

          headers: {
            Accept:
              "application/json",

            "User-Agent":
              options.userAgent ||
              DEFAULTS.userAgent
          },

          signal:
            controller.signal
        }
      );

    const responseText =
      await response.text();

    if (!response.ok) {
      throw new Mt5MarketDataSyncError(
        `MT5 receiver request failed with HTTP ${response.status}`,
        "RECEIVER_HTTP_ERROR",
        {
          status:
            response.status,
          endpoint:
            url.toString()
        }
      );
    }

    let payload;

    try {
      payload =
        responseText
          ? JSON.parse(
              responseText
            )
          : null;
    } catch (error) {
      throw new Mt5MarketDataSyncError(
        "MT5 receiver returned invalid JSON",
        "RECEIVER_INVALID_JSON",
        {
          endpoint:
            url.toString(),
          reason:
            normalizeError(error)
              .message
        }
      );
    }

    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    ) {
      throw new Mt5MarketDataSyncError(
        "MT5 receiver returned an invalid JSON document",
        "RECEIVER_INVALID_DOCUMENT",
        {
          endpoint:
            url.toString()
        }
      );
    }

    return payload;
  } catch (error) {
    if (
      error &&
      error.name === "AbortError"
    ) {
      throw new Mt5MarketDataSyncError(
        `MT5 receiver request timed out after ${timeoutMs}ms`,
        "RECEIVER_TIMEOUT",
        {
          endpoint:
            url.toString(),
          timeoutMs
        }
      );
    }

    throw error;
  } finally {
    clearTimeout(
      timeoutHandle
    );
  }
}

function ensureDirectory(filePath) {
  fs.mkdirSync(
    path.dirname(filePath),
    {
      recursive:
        true
    }
  );
}

function atomicWriteJson(
  filePath,
  document
) {
  ensureDirectory(
    filePath
  );

  const temporaryPath =
    `${filePath}.${process.pid}.${Date.now()}.tmp`;

  const serialized =
    `${JSON.stringify(document, null, 2)}\n`;

  let temporaryCreated =
    false;

  try {
    fs.writeFileSync(
      temporaryPath,
      serialized,
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

    fs.renameSync(
      temporaryPath,
      filePath
    );

    temporaryCreated =
      false;
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
        // Preserve the original write error.
      }
    }

    throw new Mt5MarketDataSyncError(
      "Unable to atomically write synchronized MT5 data",
      "ATOMIC_WRITE_FAILED",
      {
        filePath,
        reason:
          normalizeError(error)
            .message
      }
    );
  }

  return {
    written:
      true,
    filePath,
    bytes:
      Buffer.byteLength(
        serialized,
        "utf8"
      )
  };
}

function buildConfiguration(
  environment = process.env
) {
  if (
    !environment ||
    typeof environment !== "object" ||
    Array.isArray(environment)
  ) {
    throw new Mt5MarketDataSyncError(
      "Environment configuration is invalid",
      "INVALID_ENVIRONMENT"
    );
  }

  return Object.freeze({
    receiverBaseUrl:
      normalizeReceiverBaseUrl(
        environment
          .MT5_RECEIVER_BASE_URL ||
        DEFAULTS.receiverBaseUrl
      ),

    marketDataPath:
      normalizeEndpointPath(
        environment
          .MT5_MARKET_DATA_PATH,
        DEFAULTS.marketDataPath,
        "MT5_MARKET_DATA_PATH"
      ),

    marketHistoryPath:
      normalizeEndpointPath(
        environment
          .MT5_MARKET_HISTORY_PATH,
        DEFAULTS.marketHistoryPath,
        "MT5_MARKET_HISTORY_PATH"
      ),

    snapshotOutputPath:
      normalizeOutputPath(
        environment
          .MT5_SNAPSHOT_OUTPUT_PATH,
        DEFAULTS.snapshotOutputPath,
        "MT5_SNAPSHOT_OUTPUT_PATH"
      ),

    historyOutputPath:
      normalizeOutputPath(
        environment
          .MT5_HISTORY_OUTPUT_PATH,
        DEFAULTS.historyOutputPath,
        "MT5_HISTORY_OUTPUT_PATH"
      ),

    timeoutMs:
      normalizePositiveInteger(
        environment
          .MT5_SYNC_TIMEOUT_MS,
        DEFAULTS.timeoutMs,
        "MT5_SYNC_TIMEOUT_MS"
      )
  });
}

async function synchronizeMt5MarketData(
  options = {}
) {
  const configuration =
    options.configuration ||
    buildConfiguration(
      options.environment
    );

  if (
    !configuration
      .receiverBaseUrl
  ) {
    return {
      synchronized:
        false,
      skipped:
        true,
      reason:
        "RECEIVER_URL_NOT_CONFIGURED",
      snapshot:
        null,
      history:
        null
    };
  }

  const now =
    options.now instanceof Date
      ? options.now
      : new Date();

  const snapshotUrl =
    buildEndpointUrl(
      configuration
        .receiverBaseUrl,
      configuration
        .marketDataPath
    );

  const historyUrl =
    buildEndpointUrl(
      configuration
        .receiverBaseUrl,
      configuration
        .marketHistoryPath
    );

  const [
    rawSnapshot,
    rawHistory
  ] =
    await Promise.all([
      fetchJson(
        snapshotUrl,
        {
          timeoutMs:
            configuration
              .timeoutMs
        }
      ),

      fetchJson(
        historyUrl,
        {
          timeoutMs:
            configuration
              .timeoutMs
        }
      )
    ]);

  const snapshot =
    validateSnapshotDocument(
      rawSnapshot,
      {
        now
      }
    );

  const history =
    validateHistoryDocument(
      rawHistory,
      {
        now,
        limits:
          rawHistory.limits
      }
    );

  /*
   * Validate both documents before writing either file. This prevents a
   * partially synchronized pair from becoming the primary producer source.
   */
  const snapshotWrite =
    atomicWriteJson(
      configuration
        .snapshotOutputPath,
      snapshot
    );

  try {
    const historyWrite =
      atomicWriteJson(
        configuration
          .historyOutputPath,
        history
      );

    return {
      synchronized:
        true,
      skipped:
        false,
      reason:
        null,
      receiverBaseUrl:
        configuration
          .receiverBaseUrl,
      snapshot:
        snapshotWrite,
      history:
        historyWrite,
      updatedAt:
        now.toISOString()
    };
  } catch (error) {
    /*
     * Remove the newly written snapshot when the history write fails so the
     * adapter cannot observe a newly synchronized snapshot paired with old
     * or missing history.
     */
    try {
      if (
        fs.existsSync(
          configuration
            .snapshotOutputPath
        )
      ) {
        fs.unlinkSync(
          configuration
            .snapshotOutputPath
        );
      }
    } catch {
      // Preserve the original history write error.
    }

    throw error;
  }
}

async function main() {
  let result;

  try {
    result =
      await synchronizeMt5MarketData();
  } catch (error) {
    const normalized =
      normalizeError(error);

    console.warn(
      "MT5 synchronization unavailable; existing producer fallbacks remain active:",
      normalized.message
    );

    return {
      synchronized:
        false,
      skipped:
        false,
      reason:
        error?.code ||
        "MT5_SYNC_FAILED",
      error:
        normalized.message
    };
  }

  if (result.skipped) {
    console.warn(
      "MT5_RECEIVER_BASE_URL is not configured; skipping MT5 synchronization."
    );

    return result;
  }

  console.log(
    "MT5 market data synchronized:",
    {
      snapshotPath:
        result.snapshot
          .filePath,
      snapshotBytes:
        result.snapshot
          .bytes,
      historyPath:
        result.history
          .filePath,
      historyBytes:
        result.history
          .bytes,
      updatedAt:
        result.updatedAt
    }
  );

  return result;
}

if (
  require.main === module
) {
  main()
    .catch(
      error => {
        /*
         * This is reserved for unexpected programming failures. Normal
         * receiver unavailability is handled inside main() and exits zero.
         */
        console.error(
          "MT5 synchronization failed unexpectedly:",
          error instanceof Error
            ? error.stack ||
              error.message
            : error
        );

        process.exitCode = 1;
      }
    );
}

module.exports = Object.freeze({
  DEFAULTS,
  Mt5MarketDataSyncError,
  normalizeOptionalString,
  normalizePositiveInteger,
  normalizeEndpointPath,
  normalizeOutputPath,
  normalizeReceiverBaseUrl,
  buildEndpointUrl,
  normalizeError,
  fetchJson,
  ensureDirectory,
  atomicWriteJson,
  buildConfiguration,
  synchronizeMt5MarketData,
  main
});
