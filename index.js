#!/usr/bin/env node
/**
 * Pattern Detection AI Bot - Main Entry Point
 * Real-time chart pattern recognition with self-learning
 * Runs every 5 minutes via GitHub Actions
 */

const fs = require('fs');
const path = require('path');
const PatternAnalyzer = require('./analyzer');
const LearningSystem = require('./learner');
const SignalGenerator = require('./signals');

const DATA_DIR = path.join(__dirname, 'data');
const SIGNALS_FILE = path.join(DATA_DIR, 'pattern-signals.json');
const CONFIDENCE_FILE = path.join(DATA_DIR, 'pattern-confidence.json');
const LEARNING_FILE = path.join(DATA_DIR, 'pattern-learning.json');
const ARCHIVE_FILE = path.join(DATA_DIR, 'pattern-signals-archive.json');
const AUDIT_FILE = path.join(DATA_DIR, 'pattern-audit-log.json');
const HEALTH_FILE = path.join(DATA_DIR, 'pattern-health.json');

// Signal lifecycle: NEW -> ACTIVE -> PARTIAL -> WIN/LOSS/EXPIRED -> ARCHIVED
// PARTIAL is reserved for a future multi-TP (TP1/TP2/TP3) system.
const OPEN_STATUSES = ['NEW', 'ACTIVE', 'PARTIAL'];

// Signal expiry by timeframe (ms) — midpoint of the requested ranges
const EXPIRY_MAP = {
  '5m': 45 * 60 * 1000,            // 45 min  (range: 30-60 min)
  '15m': 3 * 60 * 60 * 1000,       // 3 hours (range: 2-4 hours)
  '30m': 4 * 60 * 60 * 1000,       // 4 hours (unchanged — not in new spec)
  '1H': 18 * 60 * 60 * 1000,       // 18 hours (range: 12-24 hours)
  '4H': 2 * 24 * 60 * 60 * 1000    // 2 days  (range: 1-3 days)
};

// Market session quality multipliers (applied to qualityScore, UTC hours)
const SESSION_QUALITY_MULTIPLIER = {
  ASIAN: 0.9,
  LONDON: 1.05,
  LONDON_NY_OVERLAP: 1.15,
  NEWYORK: 1.05,
  OFF_HOURS: 0.8
};

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize files if not exist
function initializeFiles() {
  if (!fs.existsSync(SIGNALS_FILE)) {
    fs.writeFileSync(SIGNALS_FILE, JSON.stringify({ signals: [], updatedAt: new Date().toISOString(), stale: {} }, null, 2));
  }
  if (!fs.existsSync(CONFIDENCE_FILE)) {
    fs.writeFileSync(CONFIDENCE_FILE, JSON.stringify({ patterns: {}, updatedAt: new Date().toISOString() }, null, 2));
  }
  if (!fs.existsSync(LEARNING_FILE)) {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify({ history: [], stats: {}, updatedAt: new Date().toISOString() }, null, 2));
  }
  if (!fs.existsSync(ARCHIVE_FILE)) {
    fs.writeFileSync(ARCHIVE_FILE, JSON.stringify({ signals: [], updatedAt: new Date().toISOString(), totalArchived: 0 }, null, 2));
  }
  if (!fs.existsSync(AUDIT_FILE)) {
    fs.writeFileSync(AUDIT_FILE, JSON.stringify({ entries: [], updatedAt: new Date().toISOString() }, null, 2));
  }
  if (!fs.existsSync(HEALTH_FILE)) {
    fs.writeFileSync(HEALTH_FILE, JSON.stringify({ history: [], updatedAt: new Date().toISOString() }, null, 2));
  }
}

