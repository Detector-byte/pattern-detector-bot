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

// =====================================================
// Pair Analysis
// =====================================================

function refreshExistingSignal(
  existingSignal,
  newSignal,
  pattern
) {
  const oldConfidence =
    toNumber(
      existingSignal.confidence,
      0
    );

  const newConfidence =
    toNumber(
      newSignal.confidence,
      0
    );

  if (
    newConfidence >
    oldConfidence
  ) {
    existingSignal.confidence =
      newConfidence;
  }

  const oldConfirmation =
    toNumber(
      existingSignal
        .confirmationScore,
      0
    );

  const newConfirmation =
    toNumber(
      pattern.confirmationScore,
      0
    );

  if (
    newConfirmation >
    oldConfirmation
  ) {
    existingSignal
      .confirmationScore =
      newConfirmation;
  }

  const newTarget1 =
    getPrimaryTakeProfit(
      newSignal
    );

  const newTarget2 =
    getSecondTakeProfit(
      newSignal
    );

  const newTarget3 =
    getThirdTakeProfit(
      newSignal
    );

  if (
    newSignal.direction ===
    "BUY"
  ) {
    if (
      toNumber(
        newSignal.stopLoss,
        -Infinity
      ) >
      toNumber(
        existingSignal.stopLoss,
        -Infinity
      )
    ) {
      existingSignal.stopLoss =
        newSignal.stopLoss;
    }

    if (
      newTarget1 >
      getPrimaryTakeProfit(
        existingSignal
      )
    ) {
      existingSignal.takeProfit =
        newTarget1;

      existingSignal.takeProfit1 =
        newTarget1;
    }

    if (
      newTarget2 >
      getSecondTakeProfit(
        existingSignal
      )
    ) {
      existingSignal.takeProfit2 =
        newTarget2;
    }

    if (
      newTarget3 >
      getThirdTakeProfit(
        existingSignal
      )
    ) {
      existingSignal.takeProfit3 =
        newTarget3;
    }

    if (
      toNumber(
        newSignal.entry,
        -Infinity
      ) >
      toNumber(
        existingSignal.entry,
        -Infinity
      )
    ) {
      existingSignal.entry =
        newSignal.entry;
    }
  } else if (
    newSignal.direction ===
    "SELL"
  ) {
    if (
      toNumber(
        newSignal.stopLoss,
        Infinity
      ) <
      toNumber(
        existingSignal.stopLoss,
        Infinity
      )
    ) {
      existingSignal.stopLoss =
        newSignal.stopLoss;
    }

    if (
      newTarget1 <
      getPrimaryTakeProfit(
        existingSignal
      )
    ) {
      existingSignal.takeProfit =
        newTarget1;

      existingSignal.takeProfit1 =
        newTarget1;
    }

    if (
      newTarget2 <
      getSecondTakeProfit(
        existingSignal
      )
    ) {
      existingSignal.takeProfit2 =
        newTarget2;
    }

    if (
      newTarget3 <
      getThirdTakeProfit(
        existingSignal
      )
    ) {
      existingSignal.takeProfit3 =
        newTarget3;
    }

    if (
      toNumber(
        newSignal.entry,
        Infinity
      ) <
      toNumber(
        existingSignal.entry,
        Infinity
      )
    ) {
      existingSignal.entry =
        newSignal.entry;
    }
  }

  existingSignal.qualityScore =
    Math.max(
      toNumber(
        existingSignal
          .qualityScore,
        0
      ),
      toNumber(
        newSignal.qualityScore,
        0
      )
    );

  existingSignal
    .adaptiveConfidence =
    newSignal
      .adaptiveConfidence ??
    existingSignal
      .adaptiveConfidence;

  existingSignal
    .patternWeight =
    newSignal.patternWeight ??
    existingSignal.patternWeight;

  existingSignal
    .marketRegime =
    newSignal.marketRegime ??
    existingSignal.marketRegime;

  existingSignal
    .lastUpdated =
    nowIso();

  existingSignal
    .refreshCount =
    (
      existingSignal
        .refreshCount ||
      1
    ) + 1;

  existingSignal.version =
    (
      existingSignal.version ||
      1
    ) + 1;

  return {
    oldConfidence,

    newConfidence:
      existingSignal.confidence
  };
}

