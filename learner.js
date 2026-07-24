/**
 * Learning System - Self-improving AI confidence tracker
 * Tracks pattern accuracy, learns from outcomes, adjusts confidence
 */

class LearningSystem {
  constructor(learningData = {}, confidenceData = {}) {

    this.data = learningData || {};
    this.confidenceData = confidenceData || {};

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

    if (!this.data.patternWeights)
      this.data.patternWeights = {};

    if (!this.data.calibration)
      this.data.calibration = {};

    if (!this.data.patternEvolution)
      this.data.patternEvolution = {};

    if (!this.data.blacklistedPatterns)
      this.data.blacklistedPatterns = {};

    if (!this.data.optimization)
      this.data.optimization = {};

    if (!this.data.lastLearningUpdate)
      this.data.lastLearningUpdate = null;
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

      patternWeights:
        this.data.patternWeights,

      blacklistedPatterns:
        this.getBlacklistedPatterns(),

      calibration:
        this.data.calibration,

      patternEvolution:
        this.data.patternEvolution,

      updatedAt:
        new Date().toISOString()

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

      patternWeights:
        this.data.patternWeights,

      calibration:
        this.data.calibration,

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
        "4.0.0"

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

    this.data.patternWeights =
      data.patternWeights || {};

    this.data.calibration =
      data.calibration || {};

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

    this.data.patternWeights = {};

    this.data.calibration = {};

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
        "4.0.0",

      learning:
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

      this.data.history.push({

        ...signal,

        addedAt:
          signal.addedAt ||
          new Date().toISOString(),

        outcome:
          signal.outcome || null

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

    const exactHistory = {};
    const patternHistory = {};
    const pairHistory = {};
    const timeframeHistory = {};
    const regimeHistory = {};

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

      const exactKey =
        `${pattern}_${pair}_${timeframe}`;

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

    this.updateConfidenceCalibration();

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

      const rawConfidence =
        Number(
          signal.confidence ??
          signal.aiConfidence ??
          this.defaultConfidence
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

          lastUpdated: null

        };
      }

      calibration[bin].total++;

      if (
        signal.outcome === "WIN"
      ) {
        calibration[bin].wins++;
      }

      else {
        calibration[bin].losses++;
      }

      calibration[bin].actualRate =
        (
          calibration[bin].wins /
          calibration[bin].total
        ) * 100;

      calibration[bin].calibrationError =
        calibration[bin].actualRate -
        calibration[bin]
          .predictedConfidence;

      calibration[bin].lastUpdated =
        new Date().toISOString();
    }

    for (
      const bin in
      calibration
    ) {

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
    }

    this.data.calibration =
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

      patternWeights:
        this.data.patternWeights,

      calibration:
        this.data.calibration,

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
  // Signal Resolution
  // =====================================================

  /**
   * Mark signal as WIN or LOSS.
   *
   * Supports either signal.id or signal.timestamp.
   */
  resolveSignal(
    signalId,
    outcome
  ) {

    if (
      outcome !== "WIN" &&
      outcome !== "LOSS"
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

    signal.resolvedAt =
      new Date().toISOString();

    /*
     * Save the confidence that existed when the
     * trade was resolved for future calibration.
     */
    if (
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
          outcome !== "LOSS"
        )
      ) {
        failed++;
        continue;
      }

      signal.outcome =
        outcome;

      signal.resolvedAt =
        resolution.resolvedAt ||
        new Date().toISOString();

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
        "An imbalance created by rapid price displacement. Price may revisit the gap before resuming its directional move."

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

      confidence,

      updatedAt:
        this.data.lastLearningUpdate

    };
  }
}

module.exports = LearningSystem;

