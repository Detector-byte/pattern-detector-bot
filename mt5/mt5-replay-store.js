"use strict";

/**
 * PipSight Pro — MT5 Replay Store
 *
 * Isolated in-memory replay and ordering protection for authenticated MT5
 * bridge requests.
 *
 * Responsibilities:
 * - Nonce replay detection
 * - Request idempotency
 * - Bridge session tracking
 * - Monotonic sequence enforcement
 * - Bridge restart handling through sessionId
 * - Bounded storage and automatic cleanup
 * - Lightweight health/statistics reporting
 *
 * This file does not change Pattern Detector, Signal Engine, Pattern Detection,
 * AI confidence, learning, Telegram, tracker behavior, or existing JSON schemas.
 */

const {
  buildReplayKey,
  normalizeBridgeId,
  normalizeNonce
} = require("./mt5-auth");

const DEFAULTS = Object.freeze({
  replayWindowMs: 5 * 60 * 1000,
  requestRetentionMs: 10 * 60 * 1000,
  sessionRetentionMs: 24 * 60 * 60 * 1000,
  cleanupIntervalMs: 60 * 1000,
  maxNonceEntries: 10_000,
  maxRequestEntries: 10_000,
  maxSessionEntries: 1_000
});

class Mt5ReplayStoreError extends Error {
  constructor(
    message,
    code = "REPLAY_STORE_ERROR",
    details = {}
  ) {
    super(message);
    this.name = "Mt5ReplayStoreError";
    this.code = code;
    this.details =
      details &&
      typeof details === "object" &&
      !Array.isArray(details)
        ? details
        : {};
  }
}

function normalizeNonEmptyString(
  value,
  fieldName
) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Mt5ReplayStoreError(
      `${fieldName} is required`,
      `INVALID_${fieldName
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")}`
    );
  }

  return value.trim();
}

function normalizeSessionId(value) {
  const sessionId =
    normalizeNonEmptyString(
      value,
      "sessionId"
    );

  if (
    sessionId.length > 128 ||
    !/^[A-Za-z0-9._~:-]+$/.test(
      sessionId
    )
  ) {
    throw new Mt5ReplayStoreError(
      "sessionId is invalid",
      "INVALID_SESSION_ID"
    );
  }

  return sessionId;
}

function normalizeRequestId(value) {
  const requestId =
    normalizeNonEmptyString(
      value,
      "requestId"
    );

  if (
    requestId.length > 128 ||
    !/^[A-Za-z0-9._~:-]+$/.test(
      requestId
    )
  ) {
    throw new Mt5ReplayStoreError(
      "requestId is invalid",
      "INVALID_REQUEST_ID"
    );
  }

  return requestId;
}

function normalizeSequence(value) {
  const sequence =
    Number(value);

  if (
    !Number.isSafeInteger(
      sequence
    ) ||
    sequence < 0
  ) {
    throw new Mt5ReplayStoreError(
      "sequence must be a non-negative safe integer",
      "INVALID_SEQUENCE"
    );
  }

  return sequence;
}

function normalizeTimestampMs(
  value,
  fieldName = "timestamp"
) {
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
    throw new Mt5ReplayStoreError(
      `${fieldName} is invalid`,
      "INVALID_TIMESTAMP"
    );
  }

  return date.getTime();
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

  const number =
    Number(value);

  if (
    !Number.isSafeInteger(
      number
    ) ||
    number <= 0
  ) {
    throw new Mt5ReplayStoreError(
      `${fieldName} must be a positive safe integer`,
      "INVALID_CONFIGURATION"
    );
  }

  return number;
}

function buildRequestKey({
  bridgeId,
  sessionId,
  requestId
}) {
  return [
    normalizeBridgeId(
      bridgeId
    ),
    normalizeSessionId(
      sessionId
    ),
    normalizeRequestId(
      requestId
    )
  ].join("|");
}

