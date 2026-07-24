#!/usr/bin/env node

/**
 * PipSight Pro AI - Main Entry Point
 *
 * Real-time chart pattern recognition with:
 * - Phase 4 adaptive learning
 * - Confidence calibration
 * - Pattern weighting and blacklist
 * - Pattern evolution
 * - Signal lifecycle management
 * - Audit logging
 * - Health monitoring
 * - Signal archiving
 */

const fs = require("fs");
const path = require("path");

const PatternAnalyzer = require("./analyzer");
const LearningSystem = require("./learner");
const SignalGenerator = require("./signals");

// =====================================================
// File Paths
// =====================================================

const DATA_DIR =
  path.join(
    __dirname,
    "data"
  );

const SIGNALS_FILE =
  path.join(
    DATA_DIR,
    "pattern-signals.json"
  );

const CONFIDENCE_FILE =
  path.join(
    DATA_DIR,
    "pattern-confidence.json"
  );

const LEARNING_FILE =
  path.join(
    DATA_DIR,
    "pattern-learning.json"
  );

const ARCHIVE_FILE =
  path.join(
    DATA_DIR,
    "pattern-signals-archive.json"
  );

const AUDIT_FILE =
  path.join(
    DATA_DIR,
    "pattern-audit-log.json"
  );

const HEALTH_FILE =
  path.join(
    DATA_DIR,
    "pattern-health.json"
  );

// =====================================================
// Bot Configuration
// =====================================================

const OPEN_STATUSES = [
  "NEW",
  "ACTIVE",
  "PARTIAL"
];

const CLOSED_STATUSES = [
  "WIN",
  "LOSS",
  "EXPIRED",
  "CANCELLED",
  "ARCHIVED"
];

const SUPPORTED_PAIRS = [
  "XAUUSD",
  "GBPJPY"
];

const SUPPORTED_TIMEFRAMES = [
  "5m",
  "15m",
  "30m",
  "1H",
  "4H"
];

const MINIMUM_CANDLES = 20;

const MINIMUM_CONFIDENCE = 70;

const MAX_MAIN_CLOSED_SIGNALS = 500;

const MAX_ARCHIVE_SIGNALS = 10000;

const MAX_AUDIT_ENTRIES = 2000;

const MAX_HEALTH_ENTRIES = 100;

/**
 * Signal expiry by timeframe.
 */
const EXPIRY_MAP = {
  "1m":
    10 * 60 * 1000,

  "5m":
    45 * 60 * 1000,

  "15m":
    3 * 60 * 60 * 1000,

  "30m":
    4 * 60 * 60 * 1000,

  "1H":
    18 * 60 * 60 * 1000,

  "4H":
    2 * 24 * 60 * 60 * 1000,

  "1D":
    5 * 24 * 60 * 60 * 1000
};

/**
 * Market-session quality multipliers.
 */
const SESSION_QUALITY_MULTIPLIER = {
  ASIAN: 0.9,

  LONDON: 1.05,

  LONDON_NY_OVERLAP: 1.15,

  NEWYORK: 1.05,

  OFF_HOURS: 0.8
};

// =====================================================
// Runtime State
// =====================================================

let auditLog = [];

// =====================================================
// General Utilities
// =====================================================

function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}

function nowIso() {
  return new Date()
    .toISOString();
}

function toNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function round(
  value,
  digits = 2
) {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return null;
  }

  return Number(
    number.toFixed(digits)
  );
}

function safeReadJson(
  filePath,
  fallback
) {
  try {
    if (
      !fs.existsSync(filePath)
    ) {
      return fallback;
    }

    const raw =
      fs.readFileSync(
        filePath,
        "utf8"
      );

    if (!raw.trim()) {
      return fallback;
    }

    return JSON.parse(raw);
  } catch (error) {
    console.error(
      `Error reading ${path.basename(filePath)}:`,
      error.message
    );

    return fallback;
  }
}

