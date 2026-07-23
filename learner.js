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

    // Initialize storage
    if (!this.data.history)
        this.data.history = [];

    if (!this.data.stats)
        this.data.stats = {};

    if (!this.confidenceData.patterns)
        this.confidenceData.patterns = {};

    if (!this.confidenceData.updatedAt)
        this.confidenceData.updatedAt = new Date().toISOString();
  }

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
      Math.min(this.maxConfidence, confidence)
    );

    return Math.round(confidence);
  }

  /**
   * Adaptive AI Confidence Engine
   */
  calculateAdaptiveConfidence(signal) {

    if (!signal)
      return this.defaultConfidence;

    const history =
      this.data.history.filter(s =>
        s.pattern === signal.pattern &&
        s.pair === signal.pair &&
        s.timeframe === signal.timeframe &&
        s.outcome
      );

    if (history.length === 0)
      return this.defaultConfidence;

    const wins =
      history.filter(s => s.outcome === "WIN").length;

    const historicalAccuracy =
      (wins / history.length) * 100;

    let confidence =
      this.calculateConfidence(
        signal.strength || 60,
        historicalAccuracy,
        signal.confirmationScore || 60,
        history.length
      );

    // Recent trend adjustment
    const recent =
      history.slice(-10);

    if (recent.length >= 5) {

      const recentWins =
        recent.filter(s => s.outcome === "WIN").length;

      const recentRate =
        (recentWins / recent.length) * 100;

      if (recentRate > historicalAccuracy + 15)
        confidence += 3;

      if (recentRate < historicalAccuracy - 15)
        confidence -= 3;
    }

    confidence = Math.max(
      this.minConfidence,
      Math.min(this.maxConfidence, confidence)
    );

    return Math.round(confidence);
  }

  /**
   * Update confidence of one signal
   */
  updateSignalConfidence(signal) {

    signal.confidence =
      this.calculateAdaptiveConfidence(signal);

    return signal.confidence;
  }

  /**
   * Refresh confidence of all unresolved signals
   */
  refreshPendingConfidence() {

    this.data.history
      .filter(s => !s.outcome)
      .forEach(signal => {

        signal.confidence =
          this.calculateAdaptiveConfidence(signal);

      });

    this.confidenceData.updatedAt =
      new Date().toISOString();

    return true;
  }

  /**
   * AI Performance Optimization Engine
   */
  optimizePerformance() {

    const optimization = {

      bestPattern: null,
      weakestPattern: null,

      bestPair: null,
      weakestPair: null,

      bestTimeframe: null,
      weakestTimeframe: null,

      suggestions: []

    };

    if (!this.data.stats)
      return optimization;

    let highest = -1;
    let lowest = 101;

    // Pattern Ranking
    for (const key in this.data.stats) {

      const stat = this.data.stats[key];

      if (stat.total < 3)
        continue;

      if (stat.accuracy > highest) {

        highest = stat.accuracy;
        optimization.bestPattern = key;

      }

      if (stat.accuracy < lowest) {

        lowest = stat.accuracy;
        optimization.weakestPattern = key;

      }

    }

    // Pair Ranking
    const pairStats = {};

    for (const key in this.data.stats) {

      const stat = this.data.stats[key];

      const pair = key.split("_")[1];

      if (!pairStats[pair]) {

        pairStats[pair] = {
          wins: 0,
          total: 0
        };

      }

      pairStats[pair].wins += stat.wins;
      pairStats[pair].total += stat.total;

    }

    highest = -1;
    lowest = 101;

    for (const pair in pairStats) {

      const rate =
        (pairStats[pair].wins /
        pairStats[pair].total) * 100;

      if (rate > highest) {

        highest = rate;
        optimization.bestPair = pair;

      }

      if (rate < lowest) {

        lowest = rate;
        optimization.weakestPair = pair;

      }

    }

    // Timeframe Ranking

    const timeframeStats = {};

    for (const key in this.data.stats) {

      const stat = this.data.stats[key];

      const tf = key.split("_")[2];

      if (!timeframeStats[tf]) {

        timeframeStats[tf] = {
          wins: 0,
          total: 0
        };

      }

      timeframeStats[tf].wins += stat.wins;
      timeframeStats[tf].total += stat.total;

    }

    highest = -1;
    lowest = 101;

    for (const tf in timeframeStats) {

      const rate =
        (timeframeStats[tf].wins /
        timeframeStats[tf].total) * 100;

      if (rate > highest) {

        highest = rate;
        optimization.bestTimeframe = tf;

      }

      if (rate < lowest) {

        lowest = rate;
        optimization.weakestTimeframe = tf;

      }

    }

    // Suggestions

    if (optimization.bestPattern) {

      optimization.suggestions.push(
        `Focus on ${optimization.bestPattern}`
      );

    }

    if (optimization.bestPair) {

      optimization.suggestions.push(
        `${optimization.bestPair} currently performs best`
      );

    }

    if (optimization.bestTimeframe) {

      optimization.suggestions.push(
        `Highest accuracy timeframe: ${optimization.bestTimeframe}`
      );

    }

    if (optimization.weakestPattern) {

      optimization.suggestions.push(
        `Review ${optimization.weakestPattern}`
      );

    }

    return optimization;

  }

  /**
   * Get Best Performing Pattern
   */
  getBestPattern() {

    let best = null;
    let highest = 0;

    for (const key in this.data.stats) {

      const stat = this.data.stats[key];

      if (stat.total < 3)
        continue;

      if (stat.accuracy > highest) {

        highest = stat.accuracy;
        best = key;

      }

    }

    return {

      pattern: best,
      accuracy: highest

    };

  }

  /**
   * Overall Learning Trend
   */
  getPerformanceTrend() {

    const resolved =
      this.data.history.filter(
        s => s.outcome
      );

    if (resolved.length < 20)
      return "insufficient-data";

    const recent =
      resolved.slice(-20);

    const previous =
      resolved.slice(-40, -20);

    if (previous.length === 0)
      return "insufficient-data";

    const recentRate =
      (recent.filter(
        s => s.outcome === "WIN"
      ).length / recent.length) * 100;

    const previousRate =
      (previous.filter(
        s => s.outcome === "WIN"
      ).length / previous.length) * 100;

    const diff =
      recentRate - previousRate;

    if (diff > 10)
      return "improving";

    if (diff < -10)
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

      bestPattern: bestPattern.pattern,

      bestAccuracy: bestPattern.accuracy,

      trend: trend,

      optimization: optimization,

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
  generateRecommendation(bestPattern, trend) {

    const recommendations = [];

    if (bestPattern.pattern) {

      recommendations.push(

        `Prioritize ${bestPattern.pattern} (${bestPattern.accuracy.toFixed(1)}% accuracy)`

      );

    }

    if (trend === "improving") {

      recommendations.push(

        "Learning performance is improving."

      );

    }

    else if (trend === "declining") {

      recommendations.push(

        "Performance is declining. Reduce trade frequency."

      );

    }

    const overall = this.getOverallStats();

    if (overall.winRate >= 70) {

      recommendations.push(

        "High confidence trading conditions."

      );

    }

    else if (overall.winRate < 50) {

      recommendations.push(

        "Overall accuracy is low. Wait for stronger confirmations."

      );

    }

    if (recommendations.length === 0) {

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
        s => s.outcome
      );

    const wins =
      resolved.filter(
        s => s.outcome === "WIN"
      ).length;

    const losses =
      resolved.filter(
        s => s.outcome === "LOSS"
      ).length;

    const total =
      resolved.length;

    return {

      totalSignals:
        this.data.history.length,

      resolvedSignals:
        total,

      wins:
        wins,

      losses:
        losses,

      pending:
        this.data.history.length - total,

      winRate:
        total
        ? (wins / total) * 100
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

      updatedAt:
        new Date().toISOString()

    };

  }

  /**
   * AI Signal Filter
   */
  shouldTrade(signal) {

    const confidence =
      this.calculateAdaptiveConfidence(signal);

    return {

      execute:
        confidence >= 65,

      confidence:
        confidence,

      reason:

        confidence >= 65

        ? "Confidence passed"

        : "Confidence below threshold"

    };

  }

  /**
   * Auto Cleanup Engine
   */
  cleanupHistory(maxRecords = 5000) {

    if (!this.data.history)
      return;

    if (this.data.history.length > maxRecords) {

      this.data.history =
        this.data.history.slice(-maxRecords);

    }

    return this.data.history.length;

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

      confidence:
        this.confidenceData,

      exportedAt:
        new Date().toISOString()

    };

  }

  /**
   * Restore Learning Backup
   */
  importLearning(data) {

    if (!data)
      return false;

    this.data.history =
      data.history || [];

    this.data.stats =
      data.stats || {};

    this.confidenceData =
      data.confidence || {};

    return true;

  }

  /**
   * Reset AI Learning
   */
  resetLearning() {

    this.data.history = [];

    this.data.stats = {};

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

    return {

      engine: "AI Pattern Recognition",

      status: "ONLINE",

      totalSignals:
        overall.totalSignals,

      resolved:
        overall.resolvedSignals,

      winRate:
        overall.winRate,

      trend:
        this.getPerformanceTrend(),

      bestPattern:
        this.getBestPattern(),

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
        "2.0.0",

      learning:
        true,

      adaptiveConfidence:
        true,

      optimization:
        true,

      recommendation:
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

    return this.confidenceData;

  }

  module.exports = LearningSystem;
