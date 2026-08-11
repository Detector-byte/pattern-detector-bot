/**
 * Learning System - Self-improving AI confidence tracker
 * Tracks pattern accuracy, learns from outcomes, adjusts confidence
 */

class LearningSystem {
  constructor(learningData = {}, confidenceData = {}) {

    this.data = learningData || {};
    this.confidenceData = confidenceData || {};

    const requiresStrategyStateMigration =
      !this.data.strategyStateContextStats ||
      !this.data.patternDirectionStateStats ||
      !this.data.patternStateStats;

    // Confidence limits
    this.minConfidence = 50;
    this.maxConfidence = 95;
    this.defaultConfidence = 60;

    // Configuration
    this.maxHistory = 5000;
    this.performanceWindow = 20;
    this.minSamples = 10;
    this.actionableThreshold = 65;

    // =====================================================
    // Phase 4 Adaptive Learning Configuration
    // =====================================================

    // Recent outcomes have greater influence than old outcomes.
    this.decayFactorDays = 90;

    // A pattern can only be blacklisted after enough evidence.
    this.blacklistMinSignals = 30;
    this.blacklistWinRate = 35;

    // Pattern weights are safely restricted.
    this.minPatternWeight = 0.70;
    this.maxPatternWeight = 1.50;

    // Threshold evolution is limited to ±20%.
    this.maxEvolutionChange = 0.20;

    // Initialize existing storage
    if (!this.data.history)
      this.data.history = [];

    if (!this.data.stats)
      this.data.stats = {};

    if (!this.confidenceData.patterns)
      this.confidenceData.patterns = {};

    if (!this.confidenceData.updatedAt)
      this.confidenceData.updatedAt =
        new Date().toISOString();

    // =====================================================
    // Phase 4 Additive Storage
    // =====================================================

    // These fields are additive, so old learning JSON
    // remains fully backward compatible.
    if (!this.data.patternStats)
      this.data.patternStats = {};

    if (!this.data.pairStats)
      this.data.pairStats = {};

    if (!this.data.timeframeStats)
      this.data.timeframeStats = {};

    if (!this.data.regimeStats)
      this.data.regimeStats = {};

    // Contextual economic-edge aggregates are additive and rebuilt
    // from learning history, preserving backward compatibility.
    if (!this.data.contextEdgeStats)
      this.data.contextEdgeStats = {};

    if (!this.data.patternRegimeStats)
      this.data.patternRegimeStats = {};

    if (!this.data.patternSessionStats)
      this.data.patternSessionStats = {};

    // Advanced market-state strategy authority is fully additive.
    // It uses already-computed Pattern Detector market state only;
    // no external data source or API request is introduced.
    if (!this.data.strategyStateContextStats)
      this.data.strategyStateContextStats = {};

    if (!this.data.patternDirectionStateStats)
      this.data.patternDirectionStateStats = {};

    if (!this.data.patternStateStats)
      this.data.patternStateStats = {};

    if (!this.data.patternWeights)
      this.data.patternWeights = {};

    if (!this.data.calibration)
      this.data.calibration = {};

    // Published Phase-6 confidence is a separate forecast stage from
    // the learner's adaptive confidence. Keep its calibration separate
    // so one stage can never contaminate the other.
    if (!this.data.finalConfidenceCalibration)
      this.data.finalConfidenceCalibration = {};

    if (!this.data.patternEvolution)
      this.data.patternEvolution = {};

    if (!this.data.blacklistedPatterns)
      this.data.blacklistedPatterns = {};

    if (!this.data.optimization)
      this.data.optimization = {};

    if (!this.data.lastLearningUpdate)
      this.data.lastLearningUpdate = null;

    /*
     * Production lifecycle integrity migration.
     *
     * Older learning snapshots can contain a terminal outcome while their
     * copied status/lastUpdated metadata still reflects the formerly active
     * signal. Reconcile those already-known terminal facts locally on load.
     * No market data, API request, new outcome or timestamp is fabricated.
     */
    this.reconcileTerminalLifecycleHistory();

    // Existing learning files predate the advanced market-state aggregates.
    // Rebuild them immediately from already-stored local history so the
    // direct-live authority is available on the first upgraded run.
    // This is local computation only and performs no API/network request.
    if (
      requiresStrategyStateMigration &&
      this.data.history.length > 0
    ) {
      this.updatePatternStats();
    }
  }

  // =====================================================
  // Base Confidence Calculation
  // =====================================================

  // Calculate confidence score based on multiple factors
  calculateConfidence(
    strength,
    historicalAccuracy,
    confirmationScore,
    sampleSize = 0
  ) {

    const strengthWeight = 0.30;
    const historyWeight = 0.40;
    const confirmationWeight = 0.30;

    let confidence =
      (strength * strengthWeight) +
      (historicalAccuracy * historyWeight) +
      (confirmationScore * confirmationWeight);

    // Sample boost
    if (sampleSize > 50)
      confidence += 3;

    if (sampleSize > 100)
      confidence += 2;

    // Small sample penalty
    if (sampleSize < 10)
      confidence -= 5;

    confidence = Math.max(
      this.minConfidence,
      Math.min(
        this.maxConfidence,
        confidence
      )
    );

    return Math.round(confidence);
  }

  // =====================================================
  // Phase 4 Adaptive Confidence Engine
  // =====================================================

  /**
   * Calculate adaptive confidence using:
   *
   * - Pattern performance
   * - Exact pattern/pair/timeframe performance
   * - Pair performance
   * - Timeframe performance
   * - Market regime performance
   * - Recent weighted outcomes
   * - Confidence calibration
   * - Dynamic pattern weights
   */
  calculateAdaptiveConfidence(signal) {

    if (!signal)
      return this.defaultConfidence;

    const patternName =
      signal.pattern || "Unknown";

    const pair =
      signal.pair || "UNKNOWN";

    const timeframe =
      signal.timeframe || "UNKNOWN";

    const marketRegime =
      signal.marketRegime ||
      signal.regime ||
      "UNKNOWN";

    const exactKey =
      `${patternName}_${pair}_${timeframe}`;

    const exactStats =
      this.data.stats[exactKey];

    const patternStats =
      this.data.patternStats[patternName];

    const pairStats =
      this.data.pairStats[pair];

    const timeframeStats =
      this.data.timeframeStats[timeframe];

    const regimeStats =
      this.data.regimeStats[marketRegime];

    const primaryStats =
      exactStats || patternStats;

    const historicalAccuracy =
      primaryStats
        ? (
            primaryStats.decayedWinRate ??
            primaryStats.winRate ??
            primaryStats.accuracy ??
            this.defaultConfidence
          )
        : this.defaultConfidence;

    const sampleSize =
      primaryStats
        ? (
            primaryStats.decayedTotal ??
            primaryStats.resolved ??
            primaryStats.total ??
            0
          )
        : 0;

    let confidence =
      this.calculateConfidence(
        signal.strength || 60,
        historicalAccuracy,
        signal.confirmationScore || 60,
        sampleSize
      );

    // Aggregate adjustment helper.
    const getAdjustment =
      stats => {

        if (!stats)
          return 0;

        const resolved =
          stats.decayedTotal ??
          stats.resolved ??
          stats.total ??
          0;

        if (resolved < this.minSamples)
          return 0;

        const winRate =
          stats.decayedWinRate ??
          stats.winRate ??
          stats.accuracy ??
          50;

        // Sample reliability gradually reaches full
        // influence at approximately 50 outcomes.
        const reliability =
          Math.min(
            1,
            resolved / 50
          );

        return (
          ((winRate - 50) / 10) *
          reliability
        );
      };

    // Exact setup performance has strong influence.
    confidence +=
      getAdjustment(exactStats) *
      1.20;

    // Pattern performance has the highest broad influence.
    confidence +=
      getAdjustment(patternStats) *
      1.40;

    // Pair-specific behavior.
    confidence +=
      getAdjustment(pairStats) *
      0.80;

    // Timeframe suitability.
    confidence +=
      getAdjustment(timeframeStats) *
      0.70;

    // Market-regime suitability.
    confidence +=
      getAdjustment(regimeStats) *
      0.80;

    // Recent trend adjustment from the exact setup.
    const recentHistory =
      this.getMatchingResolvedHistory(
        signal,
        10
      );

    if (recentHistory.length >= 5) {

      const recentWins =
        recentHistory.filter(
          item =>
            item.outcome === "WIN"
        ).length;

      const recentRate =
        (
          recentWins /
          recentHistory.length
        ) * 100;

      if (
        recentRate >
        historicalAccuracy + 15
      ) {
        confidence += 3;
      }

      if (
        recentRate <
        historicalAccuracy - 15
      ) {
        confidence -= 3;
      }
    }

    // Apply learned pattern multiplier.
    confidence *=
      this.getPatternWeight(
        patternName
      );

    // Penalize a statistically weak pattern.
    if (
      this.isPatternBlacklisted(
        patternName
      )
    ) {
      confidence -= 15;
    }

    // Apply confidence calibration.
    confidence =
      this.applyConfidenceCalibration(
        confidence
      );

    confidence = Math.max(
      this.minConfidence,
      Math.min(
        this.maxConfidence,
        confidence
      )
    );

    return Math.round(confidence);
  }

  /**
   * Return recent resolved history matching the
   * signal's pattern, pair and timeframe.
   */
  getMatchingResolvedHistory(
    signal,
    limit = 10
  ) {

    if (
      !signal ||
      !Array.isArray(
        this.data.history
      )
    ) {
      return [];
    }

    const matches = [];

    for (
      let i =
        this.data.history.length - 1;
      i >= 0;
      i--
    ) {

      const historicalSignal =
        this.data.history[i];

      if (!historicalSignal.outcome)
        continue;

      if (
        historicalSignal.pattern !==
        signal.pattern
      ) {
        continue;
      }

      if (
        signal.pair &&
        historicalSignal.pair !==
        signal.pair
      ) {
        continue;
      }

      if (
        signal.timeframe &&
        historicalSignal.timeframe !==
        signal.timeframe
      ) {
        continue;
      }

      matches.unshift(
        historicalSignal
      );

      if (
        matches.length >= limit
      ) {
        break;
      }
    }

    return matches;
  }

  /**
   * Correct systematic overconfidence
   * or underconfidence using resolved signals.
   */
  applyConfidenceCalibration(
    confidence
  ) {

    const confidenceBin =
      String(
        Math.max(
          50,
          Math.min(
            95,
            Math.round(
              confidence / 5
            ) * 5
          )
        )
      );

    const calibration =
      this.data.calibration[
        confidenceBin
      ];

    if (
      !calibration ||
      calibration.total <
        this.minSamples
    ) {
      return confidence;
    }

    const actualRate =
      calibration.actualRate ??
      (
        calibration.total > 0
          ? (
              calibration.wins /
              calibration.total
            ) * 100
          : Number(
              confidenceBin
            )
      );

    const calibrationDifference =
      actualRate -
      Number(confidenceBin);

    // Limit calibration correction to ±10 points.
    const correction =
      Math.max(
        -10,
        Math.min(
          10,
          calibrationDifference
        )
      );

    return confidence + correction;
  }

  /**
   * Update confidence of one signal.
   */
  updateSignalConfidence(signal) {

    if (!signal)
      return this.defaultConfidence;

    signal.confidence =
      this.calculateAdaptiveConfidence(
        signal
      );

    return signal.confidence;
  }

  /**
   * Refresh confidence of all unresolved signals.
   */
  refreshPendingConfidence() {

    this.data.history
      .filter(
        signal =>
          !signal.outcome
      )
      .forEach(signal => {

        signal.confidence =
          this.calculateAdaptiveConfidence(
            signal
          );

      });

    this.confidenceData.updatedAt =
      new Date().toISOString();

    return true;
  }

  // =====================================================
  // Phase 4 Pattern Weighting
  // =====================================================

  /**
   * Return the learned multiplier for a pattern.
   */
  getPatternWeight(patternName) {

    if (!patternName)
      return 1;

    const storedWeight =
      Number(
        this.data.patternWeights[
          patternName
        ]
      );

    if (
      !Number.isFinite(
        storedWeight
      )
    ) {
      return 1;
    }

    return Math.max(
      this.minPatternWeight,
      Math.min(
        this.maxPatternWeight,
        storedWeight
      )
    );
  }

  /**
   * Learn safe pattern weights from historical
   * decayed win rates and sample reliability.
   */
  updatePatternWeights() {

    const newWeights = {};

    for (
      const patternName in
      this.data.patternStats
    ) {

      const stats =
        this.data.patternStats[
          patternName
        ];

      const resolved =
        stats.decayedTotal ??
        stats.resolved ??
        stats.total ??
        0;

      const winRate =
        stats.decayedWinRate ??
        stats.winRate ??
        stats.accuracy ??
        50;

      if (
        resolved <
        this.minSamples
      ) {
        newWeights[
          patternName
        ] = 1;

        continue;
      }

      const reliability =
        Math.min(
          1,
          resolved / 50
        );

      const performanceDifference =
        (winRate - 50) / 100;

      const rawWeight =
        1 +
        performanceDifference *
        reliability;

      newWeights[
        patternName
      ] = Number(
        Math.max(
          this.minPatternWeight,
          Math.min(
            this.maxPatternWeight,
            rawWeight
          )
        ).toFixed(3)
      );
    }

    this.data.patternWeights = {
      ...this.data.patternWeights,
      ...newWeights
    };

    return {
      ...this.data.patternWeights
    };
  }

  // =====================================================
  // Phase 4 Pattern Blacklisting
  // =====================================================

  /**
   * Automatically blacklist patterns that have
   * enough evidence and persistently poor results.
   */
  updatePatternBlacklist() {

    const blacklist = {};

    for (
      const patternName in
      this.data.patternStats
    ) {

      const stats =
        this.data.patternStats[
          patternName
        ];

      const resolved =
        stats.resolved ??
        stats.total ??
        0;

      const winRate =
        stats.decayedWinRate ??
        stats.winRate ??
        stats.accuracy ??
        50;

      if (
        resolved >=
          this.blacklistMinSignals &&
        winRate <
          this.blacklistWinRate
      ) {

        blacklist[
          patternName
        ] = {
          blacklisted: true,
          winRate:
            Number(
              winRate.toFixed(2)
            ),
          sampleSize:
            resolved,
          reason:
            "Historical performance below minimum threshold",
          updatedAt:
            new Date().toISOString()
        };
      }
    }

    this.data.blacklistedPatterns =
      blacklist;

    return {
      ...blacklist
    };
  }

  /**
   * Check whether a pattern is currently blacklisted.
   */
  isPatternBlacklisted(
    patternName
  ) {

    if (!patternName)
      return false;

    const blacklistData =
      this.data.blacklistedPatterns[
        patternName
      ];

    return Boolean(
      blacklistData &&
      blacklistData.blacklisted
    );
  }

  /**
   * Return blacklist information for dashboards.
   */
  getBlacklistedPatterns() {

    return {
      ...this.data.blacklistedPatterns
    };
  }

  // =====================================================
  // AI Performance Optimization Engine
  // =====================================================

