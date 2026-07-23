/**
 * Signal Generator - Creates professional trading signals
 * With pattern psychology, descriptions, and risk/reward calculations
 */

const LearningSystem = require('./learner');

class SignalGenerator {
  constructor() {
    this.learner = new LearningSystem({}, {});
  }

  generateSignal(pair, timeframe, pattern, confidence, lastCandle) {
    if (!pattern || !lastCandle) return null;

    const tradeDecision =
      this.learner.shouldTrade({
        pattern: pattern.name,
        pair,
        timeframe,
        strength: pattern.strength,
        confirmationScore: pattern.confirmationScore
      });

    if (!tradeDecision.execute) {
      return null;
    }

    // Calculate entry, stop, and take profit
    const entry = lastCandle.close;
    const { stop, target1, target2, target3, risk } = this.calculateLevels(
      pattern,
      lastCandle,
      pair
    );

    // Risk:Reward calculation
    const rrData =
      this.learner.getRiskRewardData(
        pattern.name,
        entry,
        stop,
        target1
      );

    const rr = Number(rrData.ratio);

    // Get pattern description
    const description = this.learner.getPatternDescription(pattern.name);

    // Get timeframe-specific context
    const tfContext = this.getTimeframeContext(timeframe);

    const quality =
      this.learner.getPatternQuality(
        pattern.name,
        pair,
        timeframe
      );

    // Generate signal object
    return {
      pair,
      timeframe,
      pattern: pattern.name,
      direction: pattern.direction,
      signal: pattern.direction === 'NEUTRAL' ? 'HOLD' : pattern.direction,
      confidence,
      entry: Number(entry.toFixed(4)),
      stopLoss: Number(stop.toFixed(4)),
      takeProfit1: Number(target1.toFixed(4)),
      takeProfit2: Number(target2.toFixed(4)),
      takeProfit3: Number(target3.toFixed(4)),
      riskReward: Number(rr.toFixed(2)),
      riskRewardDetails: rrData,
      qualityScore: quality.qualityScore,
      grade: quality.grade,
      qualityRecommendation: quality.recommendation,
      tradeDecision: {
        confidence: tradeDecision.confidence,
        execute: tradeDecision.execute,
        reason: tradeDecision.reason
      },
      status: 'CONFIRMED',
      description,
      psychology: this.getPatternPsychology(pattern.name),
      timeframeContext: tfContext,
      marketStructure: this.getMarketStructure(pattern),
      riskManagement: {
        stopDistance: Number(Math.abs(entry - stop).toFixed(4)),
        profitTarget1: Number(Math.abs(target1 - entry).toFixed(4)),
        profitTarget2: Number(Math.abs(target2 - entry).toFixed(4)),
        profitTarget3: Number(Math.abs(target3 - entry).toFixed(4)),
        recommendation: rr >= 2 ? 'STRONG' : rr >= 1.5 ? 'GOOD' : 'CAUTION'
      },
      tradingGuidance: this.getTradingGuidance(pattern.name, timeframe),
      strength: pattern.strength,
      confirmationScore: pattern.confirmationScore,
      executionNotes: this.getExecutionNotes(pattern.name, timeframe),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(
        Date.now() +
        (
          timeframe === "5m" ? 30 :
          timeframe === "15m" ? 60 :
          timeframe === "30m" ? 120 :
          timeframe === "1H" ? 360 :
          1440
        ) * 60000
      ).toISOString()
    };
  }

  // Calculate support, resistance, and profit targets
  calculateLevels(pattern, candle, pair) {
    const price = candle.close;
    const high = candle.high;
    const low = candle.low;
    const range = high - low;

    let stop, target1, target2, target3, risk;

    if (pattern.direction === 'BUY') {
      // Bullish patterns
      stop = low - (range * 0.5);
      risk = price - stop;
      target1 = price + risk;
      target2 = price + (risk * 1.5);
      target3 = price + (risk * 2);
    } else if (pattern.direction === 'SELL') {
      // Bearish patterns
      stop = high + (range * 0.5);
      risk = stop - price;
      target1 = price - risk;
      target2 = price - (risk * 1.5);
      target3 = price - (risk * 2);
    } else {
      // Neutral - no trade
      stop = low;
      target1 = high;
      target2 = high;
      target3 = high;
      risk = 0;
    }

    return { stop, target1, target2, target3, risk };
  }

