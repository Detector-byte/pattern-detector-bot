"use strict";

/**
 * PipSight Pro — MT5 Receiver
 *
 * Isolated HTTP receiver that combines:
 * - HMAC authentication
 * - Replay and ordering protection
 * - MT5 payload contract validation
 * - In-memory state management
 * - Persistent rolling candle-history management
 * - Atomic snapshot publication
 *
 * Default endpoints:
 * - POST /v1/ingest/mt5
 * - GET  /v1/market-data
 * - GET  /v1/market-data/:symbol
 * - GET  /v1/health
 *
 * This receiver is additive and does not alter the existing Pattern Detector
 * runtime, Signal Engine, Pattern Detection, AI confidence, learning,
 * Telegram behavior, tracker behavior, or existing JSON schemas.
 */

const http = require("http");
const { URL } = require("url");

const {
  verifyRequestAuthentication,
  Mt5AuthError
} = require("./mt5-auth");

const {
  Mt5ReplayStore,
  Mt5ReplayStoreError
} = require("./mt5-replay-store");

const {
  Mt5StateStore,
  Mt5StateStoreError
} = require("./mt5-state-store");

const {
  Mt5HistoryStore,
  Mt5HistoryStoreError
} = require("./mt5-history-store");

const {
  Mt5SnapshotWriter,
  Mt5SnapshotWriterError
} = require("./mt5-snapshot-writer");

const {
  SUPPORTED_SYMBOLS,
  Mt5ContractError
} = require("./mt5-contract");

const DEFAULTS = Object.freeze({
  host: "127.0.0.1",
  port: 8787,
  ingestPath: "/v1/ingest/mt5",
  marketDataPath: "/v1/market-data",
  healthPath: "/v1/health",
  maximumBodyBytes: 512 * 1024,
  requestTimeoutMs: 15_000,
  replayWindowSeconds: 300,
  maxFutureSkewSeconds: 30,
  minimumSecretLength: 32,
  publicReadEnabled: true,
  initializeSnapshotOnStart: true
});

class Mt5ReceiverError extends Error {
  constructor(
    message,
    code = "RECEIVER_ERROR",
    statusCode = 500,
    details = {}
  ) {
    super(message);
    this.name = "Mt5ReceiverError";
    this.code = code;
    this.statusCode = statusCode;
    this.details =
      details &&
      typeof details === "object" &&
      !Array.isArray(details)
        ? details
        : {};
  }
}

function normalizePositiveInteger(
  value,
  fallback,
  fieldName
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const number = Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    throw new Mt5ReceiverError(
      `${fieldName} must be a positive safe integer`,
      "INVALID_CONFIGURATION",
      500
    );
  }

  return number;
}

function normalizePort(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return DEFAULTS.port;
  }

  const port =
    Number(value);

  if (
    !Number.isSafeInteger(port) ||
    port < 0 ||
    port > 65_535
  ) {
    throw new Mt5ReceiverError(
      "port must be an integer between 0 and 65535",
      "INVALID_CONFIGURATION",
      500
    );
  }

  return port;
}

function normalizeHost(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return DEFAULTS.host;
  }

  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Mt5ReceiverError(
      "host must be a non-empty string",
      "INVALID_CONFIGURATION",
      500
    );
  }

  return value.trim();
}

function normalizePath(value, fallback) {
  const candidate =
    value === undefined ||
    value === null
      ? fallback
      : value;

  if (
    typeof candidate !== "string" ||
    !candidate.startsWith("/") ||
    candidate.includes("\r") ||
    candidate.includes("\n")
  ) {
    throw new Mt5ReceiverError(
      "Endpoint path is invalid",
      "INVALID_CONFIGURATION",
      500
    );
  }

  return candidate.length > 1 &&
    candidate.endsWith("/")
      ? candidate.slice(0, -1)
      : candidate;
}