function analyzePair(
  pair,
  candles,
  analyzer,
  learner,
  signalGenerator,
  existingSignals
) {
  const generatedSignals = [];

  const trendCache = {};

  if (
    !candles?.[pair]
  ) {
    return generatedSignals;
  }

  /*
   * Precalculate available trends so lower timeframes
   * can use 1H/4H confirmation even if they are
   * processed first.
   */
  for (
    const timeframe of
    SUPPORTED_TIMEFRAMES
  ) {
    const timeframeCandles =
      candles[pair][
        timeframe
      ];

    if (
      !Array.isArray(
        timeframeCandles
      ) ||
      timeframeCandles.length <
        MINIMUM_CANDLES
    ) {
      continue;
    }

    trendCache[
      `${pair}_${timeframe}`
    ] =
      analyzer.detectTrend(
        timeframeCandles
      );
  }

  for (
    const timeframe of
    SUPPORTED_TIMEFRAMES
  ) {
    const timeframeCandles =
      candles[pair][
        timeframe
      ];

    if (
      !Array.isArray(
        timeframeCandles
      ) ||
      timeframeCandles.length <
        MINIMUM_CANDLES
    ) {
      continue;
    }

    const volatilityCheck =
      passesSpreadVolatilityFilter(
        timeframeCandles
      );

    if (
      !volatilityCheck.pass
    ) {
      console.log(
        `🚫 ${pair} ${timeframe} | Skipped — ${volatilityCheck.reason}`
      );

      logAudit({
        pair,

        timeframe,

        decision:
          "REJECTED",

        reason:
          volatilityCheck.reason
      });

      continue;
    }

    const patterns =
      analyzer.detectAllPatterns(
        timeframeCandles
      );

    if (
      !Array.isArray(patterns) ||
      patterns.length === 0
    ) {
      continue;
    }

    const best =
      selectBestPattern(
        pair,
        timeframe,
        patterns,
        timeframeCandles,
        learner,
        signalGenerator
      );

    if (!best) {
      continue;
    }

    const {
      pattern,
      signal,
      confidence
    } = best;

    const higherTrend =
      timeframe === "4H"
        ? null
        : (
            trendCache[
              `${pair}_4H`
            ] ||
            trendCache[
              `${pair}_1H`
            ]
          );

    if (
      higherTrend &&
      higherTrend !==
        "SIDEWAYS" &&
      higherTrend !==
        "NEUTRAL" &&
      higherTrend !==
        signal.direction
    ) {
      logAudit({
        pair,

        timeframe,

        pattern:
          pattern.name,

        decision:
          "REJECTED",

        reason:
          `against higher-timeframe trend (${higherTrend})`
      });

      continue;
    }

    const activeMatch =
      findActiveDuplicate(
        pair,
        timeframe,
        pattern.name,
        existingSignals
      );

    if (activeMatch) {
      const refresh =
        refreshExistingSignal(
          activeMatch,
          signal,
          pattern
        );

      console.log(
        `🔁 ${pair} ${timeframe} | ${pattern.name} refreshed → v${activeMatch.version} (refresh #${activeMatch.refreshCount})`
      );

      logAudit({
        pair,

        timeframe,

        pattern:
          pattern.name,

        decision:
          "REFRESHED",

        reason:
          `confidence ${refresh.oldConfidence}% → ${refresh.newConfidence}%, version ${activeMatch.version}`
      });

      continue;
    }

    const timestamp =
      nowIso();

    const preparedSignal =
      applyLegacySignalAliases({
        ...signal,

        signalId:
          buildSignalId(
            pair,
            timeframe,
            pattern.name
          ),

        timestamp,

        status:
          "NEW",

        version: 1,

        createdAt:
          timestamp,

        lastUpdated:
          timestamp,

        refreshCount: 1,

        outcome: null
      });

    if (
      isSignalInCooldown(
        preparedSignal,
        existingSignals
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
          "cooldown active"
      });

      continue;
    }

    generatedSignals.push(
      preparedSignal
    );

    /*
     * Include the new signal in duplicate/cooldown
     * checks for the remainder of this run.
     */
    existingSignals.push(
      preparedSignal
    );

    console.log(
      `✅ ${pair} ${timeframe} | ${pattern.name} | ${signal.direction} | Confidence: ${confidence}%`
    );

    logAudit({
      pair,

      timeframe,

      pattern:
        pattern.name,

      decision:
        "GENERATED",

      direction:
        signal.direction,

      confidence,

      qualityScore:
        signal.qualityScore,

      marketRegime:
        signal.marketRegime,

      reason:
        "passed trend, session, volatility, cooldown and consensus filters"
    });
  }

  return generatedSignals;
}