  // Get timeframe context and information
  getTimeframeContext(timeframe) {
    const contexts = {
      '5m': {
        duration: '5 minute',
        holdTime: '15 min - 1 hour',
        tradingSession: 'Scalping / Ultra-short term',
        riskLevel: 'High',
        volatility: 'High',
        advice: 'Use tight stops, quick exits. Ideal for active traders only.'
      },
      '15m': {
        duration: '15 minute',
        holdTime: '1 - 4 hours',
        tradingSession: 'Short-term swing',
        riskLevel: 'Medium-High',
        volatility: 'Medium-High',
        advice: 'Balance between catching moves and avoiding false breaks. Good for day traders.'
      },
      '30m': {
        duration: '30 minute',
        holdTime: '2 - 8 hours',
        tradingSession: 'Intraday swing',
        riskLevel: 'Medium',
        volatility: 'Medium',
        advice: 'Better quality signals than lower timeframes. Ideal for part-time traders.'
      },
      '1H': {
        duration: '1 hour',
        holdTime: '4 - 24 hours',
        tradingSession: 'Daily intraday',
        riskLevel: 'Medium-Low',
        volatility: 'Medium',
        advice: 'Reliable signals with better risk:reward. Good for conservative traders.'
      },
      '4H': {
        duration: '4 hour',
        holdTime: '1 - 5 days',
        tradingSession: 'Position swing',
        riskLevel: 'Low',
        volatility: 'Low',
        advice: 'High-quality signals, lower noise. Best for position traders. Fewer, better trades.'
      }
    };

    return contexts[timeframe] || contexts['1H'];
  }

  // Get pattern psychology explanation
  getPatternPsychology(patternName) {
    return this.learner.getPatternDescription(patternName);
  }

  // Get market structure interpretation
  getMarketStructure(pattern) {
    if (pattern.direction === 'BUY') {
      return {
        interpretation: 'Bullish reversal or continuation',
        sentiment: 'Buyers gaining control',
        momentum: 'Upside momentum building',
        recommendedAction: 'Look for long entries on breakout confirmation'
      };
    } else if (pattern.direction === 'SELL') {
      return {
        interpretation: 'Bearish reversal or continuation',
        sentiment: 'Sellers gaining control',
        momentum: 'Downside momentum building',
        recommendedAction: 'Look for short entries on breakdown confirmation'
      };
    } else {
      return {
        interpretation: 'Consolidation - direction uncertain',
        sentiment: 'Equilibrium between buyers and sellers',
        momentum: 'Low directional bias',
        recommendedAction: 'Wait for breakout direction confirmation'
      };
    }
  }