function normalizeSecretResolver(
  options = {}
) {
  if (
    typeof options.resolveSecret ===
    "function"
  ) {
    return options.resolveSecret;
  }

  if (
    options.secrets &&
    typeof options.secrets ===
      "object" &&
    !Array.isArray(options.secrets)
  ) {
    const secrets = {
      ...options.secrets
    };

    return bridgeId =>
      typeof secrets[bridgeId] ===
      "string"
        ? secrets[bridgeId]
        : null;
  }

  if (
    typeof options.sharedSecret ===
      "string"
  ) {
    const sharedSecret =
      options.sharedSecret;

    return () =>
      sharedSecret;
  }

  return bridgeId => {
    const environmentKey =
      `MT5_SHARED_SECRET_${String(
        bridgeId ?? ""
      )
        .trim()
        .toUpperCase()
        .replace(
          /[^A-Z0-9]+/g,
          "_"
        )}`;

    return (
      process.env[environmentKey] ||
      process.env.MT5_SHARED_SECRET ||
      null
    );
  };
}

function sendJson(
  response,
  statusCode,
  payload,
  headers = {}
) {
  const body =
    JSON.stringify(
      payload,
      null,
      2
    ) + "\n";

  response.writeHead(
    statusCode,
    {
      "content-type":
        "application/json; charset=utf-8",
      "content-length":
        Buffer.byteLength(
          body,
          "utf8"
        ),
      "cache-control":
        "no-store",
      ...headers
    }
  );

  response.end(body);
}

function sendMethodNotAllowed(
  response,
  allowedMethods
) {
  sendJson(
    response,
    405,
    {
      ok: false,
      error: {
        code:
          "METHOD_NOT_ALLOWED",
        message:
          "HTTP method is not allowed"
      }
    },
    {
      allow:
        allowedMethods.join(", ")
    }
  );
}

function readRequestBody(
  request,
  options = {}
) {
  const maximumBodyBytes =
    normalizePositiveInteger(
      options.maximumBodyBytes,
      DEFAULTS.maximumBodyBytes,
      "maximumBodyBytes"
    );

  const timeoutMs =
    normalizePositiveInteger(
      options.timeoutMs,
      DEFAULTS.requestTimeoutMs,
      "requestTimeoutMs"
    );

  return new Promise(
    (resolve, reject) => {
      const chunks = [];
      let totalBytes = 0;
      let settled = false;

      const finishReject =
        error => {
          if (settled) {
            return;
          }

          settled = true;
          reject(error);
        };

      const finishResolve =
        value => {
          if (settled) {
            return;
          }

          settled = true;
          resolve(value);
        };

      const timer =
        setTimeout(
          () => {
            finishReject(
              new Mt5ReceiverError(
                "Request body timed out",
                "REQUEST_TIMEOUT",
                408
              )
            );

            request.destroy();
          },
          timeoutMs
        );

      request.on(
        "data",
        chunk => {
          if (settled) {
            return;
          }

          const buffer =
            Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk);

          totalBytes +=
            buffer.length;

          if (
            totalBytes >
            maximumBodyBytes
          ) {
            clearTimeout(timer);

            finishReject(
              new Mt5ReceiverError(
                "Request body is too large",
                "PAYLOAD_TOO_LARGE",
                413,
                {
                  maximumBodyBytes
                }
              )
            );

            request.destroy();

            return;
          }

          chunks.push(buffer);
        }
      );

      request.on(
        "end",
        () => {
          clearTimeout(timer);

          finishResolve(
            Buffer.concat(chunks)
          );
        }
      );

      request.on(
        "aborted",
        () => {
          clearTimeout(timer);

          finishReject(
            new Mt5ReceiverError(
              "Request was aborted",
              "REQUEST_ABORTED",
              400
            )
          );
        }
      );

      request.on(
        "error",
        error => {
          clearTimeout(timer);

          finishReject(
            new Mt5ReceiverError(
              "Unable to read request body",
              "REQUEST_READ_FAILED",
              400,
              {
                reason:
                  error.message
              }
            )
          );
        }
      );
    }
  );
}