function safeWriteJson(
  filePath,
  data
) {
  const temporaryFile =
    `${filePath}.tmp`;

  try {
    fs.writeFileSync(
      temporaryFile,
      JSON.stringify(
        data,
        null,
        2
      ),
      "utf8"
    );

    fs.renameSync(
      temporaryFile,
      filePath
    );

    return true;
  } catch (error) {
    console.error(
      `Error writing ${path.basename(filePath)}:`,
      error.message
    );

    try {
      if (
        fs.existsSync(
          temporaryFile
        )
      ) {
        fs.unlinkSync(
          temporaryFile
        );
      }
    } catch (_) {
      // Ignore temporary-file cleanup errors.
    }

    return false;
  }
}

// =====================================================
// File Initialization and Loading
// =====================================================

function getDefaultSignalsData() {
  return {
    signals: [],

    updatedAt:
      nowIso(),

    stale: {},

    totalSignals: 0,

    resolvedSignals: 0,

    expiredSignals: 0,

    pendingSignals: 0
  };
}

function getDefaultConfidenceData() {
  return {
    patterns: {},

    updatedAt:
      nowIso()
  };
}

function getDefaultLearningData() {
  return {
    history: [],

    stats: {},

    patternStats: {},

    pairStats: {},

    timeframeStats: {},

    regimeStats: {},

    patternWeights: {},

    calibration: {},

    patternEvolution: {},

    blacklistedPatterns: {},

    optimization: {},

    lastLearningUpdate: null,

    updatedAt:
      nowIso()
  };
}

function getDefaultArchiveData() {
  return {
    signals: [],

    updatedAt:
      nowIso(),

    totalArchived: 0
  };
}

function getDefaultAuditData() {
  return {
    entries: [],

    updatedAt:
      nowIso(),

    totalEntries: 0
  };
}

function getDefaultHealthData() {
  return {
    history: [],

    updatedAt:
      nowIso(),

    lastStatus: null
  };
}

function initializeFiles() {
  if (
    !fs.existsSync(DATA_DIR)
  ) {
    fs.mkdirSync(
      DATA_DIR,
      {
        recursive: true
      }
    );
  }

  const initialFiles = [
    [
      SIGNALS_FILE,
      getDefaultSignalsData()
    ],

    [
      CONFIDENCE_FILE,
      getDefaultConfidenceData()
    ],

    [
      LEARNING_FILE,
      getDefaultLearningData()
    ],

    [
      ARCHIVE_FILE,
      getDefaultArchiveData()
    ],

    [
      AUDIT_FILE,
      getDefaultAuditData()
    ],

    [
      HEALTH_FILE,
      getDefaultHealthData()
    ]
  ];

  for (
    const [
      filePath,
      defaultData
    ] of initialFiles
  ) {
    if (
      !fs.existsSync(filePath)
    ) {
      safeWriteJson(
        filePath,
        defaultData
      );
    }
  }
}

function loadData() {
  const signals =
    safeReadJson(
      SIGNALS_FILE,
      getDefaultSignalsData()
    );

  const confidence =
    safeReadJson(
      CONFIDENCE_FILE,
      getDefaultConfidenceData()
    );

  const learning =
    safeReadJson(
      LEARNING_FILE,
      getDefaultLearningData()
    );

  return {
    signals: {
      ...getDefaultSignalsData(),
      ...signals,

      signals:
        Array.isArray(
          signals.signals
        )
          ? signals.signals
          : []
    },

    confidence: {
      ...getDefaultConfidenceData(),
      ...confidence,

      patterns:
        confidence.patterns &&
        typeof confidence.patterns ===
          "object"
          ? confidence.patterns
          : {}
    },

    learning: {
      ...getDefaultLearningData(),
      ...learning,

      history:
        Array.isArray(
          learning.history
        )
          ? learning.history
          : []
    }
  };
}

// =====================================================
// Audit Log
// =====================================================