function analyzeMarkets(
  candles,
  analyzer,
  learner,
  signalGenerator,
  existingSignals
) {
  console.log(
    "🔍 Analyzing patterns..."
  );

  const newSignals = [];

  const workingSignals =
    Array.isArray(
      existingSignals
    )
      ? existingSignals
      : [];

  for (
    const pair of
    SUPPORTED_PAIRS
  ) {
    newSignals.push(
      ...analyzePair(
        pair,
        candles,
        analyzer,
        learner,
        signalGenerator,
        workingSignals
      )
    );
  }

  return newSignals;
}

// =====================================================
// Signal Resolution
// =====================================================

function determineSignalOutcome(
  signal,
  candle
) {
  if (
    !signal ||
    !candle
  ) {
    return null;
  }

  const high =
    toNumber(
      candle.high,
      NaN
    );

  const low =
    toNumber(
      candle.low,
      NaN
    );

  const stopLoss =
    toNumber(
      signal.stopLoss,
      NaN
    );

  const target =
    getPrimaryTakeProfit(
      signal
    );

  if (
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(
      stopLoss
    ) ||
    !Number.isFinite(target)
  ) {
    return null;
  }

  if (
    signal.direction ===
    "BUY"
  ) {
    const targetHit =
      high >= target;

    const stopHit =
      low <= stopLoss;

    /*
     * Conservative handling when both TP and SL
     * appear inside the same candle.
     */
    if (
      targetHit &&
      stopHit
    ) {
      return "LOSS";
    }

    if (targetHit) {
      return "WIN";
    }

    if (stopHit) {
      return "LOSS";
    }
  }

  if (
    signal.direction ===
    "SELL"
  ) {
    const targetHit =
      low <= target;

    const stopHit =
      high >= stopLoss;

    if (
      targetHit &&
      stopHit
    ) {
      return "LOSS";
    }

    if (targetHit) {
      return "WIN";
    }

    if (stopHit) {
      return "LOSS";
    }
  }

  return null;
}

