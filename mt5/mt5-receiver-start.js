"use strict";

/**
 * PipSight Pro — MT5 Receiver Start
 *
 * Deployment entry point for the isolated MT5 receiver.
 *
 * Responsibilities:
 * - Validate required environment configuration
 * - Confirm the shared secret is production-safe
 * - Validate optional host, port, output-path, and public-read settings
 * - Start the existing mt5-receiver runtime
 * - Preserve one clear process exit path on startup failure
 *
 * This file intentionally contains no receiver, authentication, replay,
 * state-management, snapshot-writing, Signal Engine, Pattern Detection,
 * AI confidence, learning, Telegram, or tracker logic.
 */

const {
  startFromEnvironment
} = require("./mt5-receiver");

const MINIMUM_SECRET_LENGTH = 32;

class Mt5ReceiverStartError extends Error {
  constructor(
    message,
    code = "MT5_RECEIVER_START_ERROR",
    details = {}
  ) {
    super(message);
    this.name =
      "Mt5ReceiverStartError";
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
    return null;
  }

  const normalized =
    String(value).trim();

  return normalized.length > 0
    ? normalized
    : null;
}

function validateSharedSecret(
  value,
  options = {}
) {
  const minimumLength =
    Number.isSafeInteger(
      options.minimumLength
    ) &&
    options.minimumLength > 0
      ? options.minimumLength
      : MINIMUM_SECRET_LENGTH;

  const secret =
    normalizeOptionalString(value);

  if (!secret) {
    throw new Mt5ReceiverStartError(
      "MT5_SHARED_SECRET is required",
      "MISSING_SHARED_SECRET"
    );
  }

  if (
    secret.length <
    minimumLength
  ) {
    throw new Mt5ReceiverStartError(
      `MT5_SHARED_SECRET must be at least ${minimumLength} characters`,
      "WEAK_SHARED_SECRET",
      {
        minimumLength
      }
    );
  }

  return secret;
}

function validateHost(value) {
  const host =
    normalizeOptionalString(value);

  if (!host) {
    return null;
  }

  if (
    host.includes("\r") ||
    host.includes("\n") ||
    host.includes(" ")
  ) {
    throw new Mt5ReceiverStartError(
      "MT5_RECEIVER_HOST is invalid",
      "INVALID_RECEIVER_HOST"
    );
  }

  return host;
}

function validatePort(value) {
  const raw =
    normalizeOptionalString(value);

  if (!raw) {
    return null;
  }

  const port =
    Number(raw);

  if (
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Mt5ReceiverStartError(
      "MT5_RECEIVER_PORT must be an integer between 1 and 65535",
      "INVALID_RECEIVER_PORT"
    );
  }

  return port;
}

function validateOutputPath(value) {
  const outputPath =
    normalizeOptionalString(value);

  if (!outputPath) {
    return null;
  }

  if (
    outputPath.includes("\0") ||
    outputPath.includes("\r") ||
    outputPath.includes("\n")
  ) {
    throw new Mt5ReceiverStartError(
      "MT5_SNAPSHOT_OUTPUT_PATH is invalid",
      "INVALID_SNAPSHOT_OUTPUT_PATH"
    );
  }

  return outputPath;
}

function validateBooleanEnvironment(
  value,
  fieldName
) {
  const raw =
    normalizeOptionalString(value);

  if (!raw) {
    return null;
  }

  const normalized =
    raw.toLowerCase();

  if (
    normalized !== "true" &&
    normalized !== "false"
  ) {
    throw new Mt5ReceiverStartError(
      `${fieldName} must be true or false`,
      "INVALID_BOOLEAN_ENVIRONMENT",
      {
        fieldName
      }
    );
  }

  return normalized === "true";
}

function validateEnvironment(
  environment = process.env
) {
  if (
    !environment ||
    typeof environment !== "object" ||
    Array.isArray(environment)
  ) {
    throw new Mt5ReceiverStartError(
      "Environment configuration is invalid",
      "INVALID_ENVIRONMENT"
    );
  }

  validateSharedSecret(
    environment.MT5_SHARED_SECRET
  );

  const host =
    validateHost(
      environment.MT5_RECEIVER_HOST
    );

  const port =
    validatePort(
      environment.MT5_RECEIVER_PORT
    );

  const outputPath =
    validateOutputPath(
      environment.MT5_SNAPSHOT_OUTPUT_PATH
    );

  const publicReadEnabled =
    validateBooleanEnvironment(
      environment.MT5_PUBLIC_READ_ENABLED,
      "MT5_PUBLIC_READ_ENABLED"
    );

  return Object.freeze({
    sharedSecretConfigured:
      true,
    host,
    port,
    outputPath,
    publicReadEnabled
  });
}

function buildSafeStartupSummary(
  validated
) {
  return Object.freeze({
    sharedSecretConfigured:
      Boolean(
        validated
          .sharedSecretConfigured
      ),

    host:
      validated.host ||
      "default",

    port:
      validated.port ||
      "default",

    outputPath:
      validated.outputPath ||
      "default",

    publicReadEnabled:
      validated.publicReadEnabled ===
        null
        ? "default"
        : validated
            .publicReadEnabled
  });
}

async function main(
  options = {}
) {
  const environment =
    options.environment ||
    process.env;

  const validated =
    validateEnvironment(
      environment
    );

  const summary =
    buildSafeStartupSummary(
      validated
    );

  console.log(
    "Starting isolated MT5 receiver"
  );

  console.log(
    "MT5 receiver configuration:",
    summary
  );

  return startFromEnvironment();
}

if (
  require.main === module
) {
  main()
    .catch(
      error => {
        const code =
          error?.code ||
          "MT5_RECEIVER_START_FAILED";

        console.error(
          `MT5 receiver startup failed [${code}]:`,
          error?.message ||
          error
        );

        process.exitCode = 1;
      }
    );
}

module.exports = Object.freeze({
  MINIMUM_SECRET_LENGTH,
  Mt5ReceiverStartError,
  normalizeOptionalString,
  validateSharedSecret,
  validateHost,
  validatePort,
  validateOutputPath,
  validateBooleanEnvironment,
  validateEnvironment,
  buildSafeStartupSummary,
  main
});
