#!/usr/bin/env node

/**
 * PipSight Pro AI - Phase 6 Institutional Orchestrator
 *
 * Backward-compatible entry point.
 * Existing analyzer.js, learner.js and signals.js APIs remain unchanged.
 *
 * Phase 6 adds:
 * - Institutional AI ranking
 * - Dynamic final confidence
 * - Portfolio exposure management
 * - Correlation penalties
 * - Advanced market-state enhancement
 * - Automatic strategy prioritization
 * - Explainable AI
 * - Self-optimizer recommendations
 * - Weekly performance reports
 * - Dashboard-ready statistics
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

const PHASE6_FILE =
  path.join(
    DATA_DIR,
    "phase6-intelligence.json"
  );

const DASHBOARD_FILE =
  path.join(
    DATA_DIR,
    "phase6-dashboard.json"
  );

const WEEKLY_REPORT_FILE =
  path.join(
    DATA_DIR,
    "phase6-weekly-report.json"
  );

const OPTIMIZER_FILE =
  path.join(
    DATA_DIR,
    "phase6-optimizer.json"
  );

const PIPELINE_STATUS_FILE =
  path.join(
    DATA_DIR,
    "pattern-pipeline-status.json"
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

const MINIMUM_AI_SCORE = 70;

const MAX_MAIN_CLOSED_SIGNALS = 500;

const MAX_ARCHIVE_SIGNALS = 10000;

const MAX_AUDIT_ENTRIES = 2000;

const MAX_HEALTH_ENTRIES = 100;

const MAX_OPEN_TRADES = 4;

const MAX_PAIR_OPEN_TRADES = 2;

const MAX_SAME_DIRECTION_PER_PAIR = 2;

const MAX_JPY_EXPOSURE = 2;

/**
 * Existing signal expiry behavior.
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
 * Existing market-session quality multipliers.
 */
const SESSION_QUALITY_MULTIPLIER = {
  ASIAN: 0.9,

  LONDON: 1.05,

  LONDON_NY_OVERLAP: 1.15,

  NEWYORK: 1.05,

  OFF_HOURS: 0.8
};

/**
 * Extensible portfolio correlation groups.
 *
 * These values do not recalculate market correlation.
 * They apply exposure penalties to related instruments.
 */
const CORRELATION_GROUPS = {
  JPY: [
    "GBPJPY",
    "USDJPY",
    "EURJPY",
    "AUDJPY",
    "CADJPY",
    "CHFJPY",
    "NZDJPY"
  ],

  GOLD_USD: [
    "XAUUSD",
    "XAGUSD",
    "EURUSD",
    "GBPUSD"
  ]
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

function clamp(
  value,
  minimum = 0,
  maximum = 100
) {
  return Math.max(
    minimum,
    Math.min(
      maximum,
      toNumber(
        value,
        minimum
      )
    )
  );
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

function average(values) {
  const validValues =
    values
      .map(Number)
      .filter(Number.isFinite);

  if (
    validValues.length === 0
  ) {
    return 0;
  }

  return (
    validValues.reduce(
      (
        total,
        value
      ) =>
        total + value,
      0
    ) /
    validValues.length
  );
}

function percent(
  part,
  total
) {
  return total > 0
    ? (
        part /
        total
      ) * 100
    : 0;
}

function safeArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function objectOrEmpty(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value
    : {};
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

    return raw.trim()
      ? JSON.parse(raw)
      : fallback;
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
      // Ignore cleanup errors.
    }

    return false;
  }
}

// =====================================================
// Default Data Structures
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

function getDefaultPhase6Data() {
  return {
    version:
      "6.0.0",

    updatedAt:
      nowIso(),

    lastRun:
      null,

    publishedSignalId:
      null,

    rejectedCandidates: [],

    portfolio: {},

    marketStates: {},

    strategyPriorities: {},

    optimizerRecommendations: []
  };
}

function getDefaultDashboardData() {
  return {
    version:
      "6.0.0",

    updatedAt:
      nowIso(),

    distributions: {},

    performance: {},

    health: {}
  };
}

function getDefaultWeeklyReport() {
  return {
    version:
      "6.0.0",

    generatedAt:
      null,

    period: {},

    metrics: {},

    recommendations: []
  };
}

function getDefaultPipelineStatusData() {
  return {
    version:
      "1.0.0",

    updatedAt:
      nowIso(),

    pairs: {}
  };
}