async function resolvePendingSignals(
  learner,
  existingSignals,
  candles
) {
  if (
    !Array.isArray(
      existingSignals
    )
  ) {
    return existingSignals;
  }

  const resolutions = [];

  for (
    const signal of
    existingSignals
  ) {
    if (
      !signal ||
      !OPEN_STATUSES.includes(
        signal.status
      )
    ) {
      continue;
    }

    if (
      signal.status ===
      "NEW"
    ) {
      signal.status =
        "ACTIVE";

      signal.lastUpdated =
        nowIso();
    }

    const pairCandles =
      candles?.[
        signal.pair
      ]?.[
        signal.timeframe
      ];

    if (
      !Array.isArray(
        pairCandles
      ) ||
      pairCandles.length === 0
    ) {
      continue;
    }

    const latest =
      pairCandles[
        pairCandles.length - 1
      ];

    const outcome =
      determineSignalOutcome(
        signal,
        latest
      );

    if (outcome) {
      signal.outcome =
        outcome;

      signal.status =
        outcome;

      signal.resolvedAt =
        nowIso();

      signal.lastUpdated =
        signal.resolvedAt;

      resolutions.push({
        id:
          signal.id ||
          signal.signalId ||
          signal.timestamp,

        outcome,

        resolvedAt:
          signal.resolvedAt
      });

      console.log(
        `🎯 ${signal.pattern} ${signal.pair} ${signal.timeframe} → ${outcome}`
      );

      logAudit({
        pair:
          signal.pair,

        timeframe:
          signal.timeframe,

        pattern:
          signal.pattern,

        decision:
          "RESOLVED",

        outcome,

        reason:
          outcome === "WIN"
            ? "take-profit reached"
            : "stop-loss reached"
      });

      continue;
    }

    const expiryMs =
      EXPIRY_MAP[
        signal.timeframe
      ];

    if (!expiryMs) {
      continue;
    }

    const createdTime =
      new Date(
        getSignalTimestamp(
          signal
        )
      ).getTime();

    if (
      Number.isNaN(
        createdTime
      )
    ) {
      continue;
    }

    const elapsed =
      Date.now() -
      createdTime;

    if (
      elapsed >= expiryMs
    ) {
      signal.status =
        "EXPIRED";

      signal.outcome =
        "EXPIRED";

      signal.expiredAt =
        nowIso();

      signal.lastUpdated =
        signal.expiredAt;

      console.log(
        `⌛ ${signal.pattern} ${signal.pair} ${signal.timeframe} → EXPIRED`
      );

      logAudit({
        pair:
          signal.pair,

        timeframe:
          signal.timeframe,

        pattern:
          signal.pattern,

        decision:
          "EXPIRED",

        reason:
          `signal exceeded ${signal.timeframe} lifecycle limit`
      });
    }
  }

  if (
    resolutions.length > 0
  ) {
    if (
      typeof learner
        .resolveSignals ===
        "function"
    ) {
      learner.resolveSignals(
        resolutions
      );
    } else {
      for (
        const resolution of
        resolutions
      ) {
        learner.resolveSignal(
          resolution.id,
          resolution.outcome
        );
      }
    }
  }

  return existingSignals;
}

// =====================================================
// Learning Update
// =====================================================

async function updateLearning(
  learner,
  existingSignals,
  newSignals,
  candles
) {
  console.log(
    "🧠 Updating learning outcomes..."
  );

  await resolvePendingSignals(
    learner,
    existingSignals,
    candles
  );

  if (
    Array.isArray(
      newSignals
    ) &&
    newSignals.length > 0
  ) {
    learner.updateHistory(
      newSignals
    );
  } else {
    learner.updatePatternStats();
  }

  if (
    typeof learner
      .runLearningCycle ===
      "function"
  ) {
    learner.runLearningCycle();
  }

  return existingSignals;
}

// =====================================================
// Archive and Persistence
// =====================================================

function archiveSignals(
  signalsToArchive
) {
  if (
    !Array.isArray(
      signalsToArchive
    ) ||
    signalsToArchive.length === 0
  ) {
    return;
  }

  try {
    const archiveData =
      safeReadJson(
        ARCHIVE_FILE,
        getDefaultArchiveData()
      );

    const existingArchive =
      Array.isArray(
        archiveData.signals
      )
        ? archiveData.signals
        : [];

    const archivedEntries =
      signalsToArchive.map(
        signal => ({
          ...signal,

          previousStatus:
            signal.status,

          status:
            "ARCHIVED",

          archivedAt:
            nowIso()
        })
      );

    const combined =
      [
        ...existingArchive,
        ...archivedEntries
      ].slice(
        -MAX_ARCHIVE_SIGNALS
      );

    safeWriteJson(
      ARCHIVE_FILE,
      {
        ...archiveData,

        signals:
          combined,

        updatedAt:
          nowIso(),

        totalArchived:
          combined.length
      }
    );

    console.log(
      `🗄️ Archived ${archivedEntries.length} closed signal(s)`
    );
  } catch (error) {
    console.error(
      "Error archiving signals:",
      error.message
    );
  }
}