function parseJsonBody(bodyBuffer) {
  if (
    !Buffer.isBuffer(bodyBuffer)
  ) {
    throw new Mt5ReceiverError(
      "Request body buffer is invalid",
      "INVALID_BODY_BUFFER",
      400
    );
  }

  if (bodyBuffer.length === 0) {
    throw new Mt5ReceiverError(
      "Request body is required",
      "EMPTY_BODY",
      400
    );
  }

  try {
    return JSON.parse(
      bodyBuffer.toString("utf8")
    );
  } catch (error) {
    throw new Mt5ReceiverError(
      "Request body is not valid JSON",
      "INVALID_JSON",
      400,
      {
        reason:
          error.message
      }
    );
  }
}

function normalizeRequestPath(
  request
) {
  const host =
    request.headers.host ||
    "localhost";

  const parsed =
    new URL(
      request.url ||
      "/",
      `http://${host}`
    );

  return {
    pathname:
      parsed.pathname.length > 1 &&
      parsed.pathname.endsWith("/")
        ? parsed.pathname.slice(0, -1)
        : parsed.pathname,

    search:
      parsed.search
  };
}

function getBridgeIdFromHeaders(
  headers
) {
  const value =
    headers?.["x-bridge-id"];

  if (Array.isArray(value)) {
    return value[0] || null;
  }

  return (
    typeof value === "string"
      ? value
      : null
  );
}

function mapError(error) {
  if (
    error instanceof
      Mt5ReceiverError
  ) {
    return {
      statusCode:
        error.statusCode,
      code:
        error.code,
      message:
        error.message,
      details:
        error.details
    };
  }

  if (
    error instanceof
      Mt5AuthError
  ) {
    return {
      statusCode: 401,
      code:
        error.code ||
        "AUTHENTICATION_FAILED",
      message:
        error.message,
      details:
        error.details ||
        {}
    };
  }

  if (
    error instanceof
      Mt5ReplayStoreError
  ) {
    const conflictCodes =
      new Set([
        "NONCE_REPLAY",
        "OUT_OF_ORDER_SEQUENCE",
        "REPLAY_WINDOW_EXPIRED"
      ]);

    return {
      statusCode:
        conflictCodes.has(
          error.code
        )
          ? 409
          : 400,
      code:
        error.code ||
        "REPLAY_VALIDATION_FAILED",
      message:
        error.message,
      details:
        error.details ||
        {}
    };
  }

  if (
    error instanceof
      Mt5ContractError
  ) {
    return {
      statusCode: 422,
      code:
        "CONTRACT_VALIDATION_FAILED",
      message:
        error.message,
      details:
        error.details ||
        {}
    };
  }

  if (
    error instanceof
      Mt5StateStoreError ||
    error instanceof
      Mt5HistoryStoreError ||
    error instanceof
      Mt5SnapshotWriterError
  ) {
    return {
      statusCode: 500,
      code:
        error.code ||
        "INTERNAL_STORAGE_ERROR",
      message:
        error.message,
      details:
        error.details ||
        {}
    };
  }

  return {
    statusCode: 500,
    code:
      "INTERNAL_SERVER_ERROR",
    message:
      "Internal server error",
    details: {}
  };
}

