"use strict";

/**
 * PipSight Pro — MT5 Bridge Authentication
 *
 * HMAC-SHA256 request authentication for the MT5 bridge receiver.
 *
 * Responsibilities:
 * - Canonical body hashing
 * - Canonical request-string construction
 * - HMAC signature generation
 * - Constant-time signature comparison
 * - Timestamp/replay-window validation
 * - Nonce format validation
 * - Header extraction
 *
 * This module is isolated and additive. It does not change Pattern Detector,
 * Signal Engine, Pattern Detection, AI confidence, learning, Telegram,
 * tracker behavior, or any existing JSON schema.
 */

const crypto = require("crypto");

const AUTH_VERSION = "1.0.0";
const SIGNATURE_ALGORITHM = "sha256";

const HEADER_NAMES = Object.freeze({
  bridgeId: "x-bridge-id",
  timestamp: "x-timestamp",
  nonce: "x-nonce",
  signature: "x-signature",
  payloadHash: "x-payload-hash",
  authVersion: "x-auth-version"
});

const DEFAULTS = Object.freeze({
  replayWindowSeconds: 300,
  maxFutureSkewSeconds: 30,
  minimumSecretLength: 32,
  minimumNonceLength: 16,
  maximumNonceLength: 128,
  maximumBridgeIdLength: 128,
  maximumRequestPathLength: 2048
});