// =====================================================
// File Initialization and Loading
// =====================================================

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

  const files = [
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
    ],

    [
      PHASE6_FILE,
      getDefaultPhase6Data()
    ],

    [
      DASHBOARD_FILE,
      getDefaultDashboardData()
    ],

        [
      WEEKLY_REPORT_FILE,
      getDefaultWeeklyReport()
    ],

    [
      OPTIMIZER_FILE,
      {
        version:
          "6.0.0",

        updatedAt:
          nowIso(),

        recommendations: []
      }
    ],

    [
      PIPELINE_STATUS_FILE,
      getDefaultPipelineStatusData()
    ]
  ];

  for (
    const [
      filePath,
      defaultData
    ] of files
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

  const phase6 =
    safeReadJson(
      PHASE6_FILE,
      getDefaultPhase6Data()
    );

  return {
    signals: {
      ...getDefaultSignalsData(),
      ...signals,

      signals:
        safeArray(
          signals.signals
        )
    },

    confidence: {
      ...getDefaultConfidenceData(),
      ...confidence,

      patterns:
        objectOrEmpty(
          confidence.patterns
        )
    },

    learning: {
      ...getDefaultLearningData(),
      ...learning,

      history:
        safeArray(
          learning.history
        )
    },

    phase6: {
      ...getDefaultPhase6Data(),
      ...phase6
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

  const entries = [
    ...safeArray(
      auditData.entries
    ),

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
}

// =====================================================
// Health Monitor
// =====================================================

function runHealthCheck(report) {
  const healthData =
    safeReadJson(
      HEALTH_FILE,
      getDefaultHealthData()
    );

  const history = [
    ...safeArray(
      healthData.history
    ),

    {
      timestamp:
        nowIso(),

      ...report
    }
  ].slice(
    -MAX_HEALTH_ENTRIES
  );

  safeWriteJson(
    HEALTH_FILE,
    {
      ...healthData,

      history,

      updatedAt:
        nowIso(),

      lastStatus:
        report.status
    }
  );

  console.log(
    `🩺 Health check: ${report.status}`
  );
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

  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    try {
      const candles =
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
// Existing Session and Volatility Filters
// =====================================================

function getMarketSession() {
  const hour =
    new Date()
      .getUTCHours();

  if (
    hour < 7
  ) {
    return "ASIAN";
  }

  if (
    hour < 12
  ) {
    return "LONDON";
  }

  if (
    hour < 16
  ) {
    return "LONDON_NY_OVERLAP";
  }

  if (
    hour < 21
  ) {
    return "NEWYORK";
  }

  return "OFF_HOURS";
}

function passesSpreadVolatilityFilter(
  candles
) {
  if (
    !Array.isArray(candles) ||
    candles.length < 15
  ) {
    return {
      pass: true
    };
  }

  const recent =
    candles
      .slice(-15, -1)
      .filter(Boolean);

  const latest =
    candles[
      candles.length - 1
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
    average(
      recent.map(
        candle =>
          Math.abs(
            toNumber(
              candle.high
            ) -
            toNumber(
              candle.low
            )
          )
      )
    );

  const currentRange =
    Math.abs(
      toNumber(
        latest.high
      ) -
      toNumber(
        latest.low
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
        `extreme volatility: current ${currentRange.toFixed(5)}, average ${averageRange.toFixed(5)}`
    };
  }

  if (
    latest.spread !==
      undefined
  ) {
    const averageSpread =
      average(
        recent.map(
          candle =>
            toNumber(
              candle.spread
            )
        )
      );

    const spread =
      toNumber(
        latest.spread
      );

    if (
      averageSpread > 0 &&
      spread >
        averageSpread * 3
    ) {
      return {
        pass: false,

        reason:
          `abnormal spread: current ${spread}, average ${averageSpread.toFixed(5)}`
      };
    }
  }

  return {
    pass: true,

    averageRange,

    currentRange
  };
}

// =====================================================
// Existing Signal Compatibility
// =====================================================

function getSignalTimestamp(signal) {
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
  const date =
    nowIso()
      .slice(0, 10)
      .replace(
        /-/g,
        ""
      );

  const pattern =
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
    pattern,
    date
  ].join("_");
}

function findActiveDuplicate(
  pair,
  timeframe,
  patternName,
  existingSignals
) {
  return (
    safeArray(
      existingSignals
    ).find(
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

function getHistoricalWinRate(
  learner,
  context
) {
  try {
    if (
      typeof learner
        .getPatternWinRate ===
        "function"
    ) {
      const result =
        learner
          .getPatternWinRate(
            context
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
        learner
          .getPatternQuality(
            context.pattern,
            context.pair,
            context.timeframe
          );

      const accuracy =
        Number(
          quality?.accuracy ??
          quality?.winRate
        );

      if (
        Number.isFinite(
          accuracy
        )
      ) {
        return accuracy;
      }
    }
  } catch (_) {
    // Use neutral fallback.
  }

  return 50;
}

// =====================================================
// Phase 6 - Advanced Market State Engine
// =====================================================

function detectAdvancedMarketState(
  candles,
  baseRegime = "UNKNOWN"
) {
  const list =
    safeArray(candles)
      .slice(-30);

  if (
    list.length < 10
  ) {
    return {
      state:
        baseRegime ||
        "UNKNOWN",

      confidence: 40,

      features: {}
    };
  }

  const ranges =
    list.map(
      candle =>
        Math.abs(
          toNumber(
            candle.high
          ) -
          toNumber(
            candle.low
          )
        )
    );

  const bodies =
    list.map(
      candle =>
        Math.abs(
          toNumber(
            candle.close
          ) -
          toNumber(
            candle.open
          )
        )
    );

  const closes =
    list.map(
      candle =>
        toNumber(
          candle.close
        )
    );

  const volumes =
    list.map(
      candle =>
        toNumber(
          candle.volume,
          0
        )
    );

  const recentRange =
    average(
      ranges.slice(-5)
    );

  const priorRange =
    average(
      ranges.slice(
        -15,
        -5
      )
    );

  const averageRange =
    average(ranges);

  const averageBody =
    average(bodies);

  const directionalMove =
    closes.length > 1 &&
    closes[0] !== 0
      ? (
          closes[
            closes.length - 1
          ] -
          closes[0]
        ) /
        closes[0]
      : 0;

  const rangeRatio =
    priorRange > 0
      ? recentRange /
        priorRange
      : 1;

  const bodyRatio =
    averageRange > 0
      ? averageBody /
        averageRange
      : 0;

  const recentVolume =
    average(
      volumes.slice(-5)
    );

  const priorVolume =
    average(
      volumes.slice(
        -15,
        -5
      )
    );

  const volumeRatio =
    priorVolume > 0
      ? recentVolume /
        priorVolume
      : 1;

  const latest =
    list[
      list.length - 1
    ];

  const priorHigh =
    Math.max(
      ...list
        .slice(0, -1)
        .map(
          candle =>
            toNumber(
              candle.high
            )
        )
    );

  const priorLow =
    Math.min(
      ...list
        .slice(0, -1)
        .map(
          candle =>
            toNumber(
              candle.low
            )
        )
    );

  const breakout =
    toNumber(
      latest.close
    ) > priorHigh ||
    toNumber(
      latest.close
    ) < priorLow;

  const latestRange =
    Math.abs(
      toNumber(
        latest.high
      ) -
      toNumber(
        latest.low
      )
    );

  const wick =
    Math.max(
      0,
      latestRange -
      Math.abs(
        toNumber(
          latest.close
        ) -
        toNumber(
          latest.open
        )
      )
    );

  const wickRatio =
    latestRange > 0
      ? wick /
        latestRange
      : 0;

  let state =
    "RANGING";

  let confidence = 60;

  if (
    breakout &&
    rangeRatio > 1.15
  ) {
    state =
      "BREAKOUT";

    confidence = 85;
  } else if (
    rangeRatio < 0.65
  ) {
    state =
      "COMPRESSION";

    confidence = 80;
  } else if (
    rangeRatio > 1.6
  ) {
    state =
      "EXPANSION";

    confidence = 82;
  } else if (
    Math.abs(
      directionalMove
    ) > 0.015 &&
    bodyRatio > 0.45
  ) {
    state =
      "TRENDING";

    confidence = 80;
  } else if (
    rangeRatio > 2.2 ||
    String(
      baseRegime
    ).includes(
      "VOLATILE"
    )
  ) {
    state =
      "HIGH_VOLATILITY";

    confidence = 85;
  } else if (
    volumeRatio < 0.5
  ) {
    state =
      "LOW_LIQUIDITY";

    confidence = 75;
  } else if (
    wickRatio > 0.7 &&
    rangeRatio > 1.2
  ) {
    state =
      "MANIPULATION";

    confidence = 72;
  } else if (
    directionalMove >
      0.004 &&
    volumeRatio > 1.15 &&
    bodyRatio < 0.45
  ) {
    state =
      "ACCUMULATION";

    confidence = 68;
  } else if (
    directionalMove <
      -0.004 &&
    volumeRatio > 1.15 &&
    bodyRatio < 0.45
  ) {
    state =
      "DISTRIBUTION";

    confidence = 68;
  } else if (
    rangeRatio > 1.8 &&
    volumeRatio > 2.2
  ) {
    state =
      "NEWS_DRIVEN";

    confidence = 70;
  }

  return {
    state,

    confidence,

    features: {
      baseRegime,

      directionalMove:
        round(
          directionalMove,
          5
        ),

      rangeRatio:
        round(
          rangeRatio,
          2
        ),

      bodyRatio:
        round(
          bodyRatio,
          2
        ),

      volumeRatio:
        round(
          volumeRatio,
          2
        ),

      breakout
    }
  };
}

// =====================================================
// Phase 6 - Strategy Manager
// =====================================================

function chooseStrategyPriority(
  timeframe,
  marketState,
  volatilityRatio = 1
) {
  const state =
    marketState?.state ||
    marketState ||
    "UNKNOWN";

  const scores = {
    SCALPING: 50,

    INTRADAY: 50,

    SWING: 50
  };

  if (
    [
      "1m",
      "5m",
      "15m"
    ].includes(
      timeframe
    )
  ) {
    scores.SCALPING += 20;
  }

  if (
    [
      "15m",
      "30m",
      "1H"
    ].includes(
      timeframe
    )
  ) {
    scores.INTRADAY += 20;
  }

  if (
    [
      "1H",
      "4H",
      "1D"
    ].includes(
      timeframe
    )
  ) {
    scores.SWING += 20;
  }

  if (
    [
      "BREAKOUT",
      "EXPANSION",
      "HIGH_VOLATILITY",
      "NEWS_DRIVEN"
    ].includes(state)
  ) {
    scores.SCALPING += 10;

    scores.INTRADAY += 15;

    scores.SWING -= 10;
  }

  if (
    [
      "TRENDING",
      "ACCUMULATION",
      "DISTRIBUTION"
    ].includes(state)
  ) {
    scores.SWING += 15;

    scores.INTRADAY += 10;
  }

  if (
    [
      "RANGING",
      "COMPRESSION"
    ].includes(state)
  ) {
    scores.SCALPING += 10;

    scores.SWING -= 5;
  }

  if (
    state ===
    "LOW_LIQUIDITY"
  ) {
    scores.SCALPING -= 20;

    scores.INTRADAY -= 10;
  }

  if (
    volatilityRatio > 1.5
  ) {
    scores.SWING -= 10;
  }

  const ranking =
    Object.entries(scores)
      .sort(
        (
          first,
          second
        ) =>
          second[1] -
          first[1]
      );

  return {
    primary:
      ranking[0][0],

    scores:
      Object.fromEntries(
        ranking.map(
          (
            [
              name,
              score
            ]
          ) => [
            name,
            clamp(score)
          ]
        )
      )
  };
}

// =====================================================
// Phase 6 - Dynamic Confidence Engine
// =====================================================

function calculateFinalAIConfidence(
  candidate
) {
  const signal =
    candidate.signal ||
    {};

  const components = {
    adaptiveConfidence:
      toNumber(
        signal.adaptiveConfidence ??
        candidate.confidence,
        50
      ),

    learningConfidence:
      toNumber(
        candidate.learningScore ??
        signal.tradeDecision
          ?.confidence,
        50
      ),

    historicalAccuracy:
      toNumber(
        candidate.historicalWinRate,
        50
      ),

    marketRegime:
      toNumber(
        candidate.marketState
          ?.confidence,
        50
      ),

    sessionQuality:
      clamp(
        (
          SESSION_QUALITY_MULTIPLIER[
            candidate.session
          ] ||
          1
        ) * 75
      ),

    riskReward:
      clamp(
        (
          toNumber(
            candidate.riskReward
          ) /
          3
        ) * 100
      ),

    patternWeight:
      clamp(
        toNumber(
          signal.patternWeight,
          1
        ) * 50
      ),

    trendStrength:
      clamp(
        toNumber(
          candidate
            .trendAlignmentScore,
          50
        )
      ),

    freshness:
      clamp(
        toNumber(
          candidate.freshnessScore,
          100
        )
      ),

    volatility:
      clamp(
        toNumber(
          candidate.volatilityScore,
          65
        )
      )
  };

  const weights = {
    adaptiveConfidence: 0.25,

    learningConfidence: 0.12,

    historicalAccuracy: 0.12,

    marketRegime: 0.1,

    sessionQuality: 0.08,

    riskReward: 0.1,

    patternWeight: 0.08,

    trendStrength: 0.08,

    freshness: 0.04,

    volatility: 0.03
  };

  const finalConfidence =
    clamp(
      Object.keys(weights)
        .reduce(
          (
            total,
            key
          ) =>
            total +
            components[key] *
            weights[key],
          0
        )
    );

  return {
    finalConfidence:
      round(
        finalConfidence,
        1
      ),

    components
  };
}

// =====================================================
// Phase 6 - Institutional AI Ranking
// =====================================================

function calculateInstitutionalAIScore(
  candidate
) {
  const signal =
    candidate.signal ||
    {};

  const values = {
    patternStrength:
      clamp(
        toNumber(
          signal.strength ??
          candidate.pattern
            ?.strength,
          0
        )
      ),

    confirmationScore:
      clamp(
        toNumber(
          signal.confirmationScore ??
          candidate.pattern
            ?.confirmationScore,
          0
        )
      ),

    adaptiveConfidence:
      clamp(
        toNumber(
          signal.adaptiveConfidence ??
          candidate.confidence,
          0
        )
      ),

    historicalAccuracy:
      clamp(
        toNumber(
          candidate
            .historicalWinRate,
          50
        )
      ),

    riskReward:
      clamp(
        (
          toNumber(
            candidate.riskReward
          ) /
          3
        ) * 100
      ),

    marketRegime:
      clamp(
        toNumber(
          candidate.marketState
            ?.confidence,
          50
        )
      ),

    sessionQuality:
      clamp(
        (
          SESSION_QUALITY_MULTIPLIER[
            candidate.session
          ] ||
          1
        ) * 75
      ),

    patternWeight:
      clamp(
        toNumber(
          signal.patternWeight,
          1
        ) * 50
      ),

    trendAlignment:
      clamp(
        toNumber(
          candidate
            .trendAlignmentScore,
          50
        )
      ),

    learningScore:
      clamp(
        toNumber(
          candidate.learningScore,
          50
        )
      ),

    patternEvolution:
      clamp(
        toNumber(
          candidate.evolutionScore,
          50
        )
      )
  };

  const weights = {
    patternStrength: 0.1,

    confirmationScore: 0.12,

    adaptiveConfidence: 0.16,

    historicalAccuracy: 0.11,

    riskReward: 0.1,

    marketRegime: 0.08,

    sessionQuality: 0.06,

    patternWeight: 0.08,

    trendAlignment: 0.08,

    learningScore: 0.06,

    patternEvolution: 0.05
  };

  const aiScore =
    clamp(
      Object.keys(weights)
        .reduce(
          (
            total,
            key
          ) =>
            total +
            values[key] *
            weights[key],
          0
        )
    );

  const qualityGrade =
    aiScore >= 90
      ? "A+"
      : aiScore >= 82
        ? "A"
        : aiScore >= 72
          ? "B"
          : "C";

  return {
    aiScore:
      round(
        aiScore,
        1
      ),

    qualityGrade,

    components:
      values
  };
}

// =====================================================
// Phase 6 - Correlation and Portfolio Manager
// =====================================================

function getCorrelationPenalty(
  signal,
  openSignals
) {
  const pair =
    String(
      signal.pair ||
      ""
    ).toUpperCase();

  const direction =
    signal.direction;

  let penalty = 0;

  const reasons = [];

  for (
    const [
      group,
      pairs
    ] of Object.entries(
      CORRELATION_GROUPS
    )
  ) {
    if (
      !pairs.includes(pair)
    ) {
      continue;
    }

    const related =
      safeArray(openSignals)
        .filter(
          openSignal =>
            OPEN_STATUSES.includes(
              openSignal.status
            ) &&
            pairs.includes(
              String(
                openSignal.pair ||
                ""
              ).toUpperCase()
            )
        );

    const sameDirection =
      related.filter(
        openSignal =>
          openSignal.direction ===
          direction
      ).length;

    const oppositeDirection =
      related.filter(
        openSignal =>
          openSignal.direction &&
          openSignal.direction !==
            direction
      ).length;

    if (
      sameDirection > 0
    ) {
      const groupPenalty =
        Math.min(
          18,
          sameDirection * 6
        );

      penalty +=
        groupPenalty;

      reasons.push(
        `${group} same-direction exposure -${groupPenalty}`
      );
    }

    if (
      oppositeDirection > 0
    ) {
      const conflictPenalty =
        Math.min(
          10,
          oppositeDirection * 4
        );

      penalty +=
        conflictPenalty;

      reasons.push(
        `${group} conflicting exposure -${conflictPenalty}`
      );
    }
  }

  return {
    penalty:
      Math.min(
        25,
        penalty
      ),

    reasons
  };
}

function evaluatePortfolioRisk(
  signal,
  openSignals
) {
  const open =
    safeArray(openSignals)
      .filter(
        openSignal =>
          OPEN_STATUSES.includes(
            openSignal.status
          )
      );

  const samePair =
    open.filter(
      openSignal =>
        openSignal.pair ===
        signal.pair
    );

  const samePairDirection =
    samePair.filter(
      openSignal =>
        openSignal.direction ===
        signal.direction
    );

  const jpyExposure =
    open.filter(
      openSignal =>
        String(
          openSignal.pair ||
          ""
        ).includes(
          "JPY"
        )
    );

  const reasons = [];

  let hardReject = false;

  if (
    open.length >=
    MAX_OPEN_TRADES
  ) {
    hardReject = true;

    reasons.push(
      `maximum open trades reached (${MAX_OPEN_TRADES})`
    );
  }

  if (
    samePair.length >=
    MAX_PAIR_OPEN_TRADES
  ) {
    hardReject = true;

    reasons.push(
      `maximum ${signal.pair} exposure reached`
    );
  }

  if (
    samePairDirection.length >=
    MAX_SAME_DIRECTION_PER_PAIR
  ) {
    hardReject = true;

    reasons.push(
      `too many ${signal.direction} trades on ${signal.pair}`
    );
  }

  if (
    String(
      signal.pair ||
      ""
    ).includes(
      "JPY"
    ) &&
    jpyExposure.length >=
      MAX_JPY_EXPOSURE
  ) {
    reasons.push(
      "JPY portfolio exposure is elevated"
    );
  }

  const correlation =
    getCorrelationPenalty(
      signal,
      open
    );

  return {
    approved:
      !hardReject,

    hardReject,

    reasons: [
      ...reasons,
      ...correlation.reasons
    ],

    correlationPenalty:
      correlation.penalty,

    exposure: {
      totalOpen:
        open.length,

      samePair:
        samePair.length,

      samePairDirection:
        samePairDirection.length,

      jpy:
        jpyExposure.length
    }
  };
}

// =====================================================
// Phase 6 - Explainable AI
// =====================================================

function generateExplanation(
  candidate,
  rejectedCandidates = []
) {
  const signal =
    candidate.signal;

  const directionReason =
    signal.direction === "BUY"
      ? "buyers gained control with bullish pattern and confirmation alignment"
      : "sellers gained control with bearish pattern and confirmation alignment";

  const rejectedPatterns =
    rejectedCandidates
      .slice(0, 5)
      .map(
        rejected => ({
          pattern:
            rejected.pattern?.name ||
            rejected.signal?.pattern,

          reason:
            rejected.rejectionReason ||
            `lower AI score (${round(rejected.aiScore, 1)})`
        })
      );

  return {
    summary:
      `${signal.direction} selected because ${signal.pattern} produced the strongest institutional score for ${signal.pair} ${signal.timeframe}.`,

    whyDirection:
      directionReason,

    whyConfidence:
      `Final AI Confidence ${candidate.finalAIConfidence}% combines existing adaptive confidence with learning, historical accuracy, regime quality, session quality, risk/reward, pattern weight, trend alignment, freshness and volatility.`,

    whyStopLoss:
      `Stop loss ${signal.stopLoss} comes from the existing signal engine's market-structure and invalidation logic.`,

    whyTakeProfit:
      `Primary take profit ${getPrimaryTakeProfit(signal)} preserves the existing risk/reward calculation. Phase 6 validates its institutional quality without replacing it.`,

    whyPatternSelected:
      `${signal.pattern} achieved AI Score ${candidate.aiScore}/100 with Quality Grade ${candidate.qualityGrade} after portfolio and correlation review.`,

    whyRiskRewardAccepted:
      `Risk/reward ${round(candidate.riskReward, 2)} passed the existing signal engine and the institutional ranking threshold.`,

    marketState:
      candidate.marketState,

    strategy:
      candidate.strategyPriority,

    rejectedPatterns
  };
}

// =====================================================
// Phase 6 - Learning and Evolution Hooks
// =====================================================

function getLearningScore(
  learner,
  candidate
) {
  try {
    const quality =
      learner
        .getPatternQuality?.(
          candidate.pattern.name,
          candidate.signal.pair,
          candidate.signal.timeframe
        ) ||
      {};

    return clamp(
      toNumber(
        quality.qualityScore ??
        quality.score ??
        quality.accuracy,
        50
      )
    );
  } catch (_) {
    return 50;
  }
}

function getEvolutionScore(
  learner,
  patternName
) {
  try {
    const recommendations =
      learner
        .getPatternEvolutionRecommendations?.() ||
      {};

    const patternData =
      recommendations[
        patternName
      ] ||
      recommendations
        .patterns?.[
          patternName
        ] ||
      {};

    if (
      Number.isFinite(
        Number(
          patternData.score
        )
      )
    ) {
      return clamp(
        patternData.score
      );
    }

    if (
      Number.isFinite(
        Number(
          patternData
            .confidenceAdjustment
        )
      )
    ) {
      return clamp(
        50 +
        Number(
          patternData
            .confidenceAdjustment
        ) * 5
      );
    }
  } catch (_) {
    // Return neutral score.
  }

  return 50;
}

function enrichCandidatePhase6(
  candidate,
  learner,
  candles,
  higherTrend
) {
  const timeframeCandles =
    candles?.[
      candidate.signal.pair
    ]?.[
      candidate.signal.timeframe
    ] ||
    [];

  candidate.marketState =
    detectAdvancedMarketState(
      timeframeCandles,
      candidate.marketRegime
    );

  candidate.strategyPriority =
    chooseStrategyPriority(
      candidate.signal.timeframe,
      candidate.marketState,
      candidate.marketState
        .features?.rangeRatio
    );

  candidate.trendAlignmentScore =
    !higherTrend ||
    higherTrend === "SIDEWAYS" ||
    higherTrend === "NEUTRAL"
      ? 65
      : higherTrend ===
          candidate.signal.direction
        ? 95
        : 20;

  candidate.freshnessScore =
    100;

  candidate.volatilityScore =
    candidate.marketState.state ===
      "HIGH_VOLATILITY"
      ? 45
      : candidate.marketState.state ===
          "LOW_LIQUIDITY"
        ? 35
        : 75;

  candidate.learningScore =
    getLearningScore(
      learner,
      candidate
    );

  candidate.evolutionScore =
    getEvolutionScore(
      learner,
      candidate.pattern.name
    );

  const confidence =
    calculateFinalAIConfidence(
      candidate
    );

  candidate.finalAIConfidence =
    confidence.finalConfidence;

  candidate.confidenceComponents =
    confidence.components;

  const ranking =
    calculateInstitutionalAIScore(
      candidate
    );

  candidate.aiScore =
    ranking.aiScore;

  candidate.qualityGrade =
    ranking.qualityGrade;

  candidate.aiScoreComponents =
    ranking.components;

  return candidate;
}

// =====================================================
// Phase 6 - Final Institutional Selection
// =====================================================

function selectInstitutionalSignal(
  candidates,
  existingSignals
) {
  const ranked =
    safeArray(candidates)
      .map(
        candidate => {
          const portfolioRisk =
            evaluatePortfolioRisk(
              candidate.signal,
              existingSignals
            );

          candidate.portfolioRisk =
            portfolioRisk;

          candidate.prePenaltyAIScore =
            candidate.aiScore;

          candidate.aiScore =
            round(
              clamp(
                candidate.aiScore -
                portfolioRisk
                  .correlationPenalty
              ),
              1
            );

          candidate.qualityGrade =
            candidate.aiScore >= 90
              ? "A+"
              : candidate.aiScore >= 82
                ? "A"
                : candidate.aiScore >= 72
                  ? "B"
                  : "C";

          if (
            !portfolioRisk.approved
          ) {
            candidate.rejectionReason =
              portfolioRisk.reasons
                .join("; ");
          } else if (
            candidate.aiScore <
            MINIMUM_AI_SCORE
          ) {
            candidate.rejectionReason =
              `AI score ${candidate.aiScore} below ${MINIMUM_AI_SCORE}`;
          }

          return candidate;
        }
      )
      .sort(
        (
          first,
          second
        ) =>
          second.aiScore -
          first.aiScore
      );

  const approved =
    ranked.filter(
      candidate =>
        !candidate.rejectionReason
    );

  const selected =
    approved[0] ||
    null;

  const rejected =
    ranked.filter(
      candidate =>
        candidate !== selected
    );

  if (selected) {
    selected.explanation =
      generateExplanation(
        selected,
        rejected
      );
  }

  return {
    selected,

    ranked,

    rejected
  };
}

// =====================================================
// Existing Pattern Scoring + Phase 6 Inputs
// =====================================================

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

  const context = {
    pair,

    timeframe,

    pattern:
      pattern.name,

    strength:
      toNumber(
        pattern.strength
      ),

    confirmationScore:
      toNumber(
        pattern.confirmationScore
      ),

    marketRegime,

    regime:
      marketRegime
  };

  if (
    learner
      .isPatternBlacklisted?.(
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
        context
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

  const stop =
    toNumber(
      signal.stopLoss,
      NaN
    );

  const target =
    getPrimaryTakeProfit(
      signal
    );

  const risk =
    Math.abs(
      entry - stop
    );

  const reward =
    Math.abs(
      target - entry
    );

  const riskReward =
    risk > 0
      ? reward /
        risk
      : 0;

  const historicalWinRate =
    getHistoricalWinRate(
      learner,
      context
    );

  const session =
    getMarketSession();

  let qualityScore =
    confidence * 0.35 +
    toNumber(
      pattern.confirmationScore
    ) * 0.25 +
    toNumber(
      pattern.strength
    ) * 0.2 +
    Math.min(
      (
        riskReward /
        5
      ) * 100,
      100
    ) * 0.1 +
    historicalWinRate * 0.1;

  qualityScore =
    clamp(
      qualityScore *
      (
        SESSION_QUALITY_MULTIPLIER[
          session
        ] ||
        1
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
    safeArray(patterns)
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
    const sameDirection =
      candidate.signal
        .direction ===
      "BUY"
        ? buyCount
        : sellCount;

    const oppositeDirection =
      candidate.signal
        .direction ===
      "BUY"
        ? sellCount
        : buyCount;

    if (
      oppositeDirection > 0
    ) {
      candidate.qualityScore =
        Math.max(
          0,
          candidate.qualityScore -
          5
        );

      candidate.consensusNote =
        `conflict: ${buyCount} BUY vs ${sellCount} SELL`;
    } else if (
      sameDirection >= 2
    ) {
      const boost =
        Math.min(
          (
            sameDirection -
            1
          ) * 3,
          10
        );

      candidate.qualityScore =
        Math.min(
          100,
          candidate.qualityScore +
          boost
        );

      candidate.consensusNote =
        `${sameDirection} ${candidate.signal.direction} patterns agree (+${boost})`;
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
    logAudit({
      pair,

      timeframe,

      decision:
        "REJECTED",

      reason:
        `near-parity conflict: ${best.pattern.name} vs ${runnerUp.pattern.name}`
    });

    return null;
  }

  return best;
}

// =====================================================
// Signal Refresh
// =====================================================

function refreshExistingSignal(
  existingSignal,
  incomingSignal,
  pattern
) {
  const oldConfidence =
    toNumber(
      existingSignal.confidence
    );

  if (
    toNumber(
      incomingSignal.confidence
    ) >
    oldConfidence
  ) {
    existingSignal.confidence =
      incomingSignal.confidence;
  }

  if (
    toNumber(
      pattern.confirmationScore
    ) >
    toNumber(
      existingSignal
        .confirmationScore
    )
  ) {
    existingSignal
      .confirmationScore =
      pattern.confirmationScore;
  }

  const takeProfit1 =
    getPrimaryTakeProfit(
      incomingSignal
    );

  const takeProfit2 =
    getSecondTakeProfit(
      incomingSignal
    );

  const takeProfit3 =
    getThirdTakeProfit(
      incomingSignal
    );

  if (
    incomingSignal.direction ===
    "BUY"
  ) {
    if (
      toNumber(
        incomingSignal.stopLoss,
        -Infinity
      ) >
      toNumber(
        existingSignal.stopLoss,
        -Infinity
      )
    ) {
      existingSignal.stopLoss =
        incomingSignal.stopLoss;
    }

    if (
      takeProfit1 >
      getPrimaryTakeProfit(
        existingSignal
      )
    ) {
      existingSignal.takeProfit =
        takeProfit1;

      existingSignal.takeProfit1 =
        takeProfit1;
    }

    if (
      takeProfit2 >
      getSecondTakeProfit(
        existingSignal
      )
    ) {
      existingSignal.takeProfit2 =
        takeProfit2;
    }

    if (
      takeProfit3 >
      getThirdTakeProfit(
        existingSignal
      )
    ) {
      existingSignal.takeProfit3 =
        takeProfit3;
    }
  } else if (
    incomingSignal.direction ===
    "SELL"
  ) {
    if (
      toNumber(
        incomingSignal.stopLoss,
        Infinity
      ) <
      toNumber(
        existingSignal.stopLoss,
        Infinity
      )
    ) {
      existingSignal.stopLoss =
        incomingSignal.stopLoss;
    }

    if (
      takeProfit1 <
      getPrimaryTakeProfit(
        existingSignal
      )
    ) {
      existingSignal.takeProfit =
        takeProfit1;

      existingSignal.takeProfit1 =
        takeProfit1;
    }

    if (
      takeProfit2 <
      getSecondTakeProfit(
        existingSignal
      )
    ) {
      existingSignal.takeProfit2 =
        takeProfit2;
    }

    if (
      takeProfit3 <
      getThirdTakeProfit(
        existingSignal
      )
    ) {
      existingSignal.takeProfit3 =
        takeProfit3;
    }
  }

  const phase6Fields = [
    "qualityScore",
    "adaptiveConfidence",
    "patternWeight",
    "marketRegime",
    "aiScore",
    "qualityGrade",
    "finalAIConfidence",
    "explanation",
    "marketState",
    "strategyPriority",
    "portfolioRisk"
  ];

  for (
    const field of
    phase6Fields
  ) {
    if (
      incomingSignal[field] !==
      undefined
    ) {
      existingSignal[field] =
        incomingSignal[field];
    }
  }

  existingSignal.lastUpdated =
    nowIso();

  existingSignal.refreshCount =
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

// =====================================================
// Pair and Market Analysis
// =====================================================
/**
 * Return candles for one pair/timeframe while preserving both supported
 * source schemas:
 *
 * 1. Current PipSight worker schema:
 *    { XAUUSD: [...M5 candles], GBPJPY: [...M5 candles] }
 *
 * 2. Legacy/nested Pattern Detector schema:
 *    { XAUUSD: { "5m": [...], "15m": [...] } }
 *
 * A direct pair array is M5 data only. It must never be reused as a
 * fabricated higher timeframe.
 */
function getPairTimeframeCandles(
  candles,
  pair,
  timeframe
) {
  const pairData =
    candles?.[pair];

  /*
   * Current PipSight worker schema:
   *
   * {
   *   XAUUSD: [...M5 candles],
   *   GBPJPY: [...M5 candles],
   *   derivedCandles: {
   *     XAUUSD: {
   *       "15m": [...],
   *       "30m": [...],
   *       "1H": [...],
   *       "4H": [...]
   *     }
   *   }
   * }
   */
  if (Array.isArray(pairData)) {
    if (timeframe === "5m") {
      return pairData;
    }

    const derivedRows =
      candles
        ?.derivedCandles
        ?.[pair]
        ?.[timeframe];

    return Array.isArray(
      derivedRows
    )
      ? derivedRows
      : null;
  }

  /*
   * Preserve the existing legacy/nested schema:
   *
   * {
   *   XAUUSD: {
   *     "5m": [...],
   *     "15m": [...]
   *   }
   * }
   */
  if (
    !pairData ||
    typeof pairData !== "object"
  ) {
    return null;
  }

  const rows =
    pairData[timeframe];

  if (Array.isArray(rows)) {
    return rows;
  }

  /*
   * Defensive additive fallback for mixed payloads.
   */
  const derivedRows =
    candles
      ?.derivedCandles
      ?.[pair]
      ?.[timeframe];

  return Array.isArray(
    derivedRows
  )
    ? derivedRows
    : null;
}

function buildPipelineStatusEntry(
  pair,
  timeframe,
  candleCount,
  diagnostics = null,
  overrides = {}
) {
  const safeDiagnostics =
    diagnostics &&
    typeof diagnostics ===
      "object" &&
    !Array.isArray(
      diagnostics
    )
      ? diagnostics
      : {};

  const sequence =
    safeDiagnostics
      .institutionalSequence &&
    typeof safeDiagnostics
      .institutionalSequence ===
      "object" &&
    !Array.isArray(
      safeDiagnostics
        .institutionalSequence
    )
      ? safeDiagnostics
          .institutionalSequence
      : null;

  return {
    pair,

    timeframe,

    updatedAt:
      nowIso(),

    candleCount:
      Number.isFinite(
        Number(candleCount)
      )
        ? Number(candleCount)
        : 0,

    analyzerStatus:
      safeDiagnostics.status ||
      overrides.analyzerStatus ||
      "UNKNOWN",

    rejectionStage:
      safeDiagnostics
        .rejectionStage ||
      overrides.rejectionStage ||
      null,

    reason:
      overrides.reason ||
      null,

    atr:
      Number.isFinite(
        Number(
          safeDiagnostics.atr
        )
      )
        ? Number(
            safeDiagnostics.atr
          )
        : null,

    atrPercent:
      Number.isFinite(
        Number(
          safeDiagnostics
            .atrPercent
        )
      )
        ? Number(
            safeDiagnostics
              .atrPercent
          )
        : null,

    minimumATRPercent:
      Number.isFinite(
        Number(
          safeDiagnostics
            .minimumATRPercent
        )
      )
        ? Number(
            safeDiagnostics
              .minimumATRPercent
          )
        : null,

    rawCandidates:
      Number.isFinite(
        Number(
          safeDiagnostics
            .rawCandidates
        )
      )
        ? Number(
            safeDiagnostics
              .rawCandidates
          )
        : 0,

    acceptedPatterns:
      Number.isFinite(
        Number(
          safeDiagnostics
            .acceptedPatterns
        )
      )
        ? Number(
            safeDiagnostics
              .acceptedPatterns
          )
        : 0,

    returnedPatterns:
      Number.isFinite(
        Number(
          safeDiagnostics
            .returnedPatterns
        )
      )
        ? Number(
            safeDiagnostics
              .returnedPatterns
          )
        : 0,

    institutionalSequence:
      sequence
        ? {
            stage:
              sequence.stage ||
              null,

            score:
              Number.isFinite(
                Number(
                  sequence.score
                )
              )
                ? Number(
                    sequence.score
                  )
                : 0,

            valid:
              sequence.valid ===
              true,

            direction:
              sequence.direction ||
              "NEUTRAL",

            completedStages:
              Number.isFinite(
                Number(
                  sequence
                    .completedStages
                )
              )
                ? Number(
                    sequence
                      .completedStages
                  )
                : 0,

            missingStages:
              Number.isFinite(
                Number(
                  sequence
                    .missingStages
                )
              )
                ? Number(
                    sequence
                      .missingStages
                  )
                : 0,

            conflicts:
              Number.isFinite(
                Number(
                  sequence.conflicts
                )
              )
                ? Number(
                    sequence.conflicts
                  )
                : 0
          }
        : null
  };
}

function savePipelineStatus(
  pipelineStatus
) {
  const safeStatus =
    pipelineStatus &&
    typeof pipelineStatus ===
      "object" &&
    !Array.isArray(
      pipelineStatus
    )
      ? pipelineStatus
      : getDefaultPipelineStatusData();

  safeWriteJson(
    PIPELINE_STATUS_FILE,
    {
      version:
        "1.0.0",

      updatedAt:
        nowIso(),

      pairs:
        objectOrEmpty(
          safeStatus.pairs
        )
    }
  );
}

function analyzePair(
  pair,
  candles,
  analyzer,
  learner,
  signalGenerator,
  existingSignals,
  phase6Candidates = [],
  pipelineStatus = null
) {
  const trendCache = {};

  if (
    pipelineStatus &&
    typeof pipelineStatus ===
      "object"
  ) {
    pipelineStatus.pairs =
      objectOrEmpty(
        pipelineStatus.pairs
      );

    pipelineStatus.pairs[
      pair
    ] =
      objectOrEmpty(
        pipelineStatus.pairs[
          pair
        ]
      );
  }
  
  if (
    !candles?.[pair]
  ) {
    return phase6Candidates;
  }

  for (
    const timeframe of
    SUPPORTED_TIMEFRAMES
  ) {
    const timeframeCandles =
      getPairTimeframeCandles(
        candles,
        pair,
        timeframe
      );

    console.log(
      `📦 ${pair} ${timeframe}: ${
        Array.isArray(timeframeCandles)
          ? timeframeCandles.length
          : 0
      } candles available`
    );

    if (
      Array.isArray(
        timeframeCandles
      ) &&
      timeframeCandles.length >=
        MINIMUM_CANDLES
    ) {
      trendCache[
        `${pair}_${timeframe}`
      ] =
        analyzer.detectTrend(
          timeframeCandles
        );
    }
  }

  for (
    const timeframe of
    SUPPORTED_TIMEFRAMES
  ) {
    const timeframeCandles =
      getPairTimeframeCandles(
        candles,
        pair,
        timeframe
      );

   if (
      !Array.isArray(
        timeframeCandles
      ) ||
      timeframeCandles.length <
        MINIMUM_CANDLES
    ) {
      if (
        pipelineStatus?.pairs?.[
          pair
        ]
      ) {
        pipelineStatus.pairs[
          pair
        ][timeframe] =
          buildPipelineStatusEntry(
            pair,
            timeframe,
            Array.isArray(
              timeframeCandles
            )
              ? timeframeCandles
                  .length
              : 0,
            null,
            {
              analyzerStatus:
                "REJECTED",

              rejectionStage:
                "INSUFFICIENT_CANDLES",

              reason:
                `requires at least ${MINIMUM_CANDLES} candles`
            }
          );
      }

      continue;
    }

    const filter =
      passesSpreadVolatilityFilter(
        timeframeCandles
      );

    if (!filter.pass) {
      logAudit({
        pair,

        timeframe,

        decision:
          "REJECTED",

        reason:
          filter.reason
      });

      if (
        pipelineStatus?.pairs?.[
          pair
        ]
      ) {
        pipelineStatus.pairs[
          pair
        ][timeframe] =
          buildPipelineStatusEntry(
            pair,
            timeframe,
            timeframeCandles
              .length,
            null,
            {
              analyzerStatus:
                "REJECTED",

              rejectionStage:
                "SPREAD_VOLATILITY_FILTER",

              reason:
                filter.reason
            }
          );
      }

      continue;
    }

    const patterns =
      analyzer
        .detectAllPatterns(
          timeframeCandles,
          timeframe
        );

    const diagnostics =
      typeof analyzer
        .getLastDiagnostics ===
        "function"
        ? analyzer
            .getLastDiagnostics()
        : null;

    if (
      pipelineStatus?.pairs?.[
        pair
      ]
    ) {
      pipelineStatus.pairs[
        pair
      ][timeframe] =
        buildPipelineStatusEntry(
          pair,
          timeframe,
          timeframeCandles
            .length,
          diagnostics
        );
    }

    console.log(
      `🔎 ${pair} ${timeframe}: ${
        Array.isArray(patterns)
          ? patterns.length
          : 0
      } patterns returned by analyzer`
    );

    if (
      !Array.isArray(patterns) ||
      patterns.length === 0
    ) {
      logAudit({
        pair,
        timeframe,
        decision: "NO_PATTERN",
        reason:
          "analyzer returned zero patterns after internal ATR, RSI, volume, age and breakout filters"
      });

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
      ![
        "SIDEWAYS",
        "NEUTRAL",
        best.signal.direction
      ].includes(
        higherTrend
      )
    ) {
      logAudit({
        pair,

        timeframe,

        pattern:
          best.pattern.name,

        decision:
          "REJECTED",

        reason:
          `against higher-timeframe trend (${higherTrend})`
      });

      continue;
    }

    phase6Candidates.push(
      enrichCandidatePhase6(
        best,
        learner,
        candles,
        higherTrend
      )
    );
  }

  return phase6Candidates;
}

function analyzeMarkets(
  candles,
  analyzer,
  learner,
  signalGenerator,
  existingSignals,
  pipelineStatus = null
) {
  console.log(
    "🔍 Analyzing patterns with Phase 6 institutional layer..."
  );

  const candidates = [];

  for (
    const pair of
    SUPPORTED_PAIRS
  ) {
    analyzePair(
      pair,
      candles,
      analyzer,
      learner,
      signalGenerator,
      existingSignals,
      candidates,
      pipelineStatus
    );
  }
  
  const institutionalResult =
    selectInstitutionalSignal(
      candidates,
      existingSignals
    );

  for (
    const rejected of
    institutionalResult.rejected
  ) {
    logAudit({
      pair:
        rejected.signal.pair,

      timeframe:
        rejected.signal.timeframe,

      pattern:
        rejected.pattern.name,

      decision:
        "PHASE6_REJECTED",

      aiScore:
        rejected.aiScore,

      reason:
        rejected.rejectionReason ||
        "lower institutional ranking than published signal"
    });
  }

  if (
    !institutionalResult.selected
  ) {
    return [];
  }

  const selected =
    institutionalResult.selected;

  const activeSignal =
    findActiveDuplicate(
      selected.signal.pair,
      selected.signal.timeframe,
      selected.pattern.name,
      existingSignals
    );

  const enhancedSignal =
    applyLegacySignalAliases({
      ...selected.signal,

      confidence:
        selected.finalAIConfidence,

      finalAIConfidence:
        selected.finalAIConfidence,

      aiScore:
        selected.aiScore,

      qualityGrade:
        selected.qualityGrade,

      aiScoreComponents:
        selected.aiScoreComponents,

      confidenceComponents:
        selected.confidenceComponents,

      marketState:
        selected.marketState,

      strategyPriority:
        selected.strategyPriority,

      portfolioRisk:
        selected.portfolioRisk,

      explanation:
        selected.explanation,

      phase: 6,

      institutionalRank: 1
    });

  if (activeSignal) {
    const refresh =
      refreshExistingSignal(
        activeSignal,
        enhancedSignal,
        selected.pattern
      );

    logAudit({
      pair:
        enhancedSignal.pair,

      timeframe:
        enhancedSignal.timeframe,

      pattern:
        enhancedSignal.pattern,

      decision:
        "REFRESHED",

      reason:
        `Phase 6 confidence ${refresh.oldConfidence}% → ${refresh.newConfidence}%`
    });

    return [];
  }

  const timestamp =
    nowIso();

  const preparedSignal = {
    ...enhancedSignal,

    signalId:
      buildSignalId(
        enhancedSignal.pair,
        enhancedSignal.timeframe,
        enhancedSignal.pattern
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
  };

  if (
    isSignalInCooldown(
      preparedSignal,
      existingSignals
    )
  ) {
    logAudit({
      pair:
        preparedSignal.pair,

      timeframe:
        preparedSignal.timeframe,

      pattern:
        preparedSignal.pattern,

      decision:
        "REJECTED",

      reason:
        "cooldown active"
    });

    return [];
  }

  existingSignals.push(
    preparedSignal
  );

  logAudit({
    pair:
      preparedSignal.pair,

    timeframe:
      preparedSignal.timeframe,

    pattern:
      preparedSignal.pattern,

    decision:
      "PUBLISHED",

    aiScore:
      preparedSignal.aiScore,

    qualityGrade:
      preparedSignal.qualityGrade,

    confidence:
      preparedSignal
        .finalAIConfidence,

    reason:
      "highest-quality institutional signal"
  });

  console.log(
    `🏛️ Published: ${preparedSignal.pair} ${preparedSignal.timeframe} ${preparedSignal.pattern} | AI ${preparedSignal.aiScore} ${preparedSignal.qualityGrade} | Confidence ${preparedSignal.finalAIConfidence}%`
  );

  return [
    preparedSignal
  ];
}

// =====================================================
// Existing Signal Resolution
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
    ![
      high,
      low,
      stopLoss,
      target
    ].every(
      Number.isFinite
    )
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
  const resolutions = [];

  for (
    const signal of
    safeArray(
      existingSignals
    )
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

      logAudit({
        pair:
          signal.pair,

        timeframe:
          signal.timeframe,

        pattern:
          signal.pattern,

        decision:
          "RESOLVED",

        outcome
      });

      continue;
    }

    const expiry =
      EXPIRY_MAP[
        signal.timeframe
      ];

    const createdTime =
      new Date(
        getSignalTimestamp(
          signal
        )
      ).getTime();

    if (
      expiry &&
      Number.isFinite(
        createdTime
      ) &&
      Date.now() -
        createdTime >=
        expiry
    ) {
      signal.status =
        "EXPIRED";

      signal.outcome =
        "EXPIRED";

      signal.expiredAt =
        nowIso();

      signal.lastUpdated =
        signal.expiredAt;

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
          "signal lifecycle limit reached"
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
// Existing Learning Update
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
    newSignals.length > 0 &&
    typeof learner
      .updateHistory ===
      "function"
  ) {
    learner.updateHistory(
      newSignals
    );
  } else if (
    typeof learner
      .updatePatternStats ===
      "function"
  ) {
    learner
      .updatePatternStats();
  }

  if (
    typeof learner
      .runLearningCycle ===
      "function"
  ) {
    learner
      .runLearningCycle();
  }

  return existingSignals;
}

// =====================================================
// Existing Archive and Persistence
// =====================================================

function archiveSignals(
  signalsToArchive
) {
  if (
    safeArray(
      signalsToArchive
    ).length === 0
  ) {
    return;
  }

  const archiveData =
    safeReadJson(
      ARCHIVE_FILE,
      getDefaultArchiveData()
    );

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

  const signals = [
    ...safeArray(
      archiveData.signals
    ),

    ...archivedEntries
  ].slice(
    -MAX_ARCHIVE_SIGNALS
  );

  safeWriteJson(
    ARCHIVE_FILE,
    {
      ...archiveData,

      signals,

      updatedAt:
        nowIso(),

      totalArchived:
        signals.length
    }
  );
}

function mergeSignals(
  newSignals,
  existingSignals
) {
  const signalMap =
    new Map();

  const allSignals = [
    ...safeArray(
      existingSignals
    ),

    ...safeArray(
      newSignals
    )
  ];

  for (
    const rawSignal of
    allSignals
  ) {
    if (!rawSignal) {
      continue;
    }

    const signal =
      applyLegacySignalAliases(
        rawSignal
      );

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
      signalMap.get(key);

    if (
      !previous ||
      new Date(
        signal.lastUpdated ||
        signal.createdAt ||
        0
      ) >=
      new Date(
        previous.lastUpdated ||
        previous.createdAt ||
        0
      )
    ) {
      signalMap.set(
        key,
        {
          ...previous,
          ...signal,

          outcome:
            signal.outcome ??
            previous?.outcome
        }
      );
    }
  }

  return [
    ...signalMap.values()
  ];
}

function saveData(
  newSignals,
  existingSignals,
  confidenceData,
  learningData
) {
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
            first.lastUpdated ||
            first.createdAt ||
            0
          ) -
          new Date(
            second.lastUpdated ||
            second.createdAt ||
            0
          )
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

  archiveSignals(
    closedSignals.slice(
      0,
      archiveCount
    )
  );

  const keptSignals = [
    ...openSignals,
    ...closedToKeep
  ];

  const timestamp =
    nowIso();

  safeWriteJson(
    SIGNALS_FILE,
    {
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
            [
              "WIN",
              "LOSS"
            ].includes(
              signal.status
            )
        ).length,

      expiredSignals:
        keptSignals.filter(
          signal =>
            signal.status ===
            "EXPIRED"
        ).length,

      pendingSignals:
        openSignals.length
    }
  );

  safeWriteJson(
    CONFIDENCE_FILE,
    {
      patterns:
        objectOrEmpty(
          confidenceData
        ),

      updatedAt:
        timestamp
    }
  );

  safeWriteJson(
    LEARNING_FILE,
    {
      ...getDefaultLearningData(),
      ...objectOrEmpty(
        learningData
      ),

      history:
        safeArray(
          learningData?.history
        ),

      stats:
        objectOrEmpty(
          learningData?.stats
        ),

      updatedAt:
        timestamp
    }
  );
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
// Phase 6 - Performance Engine
// =====================================================

function buildPerformanceBreakdown(
  signals,
  keyGetter
) {
  const groups = {};

  for (
    const signal of
    safeArray(signals)
  ) {
    const key =
      keyGetter(signal) ||
      "UNKNOWN";

    if (!groups[key]) {
      groups[key] = {
        total: 0,

        wins: 0,

        losses: 0,

        expired: 0,

        riskRewards: []
      };
    }

    groups[key].total++;

    if (
      signal.status ===
      "WIN"
    ) {
      groups[key].wins++;
    }

    if (
      signal.status ===
      "LOSS"
    ) {
      groups[key].losses++;
    }

    if (
      signal.status ===
      "EXPIRED"
    ) {
      groups[key].expired++;
    }

    if (
      Number.isFinite(
        Number(
          signal.riskReward
        )
      )
    ) {
      groups[key]
        .riskRewards
        .push(
          Number(
            signal.riskReward
          )
        );
    }
  }

  return Object.fromEntries(
    Object.entries(groups)
      .map(
        (
          [
            key,
            value
          ]
        ) => [
          key,
          {
            total:
              value.total,

            wins:
              value.wins,

            losses:
              value.losses,

            expired:
              value.expired,

            winRate:
              round(
                percent(
                  value.wins,
                  value.wins +
                  value.losses
                ),
                1
              ),

            averageRiskReward:
              round(
                average(
                  value.riskRewards
                ),
                2
              )
          }
        ]
      )
  );
}

// =====================================================
// Phase 6 - Self Optimizer
// =====================================================

function generateOptimizerRecommendations(
  signals,
  learner
) {
  const patternPerformance =
    buildPerformanceBreakdown(
      signals,
      signal =>
        signal.pattern
    );

  const recommendations = [];

  for (
    const [
      pattern,
      statistics
    ] of Object.entries(
      patternPerformance
    )
  ) {
    if (
      statistics.wins +
      statistics.losses <
      5
    ) {
      continue;
    }

    if (
      statistics.winRate >= 65
    ) {
      recommendations.push({
        type:
          "PATTERN_WEIGHT",

        pattern,

        action:
          "INCREASE",

        suggestedChange:
          0.05,

        reason:
          `win rate ${statistics.winRate}%`,

        applyAutomatically:
          false
      });
    }

    if (
      statistics.winRate <= 40
    ) {
      recommendations.push({
        type:
          "PATTERN_WEIGHT",

        pattern,

        action:
          "DECREASE",

        suggestedChange:
          -0.05,

        reason:
          `win rate ${statistics.winRate}%`,

        applyAutomatically:
          false
      });
    }
  }

  const evolution =
    learner
      .getPatternEvolutionRecommendations?.() ||
    {};

  if (
    Object.keys(evolution)
      .length > 0
  ) {
    recommendations.push({
      type:
        "DETECTOR_THRESHOLDS",

      action:
        "REVIEW",

      data:
        evolution,

      applyAutomatically:
        false
    });
  }

  return recommendations;
}

// =====================================================
// Phase 6 - Weekly Report
// =====================================================

function generateWeeklyReport(
  signals,
  learner
) {
  const end =
    new Date();

  const start =
    new Date(
      end.getTime() -
      7 *
      24 *
      60 *
      60 *
      1000
    );

  const weeklySignals =
    safeArray(signals)
      .filter(
        signal =>
          new Date(
            signal.resolvedAt ||
            signal.expiredAt ||
            signal.lastUpdated ||
            signal.createdAt ||
            0
          ) >= start
      );

  const resolvedSignals =
    weeklySignals.filter(
      signal =>
        [
          "WIN",
          "LOSS"
        ].includes(
          signal.status
        )
    );

  const wins =
    resolvedSignals.filter(
      signal =>
        signal.status ===
        "WIN"
    ).length;

  const patternAccuracy =
    buildPerformanceBreakdown(
      weeklySignals,
      signal =>
        signal.pattern
    );

  const pairAccuracy =
    buildPerformanceBreakdown(
      weeklySignals,
      signal =>
        signal.pair
    );

  const timeframeAccuracy =
    buildPerformanceBreakdown(
      weeklySignals,
      signal =>
        signal.timeframe
    );

  const sessionAccuracy =
    buildPerformanceBreakdown(
      weeklySignals,
      signal =>
        signal.session ||
        signal.executionNotes
          ?.bestSessions
    );

  const marketRegimeAccuracy =
    buildPerformanceBreakdown(
      weeklySignals,
      signal =>
        signal.marketState
          ?.state ||
        signal.marketRegime
    );

  const rankedPatterns =
    Object.entries(
      patternAccuracy
    )
      .sort(
        (
          first,
          second
        ) =>
          second[1].winRate -
          first[1].winRate
      );

  const recommendations =
    generateOptimizerRecommendations(
      weeklySignals,
      learner
    );

  return {
    version:
      "6.0.0",

    generatedAt:
      nowIso(),

    period: {
      start:
        start.toISOString(),

      end:
        end.toISOString()
    },

    metrics: {
      totalSignals:
        weeklySignals.length,

      resolvedSignals:
        resolvedSignals.length,

      overallWinRate:
        round(
          percent(
            wins,
            resolvedSignals.length
          ),
          1
        ),

      averageRiskReward:
        round(
          average(
            weeklySignals.map(
              signal =>
                signal.riskReward
            )
          ),
          2
        ),

      patternAccuracy,

      pairAccuracy,

      timeframeAccuracy,

      sessionAccuracy,

      marketRegimeAccuracy,

      learningProgress:
        learner
          .getPerformanceTrend?.() ||
        learner
          .getDashboardData?.()
          ?.learningProgress ||
        null,

      bestPattern:
        rankedPatterns[0]?.[0] ||
        null,

      worstPattern:
        rankedPatterns[
          rankedPatterns.length - 1
        ]?.[0] ||
        null,

      mostImprovedPattern:
        recommendations.find(
          recommendation =>
            recommendation.action ===
            "INCREASE"
        )?.pattern ||
        null,

      blacklistedPatterns:
        Object.keys(
          learner.data
            ?.blacklistedPatterns ||
          {}
        ),

      optimizationSuggestions:
        recommendations
    },

    recommendations
  };
}

// =====================================================
// Phase 6 - Dashboard Data
// =====================================================

function distribution(
  values,
  buckets
) {
  const result =
    Object.fromEntries(
      buckets.map(
        bucket => [
          bucket.label,
          0
        ]
      )
    );

  for (
    const rawValue of
    values
  ) {
    const value =
      toNumber(
        rawValue,
        NaN
      );

    if (
      !Number.isFinite(value)
    ) {
      continue;
    }

    const bucket =
      buckets.find(
        item =>
          value >= item.min &&
          value <= item.max
      );

    if (bucket) {
      result[
        bucket.label
      ]++;
    }
  }

  return result;
}

function generateDashboardData(
  signals,
  learner,
  health
) {
  const signalList =
    safeArray(signals);

  const scoreBuckets = [
    {
      label:
        "0-59",

      min: 0,

      max: 59.99
    },

    {
      label:
        "60-69",

      min: 60,

      max: 69.99
    },

    {
      label:
        "70-79",

      min: 70,

      max: 79.99
    },

    {
      label:
        "80-89",

      min: 80,

      max: 89.99
    },

    {
      label:
        "90-100",

      min: 90,

      max: 100
    }
  ];

  return {
    version:
      "6.0.0",

    updatedAt:
      nowIso(),

    distributions: {
      aiScore:
        distribution(
          signalList.map(
            signal =>
              signal.aiScore
          ),
          scoreBuckets
        ),

      confidence:
        distribution(
          signalList.map(
            signal =>
              signal
                .finalAIConfidence ??
              signal.confidence
          ),
          scoreBuckets
        )
    },

    performance: {
      strategy:
        buildPerformanceBreakdown(
          signalList,
          signal =>
            signal.strategyPriority
              ?.primary
        ),

      pair:
        buildPerformanceBreakdown(
          signalList,
          signal =>
            signal.pair
        ),

      marketState:
        buildPerformanceBreakdown(
          signalList,
          signal =>
            signal.marketState
              ?.state ||
            signal.marketRegime
        ),

      session:
        buildPerformanceBreakdown(
          signalList,
          signal =>
            signal.session
        ),

      patternRanking:
        buildPerformanceBreakdown(
          signalList,
          signal =>
            signal.pattern
        ),

      learningGrowth:
        learner
          .getPerformanceTrend?.() ||
        null
    },

    health
  };
}

function persistPhase6Outputs(
  allSignals,
  newSignals,
  learner,
  health
) {
  const weeklyReport =
    generateWeeklyReport(
      allSignals,
      learner
    );

  const dashboard =
    generateDashboardData(
      allSignals,
      learner,
      health
    );

  const recommendations =
    generateOptimizerRecommendations(
      allSignals,
      learner
    );

  safeWriteJson(
    WEEKLY_REPORT_FILE,
    weeklyReport
  );

  safeWriteJson(
    DASHBOARD_FILE,
    dashboard
  );

  safeWriteJson(
    OPTIMIZER_FILE,
    {
      version:
        "6.0.0",

      updatedAt:
        nowIso(),

      recommendations
    }
  );

  safeWriteJson(
    PHASE6_FILE,
    {
      version:
        "6.0.0",

      updatedAt:
        nowIso(),

      lastRun:
        nowIso(),

      publishedSignalId:
        newSignals[0]
          ?.signalId ||
        null,

      portfolio: {
        openTrades:
          allSignals.filter(
            signal =>
              OPEN_STATUSES.includes(
                signal.status
              )
          ).length,

        limits: {
          maxOpenTrades:
            MAX_OPEN_TRADES,

          maxPairOpenTrades:
            MAX_PAIR_OPEN_TRADES,

          maxJPYExposure:
            MAX_JPY_EXPOSURE
        }
      },

      marketStates:
        Object.fromEntries(
          newSignals.map(
            signal => [
              `${signal.pair}_${signal.timeframe}`,
              signal.marketState
            ]
          )
        ),

      strategyPriorities:
        Object.fromEntries(
          newSignals.map(
            signal => [
              `${signal.pair}_${signal.timeframe}`,
              signal.strategyPriority
            ]
          )
        ),

      optimizerRecommendations:
        recommendations
    }
  );
}

// =====================================================
// Staleness
// =====================================================

function updateStaleness(
  reason
) {
  const data =
    safeReadJson(
      SIGNALS_FILE,
      getDefaultSignalsData()
    );

  const stale =
    Object.fromEntries(
      SUPPORTED_PAIRS.map(
        pair => [
          pair,
          true
        ]
      )
    );

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
}

// =====================================================
// Main Bot Execution
// =====================================================

async function runBot() {
  console.log(
    "🤖 PipSight Pro AI Phase 6 Starting..."
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

    /**
     * SignalGenerator and index.js share the same
     * learner instance. Existing learning remains the
     * base source for all Phase 6 intelligence.
     */
    const signalGenerator =
      new SignalGenerator({
        learner,

        minimumRiskReward:
          1.5,

        actionableThreshold:
          MINIMUM_CONFIDENCE
      });

    /**
     * Existing evolution recommendations are passed
     * to analyzer only if analyzer supports the hook.
     * Analyzer rules are never overwritten here.
     */
    const evolution =
      learner
        .getPatternEvolutionRecommendations?.() ||
      {};

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
      safeArray(
        data.signals.signals
      );

    const pipelineStatus =
      getDefaultPipelineStatusData();

    const analysisStart =
      Date.now();

    const newSignals =
      analyzeMarkets(
        candles,
        analyzer,
        learner,
        signalGenerator,
        existingSignals,
        pipelineStatus
      );

    analysisDurationMs =
      Date.now() -
      analysisStart;

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

    const saveStart =
      Date.now();

    saveBotResults(
      newSignals,
      updatedSignals,
      learner
    );

    savePipelineStatus(
      pipelineStatus
    );

    saveDurationMs =
      Date.now() -
      saveStart;

    const resolvedSignals =
      updatedSignals.filter(
        signal =>
          [
            "WIN",
            "LOSS"
          ].includes(
            signal.status
          )
      );

    const wins =
      resolvedSignals.filter(
        signal =>
          signal.status ===
          "WIN"
      ).length;

    const learnerHealth =
      learner
        .getHealthStatus?.() ||
      {
        status:
          "HEALTHY"
      };

    const health = {
      status:
        learnerHealth.status ||
        "HEALTHY",

      signalsGenerated:
        newSignals.length,

      averageConfidence:
        round(
          average(
            newSignals.map(
              signal =>
                signal
                  .finalAIConfidence ??
                signal.confidence
            )
          ),
          1
        ),

      averageAIScore:
        round(
          average(
            newSignals.map(
              signal =>
                signal.aiScore
            )
          ),
          1
        ),

      recentWinRate:
        round(
          percent(
            wins,
            resolvedSignals.length
          ),
          1
        ),

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
    };

    runHealthCheck(
      health
    );

    persistPhase6Outputs(
      mergeSignals(
        newSignals,
        updatedSignals
      ),
      newSignals,
      learner,
      health
    );

    saveAuditLog();

    console.log(
      "\n✨ Phase 6 execution complete"
    );

    console.log(
      `🏛️ Institutional signals published: ${newSignals.length}`
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
  runBot()
    .catch(
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
// Backward-Compatible Exports
// =====================================================

module.exports = {
  runBot,

  initializeFiles,

  loadData,

  fetchMarketData,

  analyzeMarkets,

  analyzePair,

  getPairTimeframeCandles,

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

  detectAdvancedMarketState,

  chooseStrategyPriority,

  calculateFinalAIConfidence,

  calculateInstitutionalAIScore,

  getCorrelationPenalty,

  evaluatePortfolioRisk,

  generateExplanation,

  selectInstitutionalSignal,

  generateOptimizerRecommendations,

  generateWeeklyReport,

  generateDashboardData,

  persistPhase6Outputs,

  OPEN_STATUSES,

  CLOSED_STATUSES,

  EXPIRY_MAP,

  SUPPORTED_PAIRS,

  SUPPORTED_TIMEFRAMES
};