function mergeSignals(
  newSignals,
  existingSignals
) {
  const allSignals =
    Array.isArray(
      existingSignals
    )
      ? [...existingSignals]
      : [];

  for (
    const incomingSignal of
    newSignals || []
  ) {
    const signal =
      applyLegacySignalAliases(
        incomingSignal
      );

    const incomingId =
      signal.id ||
      signal.signalId;

    const index =
      allSignals.findIndex(
        existingSignal => {
          const existingId =
            existingSignal.id ||
            existingSignal.signalId;

          if (
            incomingId &&
            existingId
          ) {
            return (
              incomingId ===
              existingId
            );
          }

          return (
            existingSignal.pair ===
              signal.pair &&
            existingSignal.timeframe ===
              signal.timeframe &&
            existingSignal.pattern ===
              signal.pattern &&
            OPEN_STATUSES.includes(
              existingSignal.status
            )
          );
        }
      );

    if (
      index >= 0
    ) {
      const previous =
        allSignals[index];

      allSignals[index] = {
        ...previous,
        ...signal,

        outcome:
          signal.outcome ??
          previous.outcome,

        createdAt:
          previous.createdAt ||
          signal.createdAt,

        timestamp:
          previous.timestamp ||
          signal.timestamp
      };
    } else {
      allSignals.push(
        signal
      );
    }
  }

  const uniqueMap =
    new Map();

  for (
    const signal of
    allSignals
  ) {
    if (!signal) {
      continue;
    }

    const key =
      signal.id ||
      signal.signalId ||
      [
        signal.pair,
        signal.timeframe,
        signal.pattern,
        signal.timestamp ||
        signal.createdAt
      ].join("_");

    const previous =
      uniqueMap.get(key);

    if (!previous) {
      uniqueMap.set(
        key,
        signal
      );

      continue;
    }

    const previousTime =
      new Date(
        previous.lastUpdated ||
        previous.createdAt ||
        0
      ).getTime();

    const signalTime =
      new Date(
        signal.lastUpdated ||
        signal.createdAt ||
        0
      ).getTime();

    if (
      signalTime >=
      previousTime
    ) {
      uniqueMap.set(
        key,
        signal
      );
    }
  }

  return Array.from(
    uniqueMap.values()
  );
}

function saveData(
  newSignals,
  existingSignals,
  confidenceData,
  learningData
) {
  try {
    const uniqueSignals =
      mergeSignals(
        newSignals,
        existingSignals
      );

    const openSignals =
      uniqueSignals.filter(
        signal =>
          OPEN_STATUSES.includes(
            signal.status
          )
      );

    const closedSignals =
      uniqueSignals
        .filter(
          signal =>
            !OPEN_STATUSES.includes(
              signal.status
            )
        )
        .sort(
          (
            first,
            second
          ) =>
            new Date(
              first.resolvedAt ||
              first.expiredAt ||
              first.lastUpdated ||
              first.createdAt ||
              0
            ).getTime() -
            new Date(
              second.resolvedAt ||
              second.expiredAt ||
              second.lastUpdated ||
              second.createdAt ||
              0
            ).getTime()
        );

    const closedToKeep =
      closedSignals.slice(
        -MAX_MAIN_CLOSED_SIGNALS
      );

    const archiveCount =
      Math.max(
        0,
        closedSignals.length -
        closedToKeep.length
      );

    const closedToArchive =
      closedSignals.slice(
        0,
        archiveCount
      );

    if (
      closedToArchive.length > 0
    ) {
      archiveSignals(
        closedToArchive
      );
    }

    const keptSignals = [
      ...openSignals,
      ...closedToKeep
    ];

    const timestamp =
      nowIso();

    const signalsData = {
      signals:
        keptSignals,

      updatedAt:
        timestamp,

      stale: {},

      totalSignals:
        keptSignals.length,

      resolvedSignals:
        keptSignals.filter(
          signal =>
            signal.status ===
              "WIN" ||
            signal.status ===
              "LOSS"
        ).length,

      expiredSignals:
        keptSignals.filter(
          signal =>
            signal.status ===
            "EXPIRED"
        ).length,

      pendingSignals:
        openSignals.length
    };

    const confidenceDataToSave = {
      patterns:
        confidenceData &&
        typeof confidenceData ===
          "object"
          ? confidenceData
          : {},

      updatedAt:
        timestamp
    };

    /*
     * Save all Phase 4 fields instead of only
     * history and stats.
     */
    const learningDataToSave = {
      ...getDefaultLearningData(),
      ...learningData,

      history:
        Array.isArray(
          learningData?.history
        )
          ? learningData.history
          : [],

      stats:
        learningData?.stats &&
        typeof learningData.stats ===
          "object"
          ? learningData.stats
          : {},

      updatedAt:
        timestamp
    };

    safeWriteJson(
      SIGNALS_FILE,
      signalsData
    );

    safeWriteJson(
      CONFIDENCE_FILE,
      confidenceDataToSave
    );

    safeWriteJson(
      LEARNING_FILE,
      learningDataToSave
    );
  } catch (error) {
    console.error(
      "Error saving data:",
      error.message
    );

    throw error;
  }
}