class Mt5Receiver {
  constructor(options = {}) {
    this.options =
      Object.freeze({
        host:
          normalizeHost(
            options.host
          ),

        port:
          normalizePort(
            options.port
          ),

        ingestPath:
          normalizePath(
            options.ingestPath,
            DEFAULTS.ingestPath
          ),

        marketDataPath:
          normalizePath(
            options.marketDataPath,
            DEFAULTS.marketDataPath
          ),

        healthPath:
          normalizePath(
            options.healthPath,
            DEFAULTS.healthPath
          ),

        maximumBodyBytes:
          normalizePositiveInteger(
            options.maximumBodyBytes,
            DEFAULTS.maximumBodyBytes,
            "maximumBodyBytes"
          ),

        requestTimeoutMs:
          normalizePositiveInteger(
            options.requestTimeoutMs,
            DEFAULTS.requestTimeoutMs,
            "requestTimeoutMs"
          ),

        replayWindowSeconds:
          normalizePositiveInteger(
            options.replayWindowSeconds,
            DEFAULTS.replayWindowSeconds,
            "replayWindowSeconds"
          ),

        maxFutureSkewSeconds:
          options.maxFutureSkewSeconds ===
            undefined
            ? DEFAULTS.maxFutureSkewSeconds
            : Number(
                options.maxFutureSkewSeconds
              ),

        minimumSecretLength:
          normalizePositiveInteger(
            options.minimumSecretLength,
            DEFAULTS.minimumSecretLength,
            "minimumSecretLength"
          ),

        publicReadEnabled:
          options.publicReadEnabled !==
          false,

        initializeSnapshotOnStart:
          options.initializeSnapshotOnStart !==
          false
      });

    if (
      !Number.isFinite(
        this.options
          .maxFutureSkewSeconds
      ) ||
      this.options
        .maxFutureSkewSeconds < 0
    ) {
      throw new Mt5ReceiverError(
        "maxFutureSkewSeconds must be non-negative",
        "INVALID_CONFIGURATION",
        500
      );
    }

    this.resolveSecret =
      normalizeSecretResolver(
        options
      );

    this.replayStore =
      options.replayStore ||
      new Mt5ReplayStore({
        replayWindowMs:
          this.options
            .replayWindowSeconds *
          1000
      });

    this.stateStore =
      options.stateStore ||
      new Mt5StateStore();

    this.historyStore =
      options.historyStore ||
      new Mt5HistoryStore({
        outputPath:
          options.historyOutputPath,
        autoPersist:
          false
      });

    this.snapshotWriter =
      options.snapshotWriter ||
      new Mt5SnapshotWriter({
        outputPath:
          options.outputPath
      });

    this.server = null;

    this.stats = {
      startedAt:
        null,
      stoppedAt:
        null,
      requestsTotal: 0,
      ingestAccepted: 0,
      ingestDuplicates: 0,
      ingestRejected: 0,
      readRequests: 0,
      healthRequests: 0,
      lastRequestAt:
        null,
      lastAcceptedAt:
        null,
      lastErrorAt:
        null,
      lastErrorCode:
        null
    };
  }

  async handleRequest(
    request,
    response
  ) {
    this.stats.requestsTotal += 1;

    this.stats.lastRequestAt =
      new Date()
        .toISOString();

    const {
      pathname
    } =
      normalizeRequestPath(
        request
      );

    try {
      if (
        pathname ===
        this.options.healthPath
      ) {
        if (
          request.method !==
          "GET"
        ) {
          sendMethodNotAllowed(
            response,
            ["GET"]
          );

          return;
        }

        this.stats
          .healthRequests += 1;

        this.handleHealth(
          response
        );

        return;
      }

      if (
        pathname ===
        this.options.ingestPath
      ) {
        if (
          request.method !==
          "POST"
        ) {
          sendMethodNotAllowed(
            response,
            ["POST"]
          );

          return;
        }

        await this.handleIngest(
          request,
          response
        );

        return;
      }

      if (
        pathname ===
        this.options.marketDataPath
      ) {
        if (
          request.method !==
          "GET"
        ) {
          sendMethodNotAllowed(
            response,
            ["GET"]
          );

          return;
        }

        this.handleMarketData(
          response
        );

        return;
      }

      const symbolPrefix =
        `${this.options.marketDataPath}/`;

      if (
        pathname.startsWith(
          symbolPrefix
        )
      ) {
        if (
          request.method !==
          "GET"
        ) {
          sendMethodNotAllowed(
            response,
            ["GET"]
          );

          return;
        }

        const symbol =
          decodeURIComponent(
            pathname.slice(
              symbolPrefix.length
            )
          )
            .trim()
            .toUpperCase();

        this.handleSymbol(
          response,
          symbol
        );

        return;
      }

      sendJson(
        response,
        404,
        {
          ok: false,
          error: {
            code:
              "NOT_FOUND",
            message:
              "Endpoint not found"
          }
        }
      );
    } catch (error) {
      this.handleError(
        response,
        error
      );
    }
  }