  optimizePerformance() {

    const optimization = {

      bestPattern: null,
      weakestPattern: null,

      bestPair: null,
      weakestPair: null,

      bestTimeframe: null,
      weakestTimeframe: null,

      bestRegime: null,
      weakestRegime: null,

      suggestions: []

    };

    if (!this.data.stats)
      return optimization;

    let highest = -1;
    let lowest = 101;

    // Exact pattern setup ranking
    for (
      const key in
      this.data.stats
    ) {

      const stat =
        this.data.stats[key];

      const resolved =
        stat.resolved ??
        stat.total ??
        0;

      if (resolved < 3)
        continue;

      const accuracy =
        stat.decayedWinRate ??
        stat.accuracy ??
        0;

      if (accuracy > highest) {

        highest = accuracy;

        optimization.bestPattern =
          key;
      }

      if (accuracy < lowest) {

        lowest = accuracy;

        optimization.weakestPattern =
          key;
      }
    }

    // Pair ranking
    highest = -1;
    lowest = 101;

    for (
      const pair in
      this.data.pairStats
    ) {

      const stat =
        this.data.pairStats[pair];

      const resolved =
        stat.resolved ??
        stat.total ??
        0;

      if (resolved < 3)
        continue;

      const rate =
        stat.decayedWinRate ??
        stat.winRate ??
        stat.accuracy ??
        0;

      if (rate > highest) {

        highest = rate;

        optimization.bestPair =
          pair;
      }

      if (rate < lowest) {

        lowest = rate;

        optimization.weakestPair =
          pair;
      }
    }

    // Timeframe ranking
    highest = -1;
    lowest = 101;

    for (
      const timeframe in
      this.data.timeframeStats
    ) {

      const stat =
        this.data.timeframeStats[
          timeframe
        ];

      const resolved =
        stat.resolved ??
        stat.total ??
        0;

      if (resolved < 3)
        continue;

      const rate =
        stat.decayedWinRate ??
        stat.winRate ??
        stat.accuracy ??
        0;

      if (rate > highest) {

        highest = rate;

        optimization.bestTimeframe =
          timeframe;
      }

      if (rate < lowest) {

        lowest = rate;

        optimization.weakestTimeframe =
          timeframe;
      }
    }

    // Market regime ranking
    highest = -1;
    lowest = 101;

    for (
      const regime in
      this.data.regimeStats
    ) {

      const stat =
        this.data.regimeStats[
          regime
        ];

      const resolved =
        stat.resolved ??
        stat.total ??
        0;

      if (resolved < 3)
        continue;

      const rate =
        stat.decayedWinRate ??
        stat.winRate ??
        stat.accuracy ??
        0;

      if (rate > highest) {

        highest = rate;

        optimization.bestRegime =
          regime;
      }

      if (rate < lowest) {

        lowest = rate;

        optimization.weakestRegime =
          regime;
      }
    }

    // Optimization suggestions
    if (
      optimization.bestPattern
    ) {
      optimization.suggestions.push(
        `Focus on ${optimization.bestPattern}`
      );
    }

    if (
      optimization.bestPair
    ) {
      optimization.suggestions.push(
        `${optimization.bestPair} currently performs best`
      );
    }

    if (
      optimization.bestTimeframe
    ) {
      optimization.suggestions.push(
        `Highest accuracy timeframe: ${optimization.bestTimeframe}`
      );
    }

    if (
      optimization.bestRegime
    ) {
      optimization.suggestions.push(
        `Best market regime: ${optimization.bestRegime}`
      );
    }

    if (
      optimization.weakestPattern
    ) {
      optimization.suggestions.push(
        `Review ${optimization.weakestPattern}`
      );
    }

    const blacklisted =
      Object.keys(
        this.data.blacklistedPatterns
      );

    if (blacklisted.length > 0) {
      optimization.suggestions.push(
        `Avoid blacklisted patterns: ${blacklisted.join(", ")}`
      );
    }

    optimization.generatedAt =
      new Date().toISOString();

    this.data.optimization =
      optimization;

    return optimization;
  }

  /**
   * Get Best Performing Pattern
   */
  getBestPattern() {

    let best = null;
    let highest = 0;

    const patternStats =
      this.data.patternStats || {};

    for (
      const patternName in
      patternStats
    ) {

      const stat =
        patternStats[
          patternName
        ];

      const resolved =
        stat.resolved ??
        stat.total ??
        0;

      if (resolved < 3)
        continue;

      const accuracy =
        stat.decayedWinRate ??
        stat.winRate ??
        stat.accuracy ??
        0;

      if (accuracy > highest) {

        highest = accuracy;

        best = patternName;
      }
    }

    // Backward-compatible fallback to exact stats.
    if (!best) {

      for (
        const key in
        this.data.stats
      ) {

        const stat =
          this.data.stats[key];

        const resolved =
          stat.resolved ??
          stat.total ??
          0;

        if (resolved < 3)
          continue;

        const accuracy =
          stat.decayedWinRate ??
          stat.accuracy ??
          0;

        if (accuracy > highest) {

          highest = accuracy;

          best = key;
        }
      }
    }

    return {

      pattern: best,

      accuracy:
        Number(
          highest.toFixed(2)
        )

    };
  }

  /**
   * Overall Learning Trend
   */
  getPerformanceTrend() {

    const resolved =
      this.data.history.filter(
        signal =>
          signal.outcome
      );

    if (
      resolved.length < 20
    ) {
      return "insufficient-data";
    }

    const recent =
      resolved.slice(-20);

    const previous =
      resolved.slice(
        -40,
        -20
      );

    if (
      previous.length === 0
    ) {
      return "insufficient-data";
    }

    const recentRate =
      (
        recent.filter(
          signal =>
            signal.outcome === "WIN"
        ).length /
        recent.length
      ) * 100;

    const previousRate =
      (
        previous.filter(
          signal =>
            signal.outcome === "WIN"
        ).length /
        previous.length
      ) * 100;

    const difference =
      recentRate -
      previousRate;

    if (difference > 10)
      return "improving";

    if (difference < -10)
      return "declining";

    return "stable";
  }

  /**
   * AI Recommendation Engine
   */
  getRecommendation() {

    const bestPattern =
      this.getBestPattern();

    const trend =
      this.getPerformanceTrend();

    const optimization =
      this.optimizePerformance();

    return {

      bestPattern:
        bestPattern.pattern,

      bestAccuracy:
        bestPattern.accuracy,

      trend,

      optimization,

      recommendation:
        this.generateRecommendation(
          bestPattern,
          trend
        )

    };
  }

  /**
   * Generate AI Trading Recommendation
   */
  generateRecommendation(
    bestPattern,
    trend
  ) {

    const recommendations = [];

    if (
      bestPattern.pattern
    ) {

      recommendations.push(
        `Prioritize ${bestPattern.pattern} (${bestPattern.accuracy.toFixed(1)}% accuracy)`
      );
    }

    if (
      trend === "improving"
    ) {

      recommendations.push(
        "Learning performance is improving."
      );
    }

    else if (
      trend === "declining"
    ) {

      recommendations.push(
        "Performance is declining. Reduce trade frequency."
      );
    }

    const overall =
      this.getOverallStats();

    if (
      overall.winRate >= 70
    ) {

      recommendations.push(
        "High confidence trading conditions."
      );
    }

    else if (
      overall.winRate < 50 &&
      overall.resolvedSignals >=
        this.minSamples
    ) {

      recommendations.push(
        "Overall accuracy is low. Wait for stronger confirmations."
      );
    }

    const blacklisted =
      Object.keys(
        this.data.blacklistedPatterns ||
        {}
      );

    if (
      blacklisted.length > 0
    ) {

      recommendations.push(
        `Avoid blacklisted patterns: ${blacklisted.join(", ")}`
      );
    }

    if (
      recommendations.length === 0
    ) {

      recommendations.push(
        "Insufficient learning data."
      );
    }

    return recommendations;
  }

  /**
   * Overall Learning Statistics
   */
  getOverallStats() {

    const resolved =
      this.data.history.filter(
        signal =>
          signal.outcome === "WIN" ||
          signal.outcome === "LOSS"
      );

    const wins =
      resolved.filter(
        signal =>
          signal.outcome === "WIN"
      ).length;

    const losses =
      resolved.filter(
        signal =>
          signal.outcome === "LOSS"
      ).length;

    const total =
      resolved.length;

    const pending =
      this.data.history.filter(
        signal =>
          !signal.outcome
      ).length;

    return {

      totalSignals:
        this.data.history.length,

      resolvedSignals:
        total,

      wins,

      losses,

      pending,

      winRate:
        total > 0
          ? Number(
              (
                wins /
                total *
                100
              ).toFixed(2)
            )
          : 0,

      lossRate:
        total > 0
          ? Number(
              (
                losses /
                total *
                100
              ).toFixed(2)
            )
          : 0

    };
  }

  /**
   * Dashboard Confidence Data
   */
  getDashboardData() {

    return {

      overall:
        this.getOverallStats(),

      trend:
        this.getPerformanceTrend(),

      recommendation:
        this.getRecommendation(),

      bestPattern:
        this.getBestPattern(),

      confidence:
        this.getConfidenceData(),

      patternStats:
        this.data.patternStats,

      pairStats:
        this.data.pairStats,

      timeframeStats:
        this.data.timeframeStats,

      regimeStats:
        this.data.regimeStats,

      contextEdgeStats:
        this.data.contextEdgeStats,

      patternRegimeStats:
        this.data.patternRegimeStats,

      patternSessionStats:
        this.data.patternSessionStats,

      strategyStateContextStats:
        this.data.strategyStateContextStats,

      patternDirectionStateStats:
        this.data.patternDirectionStateStats,

      patternStateStats:
        this.data.patternStateStats,

      patternWeights:
        this.data.patternWeights,

      blacklistedPatterns:
        this.getBlacklistedPatterns(),

      calibration:
        this.data.calibration,

      finalConfidenceCalibration:
        this.data.finalConfidenceCalibration,

      patternEvolution:
        this.data.patternEvolution,

      updatedAt:
        new Date().toISOString()

    };
  }

  /**
   * Live contextual economic-edge veto.
   *
   * Evidence is selected from the most specific statistically mature
   * bucket available, then falls back hierarchically:
   *
   * 1. pattern + pair + timeframe + regime + session
   * 2. pattern + pair + timeframe
   * 3. pattern + regime
   * 4. pattern + session
   * 5. pattern
   *
   * Every bucket must independently satisfy the existing minSamples
   * requirement before it may control a live decision. This prevents a
   * tiny contextual sample from overriding mature broader evidence while
   * still allowing regime/session-specific edge to take authority once it
   * has enough resolved R outcomes.
   */
  getEconomicEdge(signal) {

    const patternName =
      signal?.pattern ||
      "Unknown";

    const pair =
      signal?.pair ||
      "UNKNOWN";

    const timeframe =
      signal?.timeframe ||
      "UNKNOWN";

    const marketRegime =
      signal?.marketRegime ||
      signal?.regime ||
      "UNKNOWN";

    const session =
      signal?.session ||
      "UNKNOWN";

    const exactKey =
      `${patternName}_${pair}_${timeframe}`;

    const contextKey =
      [
        patternName,
        pair,
        timeframe,
        marketRegime,
        session
      ].join("::");

    const patternRegimeKey =
      [
        patternName,
        marketRegime
      ].join("::");

    const patternSessionKey =
      [
        patternName,
        session
      ].join("::");

    const evidenceCandidates = [
      {
        source:
          "EXACT_PATTERN_PAIR_TIMEFRAME_REGIME_SESSION",
        stats:
          this.data.contextEdgeStats?.[
            contextKey
          ] || null
      },
      {
        source:
          "EXACT_PATTERN_PAIR_TIMEFRAME",
        stats:
          this.data.stats?.[
            exactKey
          ] || null
      },
      {
        source:
          "PATTERN_REGIME",
        stats:
          this.data.patternRegimeStats?.[
            patternRegimeKey
          ] || null
      },
      {
        source:
          "PATTERN_SESSION",
        stats:
          this.data.patternSessionStats?.[
            patternSessionKey
          ] || null
      },
      {
        source:
          "PATTERN_FALLBACK",
        stats:
          this.data.patternStats?.[
            patternName
          ] || null
      }
    ];

    const hasEvidence = stats =>
      Number(
        stats?.edgeSamples ||
        0
      ) >= this.minSamples;

    const selectedEvidence =
      evidenceCandidates.find(
        candidate =>
          hasEvidence(
            candidate.stats
          )
      ) || null;

    if (!selectedEvidence) {
      const availableSamples =
        Math.max(
          0,
          ...evidenceCandidates.map(
            candidate =>
              Number(
                candidate.stats
                  ?.edgeSamples ||
                0
              )
          )
        );

      return {
        eligible: true,
        status:
          "LIVE_BOOTSTRAP",
        reason:
          `economic edge requires ${this.minSamples} resolved R samples; ${availableSamples} available`,
        source: null,
        sampleSize:
          availableSamples,
        requiredSamples:
          this.minSamples,
        expectancyR: null,
        decayedExpectancyR: null,
        profitFactor: null,
        profitFactorInfinite: false,
        context: {
          pattern:
            patternName,
          pair,
          timeframe,
          marketRegime,
          session
        }
      };
    }

    const stats =
      selectedEvidence.stats;

    const source =
      selectedEvidence.source;

    const expectancyR =
      Number(
        stats.expectancyR
      );

    const decayedExpectancyR =
      Number(
        stats.decayedExpectancyR
      );

    const profitFactorInfinite =
      Boolean(
        stats.profitFactorInfinite
      );

    const profitFactor =
      profitFactorInfinite
        ? Number.POSITIVE_INFINITY
        : Number(
            stats.profitFactor
          );

    const negativeEdge =
      Number.isFinite(
        expectancyR
      ) &&
      expectancyR <= 0 &&
      Number.isFinite(
        decayedExpectancyR
      ) &&
      decayedExpectancyR <= 0 &&
      !profitFactorInfinite &&
      Number.isFinite(
        profitFactor
      ) &&
      profitFactor < 1;

    return {
      eligible:
        !negativeEdge,
      status:
        negativeEdge
          ? "LIVE_EDGE_VETO"
          : "LIVE_EDGE_PASS",
      reason:
        negativeEdge
          ? `negative economic edge (${source}): expectancy ${expectancyR.toFixed(4)}R, decayed ${decayedExpectancyR.toFixed(4)}R, profit factor ${profitFactor.toFixed(4)}`
          : `economic edge passed from ${source} with ${stats.edgeSamples} R samples`,
      source,
      sampleSize:
        Number(
          stats.edgeSamples ||
          0
        ),
      requiredSamples:
        this.minSamples,
      expectancyR,
      decayedExpectancyR,
      profitFactor:
        profitFactorInfinite
          ? null
          : profitFactor,
      profitFactorInfinite,
      context: {
        pattern:
          patternName,
        pair,
        timeframe,
        marketRegime,
        session
      }
    };
  }