function logAudit(entry) {
  auditLog.push({
    timestamp:
      nowIso(),

    ...entry
  });
}

function saveAuditLog() {
  try {
    if (
      auditLog.length === 0
    ) {
      return;
    }

    const auditData =
      safeReadJson(
        AUDIT_FILE,
        getDefaultAuditData()
      );

    const existingEntries =
      Array.isArray(
        auditData.entries
      )
        ? auditData.entries
        : [];

    const entries = [
      ...existingEntries,
      ...auditLog
    ].slice(
      -MAX_AUDIT_ENTRIES
    );

    safeWriteJson(
      AUDIT_FILE,
      {
        ...auditData,

        entries,

        updatedAt:
          nowIso(),

        totalEntries:
          entries.length
      }
    );

    console.log(
      `📝 Audit log: ${auditLog.length} entries recorded`
    );

    auditLog = [];
  } catch (error) {
    console.error(
      "Error saving audit log:",
      error.message
    );
  }
}

// =====================================================
// Health Monitor
// =====================================================

function runHealthCheck(report) {
  try {
    const healthData =
      safeReadJson(
        HEALTH_FILE,
        getDefaultHealthData()
      );

    const history =
      Array.isArray(
        healthData.history
      )
        ? healthData.history
        : [];

    const entry = {
      timestamp:
        nowIso(),

      ...report
    };

    const updatedHistory = [
      ...history,
      entry
    ].slice(
      -MAX_HEALTH_ENTRIES
    );

    safeWriteJson(
      HEALTH_FILE,
      {
        ...healthData,

        history:
          updatedHistory,

        updatedAt:
          nowIso(),

        lastStatus:
          report.status
      }
    );

    console.log(
      `🩺 Health check: ${report.status}`
    );
  } catch (error) {
    console.error(
      "Error writing health check:",
      error.message
    );
  }
}

// =====================================================
// Market Data
// =====================================================

async function fetchMarketData(
  analyzer
) {
  console.log(
    "📊 Fetching candle data..."
  );

  let candles = null;

  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    try {
      candles =
        await analyzer
          .fetchCandles();

      if (
        candles &&
        typeof candles ===
          "object" &&
        Object.keys(candles)
          .length > 0
      ) {
        return candles;
      }
    } catch (error) {
      console.warn(
        `⚠️ Fetch attempt ${attempt} failed: ${error.message}`
      );
    }

    if (
      attempt < 3
    ) {
      console.log(
        "🔄 Retrying in 3 seconds..."
      );

      await sleep(3000);
    }
  }

  console.warn(
    "⚠️ No candle data available"
  );

  updateStaleness(
    "data-fetch-failed"
  );

  return null;
}

// =====================================================
// Session and Market Filters
// =====================================================

function getMarketSession() {
  const hour =
    new Date()
      .getUTCHours();

  if (
    hour >= 0 &&
    hour < 7
  ) {
    return "ASIAN";
  }

  if (
    hour >= 7 &&
    hour < 12
  ) {
    return "LONDON";
  }

  if (
    hour >= 12 &&
    hour < 16
  ) {
    return "LONDON_NY_OVERLAP";
  }

  if (
    hour >= 16 &&
    hour < 21
  ) {
    return "NEWYORK";
  }

  return "OFF_HOURS";
}