  async handleIngest(
    request,
    response
  ) {
    const body =
      await readRequestBody(
        request,
        {
          maximumBodyBytes:
            this.options
              .maximumBodyBytes,
          timeoutMs:
            this.options
              .requestTimeoutMs
        }
      );

    const bridgeId =
      getBridgeIdFromHeaders(
        request.headers
      );

    const secret =
      await Promise.resolve(
        this.resolveSecret(
          bridgeId
        )
      );

    if (
      typeof secret !==
        "string" ||
      secret.length === 0
    ) {
      throw new Mt5AuthError(
        "No secret is configured for this bridge",
        "UNKNOWN_BRIDGE"
      );
    }

    const auth =
      verifyRequestAuthentication({
        method:
          request.method,
        requestPath:
          this.options
            .ingestPath,
        headers:
          request.headers,
        body,
        secret,
        now:
          new Date(),
        replayWindowSeconds:
          this.options
            .replayWindowSeconds,
        maxFutureSkewSeconds:
          this.options
            .maxFutureSkewSeconds,
        minimumSecretLength:
          this.options
            .minimumSecretLength
      });

    const payload =
      parseJsonBody(
        body
      );

    if (
      payload.bridgeId !==
      auth.bridgeId
    ) {
      throw new Mt5ReceiverError(
        "Authenticated bridge ID does not match payload bridgeId",
        "BRIDGE_ID_MISMATCH",
        422,
        {
          authenticatedBridgeId:
            auth.bridgeId,
          payloadBridgeId:
            payload.bridgeId ??
            null
        }
      );
    }

    const replay =
      this.replayStore
        .checkAndRecord({
          bridgeId:
            auth.bridgeId,
          sessionId:
            payload.sessionId,
          requestId:
            payload.requestId,
          nonce:
            auth.nonce,
          sequence:
            payload.sequence,
          timestamp:
            auth.timestamp,
          now:
            new Date()
        });

    if (replay.duplicate) {
      this.stats
        .ingestDuplicates += 1;

      sendJson(
        response,
        200,
        {
          ok: true,
          duplicate: true,
          replay
        }
      );

      return;
    }

    const ingestionTime =
      new Date();

    const merge =
      this.stateStore
        .ingestPayload(
          payload,
          {
            now:
              ingestionTime,
            receivedAtUtc:
              ingestionTime
          }
        );

    const historyMerge =
      this.historyStore
        .ingestPayload(
          payload,
          {
            now:
              ingestionTime,
            receivedAtUtc:
              ingestionTime,
            persist:
              false
          }
        );

    const write =
      this.snapshotWriter
        .write(
          this.stateStore,
          {
            now:
              ingestionTime
          }
        );

    const historyWrite =
      this.historyStore
        .persist({
          now:
            ingestionTime
        });

    this.stats
      .ingestAccepted += 1;

    this.stats
      .lastAcceptedAt =
      new Date()
        .toISOString();

    sendJson(
      response,
      202,
      {
        ok: true,
        duplicate: false,
        replay,
        merge,
        historyMerge,
        publication: {
          written:
            write.written,
          outputPath:
            write.outputPath,
          bytes:
            write.bytes,
          updatedAt:
            write.updatedAt,
          stale:
            write.stale
        },
        historyPublication: {
          written:
            historyWrite.written,
          outputPath:
            historyWrite.outputPath,
          bytes:
            historyWrite.bytes,
          updatedAt:
            historyWrite.updatedAt
        }
      }
    );
  }