  /**
   * Direct-LIVE advanced market-state strategy authority.
   *
   * This is deliberately data-driven rather than a hard-coded pattern/regime
   * opinion table. A pattern/direction is allowed or vetoed only after the
   * existing minimum sample requirement is met in market-state-specific
   * realized-R history. Until then the normal live pipeline remains active.
   *
   * Evidence hierarchy:
   * 1. pattern + direction + pair + timeframe + marketState + session
   * 2. pattern + direction + marketState
   * 3. pattern + marketState
   */
  getStrategyMarketAuthority(signal) {

    const patternName =
      signal?.pattern ||
      "Unknown";

    const direction =
      String(
        signal?.direction ||
        "UNKNOWN"
      ).toUpperCase();

    const pair =
      signal?.pair ||
      "UNKNOWN";

    const timeframe =
      signal?.timeframe ||
      "UNKNOWN";

    const marketState =
      signal?.marketState?.state ||
      signal?.advancedMarketState ||
      signal?.marketState ||
      "UNKNOWN";

    const session =
      signal?.session ||
      "UNKNOWN";

    const exactContextKey =
      [
        patternName,
        direction,
        pair,
        timeframe,
        marketState,
        session
      ].join("::");

    const directionStateKey =
      [
        patternName,
        direction,
        marketState
      ].join("::");

    const patternStateKey =
      [
        patternName,
        marketState
      ].join("::");

    const evidenceCandidates = [
      {
        source:
          "EXACT_PATTERN_DIRECTION_PAIR_TIMEFRAME_STATE_SESSION",
        stats:
          this.data.strategyStateContextStats?.[
            exactContextKey
          ] || null
      },
      {
        source:
          "PATTERN_DIRECTION_STATE",
        stats:
          this.data.patternDirectionStateStats?.[
            directionStateKey
          ] || null
      },
      {
        source:
          "PATTERN_STATE",
        stats:
          this.data.patternStateStats?.[
            patternStateKey
          ] || null
      }
    ];

    const hasEvidence = stats =>
      Number(
        stats?.edgeSamples ||
        0
      ) >= this.minSamples;

    const selectedEvidence =
      evidenceCandidates.find(
        candidate =>
          hasEvidence(
            candidate.stats
          )
      ) || null;

    if (!selectedEvidence) {
      const availableSamples =
        Math.max(
          0,
          ...evidenceCandidates.map(
            candidate =>
              Number(
                candidate.stats
                  ?.edgeSamples ||
                0
              )
          )
        );

      return {
        eligible: true,
        status:
          "LIVE_STRATEGY_STATE_BOOTSTRAP",
        reason:
          `strategy-state authority requires ${this.minSamples} resolved R samples; ${availableSamples} available`,
        source: null,
        sampleSize:
          availableSamples,
        requiredSamples:
          this.minSamples,
        expectancyR: null,
        decayedExpectancyR: null,
        profitFactor: null,
        profitFactorInfinite: false,
        context: {
          pattern:
            patternName,
          direction,
          pair,
          timeframe,
          marketState,
          session
        }
      };
    }

    const stats =
      selectedEvidence.stats;

    const source =
      selectedEvidence.source;

    const expectancyR =
      Number(
        stats.expectancyR
      );

    const decayedExpectancyR =
      Number(
        stats.decayedExpectancyR
      );

    const profitFactorInfinite =
      Boolean(
        stats.profitFactorInfinite
      );

    const profitFactor =
      profitFactorInfinite
        ? Number.POSITIVE_INFINITY
        : Number(
            stats.profitFactor
          );

    const negativeEdge =
      Number.isFinite(
        expectancyR
      ) &&
      expectancyR <= 0 &&
      Number.isFinite(
        decayedExpectancyR
      ) &&
      decayedExpectancyR <= 0 &&
      !profitFactorInfinite &&
      Number.isFinite(
        profitFactor
      ) &&
      profitFactor < 1;

    return {
      eligible:
        !negativeEdge,
      status:
        negativeEdge
          ? "LIVE_STRATEGY_STATE_VETO"
          : "LIVE_STRATEGY_STATE_PASS",
      reason:
        negativeEdge
          ? `negative strategy-state edge (${source}): expectancy ${expectancyR.toFixed(4)}R, decayed ${decayedExpectancyR.toFixed(4)}R, profit factor ${profitFactor.toFixed(4)}`
          : `strategy-state edge passed from ${source} with ${stats.edgeSamples} R samples`,
      source,
      sampleSize:
        Number(
          stats.edgeSamples ||
          0
        ),
      requiredSamples:
        this.minSamples,
      expectancyR,
      decayedExpectancyR,
      profitFactor:
        profitFactorInfinite
          ? null
          : profitFactor,
      profitFactorInfinite,
      context: {
        pattern:
          patternName,
        direction,
        pair,
        timeframe,
        marketState,
        session
      }
    };
  }

  /**
   * Direct-LIVE strategy degradation kill-switch.
   *
   * Uses only resolved local learning history. No market-data request,
   * provider call or external API access is performed here.
   *
   * A degradation veto requires BOTH:
   * - a statistically mature older baseline with positive economic edge; and
   * - a full recent performance window with negative economic edge.
   *
   * Existing configuration supplies all sample requirements:
   * - baseline minimum = minSamples
   * - recent window = performanceWindow
   *
   * Evidence hierarchy mirrors the live strategy-state authority and then
   * falls back to the whole pattern only when more-specific groups do not
   * contain enough resolved R observations.
   */
  getStrategyDegradationAuthority(signal) {

    const patternName =
      signal?.pattern ||
      "Unknown";

    const direction =
      String(
        signal?.direction ||
        "UNKNOWN"
      ).toUpperCase();

    const pair =
      signal?.pair ||
      "UNKNOWN";

    const timeframe =
      signal?.timeframe ||
      "UNKNOWN";

    const marketState =
      signal?.marketState?.state ||
      signal?.advancedMarketState ||
      signal?.marketState ||
      "UNKNOWN";

    const session =
      signal?.session ||
      "UNKNOWN";

    const requiredRecentSamples =
      this.performanceWindow;

    const requiredBaselineSamples =
      this.minSamples;

    const requiredTotalSamples =
      requiredRecentSamples +
      requiredBaselineSamples;

    const realizedRValue = item => {
      const value =
        Number(
          item?.realizedR ??
          item?.performance?.realizedR ??
          item?.learningFeedback?.realizedR
        );

      return Number.isFinite(value)
        ? value
        : null;
    };

    const normalizedMarketState = item =>
      item?.marketState?.state ||
      item?.advancedMarketState ||
      item?.marketState ||
      "UNKNOWN";

    const resolvedTime = (item, index) => {
      const raw =
        item?.resolvedAt ||
        item?.closedAt ||
        item?.updatedAt ||
        item?.timestamp ||
        item?.createdAt ||
        null;

      let parsed = NaN;

      if (
        typeof raw === "number" &&
        Number.isFinite(raw)
      ) {
        parsed =
          raw < 10_000_000_000
            ? raw * 1000
            : raw;
      } else if (
        typeof raw === "string" &&
        /^\d+$/.test(raw.trim())
      ) {
        const numeric =
          Number(raw);

        parsed =
          Number.isFinite(numeric)
            ? (
                numeric < 10_000_000_000
                  ? numeric * 1000
                  : numeric
              )
            : NaN;
      } else if (raw != null) {
        parsed =
          new Date(raw).getTime();
      }

      return Number.isFinite(parsed)
        ? parsed
        : index;
    };

    const history =
      Array.isArray(this.data.history)
        ? this.data.history
        : [];

    // Build and chronologically sort the finite-R history once. Candidate
    // evidence groups are filtered from this local array, avoiding repeated
    // sorting while keeping the live gate completely network-free.
    const resolvedREntries =
      history
        .map((item, index) => ({
          item,
          index,
          realizedR:
            realizedRValue(item)
        }))
        .filter(entry =>
          entry.item &&
          entry.realizedR !== null
        )
        .sort((a, b) =>
          resolvedTime(a.item, a.index) -
          resolvedTime(b.item, b.index)
        );

    const withFiniteR = predicate =>
      resolvedREntries.filter(
        entry =>
          predicate(entry.item)
      );

    const evidenceCandidates = [
      {
        source:
          "EXACT_PATTERN_DIRECTION_PAIR_TIMEFRAME_STATE_SESSION",
        entries:
          withFiniteR(item =>
            (item.pattern || "Unknown") === patternName &&
            String(item.direction || "UNKNOWN").toUpperCase() === direction &&
            (item.pair || "UNKNOWN") === pair &&
            (item.timeframe || "UNKNOWN") === timeframe &&
            normalizedMarketState(item) === marketState &&
            (item.session || "UNKNOWN") === session
          )
      },
      {
        source:
          "PATTERN_DIRECTION_STATE",
        entries:
          withFiniteR(item =>
            (item.pattern || "Unknown") === patternName &&
            String(item.direction || "UNKNOWN").toUpperCase() === direction &&
            normalizedMarketState(item) === marketState
          )
      },
      {
        source:
          "PATTERN_STATE",
        entries:
          withFiniteR(item =>
            (item.pattern || "Unknown") === patternName &&
            normalizedMarketState(item) === marketState
          )
      },
      {
        source:
          "PATTERN_FALLBACK",
        entries:
          withFiniteR(item =>
            (item.pattern || "Unknown") === patternName
          )
      }
    ];

    const selectedEvidence =
      evidenceCandidates.find(
        candidate =>
          candidate.entries.length >=
          requiredTotalSamples
      ) || null;

    if (!selectedEvidence) {
      const availableSamples =
        Math.max(
          0,
          ...evidenceCandidates.map(
            candidate =>
              candidate.entries.length
          )
        );

      return {
        eligible: true,
        status:
          "LIVE_DEGRADATION_BOOTSTRAP",
        reason:
          `degradation authority requires ${requiredBaselineSamples} baseline + ${requiredRecentSamples} recent resolved R samples; ${availableSamples} available`,
        source: null,
        sampleSize:
          availableSamples,
        requiredBaselineSamples,
        requiredRecentSamples,
        requiredTotalSamples,
        baseline: null,
        recent: null,
        context: {
          pattern:
            patternName,
          direction,
          pair,
          timeframe,
          marketState,
          session
        }
      };
    }

    const entries =
      selectedEvidence.entries;

    const splitIndex =
      entries.length -
      requiredRecentSamples;

    const baselineEntries =
      entries.slice(0, splitIndex);

    const recentEntries =
      entries.slice(splitIndex);

    const calculateMetrics = entriesToMeasure => {
      let totalR = 0;
      let grossProfitR = 0;
      let grossLossR = 0;
      let weightedR = 0;
      let totalWeight = 0;

      for (const entry of entriesToMeasure) {
        const realizedR =
          entry.realizedR;

        totalR += realizedR;

        if (realizedR > 0) {
          grossProfitR += realizedR;
        } else if (realizedR < 0) {
          grossLossR +=
            Math.abs(realizedR);
        }

        const weight =
          this.getTimeDecayWeight(
            entry.item
          );

        weightedR +=
          realizedR * weight;

        totalWeight +=
          weight;
      }

      const sampleSize =
        entriesToMeasure.length;

      const expectancyR =
        sampleSize > 0
          ? totalR / sampleSize
          : 0;

      const decayedExpectancyR =
        totalWeight > 0
          ? weightedR / totalWeight
          : 0;

      const profitFactorInfinite =
        grossLossR === 0 &&
        grossProfitR > 0;

      const profitFactor =
        grossLossR > 0
          ? grossProfitR / grossLossR
          : (
              grossProfitR > 0
                ? null
                : 0
            );

      return {
        sampleSize,
        totalR:
          Number(totalR.toFixed(4)),
        expectancyR:
          Number(expectancyR.toFixed(4)),
        decayedExpectancyR:
          Number(
            decayedExpectancyR
              .toFixed(4)
          ),
        grossProfitR:
          Number(grossProfitR.toFixed(4)),
        grossLossR:
          Number(grossLossR.toFixed(4)),
        profitFactor:
          profitFactorInfinite
            ? null
            : Number(
                profitFactor.toFixed(4)
              ),
        profitFactorInfinite,
        firstResolvedAt:
          entriesToMeasure[0]
            ?.item?.resolvedAt ||
          entriesToMeasure[0]
            ?.item?.closedAt ||
          entriesToMeasure[0]
            ?.item?.updatedAt ||
          entriesToMeasure[0]
            ?.item?.timestamp ||
          null,
        lastResolvedAt:
          entriesToMeasure[
            entriesToMeasure.length - 1
          ]?.item?.resolvedAt ||
          entriesToMeasure[
            entriesToMeasure.length - 1
          ]?.item?.closedAt ||
          entriesToMeasure[
            entriesToMeasure.length - 1
          ]?.item?.updatedAt ||
          entriesToMeasure[
            entriesToMeasure.length - 1
          ]?.item?.timestamp ||
          null
      };
    };

    const baseline =
      calculateMetrics(
        baselineEntries
      );

    const recent =
      calculateMetrics(
        recentEntries
      );

    const baselineProfitFactor =
      baseline.profitFactorInfinite
        ? Number.POSITIVE_INFINITY
        : Number(
            baseline.profitFactor
          );

    const recentProfitFactor =
      recent.profitFactorInfinite
        ? Number.POSITIVE_INFINITY
        : Number(
            recent.profitFactor
          );

    const baselinePositive =
      Number.isFinite(
        baseline.expectancyR
      ) &&
      baseline.expectancyR > 0 &&
      (
        baseline.profitFactorInfinite ||
        (
          Number.isFinite(
            baselineProfitFactor
          ) &&
          baselineProfitFactor >= 1
        )
      );

    const recentNegative =
      Number.isFinite(
        recent.expectancyR
      ) &&
      recent.expectancyR <= 0 &&
      Number.isFinite(
        recent.decayedExpectancyR
      ) &&
      recent.decayedExpectancyR <= 0 &&
      !recent.profitFactorInfinite &&
      Number.isFinite(
        recentProfitFactor
      ) &&
      recentProfitFactor < 1;

    const degraded =
      baselinePositive &&
      recentNegative;

    return {
      eligible:
        !degraded,
      status:
        degraded
          ? "LIVE_DEGRADATION_KILL_SWITCH"
          : "LIVE_DEGRADATION_PASS",
      reason:
        degraded
          ? `strategy degraded (${selectedEvidence.source}): mature baseline expectancy ${baseline.expectancyR.toFixed(4)}R / PF ${baseline.profitFactorInfinite ? "Infinity" : baselineProfitFactor.toFixed(4)} versus recent ${recent.sampleSize}-trade expectancy ${recent.expectancyR.toFixed(4)}R, decayed ${recent.decayedExpectancyR.toFixed(4)}R / PF ${recentProfitFactor.toFixed(4)}`
          : `strategy degradation check passed from ${selectedEvidence.source}; baseline ${baseline.sampleSize} and recent ${recent.sampleSize} resolved R samples`,
      source:
        selectedEvidence.source,
      sampleSize:
        entries.length,
      requiredBaselineSamples,
      requiredRecentSamples,
      requiredTotalSamples,
      baselinePositive,
      recentNegative,
      baseline,
      recent,
      context: {
        pattern:
          patternName,
        direction,
        pair,
        timeframe,
        marketState,
        session
      }
    };
  }