function buildSessionKey({
  bridgeId,
  sessionId
}) {
  return [
    normalizeBridgeId(
      bridgeId
    ),
    normalizeSessionId(
      sessionId
    )
  ].join("|");
}

class Mt5ReplayStore {
  constructor(options = {}) {
    this.options = Object.freeze({
      replayWindowMs:
        normalizePositiveInteger(
          options.replayWindowMs,
          DEFAULTS.replayWindowMs,
          "replayWindowMs"
        ),

      requestRetentionMs:
        normalizePositiveInteger(
          options.requestRetentionMs,
          DEFAULTS.requestRetentionMs,
          "requestRetentionMs"
        ),

      sessionRetentionMs:
        normalizePositiveInteger(
          options.sessionRetentionMs,
          DEFAULTS.sessionRetentionMs,
          "sessionRetentionMs"
        ),

      cleanupIntervalMs:
        normalizePositiveInteger(
          options.cleanupIntervalMs,
          DEFAULTS.cleanupIntervalMs,
          "cleanupIntervalMs"
        ),

      maxNonceEntries:
        normalizePositiveInteger(
          options.maxNonceEntries,
          DEFAULTS.maxNonceEntries,
          "maxNonceEntries"
        ),

      maxRequestEntries:
        normalizePositiveInteger(
          options.maxRequestEntries,
          DEFAULTS.maxRequestEntries,
          "maxRequestEntries"
        ),

      maxSessionEntries:
        normalizePositiveInteger(
          options.maxSessionEntries,
          DEFAULTS.maxSessionEntries,
          "maxSessionEntries"
        )
    });

    this.nonces = new Map();
    this.requests = new Map();
    this.sessions = new Map();

    this.stats = {
      accepted: 0,
      duplicateRequests: 0,
      replayRejected: 0,
      sequenceRejected: 0,
      staleRejected: 0,
      cleanupRuns: 0,
      evictedNonces: 0,
      evictedRequests: 0,
      evictedSessions: 0
    };

    this.lastCleanupAtMs = 0;
  }