function saveBotResults(
  newSignals,
  updatedSignals,
  learner
) {
  saveData(
    newSignals,
    updatedSignals,
    learner.getConfidenceData(),
    learner.getLearningData()
  );
}

// =====================================================
// Staleness
// =====================================================

function updateStaleness(
  reason
) {
  try {
    const data =
      safeReadJson(
        SIGNALS_FILE,
        getDefaultSignalsData()
      );

    const stale = {};

    for (
      const pair of
      SUPPORTED_PAIRS
    ) {
      stale[pair] =
        true;
    }

    safeWriteJson(
      SIGNALS_FILE,
      {
        ...data,

        stale: {
          ...stale,

          reason,

          timestamp:
            nowIso()
        }
      }
    );
  } catch (error) {
    console.error(
      "Error updating staleness:",
      error.message
    );
  }
}

// =====================================================
// Main Bot Execution
// =====================================================

async function runBot() {
  console.log(
    "🤖 PipSight Pro AI Starting..."
  );

  console.log(
    `⏰ Execution time: ${nowIso()}`
  );

  const totalStart =
    Date.now();

  let fetchDurationMs = 0;

  let analysisDurationMs = 0;

  let learningDurationMs = 0;

  let saveDurationMs = 0;

  try {
    initializeFiles();

    const data =
      loadData();

    const analyzer =
      new PatternAnalyzer();

    const learner =
      new LearningSystem(
        data.learning,
        data.confidence
      );

    /*
     * Important:
     * SignalGenerator and index.js must use the same
     * learner instance.
     */
    const signalGenerator =
      new SignalGenerator({
        learner,

        minimumRiskReward:
          1.5,

        actionableThreshold:
          MINIMUM_CONFIDENCE
      });

    /*
     * Apply learned detector thresholds when the
     * analyzer supports Phase 4 evolution.
     */
    const evolution =
      learner
        .getPatternEvolutionRecommendations();

    if (
      typeof analyzer
        .applyPatternEvolution ===
        "function"
    ) {
      analyzer
        .applyPatternEvolution(
          evolution
        );
    }

    const fetchStart =
      Date.now();

    const candles =
      await fetchMarketData(
        analyzer
      );

    fetchDurationMs =
      Date.now() -
      fetchStart;

    console.log(
      `📊 Fetch completed in ${fetchDurationMs} ms`
    );

    if (!candles) {
      saveAuditLog();

      runHealthCheck({
        status:
          "CRITICAL",

        reason:
          "data-fetch-failed",

        fetchDurationMs,

        totalRuntimeMs:
          Date.now() -
          totalStart
      });

      return;
    }

    const existingSignals =
      Array.isArray(
        data.signals.signals
      )
        ? data.signals.signals
        : [];

    const analysisStart =
      Date.now();

    const newSignals =
      analyzeMarkets(
        candles,
        analyzer,
        learner,
        signalGenerator,
        existingSignals
      );

    analysisDurationMs =
      Date.now() -
      analysisStart;

    console.log(
      `🔍 Analysis completed in ${analysisDurationMs} ms`
    );

    const learningStart =
      Date.now();

    const updatedSignals =
      await updateLearning(
        learner,
        existingSignals,
        newSignals,
        candles
      );

    learningDurationMs =
      Date.now() -
      learningStart;

    console.log(
      `🧠 Learning completed in ${learningDurationMs} ms`
    );

    const saveStart =
      Date.now();

    saveBotResults(
      newSignals,
      updatedSignals,
      learner
    );

    saveDurationMs =
      Date.now() -
      saveStart;

    console.log(
      `💾 Save completed in ${saveDurationMs} ms`
    );

    const averageConfidence =
      newSignals.length > 0
        ? newSignals.reduce(
            (
              total,
              signal
            ) =>
              total +
              toNumber(
                signal.confidence,
                0
              ),
            0
          ) /
          newSignals.length
        : null;

    const recentlyResolved =
      updatedSignals.filter(
        signal =>
          signal.status ===
            "WIN" ||
          signal.status ===
            "LOSS"
      );

    const recentWins =
      recentlyResolved.filter(
        signal =>
          signal.status ===
          "WIN"
      ).length;

    const recentWinRate =
      recentlyResolved.length > 0
        ? (
            recentWins /
            recentlyResolved.length
          ) * 100
        : null;

    const learningHealth =
      learner.getHealthStatus();

    runHealthCheck({
      status:
        learningHealth?.status ||
        "HEALTHY",

      signalsGenerated:
        newSignals.length,

      averageConfidence:
        averageConfidence !== null
          ? round(
              averageConfidence,
              1
            )
          : null,

      recentWinRate:
        recentWinRate !== null
          ? round(
              recentWinRate,
              1
            )
          : null,

      openSignals:
        updatedSignals.filter(
          signal =>
            OPEN_STATUSES.includes(
              signal.status
            )
        ).length,

      blacklistedPatterns:
        Object.keys(
          learner.data
            ?.blacklistedPatterns ||
          {}
        ).length,

      fetchDurationMs,

      analysisDurationMs,

      learningDurationMs,

      saveDurationMs,

      totalRuntimeMs:
        Date.now() -
        totalStart
    });

    saveAuditLog();

    console.log(
      "\n✨ Bot execution complete"
    );

    console.log(
      `📈 Signals generated: ${newSignals.length}`
    );

    console.log(
      "💾 Data saved successfully"
    );

    console.log(
      `⏱ Total runtime: ${Date.now() - totalStart} ms`
    );
  } catch (error) {
    console.error(
      "❌ Bot execution failed:",
      error.message
    );

    console.error(
      error.stack
    );

    runHealthCheck({
      status:
        "CRITICAL",

      reason:
        error.message,

      fetchDurationMs,

      analysisDurationMs,

      learningDurationMs,

      saveDurationMs,

      totalRuntimeMs:
        Date.now() -
        totalStart
    });

    saveAuditLog();

    process.exitCode = 1;
  }
}