  /**
   * Direct-LIVE sequential out-of-sample stability authority.
   *
   * This is a prequential/live-history stability check, not a synthetic
   * backtest and not a parameter search. Every observation was a real
   * historical signal whose outcome became known only after publication.
   *
   * The method preserves chronological order and uses only existing local
   * resolved-R history. It performs no market-data request, provider call,
   * external API access or parameter optimization.
   *
   * Existing configuration supplies every sample requirement:
   * - initial prior-history requirement = minSamples
   * - OOS horizon = performanceWindow
   * - OOS fold size = minSamples
   *
   * With the current production configuration this means 10 prior resolved
   * R observations followed by the latest 20 observations evaluated as two
   * non-overlapping 10-trade OOS folds. A direct-live veto requires BOTH OOS
   * folds to have negative economic edge using the same mathematical
   * break-even conditions as the existing economic-edge authorities:
   * expectancy <= 0R, decayed expectancy <= 0R and profit factor < 1.
   *
   * Evidence hierarchy mirrors the strategy-state/degradation authorities.
   */
  getSequentialOOSStabilityAuthority(signal) {

    const patternName =
      signal?.pattern ||
      "Unknown";

    const direction =
      String(
        signal?.direction ||
        "UNKNOWN"
      ).toUpperCase();

    const pair =
      signal?.pair ||
      "UNKNOWN";

    const timeframe =
      signal?.timeframe ||
      "UNKNOWN";

    const marketState =
      signal?.marketState?.state ||
      signal?.advancedMarketState ||
      signal?.marketState ||
      "UNKNOWN";

    const session =
      signal?.session ||
      "UNKNOWN";

    const priorSamples =
      this.minSamples;

    const oosWindow =
      this.performanceWindow;

    const foldSize =
      this.minSamples;

    const foldCount =
      Math.floor(
        oosWindow /
        foldSize
      );

    const requiredTotalSamples =
      priorSamples +
      oosWindow;

    // A meaningful sequential OOS check requires at least two complete
    // non-overlapping OOS folds. This is derived from existing production
    // configuration rather than introducing a new trading threshold.
    if (
      !Number.isFinite(foldCount) ||
      foldCount < 2 ||
      oosWindow % foldSize !== 0
    ) {
      return {
        eligible: true,
        status:
          "LIVE_SEQUENTIAL_OOS_NOT_CONFIGURED",
        reason:
          "sequential OOS authority requires performanceWindow to contain at least two complete minSamples folds",
        source: null,
        sampleSize: 0,
        priorSamples,
        oosWindow,
        foldSize,
        foldCount,
        requiredTotalSamples,
        folds: [],
        context: {
          pattern:
            patternName,
          direction,
          pair,
          timeframe,
          marketState,
          session
        }
      };
    }

    const realizedRValue = item => {
      const value =
        Number(
          item?.realizedR ??
          item?.performance?.realizedR ??
          item?.learningFeedback?.realizedR
        );

      return Number.isFinite(value)
        ? value
        : null;
    };

    const normalizedMarketState = item =>
      item?.marketState?.state ||
      item?.advancedMarketState ||
      item?.marketState ||
      "UNKNOWN";

    const resolvedTime = (item, index) => {
      const raw =
        item?.resolvedAt ||
        item?.closedAt ||
        item?.updatedAt ||
        item?.timestamp ||
        item?.createdAt ||
        null;

      let parsed = NaN;

      if (
        typeof raw === "number" &&
        Number.isFinite(raw)
      ) {
        parsed =
          raw < 10_000_000_000
            ? raw * 1000
            : raw;
      } else if (
        typeof raw === "string" &&
        /^\d+$/.test(raw.trim())
      ) {
        const numeric =
          Number(raw);

        parsed =
          Number.isFinite(numeric)
            ? (
                numeric < 10_000_000_000
                  ? numeric * 1000
                  : numeric
              )
            : NaN;
      } else if (raw != null) {
        parsed =
          new Date(raw).getTime();
      }

      return Number.isFinite(parsed)
        ? parsed
        : index;
    };

    const history =
      Array.isArray(this.data.history)
        ? this.data.history
        : [];

    const resolvedREntries =
      history
        .map((item, index) => ({
          item,
          index,
          realizedR:
            realizedRValue(item)
        }))
        .filter(entry =>
          entry.item &&
          entry.realizedR !== null
        )
        .sort((a, b) =>
          resolvedTime(a.item, a.index) -
          resolvedTime(b.item, b.index)
        );

    const withFiniteR = predicate =>
      resolvedREntries.filter(
        entry =>
          predicate(entry.item)
      );

    const evidenceCandidates = [
      {
        source:
          "EXACT_PATTERN_DIRECTION_PAIR_TIMEFRAME_STATE_SESSION",
        entries:
          withFiniteR(item =>
            (item.pattern || "Unknown") === patternName &&
            String(item.direction || "UNKNOWN").toUpperCase() === direction &&
            (item.pair || "UNKNOWN") === pair &&
            (item.timeframe || "UNKNOWN") === timeframe &&
            normalizedMarketState(item) === marketState &&
            (item.session || "UNKNOWN") === session
          )
      },
      {
        source:
          "PATTERN_DIRECTION_STATE",
        entries:
          withFiniteR(item =>
            (item.pattern || "Unknown") === patternName &&
            String(item.direction || "UNKNOWN").toUpperCase() === direction &&
            normalizedMarketState(item) === marketState
          )
      },
      {
        source:
          "PATTERN_STATE",
        entries:
          withFiniteR(item =>
            (item.pattern || "Unknown") === patternName &&
            normalizedMarketState(item) === marketState
          )
      },
      {
        source:
          "PATTERN_FALLBACK",
        entries:
          withFiniteR(item =>
            (item.pattern || "Unknown") === patternName
          )
      }
    ];

    const selectedEvidence =
      evidenceCandidates.find(
        candidate =>
          candidate.entries.length >=
          requiredTotalSamples
      ) || null;

    if (!selectedEvidence) {
      const availableSamples =
        Math.max(
          0,
          ...evidenceCandidates.map(
            candidate =>
              candidate.entries.length
          )
        );

      return {
        eligible: true,
        status:
          "LIVE_SEQUENTIAL_OOS_BOOTSTRAP",
        reason:
          `sequential OOS authority requires ${priorSamples} prior + ${oosWindow} OOS resolved R samples; ${availableSamples} available`,
        source: null,
        sampleSize:
          availableSamples,
        priorSamples,
        oosWindow,
        foldSize,
        foldCount,
        requiredTotalSamples,
        folds: [],
        context: {
          pattern:
            patternName,
          direction,
          pair,
          timeframe,
          marketState,
          session
        }
      };
    }

    const entries =
      selectedEvidence.entries;

    // Only the latest configured OOS horizon is judged. All observations
    // before it are strictly earlier prior-history evidence and are never
    // mixed into an OOS fold.
    const oosStart =
      entries.length -
      oosWindow;

    const priorEntries =
      entries.slice(0, oosStart);

    const oosEntries =
      entries.slice(oosStart);

    const calculateMetrics = entriesToMeasure => {
      let totalR = 0;
      let grossProfitR = 0;
      let grossLossR = 0;
      let weightedR = 0;
      let totalWeight = 0;

      for (const entry of entriesToMeasure) {
        const realizedR =
          entry.realizedR;

        totalR += realizedR;

        if (realizedR > 0) {
          grossProfitR += realizedR;
        } else if (realizedR < 0) {
          grossLossR +=
            Math.abs(realizedR);
        }

        const weight =
          this.getTimeDecayWeight(
            entry.item
          );

        weightedR +=
          realizedR * weight;

        totalWeight +=
          weight;
      }

      const sampleSize =
        entriesToMeasure.length;

      const expectancyR =
        sampleSize > 0
          ? totalR / sampleSize
          : 0;

      const decayedExpectancyR =
        totalWeight > 0
          ? weightedR / totalWeight
          : 0;

      const profitFactorInfinite =
        grossLossR === 0 &&
        grossProfitR > 0;

      const profitFactor =
        grossLossR > 0
          ? grossProfitR / grossLossR
          : (
              grossProfitR > 0
                ? null
                : 0
            );

      return {
        sampleSize,
        totalR:
          Number(totalR.toFixed(4)),
        expectancyR:
          Number(expectancyR.toFixed(4)),
        decayedExpectancyR:
          Number(
            decayedExpectancyR
              .toFixed(4)
          ),
        grossProfitR:
          Number(grossProfitR.toFixed(4)),
        grossLossR:
          Number(grossLossR.toFixed(4)),
        profitFactor:
          profitFactorInfinite
            ? null
            : Number(
                profitFactor.toFixed(4)
              ),
        profitFactorInfinite,
        firstResolvedAt:
          entriesToMeasure[0]
            ?.item?.resolvedAt ||
          entriesToMeasure[0]
            ?.item?.closedAt ||
          entriesToMeasure[0]
            ?.item?.updatedAt ||
          entriesToMeasure[0]
            ?.item?.timestamp ||
          null,
        lastResolvedAt:
          entriesToMeasure[
            entriesToMeasure.length - 1
          ]?.item?.resolvedAt ||
          entriesToMeasure[
            entriesToMeasure.length - 1
          ]?.item?.closedAt ||
          entriesToMeasure[
            entriesToMeasure.length - 1
          ]?.item?.updatedAt ||
          entriesToMeasure[
            entriesToMeasure.length - 1
          ]?.item?.timestamp ||
          null
      };
    };

    const isNegativeEdge = metrics => {
      const profitFactor =
        metrics.profitFactorInfinite
          ? Number.POSITIVE_INFINITY
          : Number(
              metrics.profitFactor
            );

      return (
        Number.isFinite(
          metrics.expectancyR
        ) &&
        metrics.expectancyR <= 0 &&
        Number.isFinite(
          metrics.decayedExpectancyR
        ) &&
        metrics.decayedExpectancyR <= 0 &&
        !metrics.profitFactorInfinite &&
        Number.isFinite(
          profitFactor
        ) &&
        profitFactor < 1
      );
    };

    const folds = [];

    for (
      let foldIndex = 0;
      foldIndex < foldCount;
      foldIndex++
    ) {
      const start =
        foldIndex * foldSize;

      const end =
        start + foldSize;

      const metrics =
        calculateMetrics(
          oosEntries.slice(
            start,
            end
          )
        );

      folds.push({
        fold:
          foldIndex + 1,
        ...metrics,
        negativeEdge:
          isNegativeEdge(metrics)
      });
    }

    const allOOSFoldsNegative =
      folds.length === foldCount &&
      folds.every(
        fold =>
          fold.negativeEdge === true
      );

    const prior =
      calculateMetrics(
        priorEntries
      );

    return {
      eligible:
        !allOOSFoldsNegative,
      status:
        allOOSFoldsNegative
          ? "LIVE_SEQUENTIAL_OOS_VETO"
          : "LIVE_SEQUENTIAL_OOS_PASS",
      reason:
        allOOSFoldsNegative
          ? `sequential OOS instability (${selectedEvidence.source}): all ${foldCount} non-overlapping ${foldSize}-trade OOS folds have negative economic edge`
          : `sequential OOS stability check passed from ${selectedEvidence.source}; ${foldCount} non-overlapping OOS folds evaluated after ${prior.sampleSize} prior observations`,
      source:
        selectedEvidence.source,
      sampleSize:
        entries.length,
      priorSamples,
      oosWindow,
      foldSize,
      foldCount,
      requiredTotalSamples,
      prior,
      folds,
      negativeFoldCount:
        folds.filter(
          fold =>
            fold.negativeEdge
        ).length,
      context: {
        pattern:
          patternName,
        direction,
        pair,
        timeframe,
        marketState,
        session
      }
    };
  }

  /**
   * AI Signal Filter
   */
  shouldTrade(signal) {

    const confidence =
      this.calculateAdaptiveConfidence(
        signal
      );

    const patternBlacklisted =
      this.isPatternBlacklisted(
        signal
          ? signal.pattern
          : null
      );

    const execute =
      confidence >=
        this.actionableThreshold &&
      !patternBlacklisted;

    let reason =
      execute
        ? "Confidence passed"
        : "Confidence below threshold";

    if (
      patternBlacklisted
    ) {
      reason =
        "Pattern is blacklisted due to poor historical performance";
    }

    return {

      execute,

      confidence,

      threshold:
        this.actionableThreshold,

      patternBlacklisted,

      reason

    };
  }

  /**
   * Auto Cleanup Engine
   */
  cleanupHistory(
    maxRecords =
      this.maxHistory
  ) {

    if (
      !this.data.history
    ) {
      return 0;
    }

    if (
      this.data.history.length >
      maxRecords
    ) {

      this.data.history =
        this.data.history.slice(
          -maxRecords
        );
    }

    return (
      this.data.history.length
    );
  }

  /**
   * Export Learning Backup
   */
  exportLearning() {

    return {

      history:
        this.data.history,

      stats:
        this.data.stats,

      patternStats:
        this.data.patternStats,

      pairStats:
        this.data.pairStats,

      timeframeStats:
        this.data.timeframeStats,

      regimeStats:
        this.data.regimeStats,

      contextEdgeStats:
        this.data.contextEdgeStats,

      patternRegimeStats:
        this.data.patternRegimeStats,

      patternSessionStats:
        this.data.patternSessionStats,

      strategyStateContextStats:
        this.data.strategyStateContextStats,

      patternDirectionStateStats:
        this.data.patternDirectionStateStats,

      patternStateStats:
        this.data.patternStateStats,

      patternWeights:
        this.data.patternWeights,

      calibration:
        this.data.calibration,

      finalConfidenceCalibration:
        this.data.finalConfidenceCalibration,

      patternEvolution:
        this.data.patternEvolution,

      blacklistedPatterns:
        this.data.blacklistedPatterns,

      optimization:
        this.data.optimization,

      confidence:
        this.confidenceData,

      exportedAt:
        new Date().toISOString(),

      version:
        "4.8.2"

    };
  }

  /**
   * Restore Learning Backup
   */
  importLearning(data) {

    if (!data)
      return false;

    this.data.history =
      Array.isArray(
        data.history
      )
        ? data.history
        : [];

    this.data.stats =
      data.stats || {};

    this.data.patternStats =
      data.patternStats || {};

    this.data.pairStats =
      data.pairStats || {};

    this.data.timeframeStats =
      data.timeframeStats || {};

    this.data.regimeStats =
      data.regimeStats || {};

    this.data.contextEdgeStats =
      data.contextEdgeStats || {};

    this.data.patternRegimeStats =
      data.patternRegimeStats || {};

    this.data.patternSessionStats =
      data.patternSessionStats || {};

    this.data.strategyStateContextStats =
      data.strategyStateContextStats || {};

    this.data.patternDirectionStateStats =
      data.patternDirectionStateStats || {};

    this.data.patternStateStats =
      data.patternStateStats || {};

    this.data.patternWeights =
      data.patternWeights || {};

    this.data.calibration =
      data.calibration || {};

    this.data.finalConfidenceCalibration =
      data.finalConfidenceCalibration || {};

    this.data.patternEvolution =
      data.patternEvolution || {};

    this.data.blacklistedPatterns =
      data.blacklistedPatterns || {};

    this.data.optimization =
      data.optimization || {};

    this.confidenceData =
      data.confidence || {
        patterns: {},
        updatedAt:
          new Date().toISOString()
      };

    this.reconcileTerminalLifecycleHistory();

    this.cleanupHistory();

    this.updatePatternStats();

    return true;
  }

  /**
   * Reset AI Learning
   */
  resetLearning() {

    this.data.history = [];

    this.data.stats = {};

    this.data.patternStats = {};

    this.data.pairStats = {};

    this.data.timeframeStats = {};

    this.data.regimeStats = {};

    this.data.contextEdgeStats = {};

    this.data.patternRegimeStats = {};

    this.data.patternSessionStats = {};

    this.data.strategyStateContextStats = {};

    this.data.patternDirectionStateStats = {};

    this.data.patternStateStats = {};

    this.data.patternWeights = {};

    this.data.calibration = {};

    this.data.finalConfidenceCalibration = {};

    this.data.patternEvolution = {};

    this.data.blacklistedPatterns = {};

    this.data.optimization = {};

    this.data.lastLearningUpdate = null;

    this.confidenceData.patterns = {};

    this.confidenceData.updatedAt =
      new Date().toISOString();

    return true;
  }

  /**
   * Learning Engine Health
   */
  getHealthStatus() {

    const overall =
      this.getOverallStats();

    const resolved =
      overall.resolvedSignals;

    let learningStatus =
      "COLLECTING_DATA";

    if (
      resolved >=
      this.minSamples
    ) {
      learningStatus =
        "LEARNING";
    }

    if (
      resolved >= 100
    ) {
      learningStatus =
        "OPTIMIZED";
    }

    return {

      engine:
        "AI Pattern Recognition",

      status:
        "ONLINE",

      learningStatus,

      totalSignals:
        overall.totalSignals,

      resolved,

      winRate:
        overall.winRate,

      trend:
        this.getPerformanceTrend(),

      bestPattern:
        this.getBestPattern(),

      blacklistedPatterns:
        Object.keys(
          this.data.blacklistedPatterns ||
          {}
        ).length,

      updated:
        new Date().toISOString()

    };
  }

  /**
   * Version
   */
  getVersion() {

    return {

      engine:
        "Pattern Recognition AI",

      version:
        "4.8.2",

      learning:
        true,

      riskAdjustedTrendMomentum:
        true,

      liveEconomicEdge:
        true,

      contextualEconomicEdge:
        true,

      liveStrategyStateAuthority:
        true,

      liveStrategyDegradationKillSwitch:
        true,

      decisionTimeConfidenceProvenance:
        true,

      stageCorrectConfidenceCalibration:
        true,

      liveConfidenceReliabilityAuthority:
        true,

      lockedSampleStatisticalAuthority:
        true,

      liveSequentialOOSStabilityAuthority:
        true,

      terminalLifecycleSynchronization:
        true,

      terminalLifecycleSelfHealing:
        true,

      adaptiveConfidence:
        true,

      optimization:
        true,

      recommendation:
        true,

      weightedLearning:
        true,

      confidenceCalibration:
        true,

      marketRegimeLearning:
        true,

      patternEvolution:
        true,

      automaticBlacklisting:
        true

    };
  }