class Mt5AuthError extends Error {
  constructor(
    message,
    code = "AUTH_ERROR",
    details = {}
  ) {
    super(message);
    this.name = "Mt5AuthError";
    this.code = code;
    this.details =
      details &&
      typeof details === "object" &&
      !Array.isArray(details)
        ? details
        : {};
  }
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

function normalizeHeaderName(value) {
  const normalized =
    normalizeNonEmptyString(value);

  return normalized
    ? normalized.toLowerCase()
    : null;
}

function normalizeMethod(value) {
  const method =
    normalizeNonEmptyString(value)
      ?.toUpperCase() ||
    null;

  if (
    !method ||
    !/^[A-Z]+$/.test(method)
  ) {
    throw new Mt5AuthError(
      "HTTP method is invalid",
      "INVALID_METHOD"
    );
  }

  return method;
}

function normalizeRequestPath(value) {
  const path =
    normalizeNonEmptyString(value);

  if (!path) {
    throw new Mt5AuthError(
      "Request path is required",
      "INVALID_REQUEST_PATH"
    );
  }

  if (
    path.length >
    DEFAULTS.maximumRequestPathLength
  ) {
    throw new Mt5AuthError(
      "Request path is too long",
      "INVALID_REQUEST_PATH"
    );
  }

  if (!path.startsWith("/")) {
    throw new Mt5AuthError(
      "Request path must start with /",
      "INVALID_REQUEST_PATH"
    );
  }

  if (
    path.includes("\r") ||
    path.includes("\n")
  ) {
    throw new Mt5AuthError(
      "Request path contains invalid characters",
      "INVALID_REQUEST_PATH"
    );
  }

  return path;
}

function normalizeBridgeId(value) {
  const bridgeId =
    normalizeNonEmptyString(value);

  if (!bridgeId) {
    throw new Mt5AuthError(
      "Bridge ID is required",
      "MISSING_BRIDGE_ID"
    );
  }

  if (
    bridgeId.length >
    DEFAULTS.maximumBridgeIdLength
  ) {
    throw new Mt5AuthError(
      "Bridge ID is too long",
      "INVALID_BRIDGE_ID"
    );
  }

  if (
    !/^[A-Za-z0-9._:-]+$/.test(
      bridgeId
    )
  ) {
    throw new Mt5AuthError(
      "Bridge ID contains invalid characters",
      "INVALID_BRIDGE_ID"
    );
  }

  return bridgeId;
}

function normalizeSecret(
  value,
  options = {}
) {
  const secret =
    normalizeNonEmptyString(value);

  const minimumLength =
    Number.isInteger(
      options.minimumSecretLength
    )
      ? Math.max(
          1,
          options.minimumSecretLength
        )
      : DEFAULTS.minimumSecretLength;

  if (!secret) {
    throw new Mt5AuthError(
      "Shared secret is required",
      "MISSING_SECRET"
    );
  }

  if (
    secret.length <
    minimumLength
  ) {
    throw new Mt5AuthError(
      `Shared secret must be at least ${minimumLength} characters`,
      "WEAK_SECRET"
    );
  }

  return secret;
}

function normalizeNonce(value) {
  const nonce =
    normalizeNonEmptyString(value);

  if (!nonce) {
    throw new Mt5AuthError(
      "Nonce is required",
      "MISSING_NONCE"
    );
  }

  if (
    nonce.length <
      DEFAULTS.minimumNonceLength ||
    nonce.length >
      DEFAULTS.maximumNonceLength
  ) {
    throw new Mt5AuthError(
      "Nonce length is invalid",
      "INVALID_NONCE",
      {
        minimum:
          DEFAULTS.minimumNonceLength,
        maximum:
          DEFAULTS.maximumNonceLength
      }
    );
  }

  if (
    !/^[A-Za-z0-9._~:-]+$/.test(
      nonce
    )
  ) {
    throw new Mt5AuthError(
      "Nonce contains invalid characters",
      "INVALID_NONCE"
    );
  }

  return nonce;
}

function normalizeHex(
  value,
  expectedLength,
  fieldName
) {
  const normalized =
    normalizeNonEmptyString(value)
      ?.toLowerCase() ||
    null;

  if (
    !normalized ||
    !/^[a-f0-9]+$/.test(
      normalized
    ) ||
    normalized.length !==
      expectedLength
  ) {
    throw new Mt5AuthError(
      `${fieldName} must be ${expectedLength} lowercase hexadecimal characters`,
      `INVALID_${fieldName
        .toUpperCase()
        .replace(
          /[^A-Z0-9]+/g,
          "_"
        )}`
    );
  }

  return normalized;
}

function normalizeBody(body) {
  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (
    typeof body === "string"
  ) {
    return Buffer.from(
      body,
      "utf8"
    );
  }

  if (
    body === undefined ||
    body === null
  ) {
    return Buffer.alloc(0);
  }

  throw new Mt5AuthError(
    "Body must be a Buffer or string",
    "INVALID_BODY"
  );
}

function normalizeTimestamp(value) {
  const raw =
    normalizeNonEmptyString(
      String(value ?? "")
    );

  if (!raw) {
    throw new Mt5AuthError(
      "Timestamp is required",
      "MISSING_TIMESTAMP"
    );
  }

  let date;

  if (/^\d{10,13}$/.test(raw)) {
    const numeric =
      Number(raw);

    if (!Number.isFinite(numeric)) {
      throw new Mt5AuthError(
        "Timestamp is invalid",
        "INVALID_TIMESTAMP"
      );
    }

    date =
      raw.length === 10
        ? new Date(
            numeric * 1000
          )
        : new Date(numeric);
  } else {
    date =
      new Date(raw);
  }

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    throw new Mt5AuthError(
      "Timestamp is invalid",
      "INVALID_TIMESTAMP"
    );
  }

  return date.toISOString();
}