  // Get specific trading guidance for pattern
  getTradingGuidance(patternName, timeframe) {
    const guidance = {
      'Double Top': `Entry: On close below neckline support. Stop: Above right shoulder high. Target: Measured move down = distance from neckline to pattern peak. Psychology: Double rejection of resistance shows weakening buyers. On ${timeframe}, watch for failed breakout above neckline.`,
      
      'Double Bottom': `Entry: On close above neckline resistance. Stop: Below left shoulder low. Target: Measured move up = distance from neckline to pattern trough. Psychology: Double confirmation of support shows strengthening buyers. On ${timeframe}, bullish signal when second bottom holds.`,
      
      'Head and Shoulders': `Entry: After close below neckline with volume. Stop: Above right shoulder high by 1 ATR. Target: Measured move = head height × 1-2 times. Psychology: Three-peak structure is highly reliable reversal. Right shoulder lower than head is bullish divergence warning before break.`,
      
      'Inverse Head and Shoulders': `Entry: After close above neckline with volume. Stop: Below left shoulder low by 1 ATR. Target: Measured move = head depth × 1-2 times. Psychology: Three-trough structure is highly reliable reversal. Right shoulder higher than head is bullish divergence confirmation.`,
      
      'Ascending Triangle': `Entry: On breakout above resistance with volume. Stop: Below rising support line. Target: Measured move = triangle height added to breakout price. Psychology: Rising floor shows aggressive buying at support. Breakout must occur before apex for reliability.`,
      
      'Descending Triangle': `Entry: On breakdown below support with volume. Stop: Above falling resistance line. Target: Measured move = triangle height subtracted from breakdown price. Psychology: Falling ceiling shows aggressive selling at resistance. Breakdown must occur before apex.`,
      
      'Symmetric Triangle': `Entry: On breakout in either direction with volume confirmation. Stop: Behind triangle formation. Target: Measured move = triangle height added/subtracted from breakout. Psychology: Volatility expansion after consolidation. Direction predetermined by recent trend (more reliable).`,
      
      'Rising Wedge': `Entry: On breakdown below rising support line. Stop: Above rising resistance line. Target: Wedge height from breakout point downward. Psychology: Despite looking bullish, rising wedge is reversal pattern. Contracting highs indicate weakening momentum despite new highs.`,
      
      'Falling Wedge': `Entry: On breakout above falling resistance line. Stop: Below falling support line. Target: Wedge height from breakout point upward. Psychology: Despite looking bearish, falling wedge is reversal pattern. Expanding range on downside precedes upside break.`,
      
      'Pennant': `Entry: On breakout in trend direction. Stop: Behind pennant tip. Target: Previous move distance (pre-pennant) measured from breakout. Psychology: Very reliable with tight stops. Failure to break in correct direction signals weakness.`,
      
      'Flag': `Entry: On breakout in original trend direction. Stop: Behind opposite side of flag. Target: Pre-flag move distance repeated from breakout. Psychology: Consolidation strengthens original trend. Volume surge on breakout critical.`,
      
      'Cup and Handle': `Entry: On breakout above cup rim. Stop: Below cup bottom by 1 ATR. Target: Cup depth added to breakout price. Psychology: Rounded bottom shows institutional accumulation. Handle pullback is final shakeout before move.`,
      
      'Rectangle Top': `Entry: On breakdown below support. Stop: Above resistance line. Target: Rectangle height subtracted from breakout price. Psychology: Flat resistance indicates supply ceiling. Break below support signals available buyers exhausted.`,
      
      'Rectangle Bottom': `Entry: On breakout above resistance. Stop: Below support line. Target: Rectangle height added to breakout price. Psychology: Flat support indicates demand floor. Break above resistance signals sellers exhausted.`,
      
      'Diamond Top': `Entry: On close below middle of diamond. Stop: Above diamond top. Target: Diamond height from breakout point downward. Psychology: Rare and powerful reversal. High reversal probability when pattern properly formed.`,
      
      'Diamond Bottom': `Entry: On close above middle of diamond. Stop: Below diamond bottom. Target: Diamond height from breakout point upward. Psychology: Rare and powerful reversal. Look for strong continuation after breakout confirmation.`,
      
      'Bullish Engulfing': `Entry: On next candle close above engulfing candle high. Stop: Below engulfing candle low. Target: Engulfing candle range × 2-3 from entry. Psychology: Reversal at support is strongest. Most reliable after 2+ down candles. Volume confirmation on green candle important.`,
      
      'Bearish Engulfing': `Entry: On next candle close below engulfing candle low. Stop: Above engulfing candle high. Target: Engulfing candle range × 2-3 from entry. Psychology: Reversal at resistance is strongest. Most reliable after 2+ up candles. Volume confirmation on red candle important.`
    };

    return guidance[patternName] || 'Monitor pattern formation closely. Enter on confirmed breakout in signal direction with volume confirmation.';
  }

  // Get execution notes
  getExecutionNotes(patternName, timeframe) {
    return {
      confirmationRequired: true,
      volumeImportant: true,
      recommendedEntry: 'On confirmed breakout/breakdown with volume',
      riskLevel: this.getRiskLevel(timeframe),
      liquidityRequired: true,
      bestSessions: this.getBestSessions(timeframe),
      avoidTimes: 'News events 1 hour before/after, economic calendar high impact',
      notes: `Pattern most reliable on ${timeframe}. Combine with higher timeframe trend confirmation for better odds.`
    };
  }

  // Get risk level by timeframe
  getRiskLevel(timeframe) {
    const riskLevels = {
      '5m': 'VERY_HIGH',
      '15m': 'HIGH',
      '30m': 'MEDIUM',
      '1H': 'MEDIUM_LOW',
      '4H': 'LOW'
    };
    return riskLevels[timeframe] || 'MEDIUM';
  }

  // Get best trading sessions
  getBestSessions(timeframe) {
    if (timeframe === '5m' || timeframe === '15m') {
      return 'London-NY overlap (13:00-17:00 UTC), NY session opening';
    } else if (timeframe === '30m' || timeframe === '1H') {
      return 'London (8:00-17:00 UTC), New York (13:00-22:00 UTC)';
    } else {
      return 'All sessions - any time'; // 4H patterns work anytime
    }
  }
}

module.exports = SignalGenerator;