  /**
   * Save confidence snapshot
   */
  saveConfidenceSnapshot() {

    this.confidenceData.patterns =
      this.getConfidenceData();

    this.confidenceData.updatedAt =
      new Date().toISOString();

    this.confidenceData.overall =
      this.getOverallStats();

    this.confidenceData.patternWeights = {
      ...this.data.patternWeights
    };

    this.confidenceData.blacklistedPatterns = {
      ...this.data.blacklistedPatterns
    };

    return this.confidenceData;
  }

  /**
   * Get historical confidence for a pattern.
   */
  getPatternConfidence(
    patternName,
    pair,
    timeframe
  ) {

    const key =
      `${patternName}_${pair}_${timeframe}`;

    const saved =
      this.confidenceData.patterns[
        key
      ];

    if (
      saved &&
      Number.isFinite(
        Number(saved.confidence)
      )
    ) {
      return Number(
        saved.confidence
      );
    }

    const stats =
      this.data.stats[key];

    if (stats) {

      const accuracy =
        stats.decayedWinRate ??
        stats.accuracy ??
        this.defaultConfidence;

      return Math.round(
        Math.max(
          this.minConfidence,
          Math.min(
            this.maxConfidence,
            accuracy *
              this.getPatternWeight(
                patternName
              )
          )
        )
      );
    }

    return this.defaultConfidence;
  }

  /**
   * Convert an optional numeric field without treating null/empty values
   * as a real zero. This is required for immutable confidence provenance:
   * Number(null) and Number("") would otherwise create false samples.
   */
  toOptionalFiniteNumber(value) {

    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      return NaN;
    }

    const number =
      Number(value);