  checkAndRecord(input) {
    const nowMs =
      normalizeTimestampMs(
        input?.now ??
        new Date(),
        "now"
      );

    this.cleanupIfDue(
      nowMs
    );

    const bridgeId =
      normalizeBridgeId(
        input?.bridgeId
      );

    const sessionId =
      normalizeSessionId(
        input?.sessionId
      );

    const requestId =
      normalizeRequestId(
        input?.requestId
      );

    const nonce =
      normalizeNonce(
        input?.nonce
      );

    const sequence =
      normalizeSequence(
        input?.sequence
      );

    const timestampMs =
      normalizeTimestampMs(
        input?.timestamp,
        "timestamp"
      );

    const replayAgeMs =
      nowMs -
      timestampMs;

    if (
      replayAgeMs >
      this.options.replayWindowMs
    ) {
      this.stats.staleRejected += 1;

      throw new Mt5ReplayStoreError(
        "Request timestamp is outside the replay window",
        "REPLAY_WINDOW_EXPIRED",
        {
          bridgeId,
          sessionId,
          requestId,
          replayAgeMs,
          replayWindowMs:
            this.options
              .replayWindowMs
        }
      );
    }

    const requestKey =
      buildRequestKey({
        bridgeId,
        sessionId,
        requestId
      });

    const existingRequest =
      this.requests.get(
        requestKey
      );

    if (existingRequest) {
      this.stats
        .duplicateRequests += 1;

      return {
        accepted: true,
        duplicate: true,
        reason:
          "DUPLICATE_REQUEST",
        bridgeId,
        sessionId,
        requestId,
        sequence,
        firstAcceptedAt:
          new Date(
            existingRequest
              .acceptedAtMs
          ).toISOString()
      };
    }

    const nonceKey =
      buildReplayKey({
        bridgeId,
        nonce
      });

    const existingNonce =
      this.nonces.get(
        nonceKey
      );

    if (
      existingNonce &&
      existingNonce.expiresAtMs >
        nowMs
    ) {
      this.stats
        .replayRejected += 1;

      throw new Mt5ReplayStoreError(
        "Nonce has already been used",
        "NONCE_REPLAY",
        {
          bridgeId,
          nonce,
          firstRequestId:
            existingNonce
              .requestId,
          firstAcceptedAt:
            new Date(
              existingNonce
                .acceptedAtMs
            ).toISOString()
        }
      );
    }

    const sessionKey =
      buildSessionKey({
        bridgeId,
        sessionId
      });

    const existingSession =
      this.sessions.get(
        sessionKey
      );

    if (
      existingSession &&
      sequence <=
        existingSession
          .lastSequence
    ) {
      this.stats
        .sequenceRejected += 1;

      throw new Mt5ReplayStoreError(
        "Sequence is not greater than the last accepted sequence",
        "OUT_OF_ORDER_SEQUENCE",
        {
          bridgeId,
          sessionId,
          requestId,
          sequence,
          lastSequence:
            existingSession
              .lastSequence
        }
      );
    }

    this.nonces.set(
      nonceKey,
      {
        bridgeId,
        nonce,
        requestId,
        acceptedAtMs:
          nowMs,
        expiresAtMs:
          nowMs +
          this.options
            .replayWindowMs
      }
    );

    this.requests.set(
      requestKey,
      {
        bridgeId,
        sessionId,
        requestId,
        sequence,
        nonce,
        timestampMs,
        acceptedAtMs:
          nowMs,
        expiresAtMs:
          nowMs +
          this.options
            .requestRetentionMs
      }
    );

    this.sessions.set(
      sessionKey,
      {
        bridgeId,
        sessionId,
        lastSequence:
          sequence,
        lastRequestId:
          requestId,
        lastNonce:
          nonce,
        updatedAtMs:
          nowMs,
        expiresAtMs:
          nowMs +
          this.options
            .sessionRetentionMs
      }
    );

    this.stats.accepted += 1;

    this.enforceLimits();

    return {
      accepted: true,
      duplicate: false,
      reason:
        "ACCEPTED",
      bridgeId,
      sessionId,
      requestId,
      sequence,
      acceptedAt:
        new Date(
          nowMs
        ).toISOString()
    };
  }

  hasNonce({
    bridgeId,
    nonce,
    now = new Date()
  }) {
    const nowMs =
      normalizeTimestampMs(
        now,
        "now"
      );

    const nonceKey =
      buildReplayKey({
        bridgeId,
        nonce
      });

    const entry =
      this.nonces.get(
        nonceKey
      );

    return Boolean(
      entry &&
      entry.expiresAtMs >
        nowMs
    );
  }

  getRequest({
    bridgeId,
    sessionId,
    requestId
  }) {
    const requestKey =
      buildRequestKey({
        bridgeId,
        sessionId,
        requestId
      });

    const entry =
      this.requests.get(
        requestKey
      );

    return entry
      ? {
          bridgeId:
            entry.bridgeId,
          sessionId:
            entry.sessionId,
          requestId:
            entry.requestId,
          sequence:
            entry.sequence,
          nonce:
            entry.nonce,
          timestamp:
            new Date(
              entry.timestampMs
            ).toISOString(),
          acceptedAt:
            new Date(
              entry.acceptedAtMs
            ).toISOString(),
          expiresAt:
            new Date(
              entry.expiresAtMs
            ).toISOString()
        }
      : null;
  }

  getSession({
    bridgeId,
    sessionId
  }) {
    const sessionKey =
      buildSessionKey({
        bridgeId,
        sessionId
      });

    const entry =
      this.sessions.get(
        sessionKey
      );

    return entry
      ? {
          bridgeId:
            entry.bridgeId,
          sessionId:
            entry.sessionId,
          lastSequence:
            entry.lastSequence,
          lastRequestId:
            entry.lastRequestId,
          lastNonce:
            entry.lastNonce,
          updatedAt:
            new Date(
              entry.updatedAtMs
            ).toISOString(),
          expiresAt:
            new Date(
              entry.expiresAtMs
            ).toISOString()
        }
      : null;
  }