function passesSpreadVolatilityFilter(
  timeframeCandles
) {
  if (
    !Array.isArray(
      timeframeCandles
    ) ||
    timeframeCandles.length < 15
  ) {
    return {
      pass: true
    };
  }

  const recent =
    timeframeCandles
      .slice(-15, -1)
      .filter(Boolean);

  const latest =
    timeframeCandles[
      timeframeCandles.length - 1
    ];

  if (
    !latest ||
    recent.length === 0
  ) {
    return {
      pass: true
    };
  }

  const averageRange =
    recent.reduce(
      (
        total,
        candle
      ) => {
        const high =
          toNumber(
            candle.high,
            0
          );

        const low =
          toNumber(
            candle.low,
            0
          );

        return (
          total +
          Math.abs(
            high - low
          )
        );
      },
      0
    ) /
    recent.length;

  const currentRange =
    Math.abs(
      toNumber(
        latest.high,
        0
      ) -
      toNumber(
        latest.low,
        0
      )
    );

  if (
    averageRange > 0 &&
    currentRange >
      averageRange * 3
  ) {
    return {
      pass: false,

      reason:
        `extreme volatility: current range ${currentRange.toFixed(5)}, average ${averageRange.toFixed(5)}`
    };
  }

  if (
    latest.spread !==
      undefined
  ) {
    const averageSpread =
      recent.reduce(
        (
          total,
          candle
        ) =>
          total +
          toNumber(
            candle.spread,
            0
          ),
        0
      ) /
      recent.length;

    const latestSpread =
      toNumber(
        latest.spread,
        0
      );

    if (
      averageSpread > 0 &&
      latestSpread >
        averageSpread * 3
    ) {
      return {
        pass: false,

        reason:
          `abnormal spread: current ${latestSpread}, average ${averageSpread.toFixed(5)}`
      };
    }
  }

  return {
    pass: true
  };
}

// =====================================================
// Signal Identity and Duplicate Handling
// =====================================================

function getSignalTimestamp(
  signal
) {
  return (
    signal?.timestamp ||
    signal?.createdAt ||
    signal?.lastUpdated ||
    nowIso()
  );
}

function isSignalInCooldown(
  signal,
  existingSignals,
  cooldownMs =
    5 * 60 * 1000
) {
  if (
    !signal ||
    !Array.isArray(
      existingSignals
    )
  ) {
    return false;
  }

  const signalTime =
    new Date(
      getSignalTimestamp(
        signal
      )
    ).getTime();

  return existingSignals.some(
    existingSignal => {
      if (
        !existingSignal
      ) {
        return false;
      }

      const existingTime =
        new Date(
          getSignalTimestamp(
            existingSignal
          )
        ).getTime();

      if (
        Number.isNaN(signalTime) ||
        Number.isNaN(existingTime)
      ) {
        return false;
      }

      const elapsed =
        signalTime -
        existingTime;

      return (
        existingSignal.pair ===
          signal.pair &&
        existingSignal.timeframe ===
          signal.timeframe &&
        existingSignal.pattern ===
          signal.pattern &&
        elapsed >= 0 &&
        elapsed < cooldownMs
      );
    }
  );
}

function buildSignalId(
  pair,
  timeframe,
  patternName
) {
  const dateString =
    nowIso()
      .slice(0, 10)
      .replace(
        /-/g,
        ""
      );

  const patternKey =
    String(
      patternName ||
      "UNKNOWN"
    )
      .replace(
        /\s+/g,
        ""
      )
      .replace(
        /[^a-zA-Z0-9]/g,
        ""
      )
      .toUpperCase();

  return [
    pair,
    timeframe,
    patternKey,
    dateString
  ].join("_");
}

function findActiveDuplicate(
  pair,
  timeframe,
  patternName,
  existingSignals
) {
  if (
    !Array.isArray(
      existingSignals
    )
  ) {
    return null;
  }

  return (
    existingSignals.find(
      signal =>
        signal &&
        signal.pair === pair &&
        signal.timeframe ===
          timeframe &&
        signal.pattern ===
          patternName &&
        OPEN_STATUSES.includes(
          signal.status
        )
    ) ||
    null
  );
}

// =====================================================
// Signal Compatibility Helpers
// =====================================================

function getPrimaryTakeProfit(
  signal
) {
  return toNumber(
    signal?.takeProfit1 ??
    signal?.takeProfit,
    NaN
  );
}

function getSecondTakeProfit(
  signal
) {
  return toNumber(
    signal?.takeProfit2 ??
    signal?.takeProfit1 ??
    signal?.takeProfit,
    NaN
  );
}