  handleMarketData(
    response
  ) {
    if (
      !this.options
        .publicReadEnabled
    ) {
      sendJson(
        response,
        403,
        {
          ok: false,
          error: {
            code:
              "PUBLIC_READ_DISABLED",
            message:
              "Public market-data reads are disabled"
          }
        }
      );

      return;
    }

    this.stats.readRequests += 1;

    const snapshot =
      this.stateStore
        .buildSnapshot({
          now:
            new Date()
        });

    sendJson(
      response,
      200,
      snapshot,
      {
        "cache-control":
          "no-store, max-age=0"
      }
    );
  }

  handleSymbol(
    response,
    symbol
  ) {
    if (
      !this.options
        .publicReadEnabled
    ) {
      sendJson(
        response,
        403,
        {
          ok: false,
          error: {
            code:
              "PUBLIC_READ_DISABLED",
            message:
              "Public market-data reads are disabled"
          }
        }
      );

      return;
    }

    if (
      !SUPPORTED_SYMBOLS.includes(
        symbol
      )
    ) {
      sendJson(
        response,
        404,
        {
          ok: false,
          error: {
            code:
              "UNSUPPORTED_SYMBOL",
            message:
              "Symbol is not supported",
            details: {
              symbol,
              supportedSymbols:
                SUPPORTED_SYMBOLS
            }
          }
        }
      );

      return;
    }

    this.stats.readRequests += 1;

    const value =
      this.stateStore
        .getSymbol(
          symbol,
          {
            now:
              new Date()
          }
        );

    sendJson(
      response,
      200,
      {
        schemaVersion:
          "1.0.0",
        source:
          "MT5_BROKER",
        updatedAt:
          new Date()
            .toISOString(),
        symbol:
          value
      },
      {
        "cache-control":
          "no-store, max-age=0"
      }
    );
  }

  handleHealth(
    response
  ) {
    const snapshot =
      this.stateStore
        .buildSnapshot({
          now:
            new Date()
        });

    sendJson(
      response,
      200,
      {
        ok: true,
        status:
          snapshot.stale
            ? "DEGRADED"
            : "ONLINE",
        startedAt:
          this.stats.startedAt,
        now:
          new Date()
            .toISOString(),
        receiver:
          this.getStats(),
        replayStore:
          this.replayStore
            .getStats(),
        stateStore:
          this.stateStore
            .getStats(),
        historyStore:
          this.historyStore
            .getStats(),
        snapshotWriter:
          this.snapshotWriter
            .getStats(),
        bridge:
          snapshot.bridge,
        stale:
          snapshot.stale
      }
    );
  }

  handleError(
    response,
    error
  ) {
    const mapped =
      mapError(
        error
      );

    this.stats
      .ingestRejected += 1;

    this.stats
      .lastErrorAt =
      new Date()
        .toISOString();

    this.stats
      .lastErrorCode =
      mapped.code;

    sendJson(
      response,
      mapped.statusCode,
      {
        ok: false,
        error: {
          code:
            mapped.code,
          message:
            mapped.message,
          details:
            mapped.details
        }
      }
    );
  }

  start() {
    if (this.server) {
      throw new Mt5ReceiverError(
        "Receiver is already running",
        "ALREADY_RUNNING",
        500
      );
    }

    if (
      this.options
        .initializeSnapshotOnStart
    ) {
      this.snapshotWriter
        .initialize();
    }

    this.server =
      http.createServer(
        (request, response) => {
          this.handleRequest(
            request,
            response
          ).catch(
            error => {
              this.handleError(
                response,
                error
              );
            }
          );
        }
      );

    this.server.requestTimeout =
      this.options
        .requestTimeoutMs;

    this.server.headersTimeout =
      this.options
        .requestTimeoutMs +
      5_000;

    return new Promise(
      (resolve, reject) => {
        const onError =
          error => {
            this.server = null;
            reject(error);
          };

        this.server.once(
          "error",
          onError
        );

        this.server.listen(
          this.options.port,
          this.options.host,
          () => {
            this.server.off(
              "error",
              onError
            );

            this.stats.startedAt =
              new Date()
                .toISOString();

            this.stats.stoppedAt =
              null;

            const address =
              this.server.address();

            resolve({
              host:
                typeof address ===
                "object"
                  ? address.address
                  : this.options.host,
              port:
                typeof address ===
                "object"
                  ? address.port
                  : this.options.port,
              ingestPath:
                this.options
                  .ingestPath,
              marketDataPath:
                this.options
                  .marketDataPath,
              healthPath:
                this.options
                  .healthPath
            });
          }
        );
      }
    );
  }