function validateTimestamp(
  timestamp,
  options = {}
) {
  const normalized =
    normalizeTimestamp(timestamp);

  const now =
    options.now instanceof Date
      ? new Date(
          options.now.getTime()
        )
      : options.now
        ? new Date(options.now)
        : new Date();

  if (
    Number.isNaN(
      now.getTime()
    )
  ) {
    throw new Mt5AuthError(
      "Current time is invalid",
      "INVALID_CURRENT_TIME"
    );
  }

  const replayWindowSeconds =
    Number.isFinite(
      Number(
        options.replayWindowSeconds
      )
    )
      ? Math.max(
          1,
          Number(
            options.replayWindowSeconds
          )
        )
      : DEFAULTS.replayWindowSeconds;

  const maxFutureSkewSeconds =
    Number.isFinite(
      Number(
        options.maxFutureSkewSeconds
      )
    )
      ? Math.max(
          0,
          Number(
            options.maxFutureSkewSeconds
          )
        )
      : DEFAULTS.maxFutureSkewSeconds;

  const timestampMs =
    new Date(
      normalized
    ).getTime();

  const nowMs =
    now.getTime();

  const ageSeconds =
    (
      nowMs -
      timestampMs
    ) /
    1000;

  if (
    ageSeconds <
    -maxFutureSkewSeconds
  ) {
    throw new Mt5AuthError(
      "Timestamp is too far in the future",
      "TIMESTAMP_IN_FUTURE",
      {
        timestamp:
          normalized,
        now:
          now.toISOString(),
        maxFutureSkewSeconds
      }
    );
  }

  if (
    ageSeconds >
    replayWindowSeconds
  ) {
    throw new Mt5AuthError(
      "Timestamp is outside the replay window",
      "TIMESTAMP_EXPIRED",
      {
        timestamp:
          normalized,
        now:
          now.toISOString(),
        replayWindowSeconds,
        ageSeconds:
          Number(
            ageSeconds.toFixed(3)
          )
      }
    );
  }

  return {
    timestamp:
      normalized,
    ageSeconds:
      Number(
        ageSeconds.toFixed(3)
      ),
    replayWindowSeconds,
    maxFutureSkewSeconds
  };
}

function hashBody(body) {
  return crypto
    .createHash(
      SIGNATURE_ALGORITHM
    )
    .update(
      normalizeBody(body)
    )
    .digest("hex");
}

function createCanonicalString({
  method,
  requestPath,
  timestamp,
  nonce,
  payloadHash
}) {
  const normalizedMethod =
    normalizeMethod(method);

  const normalizedPath =
    normalizeRequestPath(
      requestPath
    );

  const normalizedTimestamp =
    normalizeTimestamp(
      timestamp
    );

  const normalizedNonce =
    normalizeNonce(
      nonce
    );

  const normalizedPayloadHash =
    normalizeHex(
      payloadHash,
      64,
      "payload hash"
    );

  return [
    normalizedMethod,
    normalizedPath,
    normalizedTimestamp,
    normalizedNonce,
    normalizedPayloadHash
  ].join("\n");
}

function signCanonicalString(
  canonicalString,
  secret,
  options = {}
) {
  const normalizedCanonical =
    normalizeNonEmptyString(
      canonicalString
    );

  if (!normalizedCanonical) {
    throw new Mt5AuthError(
      "Canonical string is required",
      "INVALID_CANONICAL_STRING"
    );
  }

  const normalizedSecret =
    normalizeSecret(
      secret,
      options
    );

  return crypto
    .createHmac(
      SIGNATURE_ALGORITHM,
      normalizedSecret
    )
    .update(
      normalizedCanonical,
      "utf8"
    )
    .digest("hex");
}

function createRequestSignature({
  method,
  requestPath,
  timestamp,
  nonce,
  body,
  payloadHash,
  secret,
  minimumSecretLength
}) {
  const normalizedBody =
    normalizeBody(body);

  const calculatedPayloadHash =
    hashBody(
      normalizedBody
    );

  if (payloadHash) {
    const suppliedPayloadHash =
      normalizeHex(
        payloadHash,
        64,
        "payload hash"
      );

    if (
      !safeEqualHex(
        calculatedPayloadHash,
        suppliedPayloadHash
      )
    ) {
      throw new Mt5AuthError(
        "Supplied payload hash does not match the body",
        "PAYLOAD_HASH_MISMATCH"
      );
    }
  }

  const canonicalString =
    createCanonicalString({
      method,
      requestPath,
      timestamp,
      nonce,
      payloadHash:
        calculatedPayloadHash
    });

  const signature =
    signCanonicalString(
      canonicalString,
      secret,
      {
        minimumSecretLength
      }
    );

  return {
    authVersion:
      AUTH_VERSION,
    payloadHash:
      calculatedPayloadHash,
    canonicalString,
    signature
  };
}