// Load existing data
function loadData() {
  try {
    const signals = JSON.parse(fs.readFileSync(SIGNALS_FILE, 'utf8'));
    const confidence = JSON.parse(fs.readFileSync(CONFIDENCE_FILE, 'utf8'));
    const learning = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
    return { signals, confidence, learning };
  } catch (err) {
    console.error('Error loading data:', err.message);
    return { signals: { signals: [], updatedAt: new Date().toISOString(), stale: {} }, confidence: { patterns: {}, updatedAt: new Date().toISOString() }, learning: { history: [], stats: {}, updatedAt: new Date().toISOString() } };
  }
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch market candle data
 */
async function fetchMarketData(analyzer) {

  console.log('📊 Fetching candle data...');

  let candles = null;

  for (let attempt = 1; attempt <= 3; attempt++) {

    try {

      candles = await analyzer.fetchCandles();

      if (candles && Object.keys(candles).length > 0) {
        break;
      }

    } catch (err) {

      console.warn(
        `⚠️ Fetch attempt ${attempt} failed: ${err.message}`
      );

    }

    if (attempt < 3) {

      console.log("🔄 Retrying in 3 seconds...");

      await sleep(3000);

    }

  }

  if (!candles || Object.keys(candles).length === 0) {

    console.warn('⚠️ No candle data available');

    updateStaleness('data-fetch-failed');

    return null;

  }

  return candles;

}

// ---------------------------------------------------------------------
// Audit Log — records why each signal was generated, refreshed, or
// rejected. Collected in memory during the run and flushed once at
// the end (see saveAuditLog).
// ---------------------------------------------------------------------
let auditLog = [];

function logAudit(entry) {
  auditLog.push({
    timestamp: new Date().toISOString(),
    ...entry
  });
}

/**
 * Persist this run's audit entries to the audit log file
 * (keeps the most recent 2000 entries)
 */
function saveAuditLog() {
  try {

    if (auditLog.length === 0) return;

    let auditData = { entries: [], updatedAt: new Date().toISOString() };

    if (fs.existsSync(AUDIT_FILE)) {
      auditData = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
    }

    auditData.entries = [...(auditData.entries || []), ...auditLog].slice(-2000);
    auditData.updatedAt = new Date().toISOString();
    auditData.totalEntries = auditData.entries.length;

    fs.writeFileSync(AUDIT_FILE, JSON.stringify(auditData, null, 2));

    console.log(`📝 Audit log: ${auditLog.length} entries recorded this run`);

    auditLog = [];

  } catch (err) {
    console.error('Error saving audit log:', err.message);
  }
}

/**
 * Determine the current market session (UTC-based)
 */
function getMarketSession() {

  const hour = new Date().getUTCHours();

  if (hour >= 0 && hour < 7) return 'ASIAN';
  if (hour >= 7 && hour < 12) return 'LONDON';
  if (hour >= 12 && hour < 16) return 'LONDON_NY_OVERLAP';
  if (hour >= 16 && hour < 21) return 'NEWYORK';

  return 'OFF_HOURS';

}

/**
 * Reject signals during abnormal spread or extreme volatility spikes.
 * Volatility is derived from recent candle ranges (no extra data
 * required). Spread is only checked if the candle data actually
 * contains a `spread` field — if not present, that part of the check
 * is skipped rather than assumed.
 */
function passesSpreadVolatilityFilter(tfCandles) {

  if (!tfCandles || tfCandles.length < 15) {
    return { pass: true };
  }

  const recent = tfCandles.slice(-15, -1); // last 14, excluding current
  const latest = tfCandles[tfCandles.length - 1];

  const avgRange =
    recent.reduce((sum, c) => sum + Math.abs(c.high - c.low), 0) / recent.length;

  const currentRange = Math.abs(latest.high - latest.low);

  if (avgRange > 0 && currentRange > avgRange * 3) {
    return {
      pass: false,
      reason: `extreme volatility (current range ${currentRange.toFixed(5)} vs avg ${avgRange.toFixed(5)})`
    };
  }

  if (latest.spread !== undefined) {

    const avgSpread =
      recent.reduce((sum, c) => sum + (c.spread || 0), 0) / recent.length;

    if (avgSpread > 0 && latest.spread > avgSpread * 3) {
      return {
        pass: false,
        reason: `abnormal spread (current ${latest.spread} vs avg ${avgSpread.toFixed(5)})`
      };
    }

  }

  return { pass: true };

}

/**
 * AI Health Monitor — snapshot of this run's health, written after
 * every execution (success or failure)
 */
function runHealthCheck(report) {
  try {

    let healthData = { history: [], updatedAt: new Date().toISOString() };

    if (fs.existsSync(HEALTH_FILE)) {
      healthData = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8'));
    }

    const entry = {
      timestamp: new Date().toISOString(),
      ...report
    };

    healthData.history = [...(healthData.history || []), entry].slice(-100);
    healthData.updatedAt = new Date().toISOString();
    healthData.lastStatus = report.status;

    fs.writeFileSync(HEALTH_FILE, JSON.stringify(healthData, null, 2));

    console.log(`🩺 Health check: ${report.status}`);

  } catch (err) {
    console.error('Error writing health check:', err.message);
  }
}

/**
 * Check if a signal is still in cooldown
 * (same pair + timeframe + pattern, generated recently)
 */
function isSignalInCooldown(
  signal,
  existingSignals,
  cooldownMs = 5 * 60 * 1000 // 5 minute default cooldown
) {

  const now = new Date(signal.timestamp).getTime();

  return existingSignals.some(s =>
    s.pair === signal.pair &&
    s.timeframe === signal.timeframe &&
    s.pattern === signal.pattern &&
    (now - new Date(s.timestamp).getTime()) < cooldownMs
  );

}

/**
 * Build a unique signal ID: PAIR_TF_PATTERN_YYYYMMDD
 */
function buildSignalId(pair, tf, patternName) {

  const dateStr =
    new Date().toISOString().slice(0, 10).replace(/-/g, '');

  const patternKey =
    patternName.replace(/\s+/g, '').toUpperCase();

  return `${pair}_${tf}_${patternKey}_${dateStr}`;

}

/**
 * Find an existing open (NEW/ACTIVE/PARTIAL) signal for the same
 * pair/timeframe/pattern
 */
function findActiveDuplicate(pair, tf, patternName, existingSignals) {

  return existingSignals.find(s =>
    s.pair === pair &&
    s.timeframe === tf &&
    s.pattern === patternName &&
    OPEN_STATUSES.includes(s.status)
  );

}

/**
 * Score one candidate pattern using a composite quality score:
 * 35% confidence, 25% confirmation score, 20% strength,
 * 10% risk:reward, 10% historical win rate
 */
function scorePattern(pair, tf, pattern, tfCandles, learner, signalGen) {

  const signalContext = {
    pair,
    timeframe: tf,
    pattern: pattern.name,
    strength: pattern.strength,
    confirmationScore: pattern.confirmationScore
  };

  const confidence =
    learner.calculateAdaptiveConfidence(signalContext);

  if (confidence < 70) {

    logAudit({
      pair,
      timeframe: tf,
      pattern: pattern.name,
      decision: 'REJECTED',
      reason: `confidence ${confidence}% below 70% threshold`
    });

    return null;

  }

  const signal =
    signalGen.generateSignal(
      pair,
      tf,
      pattern,
      confidence,
      tfCandles[tfCandles.length - 1]
    );

  const risk = Math.abs(signal.entry - signal.stopLoss);
  const reward = Math.abs(signal.takeProfit - signal.entry);
  const riskReward = risk > 0 ? reward / risk : 0;

  // Normalize risk:reward onto a 0-100 scale (RR of 5+ scores 100)
  const rrScore = Math.min((riskReward / 5) * 100, 100);

  // Historical win rate for this pattern, if the learner tracks one
  // (falls back to neutral 50 if the learner has no such method)
  const winRate =
    (learner.getPatternWinRate
      ? learner.getPatternWinRate(signalContext)
      : null) ?? 50;

  let qualityScore =
    (confidence * 0.35) +
    ((pattern.confirmationScore || 0) * 0.25) +
    ((pattern.strength || 0) * 0.20) +
    (rrScore * 0.10) +
    (winRate * 0.10);

  // Adjust quality by current market session (liquidity/reliability)
  const session = getMarketSession();
  const sessionMultiplier = SESSION_QUALITY_MULTIPLIER[session] || 1;
  qualityScore = qualityScore * sessionMultiplier;

  return { pattern, signal, confidence, qualityScore, session };

}

/**
 * Pick the single best pattern for a timeframe via composite quality score.
 * If the runner-up is nearly tied but points the opposite direction,
 * treat it as a conflict and skip the timeframe entirely.
 */
function selectBestPattern(pair, tf, patterns, tfCandles, learner, signalGen) {

  const candidates = patterns
    .map(p => scorePattern(pair, tf, p, tfCandles, learner, signalGen))
    .filter(Boolean);

  if (candidates.length === 0) return null;

  // Multi-Pattern Consensus Engine:
  // if 2+ candidates agree on direction, boost their quality score;
  // if candidates conflict (BUY vs SELL both present), dampen everyone
  const buyCount = candidates.filter(c => c.signal.direction === 'BUY').length;
  const sellCount = candidates.filter(c => c.signal.direction === 'SELL').length;

  candidates.forEach(c => {

    const sameDirCount = c.signal.direction === 'BUY' ? buyCount : sellCount;
    const oppositeDirCount = c.signal.direction === 'BUY' ? sellCount : buyCount;

    if (oppositeDirCount > 0) {

      c.qualityScore = Math.max(c.qualityScore - 5, 0);
      c.consensusNote = `conflict: ${buyCount} BUY vs ${sellCount} SELL patterns`;

    } else if (sameDirCount >= 2) {

      const boost = Math.min((sameDirCount - 1) * 3, 10);
      c.qualityScore = Math.min(c.qualityScore + boost, 100);
      c.consensusNote = `${sameDirCount} ${c.signal.direction} patterns agree (+${boost})`;

    }

  });

  candidates.sort((a, b) => b.qualityScore - a.qualityScore);

  const best = candidates[0];
  const runnerUp = candidates[1];

  if (
    runnerUp &&
    Math.abs(best.qualityScore - runnerUp.qualityScore) <= 2 &&
    runnerUp.signal.direction !== best.signal.direction
  ) {

    console.log(
      `⚖️ ${pair} ${tf} | Conflicting patterns near quality parity (${best.pattern.name} vs ${runnerUp.pattern.name}) — skipped`
    );

    logAudit({
      pair,
      timeframe: tf,
      decision: 'REJECTED',
      reason: `near-parity conflict: ${best.pattern.name} (${best.qualityScore.toFixed(1)}) vs ${runnerUp.pattern.name} (${runnerUp.qualityScore.toFixed(1)})`
    });

    return null;

  }

  logAudit({
    pair,
    timeframe: tf,
    pattern: best.pattern.name,
    decision: 'SELECTED',
    direction: best.signal.direction,
    confidence: best.confidence,
    qualityScore: Number(best.qualityScore.toFixed(2)),
    session: best.session,
    reason: best.consensusNote || 'best quality score among candidates'
  });

  return best;

}

/**
 * Analyze one trading pair
 */
function analyzePair(
  pair,
  candles,
  analyzer,
  learner,
  signalGen,
  existingSignals
) {

  const signals = [];

  const trendCache = {};

  const timeframes = ['5m', '15m', '30m', '1H', '4H'];

  if (!candles[pair])
    return signals;

  for (const tf of timeframes) {

    const tfCandles = candles[pair][tf];

    if (!tfCandles || tfCandles.length < 20)
      continue;

    trendCache[`${pair}_${tf}`] =
      analyzer.detectTrend(tfCandles);

    // Spread & Volatility Filter — reject abnormal conditions before
    // even looking for patterns on this timeframe
    const volCheck = passesSpreadVolatilityFilter(tfCandles);

    if (!volCheck.pass) {

      console.log(`🚫 ${pair} ${tf} | Skipped — ${volCheck.reason}`);

      logAudit({
        pair,
        timeframe: tf,
        decision: 'REJECTED',
        reason: volCheck.reason
      });

      continue;

    }

    // Detect patterns
    const patterns =
      analyzer.detectAllPatterns(tfCandles);

    if (!patterns || patterns.length === 0)
      continue;

    // Pick the single best pattern using the composite quality score
    const best =
      selectBestPattern(
        pair,
        tf,
        patterns,
        tfCandles,
        learner,
        signalGen
      );

    if (!best) continue;

    {

      const { pattern, signal, confidence } = best;

      const higherTrend =
        trendCache[`${pair}_1H`] ||
        trendCache[`${pair}_4H`];

      if (
        higherTrend &&
        higherTrend !== "SIDEWAYS" &&
        higherTrend !== signal.direction
      ) {

        logAudit({
          pair,
          timeframe: tf,
          pattern: pattern.name,
          decision: 'REJECTED',
          reason: `against higher-timeframe trend (${higherTrend})`
        });

        continue;
      }

      // If this pattern is already ACTIVE, refresh it instead of
      // creating a duplicate signal
      const activeMatch =
        findActiveDuplicate(pair, tf, pattern.name, existingSignals);

      if (activeMatch) {

        const oldConfidence = activeMatch.confidence;

        if (signal.confidence > activeMatch.confidence) {
          activeMatch.confidence = signal.confidence;
        }

        if (
          (pattern.confirmationScore || 0) >
          (activeMatch.confirmationScore || 0)
        ) {
          activeMatch.confirmationScore = pattern.confirmationScore;
        }

        if (signal.direction === "BUY") {

          if (signal.stopLoss > activeMatch.stopLoss)
            activeMatch.stopLoss = signal.stopLoss;

          if (signal.takeProfit > activeMatch.takeProfit)
            activeMatch.takeProfit = signal.takeProfit;

          if (signal.entry > activeMatch.entry)
            activeMatch.entry = signal.entry;

        } else if (signal.direction === "SELL") {

          if (signal.stopLoss < activeMatch.stopLoss)
            activeMatch.stopLoss = signal.stopLoss;

          if (signal.takeProfit < activeMatch.takeProfit)
            activeMatch.takeProfit = signal.takeProfit;

          if (signal.entry < activeMatch.entry)
            activeMatch.entry = signal.entry;

        }

        activeMatch.lastUpdated = new Date().toISOString();
        activeMatch.refreshCount = (activeMatch.refreshCount || 1) + 1;
        activeMatch.version = (activeMatch.version || 1) + 1;

        console.log(
          `🔁 ${pair} ${tf} | ${pattern.name} refreshed → v${activeMatch.version} (refresh #${activeMatch.refreshCount})`
        );

        logAudit({
          pair,
          timeframe: tf,
          pattern: pattern.name,
          decision: 'REFRESHED',
          reason: `confidence ${oldConfidence}% → ${activeMatch.confidence}%, version ${activeMatch.version}`
        });

        continue;

      }

      if (isSignalInCooldown(signal, existingSignals)) {

        logAudit({
          pair,
          timeframe: tf,
          pattern: pattern.name,
          decision: 'REJECTED',
          reason: 'cooldown active'
        });

        continue;
      }

      learner.updateSignalConfidence(signal);

      const nowIso = new Date().toISOString();

      signals.push({
        ...signal,
        signalId: buildSignalId(pair, tf, pattern.name),
        timestamp: nowIso,
        status: "NEW",
        version: 1,
        createdAt: nowIso,
        lastUpdated: nowIso,
        refreshCount: 1
      });

      console.log(
        `✅ ${pair} ${tf} | ${pattern.name} | ${signal.direction} | Confidence: ${signal.confidence}%`
      );

      logAudit({
        pair,
        timeframe: tf,
        pattern: pattern.name,
        decision: 'GENERATED',
        direction: signal.direction,
        confidence: signal.confidence,
        reason: 'passed all filters (trend, session, volatility, cooldown, consensus)'
      });

    }

  }

  return signals;

}

/**
 * Analyze all markets and generate signals
 */
function analyzeMarkets(candles, analyzer, learner, signalGen, existingSignals) {

  console.log('🔍 Analyzing patterns...');

  const newSignals = [];

  const pairs = ['XAUUSD', 'GBPJPY'];
  const timeframes = ['5m', '15m', '30m', '1H', '4H'];

  for (const pair of pairs) {

    newSignals.push(
      ...analyzePair(
        pair,
        candles,
        analyzer,
        learner,
        signalGen,
        existingSignals
      )
    );

  }

  return newSignals;

}

/**
 * Update AI learning system
 */
async function updateLearning(
  learner,
  existingSignals,
  newSignals,
  candles
) {

  console.log("🧠 Updating learning outcomes...");

  await resolvePendingSignals(
    learner,
    existingSignals,
    candles
  );

  learner.updateHistory(newSignals);

  return existingSignals;

}

/**
 * Save all bot results
 */
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

// Main bot execution
async function runBot() {
  console.log('🤖 Pattern Detection Bot Starting...');
  console.log(`⏰ Execution time: ${new Date().toISOString()}`);
  const totalStart = Date.now();

  try {
    initializeFiles();
    const data = loadData();
    
    const analyzer = new PatternAnalyzer();
    const learner = new LearningSystem(data.learning, data.confidence);
    const signalGen = new SignalGenerator();

    const fetchStart = Date.now();
    const candles = await fetchMarketData(analyzer);
    console.log(
      `📊 Fetch completed in ${Date.now() - fetchStart} ms`
    );

    if (!candles) {

      saveAuditLog();

      runHealthCheck({
        status: 'CRITICAL',
        reason: 'data-fetch-failed',
        totalRuntimeMs: Date.now() - totalStart
      });

      return;

    }

    const analysisStart = Date.now();
    const newSignals = analyzeMarkets(
        candles,
        analyzer,
        learner,
        signalGen,
        data.signals.signals
    );
    console.log(
      `🔍 Analysis completed in ${Date.now() - analysisStart} ms`
    );

    const learningStart = Date.now();
    const updatedSignals =
      await updateLearning(
        learner,
        data.signals.signals,
        newSignals,
        candles
      );
    console.log(
      `🧠 Learning completed in ${Date.now() - learningStart} ms`
    );

    const saveStart = Date.now();
    saveBotResults(
        newSignals,
        updatedSignals,
        learner
    );
    console.log(
      `💾 Save completed in ${Date.now() - saveStart} ms`
    );

    console.log(`\n✨ Bot execution complete`);
    console.log(`📈 Signals generated: ${newSignals.length}`);
    console.log(`💾 Data saved successfully`);
    console.log(
      `⏱ Total Runtime: ${Date.now() - totalStart} ms`
    );

    const avgConfidence =
      newSignals.length > 0
        ? newSignals.reduce((sum, s) => sum + (s.confidence || 0), 0) / newSignals.length
        : null;

    const recentlyResolved =
      updatedSignals.filter(s => s.status === 'WIN' || s.status === 'LOSS');

    const recentWins =
      recentlyResolved.filter(s => s.status === 'WIN').length;

    const recentWinRate =
      recentlyResolved.length > 0
        ? Number(((recentWins / recentlyResolved.length) * 100).toFixed(1))
        : null;

    runHealthCheck({
      status: 'HEALTHY',
      signalsGenerated: newSignals.length,
      avgConfidence: avgConfidence !== null ? Number(avgConfidence.toFixed(1)) : null,
      recentWinRate,
      openSignals: updatedSignals.filter(s => OPEN_STATUSES.includes(s.status)).length,
      fetchDurationMs: Date.now() - fetchStart,
      analysisDurationMs: Date.now() - analysisStart,
      totalRuntimeMs: Date.now() - totalStart
    });

    saveAuditLog();

  } catch (error) {
    console.error('❌ Bot execution failed:', error.message);
    console.error(error.stack);

    runHealthCheck({
      status: 'CRITICAL',
      reason: error.message,
      totalRuntimeMs: Date.now() - totalStart
    });

    saveAuditLog();

    process.exit(1);
  }
}

// Save data to files
function saveData(newSignals, existingSignals, confidenceData, learningData) {
  try {
    // Merge signals - remove duplicates, keep latest
    const allSignals = [...existingSignals];

    // Update existing signals if they already exist
    for (const signal of newSignals) {

      const index = allSignals.findIndex(s =>
        s.pair === signal.pair &&
        s.timeframe === signal.timeframe &&
        s.pattern === signal.pattern
      );

      if (index >= 0) {

        // Keep old outcome if already evaluated
        signal.outcome =
          allSignals[index].outcome || signal.outcome;

        allSignals[index] = signal;

      } else {

        allSignals.push(signal);

      }

    }
    const uniqueSignals = Array.from(
      new Map(
        allSignals.map(s => [
          `${s.pair}_${s.timeframe}_${s.pattern}`,
          s
        ])
      ).values()
    );

    // Keep every open (NEW/ACTIVE/PARTIAL) signal, plus the most recent
    // 500 closed (WIN/LOSS/EXPIRED) signals. Older closed signals move
    // to the archive file instead of being discarded.
    const openSignals =
      uniqueSignals.filter(s => OPEN_STATUSES.includes(s.status));

    const closedSignals =
      uniqueSignals.filter(s => !OPEN_STATUSES.includes(s.status));

    const closedToKeep = closedSignals.slice(-500);
    const closedToArchive =
      closedSignals.slice(0, closedSignals.length - closedToKeep.length);

    if (closedToArchive.length > 0) {
      archiveSignals(closedToArchive);
    }

    const keptSignals = [...openSignals, ...closedToKeep];

    const signalsData = {
      signals: keptSignals,
      updatedAt: new Date().toISOString(),
      stale: {},
      totalSignals: keptSignals.length,
      resolvedSignals: keptSignals.filter(s => s.status === "WIN" || s.status === "LOSS").length,
      expiredSignals: keptSignals.filter(s => s.status === "EXPIRED").length,
      pendingSignals: keptSignals.filter(s => OPEN_STATUSES.includes(s.status)).length
    };

    const confidenceDataToSave = {
      patterns: confidenceData,
      updatedAt: new Date().toISOString()
    };

    const learningDataToSave = {
      history: learningData.history || [],
      stats: learningData.stats || {},
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(SIGNALS_FILE, JSON.stringify(signalsData, null, 2));
    fs.writeFileSync(CONFIDENCE_FILE, JSON.stringify(confidenceDataToSave, null, 2));
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningDataToSave, null, 2));

  } catch (err) {
    console.error('Error saving data:', err.message);
  }
}