  cleanupIfDue(
    now = new Date()
  ) {
    const nowMs =
      normalizeTimestampMs(
        now,
        "now"
      );

    if (
      nowMs -
      this.lastCleanupAtMs <
      this.options
        .cleanupIntervalMs
    ) {
      return {
        ran: false,
        removedNonces: 0,
        removedRequests: 0,
        removedSessions: 0
      };
    }

    return this.cleanup(
      nowMs
    );
  }

  cleanup(
    now = new Date()
  ) {
    const nowMs =
      typeof now === "number"
        ? now
        : normalizeTimestampMs(
            now,
            "now"
          );

    let removedNonces = 0;
    let removedRequests = 0;
    let removedSessions = 0;

    for (
      const [
        key,
        entry
      ] of this.nonces
    ) {
      if (
        entry.expiresAtMs <=
        nowMs
      ) {
        this.nonces.delete(
          key
        );

        removedNonces += 1;
      }
    }

    for (
      const [
        key,
        entry
      ] of this.requests
    ) {
      if (
        entry.expiresAtMs <=
        nowMs
      ) {
        this.requests.delete(
          key
        );

        removedRequests += 1;
      }
    }

    for (
      const [
        key,
        entry
      ] of this.sessions
    ) {
      if (
        entry.expiresAtMs <=
        nowMs
      ) {
        this.sessions.delete(
          key
        );

        removedSessions += 1;
      }
    }

    this.lastCleanupAtMs =
      nowMs;

    this.stats.cleanupRuns += 1;

    return {
      ran: true,
      removedNonces,
      removedRequests,
      removedSessions
    };
  }

  enforceLimits() {
    this.stats.evictedNonces +=
      this.evictOldest(
        this.nonces,
        this.options
          .maxNonceEntries
      );

    this.stats.evictedRequests +=
      this.evictOldest(
        this.requests,
        this.options
          .maxRequestEntries
      );

    this.stats.evictedSessions +=
      this.evictOldest(
        this.sessions,
        this.options
          .maxSessionEntries
      );
  }

  evictOldest(
    map,
    maximumSize
  ) {
    let removed = 0;

    while (
      map.size >
      maximumSize
    ) {
      const firstKey =
        map.keys()
          .next()
          .value;

      if (
        firstKey ===
        undefined
      ) {
        break;
      }

      map.delete(
        firstKey
      );

      removed += 1;
    }

    return removed;
  }

  clear() {
    this.nonces.clear();
    this.requests.clear();
    this.sessions.clear();

    this.lastCleanupAtMs = 0;

    return true;
  }

  getStats() {
    return {
      ...this.stats,
      nonceEntries:
        this.nonces.size,
      requestEntries:
        this.requests.size,
      sessionEntries:
        this.sessions.size,
      lastCleanupAt:
        this.lastCleanupAtMs > 0
          ? new Date(
              this.lastCleanupAtMs
            ).toISOString()
          : null,
      limits: {
        replayWindowMs:
          this.options
            .replayWindowMs,
        requestRetentionMs:
          this.options
            .requestRetentionMs,
        sessionRetentionMs:
          this.options
            .sessionRetentionMs,
        maxNonceEntries:
          this.options
            .maxNonceEntries,
        maxRequestEntries:
          this.options
            .maxRequestEntries,
        maxSessionEntries:
          this.options
            .maxSessionEntries
      }
    };
  }
}

module.exports = Object.freeze({
  DEFAULTS,
  Mt5ReplayStoreError,
  Mt5ReplayStore,
  normalizeSessionId,
  normalizeRequestId,
  normalizeSequence,
  normalizeTimestampMs,
  buildRequestKey,
  buildSessionKey
});