    return Number.isFinite(number)
      ? number
      : NaN;
  }

  // =====================================================
  // History Management
  // =====================================================

  /**
   * Update learning history with new signals.
   */
  updateHistory(newSignals) {

    if (
      !Array.isArray(
        newSignals
      )
    ) {
      return false;
    }

    if (!this.data.history)
      this.data.history = [];

    if (!this.data.stats)
      this.data.stats = {};

    for (
      const signal of
      newSignals
    ) {

      if (!signal)
        continue;

      const signalId =
        signal.id ||
        signal.timestamp;

      const exists =
        this.data.history.find(
          historicalSignal => {

            const historicalId =
              historicalSignal.id ||
              historicalSignal.timestamp;

            return (
              signalId &&
              historicalId ===
                signalId
            );
          }
        );

      if (exists)
        continue;

      const signalOutcome =
        signal.outcome || null;

      const providedDecisionAdaptive =
        this.toOptionalFiniteNumber(
          signal.decisionAdaptiveConfidence
        );

      const providedDecisionFinal =
        this.toOptionalFiniteNumber(
          signal.decisionFinalAIConfidence
        );

      const adaptiveAtIngest =
        this.toOptionalFiniteNumber(
          signal.adaptiveConfidence
        );

      const finalAtIngest =
        this.toOptionalFiniteNumber(
          signal.finalAIConfidence ??
          signal.confidence
        );

      const mayLockAtIngest =
        !signalOutcome;

      const decisionAdaptiveConfidence =
        Number.isFinite(
          providedDecisionAdaptive
        )
          ? providedDecisionAdaptive
          : (
              mayLockAtIngest &&
              Number.isFinite(
                adaptiveAtIngest
              )
                ? adaptiveAtIngest
                : null
            );

      const decisionFinalAIConfidence =
        Number.isFinite(
          providedDecisionFinal
        )
          ? providedDecisionFinal
          : (
              mayLockAtIngest &&
              Number.isFinite(
                finalAtIngest
              )
                ? finalAtIngest
                : null
            );

      const confidenceProvenance =
        signal.confidenceProvenance ||
        (
          decisionAdaptiveConfidence !== null ||
          decisionFinalAIConfidence !== null
            ? "LOCKED_AT_INGEST"
            : "LEGACY_RESOLVED_UNAVAILABLE"
        );

      this.data.history.push({

        ...signal,

        decisionAdaptiveConfidence,

        decisionFinalAIConfidence,

        confidenceProvenance,

        decisionConfidenceCapturedAt:
          signal.decisionConfidenceCapturedAt ||
          signal.createdAt ||
          signal.timestamp ||
          signal.addedAt ||
          new Date().toISOString(),

        addedAt:
          signal.addedAt ||
          new Date().toISOString(),

        outcome:
          signalOutcome

      });
    }

    this.cleanupHistory(
      this.maxHistory
    );

    this.updatePatternStats();

    this.data.lastLearningUpdate =
      new Date().toISOString();

    return true;
  }

  /**
   * Record one signal while preserving
   * the existing updateHistory API.
   */
  recordSignal(signal) {

    if (!signal)
      return false;

    return this.updateHistory([
      signal
    ]);
  }

  // =====================================================
  // Phase 4 Weighted Statistics Engine
  // =====================================================

  /**
   * Calculate time-decay weight for one signal.
   *
   * New signals receive weight close to 1.
   * Older signals gradually receive less influence.
   */
  getTimeDecayWeight(signal) {

    const rawDate =
      signal.resolvedAt ||
      signal.closedAt ||
      signal.updatedAt ||
      signal.addedAt ||
      signal.createdAt ||
      signal.timestamp;

    if (!rawDate)
      return 1;

    const date =
      new Date(rawDate);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return 1;
    }

    const ageMilliseconds =
      Math.max(
        0,
        Date.now() -
        date.getTime()
      );

    const ageDays =
      ageMilliseconds /
      (
        1000 *
        60 *
        60 *
        24
      );

    const halfLife =
      Math.max(
        1,
        this.decayFactorDays
      );

    return Math.pow(
      0.5,
      ageDays / halfLife
    );
  }

  /**
   * Create a blank aggregate statistics object.
   */
  createEmptyStats() {

    return {

      total: 0,

      resolved: 0,

      wins: 0,

      losses: 0,

      accuracy:
        this.defaultConfidence,

      winRate:
        this.defaultConfidence,

      decayedWins: 0,

      decayedLosses: 0,

      decayedTotal: 0,

      decayedWinRate:
        this.defaultConfidence,

      trend:
        "stable",

      averageConfidence: 0,

      confidenceTotal: 0,

      edgeSamples: 0,

      totalRealizedR: 0,

      grossProfitR: 0,

      grossLossR: 0,

      expectancyR: 0,

      weightedRealizedR: 0,

      edgeWeight: 0,

      decayedExpectancyR: 0,

      profitFactor: 0,

      profitFactorInfinite: false,

      lastUpdated: null

    };
  }

  /**
   * Add one signal to an aggregate stats object.
   */
  addSignalToStats(
    stats,
    signal
  ) {

    stats.total++;

    const confidence =
      Number(
        signal.confidence
      );

    if (
      Number.isFinite(
        confidence
      )
    ) {

      stats.confidenceTotal +=
        confidence;

      stats.averageConfidence =
        stats.confidenceTotal /
        stats.total;
    }

    const realizedR =
      Number(
        signal.realizedR ??
        signal.performance?.realizedR ??
        signal.learningFeedback?.realizedR
      );

    if (
      Number.isFinite(
        realizedR
      )
    ) {
      stats.edgeSamples++;

      stats.totalRealizedR +=
        realizedR;

      if (realizedR > 0) {
        stats.grossProfitR +=
          realizedR;
      } else if (realizedR < 0) {
        stats.grossLossR +=
          Math.abs(realizedR);
      }

      const edgeDecayWeight =
        this.getTimeDecayWeight(
          signal
        );

      stats.weightedRealizedR +=
        realizedR *
        edgeDecayWeight;

      stats.edgeWeight +=
        edgeDecayWeight;

      stats.expectancyR =
        stats.edgeSamples > 0
          ? stats.totalRealizedR /
            stats.edgeSamples
          : 0;

      stats.decayedExpectancyR =
        stats.edgeWeight > 0
          ? stats.weightedRealizedR /
            stats.edgeWeight
          : 0;

      stats.profitFactorInfinite =
        stats.grossLossR === 0 &&
        stats.grossProfitR > 0;

      stats.profitFactor =
        stats.grossLossR > 0
          ? stats.grossProfitR /
            stats.grossLossR
          : (
              stats.grossProfitR > 0
                ? null
                : 0
            );
    }

    if (
      signal.outcome !== "WIN" &&
      signal.outcome !== "LOSS"
    ) {
      return;
    }

    stats.resolved++;

    const decayWeight =
      this.getTimeDecayWeight(
        signal
      );

    if (
      signal.outcome === "WIN"
    ) {

      stats.wins++;

      stats.decayedWins +=
        decayWeight;
    }

    else {

      stats.losses++;

      stats.decayedLosses +=
        decayWeight;
    }

    stats.decayedTotal =
      stats.decayedWins +
      stats.decayedLosses;

    stats.accuracy =
      stats.resolved > 0
        ? (
            stats.wins /
            stats.resolved
          ) * 100
        : this.defaultConfidence;

    stats.winRate =
      stats.accuracy;

    stats.decayedWinRate =
      stats.decayedTotal > 0
        ? (
            stats.decayedWins /
            stats.decayedTotal
          ) * 100
        : this.defaultConfidence;

    stats.lastUpdated =
      new Date().toISOString();
  }

  /**
   * Calculate recent aggregate trend.
   */
  calculateStatsTrend(
    matchingHistory,
    historicalRate
  ) {

    const resolved =
      matchingHistory.filter(
        signal =>
          signal.outcome === "WIN" ||
          signal.outcome === "LOSS"
      );

    if (
      resolved.length < 5
    ) {
      return "stable";
    }

    const recent =
      resolved.slice(-5);

    const recentWins =
      recent.filter(
        signal =>
          signal.outcome === "WIN"
      ).length;

    const recentRate =
      (
        recentWins /
        recent.length
      ) * 100;

    if (
      recentRate >
      historicalRate + 10
    ) {
      return "improving";
    }

    if (
      recentRate <
      historicalRate - 10
    ) {
      return "declining";
    }

    return "stable";
  }

  /**
   * Rebuild all learning aggregates from history.
   */
  updatePatternStats() {

    const exactStats = {};
    const patternStats = {};
    const pairStats = {};
    const timeframeStats = {};
    const regimeStats = {};
    const contextEdgeStats = {};
    const patternRegimeStats = {};
    const patternSessionStats = {};
    const strategyStateContextStats = {};
    const patternDirectionStateStats = {};
    const patternStateStats = {};

    const exactHistory = {};
    const patternHistory = {};
    const pairHistory = {};
    const timeframeHistory = {};
    const regimeHistory = {};
    const contextEdgeHistory = {};
    const patternRegimeHistory = {};
    const patternSessionHistory = {};
    const strategyStateContextHistory = {};
    const patternDirectionStateHistory = {};
    const patternStateHistory = {};

    for (
      const signal of
      this.data.history
    ) {

      if (!signal)
        continue;

      const pattern =
        signal.pattern ||
        "Unknown";

      const pair =
        signal.pair ||
        "UNKNOWN";

      const timeframe =
        signal.timeframe ||
        "UNKNOWN";

      const regime =
        signal.marketRegime ||
        signal.regime ||
        "UNKNOWN";

      const session =
        signal.session ||
        "UNKNOWN";

      const direction =
        String(
          signal.direction ||
          "UNKNOWN"
        ).toUpperCase();

      const marketState =
        signal.marketState?.state ||
        signal.advancedMarketState ||
        signal.marketState ||
        "UNKNOWN";

      const exactKey =
        `${pattern}_${pair}_${timeframe}`;

      const contextEdgeKey =
        [
          pattern,
          pair,
          timeframe,
          regime,
          session
        ].join("::");

      const patternRegimeKey =
        [
          pattern,
          regime
        ].join("::");

      const patternSessionKey =
        [
          pattern,
          session
        ].join("::");

      const strategyStateContextKey =
        [
          pattern,
          direction,
          pair,
          timeframe,
          marketState,
          session
        ].join("::");

      const patternDirectionStateKey =
        [
          pattern,
          direction,
          marketState
        ].join("::");

      const patternStateKey =
        [
          pattern,
          marketState
        ].join("::");

      if (!exactStats[exactKey])
        exactStats[exactKey] =
          this.createEmptyStats();

      if (!patternStats[pattern])
        patternStats[pattern] =
          this.createEmptyStats();

      if (!pairStats[pair])
        pairStats[pair] =
          this.createEmptyStats();

      if (!timeframeStats[timeframe])
        timeframeStats[timeframe] =
          this.createEmptyStats();

      if (!regimeStats[regime])
        regimeStats[regime] =
          this.createEmptyStats();

      if (!contextEdgeStats[
        contextEdgeKey
      ]) {
        contextEdgeStats[
          contextEdgeKey
        ] =
          this.createEmptyStats();
      }

      if (!patternRegimeStats[
        patternRegimeKey
      ]) {
        patternRegimeStats[
          patternRegimeKey
        ] =
          this.createEmptyStats();
      }

      if (!patternSessionStats[
        patternSessionKey
      ]) {
        patternSessionStats[
          patternSessionKey
        ] =
          this.createEmptyStats();
      }

      if (!strategyStateContextStats[
        strategyStateContextKey
      ]) {
        strategyStateContextStats[
          strategyStateContextKey
        ] =
          this.createEmptyStats();
      }

      if (!patternDirectionStateStats[
        patternDirectionStateKey
      ]) {
        patternDirectionStateStats[
          patternDirectionStateKey
        ] =
          this.createEmptyStats();
      }

      if (!patternStateStats[
        patternStateKey
      ]) {
        patternStateStats[
          patternStateKey
        ] =
          this.createEmptyStats();
      }

      this.addSignalToStats(
        exactStats[exactKey],
        signal
      );

      this.addSignalToStats(
        patternStats[pattern],
        signal
      );

      this.addSignalToStats(
        pairStats[pair],
        signal
      );

      this.addSignalToStats(
        timeframeStats[timeframe],
        signal
      );

      this.addSignalToStats(
        regimeStats[regime],
        signal
      );

      this.addSignalToStats(
        contextEdgeStats[
          contextEdgeKey
        ],
        signal
      );

      this.addSignalToStats(
        patternRegimeStats[
          patternRegimeKey
        ],
        signal
      );

      this.addSignalToStats(
        patternSessionStats[
          patternSessionKey
        ],
        signal
      );

      this.addSignalToStats(
        strategyStateContextStats[
          strategyStateContextKey
        ],
        signal
      );

      this.addSignalToStats(
        patternDirectionStateStats[
          patternDirectionStateKey
        ],
        signal
      );

      this.addSignalToStats(
        patternStateStats[
          patternStateKey
        ],
        signal
      );

      if (!exactHistory[exactKey])
        exactHistory[exactKey] = [];

      if (!patternHistory[pattern])
        patternHistory[pattern] = [];

      if (!pairHistory[pair])
        pairHistory[pair] = [];

      if (!timeframeHistory[timeframe])
        timeframeHistory[timeframe] = [];

      if (!regimeHistory[regime])
        regimeHistory[regime] = [];

      if (!contextEdgeHistory[
        contextEdgeKey
      ]) {
        contextEdgeHistory[
          contextEdgeKey
        ] = [];
      }

      if (!patternRegimeHistory[
        patternRegimeKey
      ]) {
        patternRegimeHistory[
          patternRegimeKey
        ] = [];
      }

      if (!patternSessionHistory[
        patternSessionKey
      ]) {
        patternSessionHistory[
          patternSessionKey
        ] = [];
      }

      if (!strategyStateContextHistory[
        strategyStateContextKey
      ]) {
        strategyStateContextHistory[
          strategyStateContextKey
        ] = [];
      }

      if (!patternDirectionStateHistory[
        patternDirectionStateKey
      ]) {
        patternDirectionStateHistory[
          patternDirectionStateKey
        ] = [];
      }

      if (!patternStateHistory[
        patternStateKey
      ]) {
        patternStateHistory[
          patternStateKey
        ] = [];
      }

      exactHistory[exactKey].push(
        signal
      );

      patternHistory[pattern].push(
        signal
      );

      pairHistory[pair].push(
        signal
      );

      timeframeHistory[
        timeframe
      ].push(signal);

      regimeHistory[regime].push(
        signal
      );

      contextEdgeHistory[
        contextEdgeKey
      ].push(signal);

      patternRegimeHistory[
        patternRegimeKey
      ].push(signal);

      patternSessionHistory[
        patternSessionKey
      ].push(signal);

      strategyStateContextHistory[
        strategyStateContextKey
      ].push(signal);

      patternDirectionStateHistory[
        patternDirectionStateKey
      ].push(signal);

      patternStateHistory[
        patternStateKey
      ].push(signal);
    }

    const applyTrends =
      (
        statistics,
        historyGroups
      ) => {

        for (
          const key in
          statistics
        ) {

          const stat =
            statistics[key];

          stat.trend =
            this.calculateStatsTrend(
              historyGroups[key] ||
              [],
              stat.decayedWinRate ??
              stat.accuracy
            );

          stat.accuracy =
            Number(
              stat.accuracy.toFixed(2)
            );

          stat.winRate =
            Number(
              stat.winRate.toFixed(2)
            );

          stat.decayedWins =
            Number(
              stat.decayedWins.toFixed(4)
            );

          stat.decayedLosses =
            Number(
              stat.decayedLosses.toFixed(4)
            );

          stat.decayedTotal =
            Number(
              stat.decayedTotal.toFixed(4)
            );

          stat.decayedWinRate =
            Number(
              stat.decayedWinRate.toFixed(2)
            );

          stat.averageConfidence =
            Number(
              stat.averageConfidence.toFixed(2)
            );

          stat.totalRealizedR =
            Number(
              stat.totalRealizedR.toFixed(4)
            );

          stat.grossProfitR =
            Number(
              stat.grossProfitR.toFixed(4)
            );

          stat.grossLossR =
            Number(
              stat.grossLossR.toFixed(4)
            );

          stat.expectancyR =
            Number(
              stat.expectancyR.toFixed(4)
            );

          stat.weightedRealizedR =
            Number(
              stat.weightedRealizedR.toFixed(4)
            );

          stat.edgeWeight =
            Number(
              stat.edgeWeight.toFixed(4)
            );

          stat.decayedExpectancyR =
            Number(
              stat.decayedExpectancyR.toFixed(4)
            );

          if (
            Number.isFinite(
              stat.profitFactor
            )
          ) {
            stat.profitFactor =
              Number(
                stat.profitFactor.toFixed(4)
              );
          }

          delete stat.confidenceTotal;
        }
      };

    applyTrends(
      exactStats,
      exactHistory
    );

    applyTrends(
      patternStats,
      patternHistory
    );

    applyTrends(
      pairStats,
      pairHistory
    );

    applyTrends(
      timeframeStats,
      timeframeHistory
    );

    applyTrends(
      regimeStats,
      regimeHistory
    );

    applyTrends(
      contextEdgeStats,
      contextEdgeHistory
    );

    applyTrends(
      patternRegimeStats,
      patternRegimeHistory
    );

    applyTrends(
      patternSessionStats,
      patternSessionHistory
    );

    applyTrends(
      strategyStateContextStats,
      strategyStateContextHistory
    );

    applyTrends(
      patternDirectionStateStats,
      patternDirectionStateHistory
    );

    applyTrends(
      patternStateStats,
      patternStateHistory
    );

    this.data.stats =
      exactStats;

    this.data.patternStats =
      patternStats;

    this.data.pairStats =
      pairStats;

    this.data.timeframeStats =
      timeframeStats;

    this.data.regimeStats =
      regimeStats;

    this.data.contextEdgeStats =
      contextEdgeStats;

    this.data.patternRegimeStats =
      patternRegimeStats;

    this.data.patternSessionStats =
      patternSessionStats;

    this.data.strategyStateContextStats =
      strategyStateContextStats;

    this.data.patternDirectionStateStats =
      patternDirectionStateStats;

    this.data.patternStateStats =
      patternStateStats;

    this.updateConfidenceCalibration();

    this.updateFinalConfidenceCalibration();

    this.updatePatternWeights();

    this.updatePatternBlacklist();

    this.updatePatternEvolution();

    this.data.lastLearningUpdate =
      new Date().toISOString();

    return this.data.stats;
  }

  // =====================================================
  // Phase 4 Confidence Calibration
  // =====================================================

  /**
   * Build calibration bins from resolved signals.
   *
   * Example:
   * Predicted confidence 70–74 is grouped into bin 70.
   * The actual win rate is then compared with the prediction.
   */
  updateConfidenceCalibration() {

    const calibration = {};

    for (
      const signal of
      this.data.history
    ) {

      if (
        !signal ||
        (
          signal.outcome !== "WIN" &&
          signal.outcome !== "LOSS"
        )
      ) {
        continue;
      }

      const lockedAdaptiveConfidence =
        this.toOptionalFiniteNumber(
          signal.decisionAdaptiveConfidence
        );

      const storedAdaptiveConfidence =
        this.toOptionalFiniteNumber(
          signal.adaptiveConfidence
        );

      /*
       * Calibration feeds calculateAdaptiveConfidence(), so it must be
       * built from the adaptive-confidence stage that existed when the
       * trade decision was made. Published Phase-6 confidence belongs to
       * a different stage and is calibrated separately below.
       */
      const rawConfidence =
        Number.isFinite(
          lockedAdaptiveConfidence
        )
          ? lockedAdaptiveConfidence
          : (
              Number.isFinite(
                storedAdaptiveConfidence
              )
                ? storedAdaptiveConfidence
                : Number(
                    signal.confidence ??
                    signal.aiConfidence ??
                    this.defaultConfidence
                  )
            );

      if (
        !Number.isFinite(
          rawConfidence
        )
      ) {
        continue;
      }

      const normalizedConfidence =
        Math.max(
          this.minConfidence,
          Math.min(
            this.maxConfidence,
            rawConfidence
          )
        );

      const bin =
        String(
          Math.round(
            normalizedConfidence / 5
          ) * 5
        );

      if (!calibration[bin]) {

        calibration[bin] = {

          total: 0,

          wins: 0,

          losses: 0,

          predictedConfidence:
            Number(bin),

          actualRate:
            Number(bin),

          calibrationError: 0,

          brierScore: 0,

          lockedSamples: 0,

          lockedWins: 0,

          lockedLosses: 0,

          lockedPredictedConfidence: null,

          lockedActualRate: null,

          lockedCalibrationError: null,

          lockedBrierScore: null,

          legacySamples: 0,

          legacyWins: 0,

          legacyLosses: 0,

          confidenceTotal: 0,

          brierTotal: 0,

          lockedConfidenceTotal: 0,

          lockedBrierTotal: 0,

          lastUpdated: null

        };
      }

      const bucket =
        calibration[bin];

      bucket.total++;

      bucket.confidenceTotal +=
        normalizedConfidence;

      const lockedSample =
        Number.isFinite(
          lockedAdaptiveConfidence
        );

      if (lockedSample) {
        bucket.lockedSamples++;
        bucket.lockedConfidenceTotal +=
          normalizedConfidence;
      } else {
        bucket.legacySamples++;
      }

      const outcomeValue =
        signal.outcome === "WIN"
          ? 1
          : 0;

      if (outcomeValue === 1) {
        bucket.wins++;
        if (lockedSample) {
          bucket.lockedWins++;
        } else {
          bucket.legacyWins++;
        }
      } else {
        bucket.losses++;
        if (lockedSample) {
          bucket.lockedLosses++;
        } else {
          bucket.legacyLosses++;
        }
      }

      const probability =
        normalizedConfidence / 100;

      const brierComponent =
        Math.pow(
          probability - outcomeValue,
          2
        );

      bucket.brierTotal +=
        brierComponent;

      if (lockedSample) {
        bucket.lockedBrierTotal +=
          brierComponent;
      }

      bucket.actualRate =
        (
          bucket.wins /
          bucket.total
        ) * 100;

      bucket.predictedConfidence =
        bucket.confidenceTotal /
        bucket.total;

      bucket.calibrationError =
        bucket.actualRate -
        bucket.predictedConfidence;

      bucket.brierScore =
        bucket.brierTotal /
        bucket.total;

      if (bucket.lockedSamples > 0) {
        bucket.lockedPredictedConfidence =
          bucket.lockedConfidenceTotal /
          bucket.lockedSamples;

        bucket.lockedActualRate =
          (
            bucket.lockedWins /
            bucket.lockedSamples
          ) * 100;

        bucket.lockedCalibrationError =
          bucket.lockedActualRate -
          bucket.lockedPredictedConfidence;

        bucket.lockedBrierScore =
          bucket.lockedBrierTotal /
          bucket.lockedSamples;
      }

      bucket.lastUpdated =
        new Date().toISOString();
    }

    for (
      const bin in
      calibration
    ) {

      calibration[bin].predictedConfidence =
        Number(
          calibration[bin]
            .predictedConfidence
            .toFixed(2)
        );

      calibration[bin].actualRate =
        Number(
          calibration[bin]
            .actualRate
            .toFixed(2)
        );

      calibration[bin]
        .calibrationError =
        Number(
          calibration[bin]
            .calibrationError
            .toFixed(2)
        );

      calibration[bin].brierScore =
        Number(
          calibration[bin]
            .brierScore
            .toFixed(6)
        );

      if (
        Number.isFinite(
          calibration[bin]
            .lockedPredictedConfidence
        )
      ) {
        calibration[bin].lockedPredictedConfidence =
          Number(
            calibration[bin]
              .lockedPredictedConfidence
              .toFixed(2)
          );

        calibration[bin].lockedActualRate =
          Number(
            calibration[bin]
              .lockedActualRate
              .toFixed(2)
          );

        calibration[bin].lockedCalibrationError =
          Number(
            calibration[bin]
              .lockedCalibrationError
              .toFixed(2)
          );

        calibration[bin].lockedBrierScore =
          Number(
            calibration[bin]
              .lockedBrierScore
              .toFixed(6)
          );
      }

      delete calibration[bin]
        .confidenceTotal;

      delete calibration[bin]
        .brierTotal;

      delete calibration[bin]
        .lockedConfidenceTotal;

      delete calibration[bin]
        .lockedBrierTotal;
    }

    this.data.calibration =
      calibration;

    return {
      ...calibration
    };
  }

  /**
   * Build calibration for the separately published Phase-6 confidence.
   * This is diagnostics-only here; the adaptive learner never consumes
   * these bins, preventing forecast-stage leakage.
   */
  updateFinalConfidenceCalibration() {

    const calibration = {};

    for (
      const signal of
      this.data.history
    ) {

      if (
        !signal ||
        (
          signal.outcome !== "WIN" &&
          signal.outcome !== "LOSS"
        )
      ) {
        continue;
      }

      const lockedFinalConfidence =
        this.toOptionalFiniteNumber(
          signal.decisionFinalAIConfidence
        );

      const storedFinalConfidence =
        this.toOptionalFiniteNumber(
          signal.finalAIConfidence
        );

      const rawConfidence =
        Number.isFinite(
          lockedFinalConfidence
        )
          ? lockedFinalConfidence
          : (
              Number.isFinite(
                storedFinalConfidence
              )
                ? storedFinalConfidence
                : NaN
            );

      if (
        !Number.isFinite(
          rawConfidence
        )
      ) {
        continue;
      }

      const normalizedConfidence =
        Math.max(
          0,
          Math.min(
            100,
            rawConfidence
          )
        );

      const bin =
        String(
          Math.round(
            normalizedConfidence / 5
          ) * 5
        );

      if (!calibration[bin]) {
        calibration[bin] = {
          total: 0,
          wins: 0,
          losses: 0,
          predictedConfidence: 0,
          actualRate: 0,
          calibrationError: 0,
          brierScore: 0,
          lockedSamples: 0,
          lockedWins: 0,
          lockedLosses: 0,
          lockedPredictedConfidence: null,
          lockedActualRate: null,
          lockedCalibrationError: null,
          lockedBrierScore: null,
          legacySamples: 0,
          legacyWins: 0,
          legacyLosses: 0,
          confidenceTotal: 0,
          brierTotal: 0,
          lockedConfidenceTotal: 0,
          lockedBrierTotal: 0,
          lastUpdated: null
        };
      }

      const bucket =
        calibration[bin];

      bucket.total++;
      bucket.confidenceTotal +=
        normalizedConfidence;

      const lockedSample =
        Number.isFinite(
          lockedFinalConfidence
        );

      if (lockedSample) {
        bucket.lockedSamples++;
        bucket.lockedConfidenceTotal +=
          normalizedConfidence;
      } else {
        bucket.legacySamples++;
      }

      const outcomeValue =
        signal.outcome === "WIN"
          ? 1
          : 0;

      if (outcomeValue === 1) {
        bucket.wins++;
        if (lockedSample) {
          bucket.lockedWins++;
        } else {
          bucket.legacyWins++;
        }
      } else {
        bucket.losses++;
        if (lockedSample) {
          bucket.lockedLosses++;
        } else {
          bucket.legacyLosses++;
        }
      }

      const probability =
        normalizedConfidence / 100;

      const brierComponent =
        Math.pow(
          probability - outcomeValue,
          2
        );

      bucket.brierTotal +=
        brierComponent;

      if (lockedSample) {
        bucket.lockedBrierTotal +=
          brierComponent;
      }

      bucket.actualRate =
        (
          bucket.wins /
          bucket.total
        ) * 100;

      bucket.predictedConfidence =
        bucket.confidenceTotal /
        bucket.total;

      bucket.calibrationError =
        bucket.actualRate -
        bucket.predictedConfidence;

      bucket.brierScore =
        bucket.brierTotal /
        bucket.total;

      if (bucket.lockedSamples > 0) {
        bucket.lockedPredictedConfidence =
          bucket.lockedConfidenceTotal /
          bucket.lockedSamples;

        bucket.lockedActualRate =
          (
            bucket.lockedWins /
            bucket.lockedSamples
          ) * 100;

        bucket.lockedCalibrationError =
          bucket.lockedActualRate -
          bucket.lockedPredictedConfidence;

        bucket.lockedBrierScore =
          bucket.lockedBrierTotal /
          bucket.lockedSamples;
      }

      bucket.lastUpdated =
        new Date().toISOString();
    }

    for (
      const bin in
      calibration
    ) {
      calibration[bin].predictedConfidence =
        Number(
          calibration[bin]
            .predictedConfidence
            .toFixed(2)
        );

      calibration[bin].actualRate =
        Number(
          calibration[bin]
            .actualRate
            .toFixed(2)
        );

      calibration[bin].calibrationError =
        Number(
          calibration[bin]
            .calibrationError
            .toFixed(2)
        );

      calibration[bin].brierScore =
        Number(
          calibration[bin]
            .brierScore
            .toFixed(6)
        );

      if (
        Number.isFinite(
          calibration[bin]
            .lockedPredictedConfidence
        )
      ) {
        calibration[bin].lockedPredictedConfidence =
          Number(
            calibration[bin]
              .lockedPredictedConfidence
              .toFixed(2)
          );

        calibration[bin].lockedActualRate =
          Number(
            calibration[bin]
              .lockedActualRate
              .toFixed(2)
          );

        calibration[bin].lockedCalibrationError =
          Number(
            calibration[bin]
              .lockedCalibrationError
              .toFixed(2)
          );

        calibration[bin].lockedBrierScore =
          Number(
            calibration[bin]
              .lockedBrierScore
              .toFixed(6)
          );
      }

      delete calibration[bin]
        .confidenceTotal;
      delete calibration[bin]
        .brierTotal;
      delete calibration[bin]
        .lockedConfidenceTotal;
      delete calibration[bin]
        .lockedBrierTotal;
    }

    this.data.finalConfidenceCalibration =
      calibration;

    return {
      ...calibration
    };
  }

  /**
   * Return confidence calibration data.
   */
  getCalibrationData() {

    return {
      ...this.data.calibration
    };
  }

  /**
   * Return published Phase-6 confidence calibration data.
   */
  getFinalConfidenceCalibrationData() {

    return {
      ...this.data.finalConfidenceCalibration
    };
  }

  /**
   * Wilson score interval for a binomial win rate.
   *
   * A two-sided 95% interval is intentionally used as a conservative
   * live-control test: a confidence stage is vetoed only when even the
   * upper bound remains below the existing production confidence floor.
   */
  calculateWilsonConfidenceInterval(
    wins,
    total,
    z = 1.959963984540054
  ) {

    const safeWins =
      Number(wins);

    const safeTotal =
      Number(total);

    if (
      !Number.isFinite(
        safeWins
      ) ||
      !Number.isFinite(
        safeTotal
      ) ||
      safeTotal <= 0 ||
      safeWins < 0 ||
      safeWins > safeTotal
    ) {
      return null;
    }

    const proportion =
      safeWins / safeTotal;

    const zSquared =
      z * z;

    const denominator =
      1 +
      zSquared / safeTotal;

    const center =
      (
        proportion +
        zSquared /
          (2 * safeTotal)
      ) /
      denominator;

    const margin =
      (
        z *
        Math.sqrt(
          (
            proportion *
            (1 - proportion) /
            safeTotal
          ) +
          (
            zSquared /
            (4 * safeTotal * safeTotal)
          )
        )
      ) /
      denominator;

    return {
      lower:
        Math.max(
          0,
          (center - margin) * 100
        ),
      upper:
        Math.min(
          100,
          (center + margin) * 100
        ),
      confidenceLevel: 95
    };
  }

  /**
   * Direct-LIVE confidence reliability authority.
   *
   * Only decision-time locked samples are allowed to veto production.
   * Legacy/mutable confidence observations remain visible in diagnostics
   * but can never become direct-live statistical authority.
   *
   * No arbitrary calibration-error or Brier threshold is introduced.
   * The existing production confidence floor is reused. A stage is vetoed
   * only when the 95% Wilson upper bound for its locked historical win rate
   * is already below that floor.
   */
  getConfidenceReliabilityAuthority({
    stage = "ADAPTIVE",
    confidence,
    minimumRequiredRate =
      this.actionableThreshold
  } = {}) {

    const normalizedStage =
      String(stage || "ADAPTIVE")
        .trim()
        .toUpperCase();

    const finalStage =
      normalizedStage === "FINAL" ||
      normalizedStage === "PHASE6" ||
      normalizedStage === "FINAL_AI";

    const numericConfidence =
      Number(confidence);

    const requiredRate =
      Number(
        minimumRequiredRate
      );

    if (
      !Number.isFinite(
        numericConfidence
      ) ||
      !Number.isFinite(
        requiredRate
      )
    ) {
      return {
        eligible: false,
        status:
          "LIVE_CONFIDENCE_RELIABILITY_INVALID",
        reason:
          "confidence reliability authority received invalid confidence input",
        stage:
          finalStage
            ? "FINAL"
            : "ADAPTIVE"
      };
    }

    const normalizedConfidence =
      finalStage
        ? Math.max(
            0,
            Math.min(
              100,
              numericConfidence
            )
          )
        : Math.max(
            this.minConfidence,
            Math.min(
              this.maxConfidence,
              numericConfidence
            )
          );

    const bin =
      String(
        Math.round(
          normalizedConfidence / 5
        ) * 5
      );

    const calibration =
      finalStage
        ? this.data
            .finalConfidenceCalibration
        : this.data.calibration;

    const bucket =
      calibration?.[bin] ||
      null;

    const lockedSamples =
      Number(
        bucket?.lockedSamples
      );

    if (
      !bucket ||
      !Number.isFinite(
        lockedSamples
      ) ||
      lockedSamples <
        this.minSamples
    ) {
      return {
        eligible: true,
        status:
          "LIVE_CONFIDENCE_RELIABILITY_BOOTSTRAP",
        reason:
          `${finalStage ? "final" : "adaptive"} confidence bin ${bin} requires ${this.minSamples} locked decision-time outcomes; ${Number.isFinite(lockedSamples) ? lockedSamples : 0} available`,
        stage:
          finalStage
            ? "FINAL"
            : "ADAPTIVE",
        bin:
          Number(bin),
        sampleSize:
          Number.isFinite(
            lockedSamples
          )
            ? lockedSamples
            : 0,
        requiredSamples:
          this.minSamples,
        minimumRequiredRate:
          requiredRate
      };
    }

    const lockedWins =
      Number(
        bucket.lockedWins
      );

    const interval =
      this.calculateWilsonConfidenceInterval(
        lockedWins,
        lockedSamples
      );

    if (!interval) {
      return {
        eligible: false,
        status:
          "LIVE_CONFIDENCE_RELIABILITY_INVALID",
        reason:
          `${finalStage ? "final" : "adaptive"} confidence bin ${bin} has invalid locked outcome counts`,
        stage:
          finalStage
            ? "FINAL"
            : "ADAPTIVE",
        bin:
          Number(bin)
      };
    }

    const statisticallyBelowFloor =
      interval.upper <
      requiredRate;

    const actualRate =
      Number(
        bucket.lockedActualRate
      );

    const predictedConfidence =
      Number(
        bucket.lockedPredictedConfidence
      );

    const brierScore =
      Number(
        bucket.lockedBrierScore
      );

    return {
      eligible:
        !statisticallyBelowFloor,
      status:
        statisticallyBelowFloor
          ? "LIVE_CONFIDENCE_RELIABILITY_VETO"
          : "LIVE_CONFIDENCE_RELIABILITY_PASS",
      reason:
        statisticallyBelowFloor
          ? `${finalStage ? "final" : "adaptive"} confidence bin ${bin} statistically failed: ${lockedWins}/${lockedSamples} wins, 95% Wilson upper ${interval.upper.toFixed(2)}% below live ${requiredRate.toFixed(2)}% floor`
          : `${finalStage ? "final" : "adaptive"} confidence bin ${bin} reliability passed: ${lockedWins}/${lockedSamples} wins, 95% Wilson interval ${interval.lower.toFixed(2)}%-${interval.upper.toFixed(2)}%`,
      stage:
        finalStage
          ? "FINAL"
          : "ADAPTIVE",
      bin:
        Number(bin),
      sampleSize:
        lockedSamples,
      requiredSamples:
        this.minSamples,
      wins:
        lockedWins,
      losses:
        Number(
          bucket.lockedLosses
        ),
      observedWinRate:
        Number.isFinite(actualRate)
          ? actualRate
          : (
              lockedWins /
              lockedSamples
            ) * 100,
      predictedConfidence:
        Number.isFinite(
          predictedConfidence
        )
          ? predictedConfidence
          : normalizedConfidence,
      brierScore:
        Number.isFinite(
          brierScore
        )
          ? brierScore
          : null,
      minimumRequiredRate:
        requiredRate,
      wilson95: {
        lower:
          Number(
            interval.lower
              .toFixed(4)
          ),
        upper:
          Number(
            interval.upper
              .toFixed(4)
          )
      },
      statisticallyBelowFloor
    };
  }

  // =====================================================
  // Phase 4 Pattern Evolution
  // =====================================================

  /**
   * Generate safe detector-threshold recommendations.
   *
   * The analyzer may apply these values through
   * applyPatternEvolution().
   *
   * Every recommendation is limited to ±20%
   * of its baseline value.
   */
  updatePatternEvolution() {

    const existing =
      this.data.patternEvolution ||
      {};

    const evolution = {
      ...existing
    };

    const recommendations = {};

    const patternMappings = {

      "Double Top": {
        key:
          "doubleTopTolerance",
        baseline:
          0.003
      },

      "Double Bottom": {
        key:
          "doubleBottomTolerance",
        baseline:
          0.003
      },

      "Head and Shoulders": {
        key:
          "shoulderTolerance",
        baseline:
          0.015
      },

      "Inverse Head and Shoulders": {
        key:
          "shoulderTolerance",
        baseline:
          0.015
      },

      "Ascending Triangle": {
        key:
          "triangleTolerance",
        baseline:
          0.005
      },

      "Descending Triangle": {
        key:
          "triangleTolerance",
        baseline:
          0.005
      },

      "Symmetric Triangle": {
        key:
          "triangleTolerance",
        baseline:
          0.005
      },

      "Rising Wedge": {
        key:
          "wedgeTolerance",
        baseline:
          0.005
      },

      "Falling Wedge": {
        key:
          "wedgeTolerance",
        baseline:
          0.005
      },

      "Rectangle Top": {
        key:
          "rectangleTolerance",
        baseline:
          0.004
      },

      "Rectangle Bottom": {
        key:
          "rectangleTolerance",
        baseline:
          0.004
      },

      "Equal Highs": {
        key:
          "liquidityTolerance",
        baseline:
          0.002
      },

      "Equal Lows": {
        key:
          "liquidityTolerance",
        baseline:
          0.002
      }

    };

    const grouped = {};

    for (
      const patternName in
      patternMappings
    ) {

      const stats =
        this.data.patternStats[
          patternName
        ];

      if (!stats)
        continue;

      const resolved =
        stats.resolved ??
        stats.total ??
        0;

      if (
        resolved <
        this.minSamples
      ) {
        continue;
      }

      const mapping =
        patternMappings[
          patternName
        ];

      if (!grouped[mapping.key]) {

        grouped[
          mapping.key
        ] = {

          baseline:
            mapping.baseline,

          weightedAdjustment:
            0,

          totalWeight:
            0,

          patterns: []

        };
      }

      const winRate =
        stats.decayedWinRate ??
        stats.winRate ??
        stats.accuracy ??
        50;

      const reliability =
        Math.min(
          1,
          resolved / 50
        );

      /*
       * Weak performance slightly tightens tolerance.
       * Strong performance slightly relaxes tolerance.
       *
       * The maximum raw adjustment here is 20%.
       */
      const adjustment =
        Math.max(
          -this.maxEvolutionChange,
          Math.min(
            this.maxEvolutionChange,
            (
              winRate - 50
            ) / 100
          )
        );

      grouped[
        mapping.key
      ].weightedAdjustment +=
        adjustment *
        reliability;

      grouped[
        mapping.key
      ].totalWeight +=
        reliability;

      grouped[
        mapping.key
      ].patterns.push(
        patternName
      );
    }

    for (
      const key in
      grouped
    ) {

      const group =
        grouped[key];

      if (
        group.totalWeight <= 0
      ) {
        continue;
      }

      const averageAdjustment =
        group.weightedAdjustment /
        group.totalWeight;

      const minimum =
        group.baseline *
        (
          1 -
          this.maxEvolutionChange
        );

      const maximum =
        group.baseline *
        (
          1 +
          this.maxEvolutionChange
        );

      const proposed =
        group.baseline *
        (
          1 +
          averageAdjustment
        );

      const safeValue =
        Math.max(
          minimum,
          Math.min(
            maximum,
            proposed
          )
        );

      recommendations[key] =
        Number(
          safeValue.toFixed(6)
        );

      evolution[key] = {

        value:
          recommendations[key],

        baseline:
          group.baseline,

        changePercent:
          Number(
            (
              (
                safeValue -
                group.baseline
              ) /
              group.baseline *
              100
            ).toFixed(2)
          ),

        sourcePatterns:
          group.patterns,

        updatedAt:
          new Date().toISOString()

      };
    }

    evolution.recommendations =
      recommendations;

    evolution.updatedAt =
      new Date().toISOString();

    this.data.patternEvolution =
      evolution;

    return {
      ...evolution
    };
  }

  /**
   * Return only analyzer-compatible
   * threshold recommendations.
   */
  getPatternEvolutionRecommendations() {

    const evolution =
      this.data.patternEvolution ||
      {};

    if (
      evolution.recommendations
    ) {
      return {
        ...evolution.recommendations
      };
    }

    const recommendations = {};

    for (
      const key in
      evolution
    ) {

      const item =
        evolution[key];

      if (
        item &&
        typeof item === "object" &&
        Number.isFinite(
          Number(item.value)
        )
      ) {

        recommendations[key] =
          Number(item.value);
      }
    }

    return recommendations;
  }

  // =====================================================
  // Confidence Data
  // =====================================================

  /**
   * Get confidence data for all exact setups.
   */
  getConfidenceData() {

    const patterns = {};

    for (
      const key in
      this.data.stats
    ) {

      const stat =
        this.data.stats[key];

      const keyParts =
        key.split("_");

      const patternName =
        keyParts[0] ||
        "Unknown";

      const pair =
        keyParts[1] ||
        "UNKNOWN";

      const timeframe =
        keyParts[2] ||
        "UNKNOWN";

      const historicalAccuracy =
        stat.decayedWinRate ??
        stat.accuracy ??
        this.defaultConfidence;

      let confidence =
        historicalAccuracy;

      if (
        stat.trend ===
        "improving"
      ) {

        confidence =
          Math.min(
            this.maxConfidence,
            confidence + 5
          );
      }

      if (
        stat.trend ===
        "declining"
      ) {

        confidence =
          Math.max(
            this.minConfidence,
            confidence - 5
          );
      }

      const resolved =
        stat.resolved ??
        stat.total ??
        0;

      if (
        resolved < 3
      ) {

        confidence =
          Math.max(
            this.minConfidence,
            confidence - 10
          );
      }

      confidence *=
        this.getPatternWeight(
          patternName
        );

      if (
        this.isPatternBlacklisted(
          patternName
        )
      ) {
        confidence -= 15;
      }

      confidence =
        this.applyConfidenceCalibration(
          confidence
        );

      confidence =
        Math.round(
          Math.max(
            this.minConfidence,
            Math.min(
              this.maxConfidence,
              confidence
            )
          )
        );

      patterns[key] = {

        pattern:
          patternName,

        pair,

        timeframe,

        confidence,

        accuracy:
          stat.accuracy,

        decayedWinRate:
          stat.decayedWinRate,

        total:
          stat.total,

        resolved:
          stat.resolved,

        wins:
          stat.wins,

        losses:
          stat.losses,

        trend:
          stat.trend,

        patternWeight:
          this.getPatternWeight(
            patternName
          ),

        blacklisted:
          this.isPatternBlacklisted(
            patternName
          ),

        lastUpdated:
          new Date().toISOString()

      };
    }

    return patterns;
  }

  /**
   * Get all learning data.
   */
  getLearningData() {

    return {

      history:
        this.data.history,

      stats:
        this.data.stats,

      patternStats:
        this.data.patternStats,

      pairStats:
        this.data.pairStats,

      timeframeStats:
        this.data.timeframeStats,

      regimeStats:
        this.data.regimeStats,

      contextEdgeStats:
        this.data.contextEdgeStats,

      patternRegimeStats:
        this.data.patternRegimeStats,

      patternSessionStats:
        this.data.patternSessionStats,

      strategyStateContextStats:
        this.data.strategyStateContextStats,

      patternDirectionStateStats:
        this.data.patternDirectionStateStats,

      patternStateStats:
        this.data.patternStateStats,

      patternWeights:
        this.data.patternWeights,

      calibration:
        this.data.calibration,

      finalConfidenceCalibration:
        this.data.finalConfidenceCalibration,

      patternEvolution:
        this.data.patternEvolution,

      blacklistedPatterns:
        this.data.blacklistedPatterns,

      optimization:
        this.data.optimization,

      lastLearningUpdate:
        this.data.lastLearningUpdate

    };
  }

  // =====================================================
  // Terminal Lifecycle Reconciliation
  // =====================================================

  /**
   * Reconcile terminal lifecycle metadata already present in learning
   * history. This is a local self-healing migration only:
   *
   * - WIN / LOSS / EXPIRED are the only terminal outcomes normalized here.
   * - Existing outcome is authoritative when it is terminal.
   * - Otherwise an existing terminal status can supply the matching outcome.
   * - lastUpdated is advanced only to an existing terminal timestamp when
   *   that timestamp is newer; no current-time timestamp is invented.
   * - WIN/LOSS statistics remain driven by outcome exactly as before.
   */
  reconcileTerminalLifecycleHistory() {

    if (
      !Array.isArray(
        this.data.history
      )
    ) {
      return {
        updatedRecords: 0
      };
    }

    const terminalOutcomes =
      new Set([
        "WIN",
        "LOSS",
        "EXPIRED"
      ]);

    let updatedRecords = 0;

    for (
      const signal of
      this.data.history
    ) {

      if (
        !signal ||
        typeof signal !==
          "object"
      ) {
        continue;
      }

      const existingOutcome =
        String(
          signal.outcome ||
          ""
        ).toUpperCase();

      const existingStatus =
        String(
          signal.status ||
          ""
        ).toUpperCase();

      const terminalOutcome =
        terminalOutcomes.has(
          existingOutcome
        )
          ? existingOutcome
          : terminalOutcomes.has(
              existingStatus
            )
            ? existingStatus
            : null;

      if (!terminalOutcome) {
        continue;
      }

      let changed = false;

      if (
        signal.outcome !==
        terminalOutcome
      ) {
        signal.outcome =
          terminalOutcome;

        changed = true;
      }

      if (
        signal.status !==
        terminalOutcome
      ) {
        signal.status =
          terminalOutcome;

        changed = true;
      }

      const terminalTimestamp =
        terminalOutcome ===
          "EXPIRED"
          ? (
              signal.expiredAt ||
              signal.resolvedAt ||
              null
            )
          : (
              signal.resolvedAt ||
              null
            );

      if (
        terminalTimestamp
      ) {
        const terminalTime =
          new Date(
            terminalTimestamp
          ).getTime();

        const existingUpdateTime =
          new Date(
            signal.lastUpdated ||
            0
          ).getTime();

        if (
          Number.isFinite(
            terminalTime
          ) &&
          (
            !Number.isFinite(
              existingUpdateTime
            ) ||
            terminalTime >
              existingUpdateTime
          )
        ) {
          signal.lastUpdated =
            terminalTimestamp;

          changed = true;
        }
      }

      if (changed) {
        updatedRecords++;
      }
    }

    return {
      updatedRecords
    };
  }

  // =====================================================
  // Signal Resolution
  // =====================================================

  /**
   * Mark a signal with a terminal learning outcome.
   * WIN/LOSS remain the only outcomes used in win-rate/economic statistics;
   * EXPIRED is persisted so terminal signals do not remain falsely pending.
   *
   * Supports either signal.id or signal.timestamp.
   */
  resolveSignal(
    signalId,
    outcome
  ) {

    if (
      outcome !== "WIN" &&
      outcome !== "LOSS" &&
      outcome !== "EXPIRED"
    ) {
      return false;
    }

    const signal =
      this.data.history.find(
        historicalSignal => {

          return (
            historicalSignal.id ===
              signalId ||
            historicalSignal.timestamp ===
              signalId
          );
        }
      );

    if (!signal)
      return false;

    signal.outcome =
      outcome;

    signal.status =
      outcome;

    signal.resolvedAt =
      new Date().toISOString();

    if (
      outcome === "EXPIRED"
    ) {
      signal.expiredAt =
        signal.resolvedAt;
    }

    /*
     * Save the confidence that existed when a WIN/LOSS trade was resolved
     * for future calibration. Expiry is not a calibration outcome.
     */
    if (
      outcome !== "EXPIRED" &&
      !Number.isFinite(
        Number(
          signal.confidence
        )
      )
    ) {

      signal.confidence =
        this.calculateAdaptiveConfidence(
          signal
        );
    }

    this.updatePatternStats();

    this.refreshPendingConfidence();

    this.saveConfidenceSnapshot();

    return true;
  }

  /**
   * Resolve multiple signals efficiently.
   */
  resolveSignals(
    resolutions
  ) {

    if (
      !Array.isArray(
        resolutions
      )
    ) {
      return {
        updated: 0,
        failed: 0
      };
    }

    let updated = 0;
    let failed = 0;

    for (
      const resolution of
      resolutions
    ) {

      if (
        !resolution
      ) {
        failed++;
        continue;
      }

      const signalId =
        resolution.id ??
        resolution.signalId ??
        resolution.timestamp;

      const outcome =
        resolution.outcome;

      const signal =
        this.data.history.find(
          historicalSignal => {

            return (
              historicalSignal.id ===
                signalId ||
              historicalSignal.timestamp ===
                signalId
            );
          }
        );

      if (
        !signal ||
        (
          outcome !== "WIN" &&
          outcome !== "LOSS" &&
          outcome !== "EXPIRED"
        )
      ) {
        failed++;
        continue;
      }

      signal.outcome =
        outcome;

      signal.status =
        outcome;

      signal.resolvedAt =
        resolution.resolvedAt ||
        new Date().toISOString();

      if (
        outcome === "EXPIRED"
      ) {
        signal.expiredAt =
          resolution.expiredAt ||
          signal.resolvedAt;
      }

      const resolutionFields = [
        "realizedR",
        "exitPrice",
        "exitReason",
        "resolutionCandleTime",
        "expiredAt",
        "session",
        "marketRegime",
        "marketState",
        "strategy",
        "strategyModel",
        "strategyEvidence",
        "tradeDurationMinutes",
        "highestTargetReached"
      ];

      for (
        const field of
        resolutionFields
      ) {
        if (
          resolution[field] !==
          undefined
        ) {
          signal[field] =
            resolution[field];
        }
      }

      updated++;
    }

    if (updated > 0) {

      this.updatePatternStats();

      this.refreshPendingConfidence();

      this.saveConfidenceSnapshot();
    }

    return {
      updated,
      failed
    };
  }

  // =====================================================
  // Pattern Psychology
  // =====================================================

  /**
   * Get pattern psychology description.
   */
  getPatternDescription(
    patternName
  ) {

    const descriptions = {

      "Double Top":
        "A bearish reversal pattern where price reaches the same resistance level twice. Indicates rejection of higher prices and weakening buying pressure. When confirmed below the neckline, expect a significant downside move. Risk:Reward typically 1:2+",

      "Double Bottom":
        "A bullish reversal pattern where price touches the same support level twice. Shows buyer strength and rejection of lower prices. Once price closes above the neckline, expect a significant upside move. Common in downtrends about to reverse.",

      "Head and Shoulders":
        "A classic bearish reversal pattern with 3 peaks - left shoulder, head (higher), right shoulder (similar to left). The neckline is critical support. Break below signals a strong downtrend. One of the most reliable patterns with high accuracy rate.",

      "Inverse Head and Shoulders":
        "Mirror image of H&S but bullish. Three troughs with middle one deepest. Neckline resistance break signals strong uptrend. Often found at market bottoms and precedes substantial rallies. Very reliable for identifying trend reversals.",

      "Ascending Triangle":
        "Rising lows with flat resistance highs indicate buyers stepping in at each dip. Bullish breakout pattern. When price breaks above resistance, expect strong continuation move upward. Time decay adds urgency - pattern must resolve within 2-3 weeks.",

      "Descending Triangle":
        "Falling highs with flat support lows indicate sellers pushing price lower. Bearish breakout pattern. Break below support signals strong continuation downward. Pattern suggests supply overwhelming demand, pointing to further weakness.",

      "Symmetric Triangle":
        "Converging highs and lows with narrowing range. Neutral consolidation until breakout occurs. Breakout direction determines next trend. Tighter the triangle, stronger the eventual move. Requires volume confirmation.",

      "Rising Wedge":
        "Higher lows and higher highs but highs rising faster - price rising into tighter resistance. Despite uptrend appearance, this is a bearish reversal pattern. Strong sell signal when resistance breaks. Often seen in overbought conditions before corrections.",

      "Falling Wedge":
        "Lower highs and lower lows but lows falling faster - price falling into support. Despite downtrend appearance, this is a bullish reversal pattern. Strong buy signal when support holds and resistance breaks. Often precedes strong bounces.",

      "Pennant":
        "Small symmetrical consolidation after a strong directional move. Flag of the trend. Breakout continues original direction. Very reliable with high probability continuation. Time factor important - should resolve quickly, typically within 1-2 weeks.",

      "Flag":
        "Rectangular consolidation after strong move, price oscillating slightly higher or lower than breakout level. Very bullish after an up move or bearish after a down move. High probability continuation pattern. Strong volume on breakout is critical.",

      "Cup and Handle":
        "Rounded bottom forming support followed by a shallow pullback within the cup rim. Very bullish pattern. Breakout above the rim signals substantial upside potential. Reliability improves when the structure forms gradually.",

      "Rectangle Top":
        "Flat resistance where price fails to break higher multiple times. Buyers are losing strength. Breakdown below support can signal a bearish continuation or reversal.",

      "Rectangle Bottom":
        "Flat support where price repeatedly rejects lower prices. Sellers are losing strength. Breakout above resistance can signal a bullish continuation or reversal.",

      "Diamond Top":
        "An expanding and then contracting formation near resistance. It is a rare bearish reversal structure. Confirmation below support can indicate a major trend reversal.",

      "Diamond Bottom":
        "An expanding and then contracting formation near support. It is a rare bullish reversal structure. Confirmation above resistance can precede a major upward reversal.",

      "Bullish Engulfing":
        "The second bullish candle engulfs the previous bearish candle body. It indicates buyers overpowering sellers and is strongest near support or after a decline.",

      "Bearish Engulfing":
        "The second bearish candle engulfs the previous bullish candle body. It indicates sellers overpowering buyers and is strongest near resistance or after an advance.",

      "Equal Highs":
        "Repeated highs at a similar level may represent resting buy-side liquidity. Price can sweep this liquidity before reversing or continuing.",

      "Equal Lows":
        "Repeated lows at a similar level may represent resting sell-side liquidity. Price can sweep this liquidity before reversing or continuing.",

      "Liquidity Sweep":
        "Price briefly moves beyond a known high or low to trigger orders before closing back inside the prior range. This can reveal institutional liquidity collection.",

      "Break of Structure":
        "Price breaks a significant swing point in the direction of the prevailing trend. This confirms continuation and validates directional market structure.",

      "Change of Character":
        "Price breaks structure against the prevailing trend. This is an early warning that momentum and market control may be changing.",

      "Order Block":
        "A price zone associated with the final opposing candle before a strong institutional move. Retests may provide entries when aligned with structure and liquidity.",

      "Fair Value Gap":
        "An imbalance created by rapid price displacement. Price may revisit the gap before resuming its directional move.",

      "Risk-Adjusted Trend Momentum":
        "A systematic trend-continuation strategy that combines EMA20/EMA50 alignment, risk-adjusted time-series momentum, momentum-zone RSI and a confirmed continuation breakout. It uses structure-aware volatility risk control with predefined R-multiple objectives and should be evaluated together with higher-timeframe, market-regime and portfolio controls."

    };

    return (
      descriptions[
        patternName
      ] ||
      "Pattern detected with confirmed signal."
    );
  }

  // =====================================================
  // Pattern Quality
  // =====================================================

  /**
   * Pattern Quality Score.
   */
  getPatternQuality(
    pattern,
    pair,
    timeframe
  ) {

    const key =
      `${pattern}_${pair}_${timeframe}`;

    const stat =
      this.data.stats[key];

    if (!stat) {

      return {

        qualityScore: 60,

        grade: "C",

        recommendation:
          "Insufficient Data",

        patternWeight:
          this.getPatternWeight(
            pattern
          ),

        blacklisted:
          this.isPatternBlacklisted(
            pattern
          )

      };
    }

    const winRate =
      stat.decayedWinRate ??
      stat.accuracy ??
      60;

    const resolved =
      stat.resolved ??
      stat.total ??
      0;

    const sampleSize =
      Math.min(
        100,
        resolved * 5
      );

    let trendScore = 60;

    if (
      stat.trend ===
      "improving"
    ) {
      trendScore = 90;
    }

    else if (
      stat.trend ===
      "stable"
    ) {
      trendScore = 70;
    }

    else if (
      stat.trend ===
      "declining"
    ) {
      trendScore = 40;
    }

    const confidence =
      Math.min(
        this.maxConfidence,
        winRate
      );

    const weightScore =
      Math.min(
        100,
        this.getPatternWeight(
          pattern
        ) * 70
      );

    let quality =
      (
        winRate * 0.35
      ) +
      (
        confidence * 0.20
      ) +
      (
        trendScore * 0.15
      ) +
      (
        sampleSize * 0.15
      ) +
      (
        weightScore * 0.15
      );

    const blacklisted =
      this.isPatternBlacklisted(
        pattern
      );

    if (blacklisted) {
      quality = Math.min(
        quality,
        40
      );
    }

    let grade = "F";

    if (quality >= 90)
      grade = "A+";

    else if (quality >= 80)
      grade = "A";

    else if (quality >= 70)
      grade = "B";

    else if (quality >= 60)
      grade = "C";

    else if (quality >= 50)
      grade = "D";

    return {

      qualityScore:
        Math.round(
          quality
        ),

      grade,

      recommendation:
        blacklisted
          ? "Avoid"
          : (
              grade === "A+" ||
              grade === "A"
            )
            ? "Excellent"
            : grade === "B"
              ? "Good"
              : grade === "C"
                ? "Average"
                : "Avoid",

      accuracy:
        Number(
          winRate.toFixed(2)
        ),

      sampleSize:
        resolved,

      trend:
        stat.trend,

      patternWeight:
        this.getPatternWeight(
          pattern
        ),

      blacklisted

    };
  }

  // =====================================================
  // Risk and Reward
  // =====================================================

  /**
   * Get risk:reward suggestion.
   */
  getRiskRewardData(
    pattern,
    entry,
    stop,
    target
  ) {

    const numericEntry =
      Number(entry);

    const numericStop =
      Number(stop);

    const numericTarget =
      Number(target);

    if (
      !Number.isFinite(
        numericEntry
      ) ||
      !Number.isFinite(
        numericStop
      ) ||
      !Number.isFinite(
        numericTarget
      )
    ) {

      return {

        pattern,

        risk: null,

        reward: null,

        ratio: null,

        acceptable: false,

        reason:
          "Invalid entry, stop or target"

      };
    }

    const risk =
      Math.abs(
        numericEntry -
        numericStop
      );

    const reward =
      Math.abs(
        numericTarget -
        numericEntry
      );

    const ratio =
      risk > 0
        ? reward / risk
        : 0;

    return {

      pattern,

      risk:
        risk.toFixed(4),

      reward:
        reward.toFixed(4),

      ratio:
        ratio.toFixed(2),

      acceptable:
        ratio >= 1.5,

      quality:
        ratio >= 3
          ? "Excellent"
          : ratio >= 2
            ? "Good"
            : ratio >= 1.5
              ? "Acceptable"
              : "Poor"

    };
  }

  // =====================================================
  // Phase 4 Learning Cycle
  // =====================================================

  /**
   * Run the complete learning cycle.
   *
   * This method is optional and additive.
   * Existing integrations may continue calling
   * updateHistory() and resolveSignal().
   */
  runLearningCycle() {

    this.cleanupHistory(
      this.maxHistory
    );

    this.updatePatternStats();

    this.refreshPendingConfidence();

    const optimization =
      this.optimizePerformance();

    const confidence =
      this.saveConfidenceSnapshot();

    this.data.lastLearningUpdate =
      new Date().toISOString();

    return {

      success: true,

      overall:
        this.getOverallStats(),

      trend:
        this.getPerformanceTrend(),

      bestPattern:
        this.getBestPattern(),

      optimization,

      patternWeights: {
        ...this.data.patternWeights
      },

      blacklistedPatterns: {
        ...this.data.blacklistedPatterns
      },

      patternEvolution:
        this.getPatternEvolutionRecommendations(),

      calibration:
        this.getCalibrationData(),

      finalConfidenceCalibration:
        this.getFinalConfidenceCalibrationData(),

      confidence,

      updatedAt:
        this.data.lastLearningUpdate

    };
  }
}

module.exports = LearningSystem;