// Mark data as stale if fetch fails
function updateStaleness(reason) {
  try {
    const data = JSON.parse(fs.readFileSync(SIGNALS_FILE, 'utf8'));
    data.stale = { XAUUSD: true, GBPJPY: true, reason, timestamp: new Date().toISOString() };
    fs.writeFileSync(SIGNALS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error updating staleness:', err.message);
  }
}

/**
 * Move closed signals (WIN/LOSS/EXPIRED) that have aged out of the
 * main file into a separate archive file
 */
function archiveSignals(signalsToArchive) {
  try {

    let archiveData = { signals: [], updatedAt: new Date().toISOString() };

    if (fs.existsSync(ARCHIVE_FILE)) {
      archiveData = JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8'));
    }

    const archivedEntries = signalsToArchive.map(s => ({
      ...s,
      previousStatus: s.status,
      status: "ARCHIVED",
      archivedAt: new Date().toISOString()
    }));

    archiveData.signals = [...(archiveData.signals || []), ...archivedEntries];
    archiveData.updatedAt = new Date().toISOString();
    archiveData.totalArchived = archiveData.signals.length;

    fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(archiveData, null, 2));

    console.log(`🗄️ Archived ${archivedEntries.length} closed signal(s)`);

  } catch (err) {
    console.error('Error archiving signals:', err.message);
  }
}