function getThirdTakeProfit(
  signal
) {
  return toNumber(
    signal?.takeProfit3 ??
    signal?.takeProfit2 ??
    signal?.takeProfit1 ??
    signal?.takeProfit,
    NaN
  );
}

function applyLegacySignalAliases(
  signal
) {
  if (!signal) {
    return signal;
  }

  const takeProfit1 =
    getPrimaryTakeProfit(
      signal
    );

  return {
    ...signal,

    takeProfit:
      Number.isFinite(
        takeProfit1
      )
        ? takeProfit1
        : signal.takeProfit,

    takeProfit1:
      Number.isFinite(
        takeProfit1
      )
        ? takeProfit1
        : signal.takeProfit1
  };
}

// =====================================================
// Pattern Scoring
// =====================================================

function getHistoricalWinRate(
  learner,
  signalContext
) {
  if (
    typeof learner
      .getPatternWinRate ===
      "function"
  ) {
    const result =
      learner.getPatternWinRate(
        signalContext
      );

    if (
      Number.isFinite(
        Number(result)
      )
    ) {
      return Number(result);
    }
  }

  if (
    typeof learner
      .getPatternQuality ===
      "function"
  ) {
    const quality =
      learner.getPatternQuality(
        signalContext.pattern,
        signalContext.pair,
        signalContext.timeframe
      );

    const accuracy =
      Number(
        quality?.accuracy
      );

    if (
      Number.isFinite(
        accuracy
      )
    ) {
      return accuracy;
    }
  }

  return 50;
}

function scorePattern(
  pair,
  timeframe,
  pattern,
  timeframeCandles,
  learner,
  signalGenerator
) {
  const lastCandle =
    timeframeCandles[
      timeframeCandles.length - 1
    ];

  const marketRegime =
    signalGenerator
      .detectMarketRegime(
        timeframeCandles,
        lastCandle
      );

  const signalContext = {
    pair,

    timeframe,

    pattern:
      pattern.name,

    strength:
      toNumber(
        pattern.strength,
        0
      ),

    confirmationScore:
      toNumber(
        pattern.confirmationScore,
        0
      ),

    marketRegime,

    regime:
      marketRegime
  };

  if (
    learner.isPatternBlacklisted(
      pattern.name
    )
  ) {
    logAudit({
      pair,

      timeframe,

      pattern:
        pattern.name,

      decision:
        "REJECTED",

      reason:
        "pattern is currently blacklisted"
    });

    return null;
  }

  const confidence =
    learner
      .calculateAdaptiveConfidence(
        signalContext
      );

  if (
    confidence <
    MINIMUM_CONFIDENCE
  ) {
    logAudit({
      pair,

      timeframe,

      pattern:
        pattern.name,

      decision:
        "REJECTED",

      reason:
        `confidence ${confidence}% below ${MINIMUM_CONFIDENCE}% threshold`
    });

    return null;
  }

  const signal =
    signalGenerator
      .generateSignal(
        pair,
        timeframe,
        pattern,
        confidence,
        lastCandle,
        {
          candles:
            timeframeCandles,

          marketRegime,

          recordSignal:
            false
        }
      );

  if (!signal) {
    logAudit({
      pair,

      timeframe,

      pattern:
        pattern.name,

      decision:
        "REJECTED",

      reason:
        "signal generator rejected setup"
    });

    return null;
  }

  const entry =
    toNumber(
      signal.entry,
      NaN
    );

  const stopLoss =
    toNumber(
      signal.stopLoss,
      NaN
    );

  const primaryTarget =
    getPrimaryTakeProfit(
      signal
    );

  const risk =
    Math.abs(
      entry - stopLoss
    );

  const reward =
    Math.abs(
      primaryTarget - entry
    );

  const riskReward =
    risk > 0
      ? reward / risk
      : 0;

  const riskRewardScore =
    Math.min(
      (
        riskReward / 5
      ) * 100,
      100
    );

  const historicalWinRate =
    getHistoricalWinRate(
      learner,
      signalContext
    );

  let qualityScore =
    confidence * 0.35 +
    toNumber(
      pattern.confirmationScore,
      0
    ) * 0.25 +
    toNumber(
      pattern.strength,
      0
    ) * 0.2 +
    riskRewardScore * 0.1 +
    historicalWinRate * 0.1;

  const session =
    getMarketSession();

  const sessionMultiplier =
    SESSION_QUALITY_MULTIPLIER[
      session
    ] || 1;

  qualityScore *=
    sessionMultiplier;

  qualityScore =
    Math.max(
      0,
      Math.min(
        100,
        qualityScore
      )
    );

  return {
    pattern,

    signal:
      applyLegacySignalAliases(
        signal
      ),

    confidence,

    qualityScore,

    session,

    marketRegime,

    historicalWinRate,

    riskReward
  };
}