// =====================================================
// Process Safety
// =====================================================

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "Unhandled promise rejection:",
      error
    );

    runHealthCheck({
      status:
        "CRITICAL",

      reason:
        `unhandled rejection: ${
          error?.message ||
          String(error)
        }`
    });

    saveAuditLog();

    process.exitCode = 1;
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "Uncaught exception:",
      error
    );

    runHealthCheck({
      status:
        "CRITICAL",

      reason:
        `uncaught exception: ${error.message}`
    });

    saveAuditLog();

    process.exitCode = 1;
  }
);

// =====================================================
// Run Bot
// =====================================================

if (
  require.main === module
) {
  runBot().catch(
    error => {
      console.error(
        "Fatal error:",
        error
      );

      process.exitCode = 1;
    }
  );
}

// =====================================================
// Optional Exports for Testing
// =====================================================

module.exports = {
  runBot,

  initializeFiles,

  loadData,

  fetchMarketData,

  analyzeMarkets,

  analyzePair,

  scorePattern,

  selectBestPattern,

  updateLearning,

  resolvePendingSignals,

  determineSignalOutcome,

  saveData,

  saveBotResults,

  archiveSignals,

  updateStaleness,

  passesSpreadVolatilityFilter,

  getMarketSession,

  isSignalInCooldown,

  buildSignalId,

  findActiveDuplicate,

  applyLegacySignalAliases,

  OPEN_STATUSES,

  CLOSED_STATUSES,

  EXPIRY_MAP,

  SUPPORTED_PAIRS,

  SUPPORTED_TIMEFRAMES
};