function safeEqualBuffers(
  first,
  second
) {
  if (
    !Buffer.isBuffer(first) ||
    !Buffer.isBuffer(second)
  ) {
    return false;
  }

  if (
    first.length !==
    second.length
  ) {
    const maximumLength =
      Math.max(
        first.length,
        second.length,
        1
      );

    const paddedFirst =
      Buffer.alloc(
        maximumLength
      );

    const paddedSecond =
      Buffer.alloc(
        maximumLength
      );

    first.copy(
      paddedFirst
    );

    second.copy(
      paddedSecond
    );

    crypto.timingSafeEqual(
      paddedFirst,
      paddedSecond
    );

    return false;
  }

  return crypto.timingSafeEqual(
    first,
    second
  );
}

function safeEqualHex(
  first,
  second
) {
  try {
    const normalizedFirst =
      normalizeHex(
        first,
        64,
        "hex value"
      );

    const normalizedSecond =
      normalizeHex(
        second,
        64,
        "hex value"
      );

    return safeEqualBuffers(
      Buffer.from(
        normalizedFirst,
        "hex"
      ),
      Buffer.from(
        normalizedSecond,
        "hex"
      )
    );
  } catch {
    return false;
  }
}

function getHeader(
  headers,
  name
) {
  if (
    !headers ||
    typeof headers !==
      "object"
  ) {
    return null;
  }

  const targetName =
    normalizeHeaderName(name);

  if (!targetName) {
    return null;
  }

  if (
    typeof headers.get ===
    "function"
  ) {
    const direct =
      headers.get(
        targetName
      ) ??
      headers.get(name);

    if (
      Array.isArray(direct)
    ) {
      return normalizeNonEmptyString(
        direct[0]
      );
    }

    return normalizeNonEmptyString(
      direct
    );
  }

  for (
    const [
      key,
      value
    ] of Object.entries(
      headers
    )
  ) {
    if (
      normalizeHeaderName(key) !==
      targetName
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      return normalizeNonEmptyString(
        value[0]
      );
    }

    return normalizeNonEmptyString(
      String(value)
    );
  }

  return null;
}

function extractAuthHeaders(headers) {
  return {
    bridgeId:
      getHeader(
        headers,
        HEADER_NAMES.bridgeId
      ),

    timestamp:
      getHeader(
        headers,
        HEADER_NAMES.timestamp
      ),

    nonce:
      getHeader(
        headers,
        HEADER_NAMES.nonce
      ),

    signature:
      getHeader(
        headers,
        HEADER_NAMES.signature
      ),

    payloadHash:
      getHeader(
        headers,
        HEADER_NAMES.payloadHash
      ),

    authVersion:
      getHeader(
        headers,
        HEADER_NAMES.authVersion
      )
  };
}

function validateAuthHeaders(
  input
) {
  if (
    !input ||
    typeof input !==
      "object" ||
    Array.isArray(input)
  ) {
    throw new Mt5AuthError(
      "Authentication headers are invalid",
      "INVALID_AUTH_HEADERS"
    );
  }

  const bridgeId =
    normalizeBridgeId(
      input.bridgeId
    );

  const timestamp =
    normalizeTimestamp(
      input.timestamp
    );

  const nonce =
    normalizeNonce(
      input.nonce
    );

  const signature =
    normalizeHex(
      input.signature,
      64,
      "signature"
    );

  const payloadHash =
    normalizeHex(
      input.payloadHash,
      64,
      "payload hash"
    );

  const authVersion =
    normalizeNonEmptyString(
      input.authVersion
    ) ||
    AUTH_VERSION;

  if (
    authVersion !==
    AUTH_VERSION
  ) {
    throw new Mt5AuthError(
      `Unsupported auth version: ${authVersion}`,
      "UNSUPPORTED_AUTH_VERSION",
      {
        expected:
          AUTH_VERSION
      }
    );
  }

  return {
    bridgeId,
    timestamp,
    nonce,
    signature,
    payloadHash,
    authVersion
  };
}