  stop() {
    if (!this.server) {
      return Promise.resolve({
        stopped: false
      });
    }

    const server =
      this.server;

    this.server =
      null;

    return new Promise(
      (resolve, reject) => {
        server.close(
          error => {
            if (error) {
              reject(error);

              return;
            }

            this.stats.stoppedAt =
              new Date()
                .toISOString();

            resolve({
              stopped: true,
              stoppedAt:
                this.stats
                  .stoppedAt
            });
          }
        );
      }
    );
  }

  getStats() {
    return {
      ...this.stats,
      listening:
        Boolean(
          this.server &&
          this.server.listening
        ),
      host:
        this.options.host,
      port:
        this.server &&
        this.server.listening &&
        typeof this.server
          .address() ===
          "object"
          ? this.server
              .address()
              .port
          : this.options.port
    };
  }
}

function createReceiver(
  options = {}
) {
  return new Mt5Receiver(
    options
  );
}

async function startFromEnvironment() {
  const receiver =
    createReceiver({
      host:
        process.env.MT5_RECEIVER_HOST ||
        DEFAULTS.host,

      port:
        process.env.MT5_RECEIVER_PORT
          ? Number(
              process.env
                .MT5_RECEIVER_PORT
            )
          : DEFAULTS.port,

      outputPath:
        process.env
          .MT5_SNAPSHOT_OUTPUT_PATH,

      historyOutputPath:
        process.env
          .MT5_HISTORY_OUTPUT_PATH,

      publicReadEnabled:
        process.env
          .MT5_PUBLIC_READ_ENABLED !==
        "false"
    });

  const address =
    await receiver.start();

  console.log(
    `MT5 receiver listening on http://${address.host}:${address.port}`
  );

  console.log(
    `Ingest endpoint: ${address.ingestPath}`
  );

  console.log(
    `Market-data endpoint: ${address.marketDataPath}`
  );

  console.log(
    `Health endpoint: ${address.healthPath}`
  );

  const shutdown =
    async signal => {
      console.log(
        `Received ${signal}; stopping MT5 receiver`
      );

      try {
        await receiver.stop();
        process.exitCode = 0;
      } catch (error) {
        console.error(
          "Failed to stop MT5 receiver:",
          error
        );

        process.exitCode = 1;
      }
    };

  process.once(
    "SIGINT",
    () => {
      shutdown("SIGINT");
    }
  );

  process.once(
    "SIGTERM",
    () => {
      shutdown("SIGTERM");
    }
  );

  return receiver;
}

if (
  require.main === module
) {
  startFromEnvironment()
    .catch(
      error => {
        console.error(
          "MT5 receiver failed:",
          error
        );

        process.exitCode = 1;
      }
    );
}

module.exports = Object.freeze({
  DEFAULTS,
  Mt5ReceiverError,
  Mt5Receiver,
  normalizePositiveInteger,
  normalizePort,
  normalizeHost,
  normalizePath,
  normalizeSecretResolver,
  sendJson,
  readRequestBody,
  parseJsonBody,
  normalizeRequestPath,
  getBridgeIdFromHeaders,
  mapError,
  createReceiver,
  startFromEnvironment
});
