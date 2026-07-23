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

  // Get historical confidence for a pattern
  getPatternConfidence(patternName, pair, timeframe) {
    const key = `${patternName}_${pair}_${timeframe}`;
    
    if (!this.confidenceData.patterns[key]) {
      // Default confidence for new patterns
      return 60;
    }

    const patternData = this.confidenceData.patterns[key];
    return patternData.confidence || 60;
  }

  // Update learning history with new signals
  updateHistory(newSignals) {
    if (!this.data.history) this.data.history = [];
    if (!this.data.stats) this.data.stats = {};

    // Add signals to history (avoid duplicates)
    for (const signal of newSignals) {

      const exists = this.data.history.find(s =>
        s.timestamp === signal.timestamp
      );

      if (exists) continue;

      this.data.history.push({
        ...signal,
        addedAt: new Date().toISOString(),
        outcome: signal.outcome || null
      });

    }

    // Keep last 5000 signals (updated from 2000)
    if (this.data.history.length > this.maxHistory) {
      this.data.history = this.data.history.slice(-this.maxHistory);
    }

    // Update pattern statistics
    this.updatePatternStats();
  }

  // Update pattern statistics based on history
  updatePatternStats() {
    const stats = {};

    for (const signal of this.data.history) {
      const key = `${signal.pattern}_${signal.pair}_${signal.timeframe}`;
      
      if (!stats[key]) {
        stats[key] = {
          total: 0,
          wins: 0,
          losses: 0,
          accuracy: 60,
          trend: 'stable'
        };
      }

      stats[key].total++;

      if (signal.outcome === 'WIN') {
        stats[key].wins++;
      } else if (signal.outcome === 'LOSS') {
        stats[key].losses++;
      }

      // Calculate accuracy
      if (stats[key].total >= 3) {
        stats[key].accuracy = Math.round((stats[key].wins / stats[key].total) * 100);
      }

      // Determine trend
      if (stats[key].total >= 5) {
        const recent = this.data.history.slice(-5).filter(s => 
          s.pattern === signal.pattern && 
          s.pair === signal.pair &&
          s.timeframe === signal.timeframe
        );
        
        const recentWins = recent.filter(s => s.outcome === 'WIN').length;
        const recentRate = (recentWins / recent.length) * 100;

        if (recentRate > stats[key].accuracy + 10) {
          stats[key].trend = 'improving';
        } else if (recentRate < stats[key].accuracy - 10) {
          stats[key].trend = 'declining';
        } else {
          stats[key].trend = 'stable';
        }
      }
    }

    this.data.stats = stats;
  }

  // Get confidence data for all patterns
  getConfidenceData() {
    const patterns = {};

    for (const key in this.data.stats) {
      const stat = this.data.stats[key];
      
      // Calculate confidence based on accuracy and trend
      let confidence = stat.accuracy || 60;

      // Boost for improving trend
      if (stat.trend === 'improving') {
        confidence = Math.min(this.maxConfidence, confidence + 5);
      }
      
      // Penalty for declining trend
      if (stat.trend === 'declining') {
        confidence = Math.max(this.minConfidence, confidence - 5);
      }

      // Penalty if low sample size
      if (stat.total < 3) {
        confidence = Math.max(this.minConfidence, confidence - 10);
      }

      patterns[key] = {
        pattern: key.split('_')[0],
        pair: key.split('_')[1],
        timeframe: key.split('_')[2],
        confidence: confidence,
        accuracy: stat.accuracy,
        total: stat.total,
        wins: stat.wins,
        losses: stat.losses,
        trend: stat.trend,
        lastUpdated: new Date().toISOString()
      };
    }

    return patterns;
  }

  // Get learning data
  getLearningData() {
    return {
      history: this.data.history,
      stats: this.data.stats
    };
  }

  // Mark signal as WIN or LOSS
  resolveSignal(signalId, outcome) {
    const signal = this.data.history.find(s => s.timestamp === signalId);
    if (signal) {
      signal.outcome = outcome;
      this.updatePatternStats();
      // Update confidence after outcome
      this.updateSignalConfidence(signal);
    }
  }

  // Get pattern psychology description
  getPatternDescription(patternName) {
    const descriptions = {
      'Double Top': `A bearish reversal pattern where price reaches the same resistance level twice. Indicates rejection of higher prices and weakening buying pressure. When confirmed below the neckline, expect a significant downside move. Risk:Reward typically 1:2+`,
      
      'Double Bottom': `A bullish reversal pattern where price touches the same support level twice. Shows buyer strength and rejection of lower prices. Once price closes above the neckline, expect a significant upside move. Common in downtrends about to reverse.`,
      
      'Head and Shoulders': `A classic bearish reversal pattern with 3 peaks - left shoulder, head (higher), right shoulder (similar to left). The neckline is critical support. Break below signals a strong downtrend. One of the most reliable patterns with high accuracy rate.`,
      
      'Inverse Head and Shoulders': `Mirror image of H&S but bullish. Three troughs with middle one deepest. Neckline resistance break signals strong uptrend. Often found at market bottoms and precedes substantial rallies. Very reliable for identifying trend reversals.`,
      
      'Ascending Triangle': `Rising lows with flat resistance highs indicate buyers stepping in at each dip. Bullish breakout pattern. When price breaks above resistance, expect strong continuation move upward. Time decay adds urgency - pattern must resolve within 2-3 weeks.`,
      
      'Descending Triangle': `Falling highs with flat support lows indicate sellers pushing price lower. Bearish breakout pattern. Break below support signals strong continuation downward. Pattern suggests supply overwhelming demand, pointing to further weakness.`,
      
      'Symmetric Triangle': `Converging highs and lows with narrowing range. Neutral consolidation until breakout occurs. Breakout direction (up or down) determines next trend. Tighter the triangle, stronger the eventual move. Requires volume confirmation.`,
      
      'Rising Wedge': `Higher lows and higher highs but highs rising faster - price rising into tighter resistance. Despite uptrend appearance, this is a bearish reversal pattern. Strong sell signal when resistance breaks. Often seen in overbought conditions before corrections.`,
      
      'Falling Wedge': `Lower highs and lower lows but lows falling faster - price falling into support. Despite downtrend appearance, this is a bullish reversal pattern. Strong buy signal when support holds and resistance breaks. Often precedes strong bounces.`,
      
      'Pennant': `Small symmetrical consolidation after a strong directional move. Flag of the trend. Breakout continues original direction. Very reliable with high probability continuation. Time factor important - should resolve quickly, typically within 1-2 weeks.`,
      
      'Flag': `Rectangular consolidation after strong move, price oscillating slightly higher/lower than breakout level. Very bullish (after up move) or bearish (after down move). High probability continuation pattern. Strong volume on breakout critical for confirmation.`,
      
      'Cup and Handle': `Rounded bottom (cup) forming support followed by shallow pullback (handle) within cup rim. Very bullish pattern. Breakout above cup rim signals substantial upside move. High probability of success when properly formed with minimum 8-12 week timeframe.`,
      
      'Rectangle Top': `Flat resistance area where price bounces multiple times without breaking above. Buyers lacking strength to push higher. Breakdown below support signals downtrend. Pattern shows equilibrium about to be broken to the downside.`,
      
      'Rectangle Bottom': `Flat support area where price bounces multiple times without breaking below. Sellers lacking strength to push lower. Breakout above resistance signals uptrend. Pattern shows accumulation before upside move.`,
      
      'Diamond Top': `Expanding highs and lows in first half, then contracting in second half creating diamond shape at resistance. Very rare and powerful reversal. Strong sell signal when confirmed below pattern. Can indicate major trend reversal.`,
      
      'Diamond Bottom': `Expanding highs and lows in first half, then contracting in second half creating diamond shape at support. Very rare and powerful reversal. Strong buy signal when confirmed above pattern. Can precede major trend reversal upward.`,
      
      'Bullish Engulfing': `Second candle completely engulfs first bearish candle's range and closes higher. Strong reversal signal at support levels. Indicates buyers overpowering sellers. Most reliable when first candle is small and second has strong body.`,
      
      'Bearish Engulfing': `Second candle completely engulfs first bullish candle's range and closes lower. Strong reversal signal at resistance levels. Indicates sellers overpowering buyers. Most reliable when first candle is small and second has strong body.`
    };

    return descriptions[patternName] || 'Pattern detected with confirmed signal.';
  }

  /**
   * Pattern Quality Score
   */
  getPatternQuality(pattern, pair, timeframe) {

    const key = `${pattern}_${pair}_${timeframe}`;

    const stat = this.data.stats[key];

    if (!stat) {
      return {
        qualityScore: 60,
        grade: "C",
        recommendation: "Insufficient Data"
      };
    }

    const winRate = stat.accuracy || 60;
    const sampleSize = Math.min(100, stat.total * 5);

    let trendScore = 60;

    if (stat.trend === "improving")
      trendScore = 90;

    else if (stat.trend === "stable")
      trendScore = 70;

    else if (stat.trend === "declining")
      trendScore = 40;

    const confidence = Math.min(95, winRate);

    const quality =
      (winRate * 0.40) +
      (confidence * 0.20) +
      (trendScore * 0.20) +
      (sampleSize * 0.20);

    let grade = "F";

    if (quality >= 90) grade = "A+";
    else if (quality >= 80) grade = "A";
    else if (quality >= 70) grade = "B";
    else if (quality >= 60) grade = "C";
    else if (quality >= 50) grade = "D";

    return {
      qualityScore: Math.round(quality),
      grade,
      recommendation:
        grade === "A+" || grade === "A"
          ? "Excellent"
          : grade === "B"
          ? "Good"
          : grade === "C"
          ? "Average"
          : "Avoid"
    };

  }

  // Get risk:reward suggestion
  getRiskRewardData(pattern, entry, stop, target) {
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    const rr = reward / risk;

    return {
      risk: risk.toFixed(4),
      reward: reward.toFixed(4),
      ratio: rr.toFixed(2),
      acceptable: rr >= 1.5
    };
  }
}

module.exports = LearningSystem;