function verifyRequestAuthentication({
  method,
  requestPath,
  headers,
  body,
  secret,
  now,
  replayWindowSeconds,
  maxFutureSkewSeconds,
  minimumSecretLength
}) {
  const extracted =
    extractAuthHeaders(
      headers
    );

  const auth =
    validateAuthHeaders(
      extracted
    );

  const timestampValidation =
    validateTimestamp(
      auth.timestamp,
      {
        now,
        replayWindowSeconds,
        maxFutureSkewSeconds
      }
    );

  const normalizedBody =
    normalizeBody(body);

  const calculatedPayloadHash =
    hashBody(
      normalizedBody
    );

  if (
    !safeEqualHex(
      calculatedPayloadHash,
      auth.payloadHash
    )
  ) {
    throw new Mt5AuthError(
      "Payload hash does not match the request body",
      "PAYLOAD_HASH_MISMATCH"
    );
  }

  const canonicalString =
    createCanonicalString({
      method,
      requestPath,
      timestamp:
        auth.timestamp,
      nonce:
        auth.nonce,
      payloadHash:
        auth.payloadHash
    });

  const expectedSignature =
    signCanonicalString(
      canonicalString,
      secret,
      {
        minimumSecretLength
      }
    );

  if (
    !safeEqualHex(
      expectedSignature,
      auth.signature
    )
  ) {
    throw new Mt5AuthError(
      "Request signature is invalid",
      "INVALID_SIGNATURE"
    );
  }

  return {
    authenticated: true,
    authVersion:
      auth.authVersion,
    bridgeId:
      auth.bridgeId,
    timestamp:
      auth.timestamp,
    nonce:
      auth.nonce,
    payloadHash:
      auth.payloadHash,
    signature:
      auth.signature,
    canonicalString,
    timestampValidation
  };
}

function createSignedHeaders({
  bridgeId,
  method,
  requestPath,
  timestamp = new Date(),
  nonce = crypto
    .randomBytes(24)
    .toString("hex"),
  body,
  secret,
  minimumSecretLength
}) {
  const normalizedBridgeId =
    normalizeBridgeId(
      bridgeId
    );

  const normalizedTimestamp =
    normalizeTimestamp(
      timestamp
    );

  const normalizedNonce =
    normalizeNonce(
      nonce
    );

  const signed =
    createRequestSignature({
      method,
      requestPath,
      timestamp:
        normalizedTimestamp,
      nonce:
        normalizedNonce,
      body,
      secret,
      minimumSecretLength
    });

  return Object.freeze({
    [HEADER_NAMES.bridgeId]:
      normalizedBridgeId,

    [HEADER_NAMES.timestamp]:
      normalizedTimestamp,

    [HEADER_NAMES.nonce]:
      normalizedNonce,

    [HEADER_NAMES.signature]:
      signed.signature,

    [HEADER_NAMES.payloadHash]:
      signed.payloadHash,

    [HEADER_NAMES.authVersion]:
      AUTH_VERSION
  });
}

function buildReplayKey({
  bridgeId,
  nonce
}) {
  return [
    normalizeBridgeId(
      bridgeId
    ),
    normalizeNonce(
      nonce
    )
  ].join("|");
}

module.exports = Object.freeze({
  AUTH_VERSION,
  SIGNATURE_ALGORITHM,
  HEADER_NAMES,
  DEFAULTS,
  Mt5AuthError,
  normalizeMethod,
  normalizeRequestPath,
  normalizeBridgeId,
  normalizeSecret,
  normalizeNonce,
  normalizeTimestamp,
  validateTimestamp,
  normalizeBody,
  hashBody,
  createCanonicalString,
  signCanonicalString,
  createRequestSignature,
  safeEqualBuffers,
  safeEqualHex,
  getHeader,
  extractAuthHeaders,
  validateAuthHeaders,
  verifyRequestAuthentication,
  createSignedHeaders,
  buildReplayKey
});