function selectBestPattern(
  pair,
  timeframe,
  patterns,
  timeframeCandles,
  learner,
  signalGenerator
) {
  const candidates =
    patterns
      .map(
        pattern =>
          scorePattern(
            pair,
            timeframe,
            pattern,
            timeframeCandles,
            learner,
            signalGenerator
          )
      )
      .filter(Boolean);

  if (
    candidates.length === 0
  ) {
    return null;
  }

  const buyCount =
    candidates.filter(
      candidate =>
        candidate.signal
          .direction ===
        "BUY"
    ).length;

  const sellCount =
    candidates.filter(
      candidate =>
        candidate.signal
          .direction ===
        "SELL"
    ).length;

  for (
    const candidate of
    candidates
  ) {
    const sameDirectionCount =
      candidate.signal
        .direction === "BUY"
        ? buyCount
        : sellCount;

    const oppositeDirectionCount =
      candidate.signal
        .direction === "BUY"
        ? sellCount
        : buyCount;

    if (
      oppositeDirectionCount > 0
    ) {
      candidate.qualityScore =
        Math.max(
          candidate.qualityScore -
            5,
          0
        );

      candidate.consensusNote =
        `conflict: ${buyCount} BUY vs ${sellCount} SELL patterns`;
    } else if (
      sameDirectionCount >= 2
    ) {
      const boost =
        Math.min(
          (
            sameDirectionCount -
            1
          ) * 3,
          10
        );

      candidate.qualityScore =
        Math.min(
          candidate.qualityScore +
            boost,
          100
        );

      candidate.consensusNote =
        `${sameDirectionCount} ${candidate.signal.direction} patterns agree (+${boost})`;
    }
  }

  candidates.sort(
    (
      first,
      second
    ) =>
      second.qualityScore -
      first.qualityScore
  );

  const best =
    candidates[0];

  const runnerUp =
    candidates[1];

  if (
    runnerUp &&
    Math.abs(
      best.qualityScore -
      runnerUp.qualityScore
    ) <= 2 &&
    runnerUp.signal
      .direction !==
      best.signal.direction
  ) {
    console.log(
      `⚖️ ${pair} ${timeframe} | Conflicting patterns near quality parity (${best.pattern.name} vs ${runnerUp.pattern.name}) — skipped`
    );

    logAudit({
      pair,

      timeframe,

      decision:
        "REJECTED",

      reason:
        `near-parity conflict: ${best.pattern.name} (${best.qualityScore.toFixed(1)}) vs ${runnerUp.pattern.name} (${runnerUp.qualityScore.toFixed(1)})`
    });

    return null;
  }

  logAudit({
    pair,

    timeframe,

    pattern:
      best.pattern.name,

    decision:
      "SELECTED",

    direction:
      best.signal.direction,

    confidence:
      best.confidence,

    qualityScore:
      round(
        best.qualityScore,
        2
      ),

    session:
      best.session,

    marketRegime:
      best.marketRegime,

    reason:
      best.consensusNote ||
      "best quality score among candidates"
  });

  return best;
}