/**
 * Resolve pending signals automatically
 */
async function resolvePendingSignals(
  learner,
  existingSignals,
  candles
) {

  for (const signal of existingSignals) {

    if (!OPEN_STATUSES.includes(signal.status)) continue;

    // A signal that survived one full bot cycle without being resolved
    // graduates from NEW to ACTIVE
    if (signal.status === "NEW") {
      signal.status = "ACTIVE";
    }

    const pairCandles =
      candles?.[signal.pair]?.[signal.timeframe];

    if (!pairCandles || pairCandles.length === 0)
      continue;

    const latest =
      pairCandles[pairCandles.length - 1];

    if (!latest)
      continue;

    let outcome = null;

    if (signal.direction === "BUY") {

      if (latest.high >= signal.takeProfit)
        outcome = "WIN";

      else if (latest.low <= signal.stopLoss)
        outcome = "LOSS";

    }

    else if (signal.direction === "SELL") {

      if (latest.low <= signal.takeProfit)
        outcome = "WIN";

      else if (latest.high >= signal.stopLoss)
        outcome = "LOSS";

    }

    if (outcome) {

      learner.resolveSignal(
        signal.timestamp,
        outcome
      );

      signal.outcome = outcome;
      signal.status = outcome;

      console.log(
        `🎯 ${signal.pattern} ${signal.pair} ${signal.timeframe} → ${outcome}`
      );

      continue;

    }

    // No TP/SL hit yet — check expiry
    const expiryMs = EXPIRY_MAP[signal.timeframe];

    if (expiryMs) {

      const elapsed =
        Date.now() - new Date(signal.timestamp).getTime();

      if (elapsed >= expiryMs) {

        signal.status = "EXPIRED";

        console.log(
          `⌛ ${signal.pattern} ${signal.pair} ${signal.timeframe} → EXPIRED`
        );

      }

    }

  }

}

// Run bot
runBot().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
