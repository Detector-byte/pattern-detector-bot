/**
 * Signal Generator - Creates professional trading signals
 * With pattern psychology, descriptions, risk/reward calculations,
 * adaptive confidence, market-regime context and Phase 4 learning.
 */

const LearningSystem = require("./learner");

class SignalGenerator {
  /**
   * Backward compatible:
   *
   * new SignalGenerator()
   *
   * Phase 4:
   *
   * new SignalGenerator({
   *   learner,
   *   learningData,
   *   confidenceData,
   *   minimumRiskReward,
   *   actionableThreshold
   * })
   */
  constructor(options = {}) {
    if (
      options &&
      typeof options.shouldTrade === "function"
    ) {
      this.learner = options;
      options = {};
    } else {
      this.learner =
        options.learner ||
        new LearningSystem(
          options.learningData || {},
          options.confidenceData || {}
        );
    }

    this.minimumRiskReward =
      Number.isFinite(
        Number(options.minimumRiskReward)
      )
        ? Number(options.minimumRiskReward)
        : 1.5;

    this.defaultRiskReward =
      Number.isFinite(
        Number(options.defaultRiskReward)
      )
        ? Number(options.defaultRiskReward)
        : 2;

    this.maximumSignals =
      Number.isFinite(
        Number(options.maximumSignals)
      )
        ? Math.max(
            1,
            Number(options.maximumSignals)
          )
        : 1000;

    if (
      Number.isFinite(
        Number(options.actionableThreshold)
      )
    ) {
      this.learner.actionableThreshold =
        Number(options.actionableThreshold);
    }
  }

  // =====================================================
  // Main Signal Generation
  // =====================================================

  /**
   * Generate one professional trading signal.
   *
   * Existing signature remains unchanged:
   *
   * generateSignal(
   *   pair,
   *   timeframe,
   *   pattern,
   *   confidence,
   *   lastCandle
   * )
   *
   * Optional sixth argument adds Phase 4 context.
   */
  generateSignal(
    pair,
    timeframe,
    pattern,
    confidence,
    lastCandle,
    context = {}
  ) {
    if (
      !pattern ||
      !lastCandle
    ) {
      return null;
    }

    const normalizedPattern =
      this.normalizePattern(pattern);

    const normalizedCandle =
      this.normalizeCandle(lastCandle);

    if (!normalizedCandle) {
      return null;
    }

    const marketRegime =
      context.marketRegime ||
      context.regime ||
      normalizedPattern.marketRegime ||
      normalizedPattern.regime ||
      this.detectMarketRegime(
        context.candles || [],
        normalizedCandle
      );

    const externalConfidence =
      Number(confidence);

    const signalInput = {
      pattern:
        normalizedPattern.name,

      pair:
        pair || "UNKNOWN",

      timeframe:
        timeframe || "1H",

      strength:
        this.toNumber(
          normalizedPattern.strength,
          60
        ),

      confirmationScore:
        this.toNumber(
          normalizedPattern.confirmationScore,
          60
        ),

      marketRegime,

      regime:
        marketRegime
    };

    const adaptiveConfidence =
      this.learner
        .calculateAdaptiveConfidence(
          signalInput
        );

    /*
     * Preserve externally supplied confidence while
     * allowing Phase 4 learning to adjust it.
     */
    const finalConfidence =
      Number.isFinite(
        externalConfidence
      )
        ? Math.round(
            (
              externalConfidence +
              adaptiveConfidence
            ) / 2
          )
        : adaptiveConfidence;

    const tradeDecision =
      this.learner.shouldTrade({
        ...signalInput,
        confidence:
          finalConfidence
      });

    if (
      !tradeDecision.execute
    ) {
      return null;
    }

    const entry =
      normalizedCandle.close;

    const levels =
      this.calculateLevels(
        normalizedPattern,
        normalizedCandle,
        pair,
        context
      );

    if (!levels) {
      return null;
    }

    const {
      stop,
      target1,
      target2,
      target3,
      risk
    } = levels;

    const rrData =
      this.learner.getRiskRewardData(
        normalizedPattern.name,
        entry,
        stop,
        target1
      );

    const riskReward =
      this.toNumber(
        rrData.ratio,
        0
      );

    /*
     * Avoid structurally poor setups unless the caller
     * explicitly allows low risk/reward signals.
     */
    if (
      riskReward <
        this.minimumRiskReward &&
      context.allowLowRiskReward !== true
    ) {
      return null;
    }

    const description =
      this.learner.getPatternDescription(
        normalizedPattern.name
      );

    const timeframeContext =
      this.getTimeframeContext(
        timeframe
      );

    const quality =
      this.learner.getPatternQuality(
        normalizedPattern.name,
        pair,
        timeframe
      );

    const direction =
      normalizedPattern.direction;

    const createdAt =
      new Date().toISOString();

    const signalId =
      context.id ||
      this.createSignalId(
        pair,
        timeframe,
        normalizedPattern.name,
        createdAt
      );

    const expirationMinutes =
      this.getExpirationMinutes(
        timeframe
      );

    const signal = {
      id:
        signalId,

      pair:
        pair || "UNKNOWN",

      timeframe:
        timeframe || "1H",

      pattern:
        normalizedPattern.name,

      direction,

      signal:
        direction === "NEUTRAL"
          ? "HOLD"
          : direction,

      confidence:
        this.clamp(
          finalConfidence,
          0,
          100
        ),

      adaptiveConfidence,

      entry:
        this.roundPrice(
          entry,
          pair
        ),

      stopLoss:
        this.roundPrice(
          stop,
          pair
        ),

      takeProfit1:
        this.roundPrice(
          target1,
          pair
        ),

      takeProfit2:
        this.roundPrice(
          target2,
          pair
        ),

      takeProfit3:
        this.roundPrice(
          target3,
          pair
        ),

      riskReward:
        Number(
          riskReward.toFixed(2)
        ),

      riskRewardDetails:
        rrData,

      qualityScore:
        quality.qualityScore,

      grade:
        quality.grade,

      qualityRecommendation:
        quality.recommendation,

      patternWeight:
        quality.patternWeight ??
        this.learner.getPatternWeight(
          normalizedPattern.name
        ),

      blacklisted:
        Boolean(
          quality.blacklisted
        ),

      tradeDecision: {
        confidence:
          tradeDecision.confidence,

        execute:
          tradeDecision.execute,

        threshold:
          tradeDecision.threshold,

        patternBlacklisted:
          tradeDecision.patternBlacklisted,

        reason:
          tradeDecision.reason
      },

      status:
        direction === "NEUTRAL"
          ? "WATCHING"
          : "CONFIRMED",

      description,

      psychology:
        this.getPatternPsychology(
          normalizedPattern.name
        ),

      timeframeContext,

      marketRegime,

      marketStructure:
        this.getMarketStructure(
          normalizedPattern
        ),

      riskManagement: {
        risk:
          this.roundPrice(
            risk,
            pair
          ),

        stopDistance:
          this.roundPrice(
            Math.abs(
              entry - stop
            ),
            pair
          ),

        profitTarget1:
          this.roundPrice(
            Math.abs(
              target1 - entry
            ),
            pair
          ),

        profitTarget2:
          this.roundPrice(
            Math.abs(
              target2 - entry
            ),
            pair
          ),

        profitTarget3:
          this.roundPrice(
            Math.abs(
              target3 - entry
            ),
            pair
          ),

        recommendation:
          riskReward >= 3
            ? "EXCELLENT"
            : riskReward >= 2
              ? "STRONG"
              : riskReward >= 1.5
                ? "GOOD"
                : "CAUTION"
      },

      tradingGuidance:
        this.getTradingGuidance(
          normalizedPattern.name,
          timeframe
        ),

      strength:
        signalInput.strength,

      confirmationScore:
        signalInput.confirmationScore,

      executionNotes:
        this.getExecutionNotes(
          normalizedPattern.name,
          timeframe,
          marketRegime
        ),

      metadata: {
        source:
          context.source ||
          "PipSight Pro AI",

        phase:
          4,

        patternVersion:
          normalizedPattern.version ||
          null,

        evolvedThresholds:
          this.learner
            .getPatternEvolutionRecommendations(),

        generatedBy:
          "SignalGenerator"
      },

      createdAt,

      expiresAt:
        new Date(
          Date.now() +
          expirationMinutes *
          60000
        ).toISOString(),

      outcome:
        null
    };

    /*
     * Recording is opt-in so old integrations do not
     * unexpectedly duplicate stored signals.
     */
    if (
      context.recordSignal === true
    ) {
      this.learner.recordSignal(
        signal
      );
    }

    return signal;
  }

  /**
   * Generate signals for multiple detected patterns.
   */
  generateSignals(
    pair,
    timeframe,
    patterns,
    confidence,
    lastCandle,
    context = {}
  ) {
    if (
      !Array.isArray(patterns)
    ) {
      return [];
    }

    const generatedSignals = [];

    for (
      const pattern of patterns
    ) {
      const signal =
        this.generateSignal(
          pair,
          timeframe,
          pattern,
          confidence,
          lastCandle,
          context
        );

      if (signal) {
        generatedSignals.push(
          signal
        );
      }
    }

    return this.rankSignals(
      generatedSignals
    ).slice(
      0,
      this.maximumSignals
    );
  }

  /**
   * Rank signals by confidence, quality and risk/reward.
   */
  rankSignals(signals) {
    if (
      !Array.isArray(signals)
    ) {
      return [];
    }

    return [...signals].sort(
      (first, second) => {
        const firstScore =
          this.getSignalRankingScore(
            first
          );

        const secondScore =
          this.getSignalRankingScore(
            second
          );

        return (
          secondScore -
          firstScore
        );
      }
    );
  }

  /**
   * Internal composite score for signal ordering.
   */
  getSignalRankingScore(signal) {
    if (!signal) {
      return 0;
    }

    const confidence =
      this.toNumber(
        signal.confidence,
        0
      );

    const quality =
      this.toNumber(
        signal.qualityScore,
        0
      );

    const riskReward =
      Math.min(
        5,
        this.toNumber(
          signal.riskReward,
          0
        )
      );

    const strength =
      this.toNumber(
        signal.strength,
        0
      );

    const blacklistedPenalty =
      signal.blacklisted
        ? 50
        : 0;

    return (
      confidence * 0.4 +
      quality * 0.3 +
      strength * 0.15 +
      riskReward * 10 * 0.15 -
      blacklistedPenalty
    );
  }

  // =====================================================
  // Price Levels
  // =====================================================

  /**
   * Calculate stop-loss and profit targets.
   */
  calculateLevels(
    pattern,
    candle,
    pair,
    context = {}
  ) {
    const price =
      this.toNumber(
        candle.close,
        NaN
      );

    const high =
      this.toNumber(
        candle.high,
        NaN
      );

    const low =
      this.toNumber(
        candle.low,
        NaN
      );

    if (
      !Number.isFinite(price) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low)
    ) {
      return null;
    }

    let range =
      Math.abs(
        high - low
      );

    const atr =
      this.toNumber(
        context.atr ??
        pattern.atr,
        0
      );

    if (
      atr > 0
    ) {
      range =
        Math.max(
          range,
          atr
        );
    }

    if (
      range <= 0
    ) {
      range =
        this.getMinimumPriceMovement(
          pair,
          price
        );
    }

    const direction =
      pattern.direction;

    const riskMultiplier =
      this.clamp(
        this.toNumber(
          context.riskMultiplier,
          0.5
        ),
        0.1,
        3
      );

    const targetMultiplier1 =
      this.clamp(
        this.toNumber(
          context.targetMultiplier1,
          1.5
        ),
        0.5,
        10
      );

    const targetMultiplier2 =
      this.clamp(
        this.toNumber(
          context.targetMultiplier2,
          2
        ),
        1,
        15
      );

    const targetMultiplier3 =
      this.clamp(
        this.toNumber(
          context.targetMultiplier3,
          3
        ),
        1.5,
        20
      );

    let stop;
    let target1;
    let target2;
    let target3;
    let risk;

    if (
      direction === "BUY"
    ) {
      const structureStop =
        this.toNumber(
          pattern.stopLoss ??
          pattern.invalidationLevel ??
          pattern.support,
          NaN
        );

      stop =
        Number.isFinite(
          structureStop
        ) &&
        structureStop < price
          ? structureStop
          : low -
            range *
            riskMultiplier;

      risk =
        price - stop;

      target1 =
        this.getValidBullishTarget(
          pattern.target1,
          price,
          price +
            risk *
            targetMultiplier1
        );

      target2 =
        this.getValidBullishTarget(
          pattern.target2,
          target1,
          price +
            risk *
            targetMultiplier2
        );

      target3 =
        this.getValidBullishTarget(
          pattern.target3,
          target2,
          price +
            risk *
            targetMultiplier3
        );
    } else if (
      direction === "SELL"
    ) {
      const structureStop =
        this.toNumber(
          pattern.stopLoss ??
          pattern.invalidationLevel ??
          pattern.resistance,
          NaN
        );

      stop =
        Number.isFinite(
          structureStop
        ) &&
        structureStop > price
          ? structureStop
          : high +
            range *
            riskMultiplier;

      risk =
        stop - price;

      target1 =
        this.getValidBearishTarget(
          pattern.target1,
          price,
          price -
            risk *
            targetMultiplier1
        );

      target2 =
        this.getValidBearishTarget(
          pattern.target2,
          target1,
          price -
            risk *
            targetMultiplier2
        );

      target3 =
        this.getValidBearishTarget(
          pattern.target3,
          target2,
          price -
            risk *
            targetMultiplier3
        );
    } else {
      stop = low;

      target1 = high;

      target2 = high;

      target3 = high;

      risk = 0;
    }

    if (
      direction !== "NEUTRAL" &&
      (
        !Number.isFinite(risk) ||
        risk <= 0
      )
    ) {
      return null;
    }

    return {
      stop,
      target1,
      target2,
      target3,
      risk
    };
  }

  getValidBullishTarget(
    providedTarget,
    minimumTarget,
    fallbackTarget
  ) {
    const target =
      this.toNumber(
        providedTarget,
        NaN
      );

    return (
      Number.isFinite(target) &&
      target > minimumTarget
    )
      ? target
      : fallbackTarget;
  }

  getValidBearishTarget(
    providedTarget,
    maximumTarget,
    fallbackTarget
  ) {
    const target =
      this.toNumber(
        providedTarget,
        NaN
      );

    return (
      Number.isFinite(target) &&
      target < maximumTarget
    )
      ? target
      : fallbackTarget;
  }

  // =====================================================
  // Market Context
  // =====================================================

  /**
   * Lightweight market-regime detector.
   *
   * The analyzer can also provide marketRegime directly.
   */
  detectMarketRegime(
    candles,
    lastCandle
  ) {
    if (
      !Array.isArray(candles) ||
      candles.length < 5
    ) {
      return "UNKNOWN";
    }

    const recent =
      candles
        .slice(-20)
        .map(
          candle =>
            this.normalizeCandle(
              candle
            )
        )
        .filter(Boolean);

    if (
      recent.length < 5
    ) {
      return "UNKNOWN";
    }

    const closes =
      recent.map(
        candle =>
          candle.close
      );

    const highs =
      recent.map(
        candle =>
          candle.high
      );

    const lows =
      recent.map(
        candle =>
          candle.low
      );

    const firstClose =
      closes[0];

    const finalClose =
      closes[
        closes.length - 1
      ];

    const overallMove =
      firstClose !== 0
        ? (
            finalClose -
            firstClose
          ) /
          firstClose
        : 0;

    const averageRange =
      recent.reduce(
        (
          total,
          candle
        ) =>
          total +
          Math.abs(
            candle.high -
            candle.low
          ),
        0
      ) /
      recent.length;

    const averagePrice =
      closes.reduce(
        (
          total,
          close
        ) =>
          total + close,
        0
      ) /
      closes.length;

    const volatility =
      averagePrice !== 0
        ? averageRange /
          averagePrice
        : 0;

    const higherHighs =
      this.countDirectionalSteps(
        highs,
        "UP"
      );

    const higherLows =
      this.countDirectionalSteps(
        lows,
        "UP"
      );

    const lowerHighs =
      this.countDirectionalSteps(
        highs,
        "DOWN"
      );

    const lowerLows =
      this.countDirectionalSteps(
        lows,
        "DOWN"
      );

    if (
      overallMove > 0.01 &&
      higherHighs >=
        recent.length * 0.5 &&
      higherLows >=
        recent.length * 0.5
    ) {
      return volatility > 0.01
        ? "VOLATILE_BULLISH"
        : "BULLISH_TREND";
    }

    if (
      overallMove < -0.01 &&
      lowerHighs >=
        recent.length * 0.5 &&
      lowerLows >=
        recent.length * 0.5
    ) {
      return volatility > 0.01
        ? "VOLATILE_BEARISH"
        : "BEARISH_TREND";
    }

    if (
      volatility > 0.015
    ) {
      return "HIGH_VOLATILITY";
    }

    return "RANGING";
  }

  countDirectionalSteps(
    values,
    direction
  ) {
    let count = 0;

    for (
      let index = 1;
      index < values.length;
      index++
    ) {
      if (
        direction === "UP" &&
        values[index] >
          values[index - 1]
      ) {
        count++;
      }

      if (
        direction === "DOWN" &&
        values[index] <
          values[index - 1]
      ) {
        count++;
      }
    }

    return count;
  }

  // =====================================================
  // Timeframe Context
  // =====================================================

  getTimeframeContext(timeframe) {
    const contexts = {
      "1m": {
        duration:
          "1 minute",

        holdTime:
          "1 - 15 minutes",

        tradingSession:
          "Ultra-fast scalping",

        riskLevel:
          "Very High",

        volatility:
          "Very High",

        advice:
          "Use only with deep liquidity, strict execution and very tight risk controls."
      },

      "5m": {
        duration:
          "5 minute",

        holdTime:
          "15 min - 1 hour",

        tradingSession:
          "Scalping / Ultra-short term",

        riskLevel:
          "High",

        volatility:
          "High",

        advice:
          "Use tight stops and quick exits. Ideal for active traders only."
      },

      "15m": {
        duration:
          "15 minute",

        holdTime:
          "1 - 4 hours",

        tradingSession:
          "Short-term swing",

        riskLevel:
          "Medium-High",

        volatility:
          "Medium-High",

        advice:
          "Balance catching moves with avoiding false breaks. Suitable for day traders."
      },

      "30m": {
        duration:
          "30 minute",

        holdTime:
          "2 - 8 hours",

        tradingSession:
          "Intraday swing",

        riskLevel:
          "Medium",

        volatility:
          "Medium",

        advice:
          "Usually produces cleaner signals than lower timeframes."
      },

      "1H": {
        duration:
          "1 hour",

        holdTime:
          "4 - 24 hours",

        tradingSession:
          "Daily intraday",

        riskLevel:
          "Medium-Low",

        volatility:
          "Medium",

        advice:
          "Reliable signals with improved risk-to-reward characteristics."
      },

      "4H": {
        duration:
          "4 hour",

        holdTime:
          "1 - 5 days",

        tradingSession:
          "Position swing",

        riskLevel:
          "Low",

        volatility:
          "Low",

        advice:
          "Higher-quality signals with less market noise and fewer trades."
      },

      "1D": {
        duration:
          "1 day",

        holdTime:
          "Several days - weeks",

        tradingSession:
          "Position trading",

        riskLevel:
          "Low",

        volatility:
          "Low",

        advice:
          "Use wider structural stops and smaller position sizing."
      }
    };

    return (
      contexts[timeframe] ||
      contexts["1H"]
    );
  }

  getExpirationMinutes(
    timeframe
  ) {
    const expirationMap = {
      "1m": 10,
      "5m": 30,
      "15m": 60,
      "30m": 120,
      "1H": 360,
      "4H": 1440,
      "1D": 4320
    };

    return (
      expirationMap[timeframe] ||
      360
    );
  }

  // =====================================================
  // Pattern Psychology and Structure
  // =====================================================

  getPatternPsychology(
    patternName
  ) {
    return this.learner
      .getPatternDescription(
        patternName
      );
  }

  getMarketStructure(pattern) {
    if (
      pattern.direction === "BUY"
    ) {
      return {
        interpretation:
          "Bullish reversal or continuation",

        sentiment:
          "Buyers gaining control",

        momentum:
          "Upside momentum building",

        recommendedAction:
          "Look for long entries after confirmed bullish structure."
      };
    }

    if (
      pattern.direction === "SELL"
    ) {
      return {
        interpretation:
          "Bearish reversal or continuation",

        sentiment:
          "Sellers gaining control",

        momentum:
          "Downside momentum building",

        recommendedAction:
          "Look for short entries after confirmed bearish structure."
      };
    }

    return {
      interpretation:
        "Consolidation - direction uncertain",

      sentiment:
        "Equilibrium between buyers and sellers",

      momentum:
        "Low directional bias",

      recommendedAction:
        "Wait for breakout direction confirmation."
    };
  }

  // =====================================================
  // Trading Guidance
  // =====================================================

  getTradingGuidance(
    patternName,
    timeframe
  ) {
    const guidance = {
      "Double Top":
        `Entry: On close below neckline support. Stop: Above the second peak. Target: Pattern height projected downward. On ${timeframe}, avoid entering before neckline confirmation.`,

      "Double Bottom":
        `Entry: On close above neckline resistance. Stop: Below the second trough. Target: Pattern height projected upward. On ${timeframe}, confirmation improves when the second bottom holds strongly.`,

      "Head and Shoulders":
        `Entry: After a close below the neckline. Stop: Above the right shoulder. Target: Head-to-neckline distance projected downward. On ${timeframe}, volume expansion strengthens confirmation.`,

      "Inverse Head and Shoulders":
        `Entry: After a close above the neckline. Stop: Below the right shoulder. Target: Head-to-neckline distance projected upward. On ${timeframe}, wait for a confirmed neckline break.`,

      "Ascending Triangle":
        `Entry: On breakout above horizontal resistance. Stop: Below rising support. Target: Triangle height projected upward. On ${timeframe}, breakouts before the apex are generally stronger.`,

      "Descending Triangle":
        `Entry: On breakdown below horizontal support. Stop: Above falling resistance. Target: Triangle height projected downward. On ${timeframe}, confirm with strong bearish momentum.`,

      "Symmetric Triangle":
        `Entry: On a confirmed breakout in either direction. Stop: Behind the opposite triangle boundary. Target: Triangle height projected from the breakout. On ${timeframe}, align with the higher-timeframe trend.`,

      "Rising Wedge":
        `Entry: On breakdown below rising support. Stop: Above wedge resistance. Target: Wedge height projected downward. On ${timeframe}, avoid premature shorts while support remains intact.`,

      "Falling Wedge":
        `Entry: On breakout above falling resistance. Stop: Below wedge support. Target: Wedge height projected upward. On ${timeframe}, bullish confirmation should follow the breakout.`,

      "Pennant":
        `Entry: On breakout in the original trend direction. Stop: Behind the pennant. Target: Previous impulse length projected from breakout. On ${timeframe}, the setup should resolve relatively quickly.`,

      "Flag":
        `Entry: On breakout in the original trend direction. Stop: Behind the opposite side of the flag. Target: Flagpole length projected from breakout. On ${timeframe}, volume expansion improves reliability.`,

      "Cup and Handle":
        `Entry: On breakout above the cup rim. Stop: Below the handle low. Target: Cup depth projected upward. On ${timeframe}, avoid handles that retrace too deeply.`,

      "Rectangle Top":
        `Entry: On breakdown below support. Stop: Above rectangle resistance. Target: Rectangle height projected downward. On ${timeframe}, repeated resistance rejection strengthens the setup.`,

      "Rectangle Bottom":
        `Entry: On breakout above resistance. Stop: Below rectangle support. Target: Rectangle height projected upward. On ${timeframe}, repeated support defense strengthens the setup.`,

      "Diamond Top":
        `Entry: On confirmed support breakdown. Stop: Above the diamond high. Target: Diamond height projected downward. On ${timeframe}, treat this rare reversal pattern conservatively.`,

      "Diamond Bottom":
        `Entry: On confirmed resistance breakout. Stop: Below the diamond low. Target: Diamond height projected upward. On ${timeframe}, require strong confirmation before entry.`,

      "Bullish Engulfing":
        `Entry: Above the engulfing candle high. Stop: Below the engulfing candle low. Target: At least 1.5-2 times risk. On ${timeframe}, strongest near meaningful support.`,

      "Bearish Engulfing":
        `Entry: Below the engulfing candle low. Stop: Above the engulfing candle high. Target: At least 1.5-2 times risk. On ${timeframe}, strongest near meaningful resistance.`,

      "Equal Highs":
        `Wait for either a liquidity sweep and bearish rejection or a clean breakout above equal highs. On ${timeframe}, confirmation is essential because equal highs can attract liquidity.`,

      "Equal Lows":
        `Wait for either a liquidity sweep and bullish rejection or a clean breakdown below equal lows. On ${timeframe}, confirmation is essential because equal lows can attract liquidity.`,

      "Liquidity Sweep":
        `Entry: After price returns inside the prior range and confirms rejection. Stop: Beyond the sweep extreme. On ${timeframe}, combine with structure shift and displacement.`,

      "Break of Structure":
        `Entry: On retracement after confirmed structure break. Stop: Beyond the invalidation swing. On ${timeframe}, trade in the direction of established structure.`,

      "Change of Character":
        `Treat as an early reversal warning. Entry should follow additional confirmation such as displacement, retest or liquidity reaction on ${timeframe}.`,

      "Order Block":
        `Entry: On a validated retest of the order-block zone. Stop: Beyond the zone. On ${timeframe}, require alignment with structure, displacement and liquidity.`,

      "Fair Value Gap":
        `Entry: On a controlled retracement into the imbalance. Stop: Beyond the invalidation structure. On ${timeframe}, avoid trading an isolated gap without directional context.`
    };

    return (
      guidance[patternName] ||
      `Monitor the pattern on ${timeframe}. Enter only after confirmed directional movement with acceptable risk-to-reward.`
    );
  }

  getExecutionNotes(
    patternName,
    timeframe,
    marketRegime = "UNKNOWN"
  ) {
    return {
      confirmationRequired:
        true,

      volumeImportant:
        true,

      recommendedEntry:
        "Enter after confirmed breakout, breakdown or rejection.",

      riskLevel:
        this.getRiskLevel(
          timeframe
        ),

      liquidityRequired:
        true,

      marketRegime,

      bestSessions:
        this.getBestSessions(
          timeframe
        ),

      avoidTimes:
        "Avoid high-impact news windows and unusually poor liquidity.",

      notes:
        `${patternName} is being evaluated on ${timeframe}. Combine it with higher-timeframe structure, liquidity and market-regime confirmation.`
    };
  }

  getRiskLevel(timeframe) {
    const riskLevels = {
      "1m": "EXTREME",
      "5m": "VERY_HIGH",
      "15m": "HIGH",
      "30m": "MEDIUM",
      "1H": "MEDIUM_LOW",
      "4H": "LOW",
      "1D": "LOW"
    };

    return (
      riskLevels[timeframe] ||
      "MEDIUM"
    );
  }

  getBestSessions(timeframe) {
    if (
      timeframe === "1m" ||
      timeframe === "5m" ||
      timeframe === "15m"
    ) {
      return "London-New York overlap and major session openings";
    }

    if (
      timeframe === "30m" ||
      timeframe === "1H"
    ) {
      return "London and New York sessions";
    }

    return "All major sessions with sufficient liquidity";
  }

  // =====================================================
  // Signal Validation
  // =====================================================

  validateSignal(signal) {
    const errors = [];

    if (!signal) {
      return {
        valid: false,
        errors: [
          "Signal is missing"
        ]
      };
    }

    if (!signal.pair) {
      errors.push(
        "Pair is required"
      );
    }

    if (!signal.timeframe) {
      errors.push(
        "Timeframe is required"
      );
    }

    if (!signal.pattern) {
      errors.push(
        "Pattern is required"
      );
    }

    if (
      ![
        "BUY",
        "SELL",
        "NEUTRAL"
      ].includes(
        signal.direction
      )
    ) {
      errors.push(
        "Direction must be BUY, SELL or NEUTRAL"
      );
    }

    if (
      signal.direction !==
        "NEUTRAL" &&
      !Number.isFinite(
        Number(signal.entry)
      )
    ) {
      errors.push(
        "Valid entry price is required"
      );
    }

    if (
      signal.direction !==
        "NEUTRAL" &&
      !Number.isFinite(
        Number(signal.stopLoss)
      )
    ) {
      errors.push(
        "Valid stop-loss is required"
      );
    }

    if (
      signal.direction !==
        "NEUTRAL" &&
      !Number.isFinite(
        Number(signal.takeProfit1)
      )
    ) {
      errors.push(
        "Valid first target is required"
      );
    }

    return {
      valid:
        errors.length === 0,

      errors
    };
  }

  /**
   * Return only currently active signals.
   */
  filterActiveSignals(signals) {
    if (
      !Array.isArray(signals)
    ) {
      return [];
    }

    const currentTime =
      Date.now();

    return signals.filter(
      signal => {
        if (
          !signal ||
          signal.status === "CANCELLED" ||
          signal.status === "EXPIRED"
        ) {
          return false;
        }

        if (!signal.expiresAt) {
          return true;
        }

        const expiration =
          new Date(
            signal.expiresAt
          ).getTime();

        return (
          Number.isNaN(
            expiration
          ) ||
          expiration >
            currentTime
        );
      }
    );
  }

  // =====================================================
  // Normalization Helpers
  // =====================================================

  normalizePattern(pattern) {
    const direction =
      String(
        pattern.direction ||
        pattern.signal ||
        "NEUTRAL"
      ).toUpperCase();

    return {
      ...pattern,

      name:
        pattern.name ||
        pattern.pattern ||
        "Unknown",

      direction:
        direction === "BUY" ||
        direction === "SELL"
          ? direction
          : "NEUTRAL",

      strength:
        this.toNumber(
          pattern.strength,
          60
        ),

      confirmationScore:
        this.toNumber(
          pattern.confirmationScore,
          60
        )
    };
  }

  normalizeCandle(candle) {
    if (!candle) {
      return null;
    }

    const open =
      this.toNumber(
        candle.open,
        NaN
      );

    const high =
      this.toNumber(
        candle.high,
        NaN
      );

    const low =
      this.toNumber(
        candle.low,
        NaN
      );

    const close =
      this.toNumber(
        candle.close,
        NaN
      );

    if (
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      return null;
    }

    return {
      ...candle,

      open:
        Number.isFinite(open)
          ? open
          : close,

      high,

      low,

      close,

      volume:
        this.toNumber(
          candle.volume,
          0
        )
    };
  }

  // =====================================================
  // Utility Helpers
  // =====================================================

  createSignalId(
    pair,
    timeframe,
    pattern,
    timestamp
  ) {
    const safePair =
      String(
        pair || "UNKNOWN"
      ).replace(
        /[^a-zA-Z0-9]/g,
        ""
      );

    const safeTimeframe =
      String(
        timeframe || "1H"
      ).replace(
        /[^a-zA-Z0-9]/g,
        ""
      );

    const safePattern =
      String(
        pattern || "Unknown"
      ).replace(
        /[^a-zA-Z0-9]/g,
        ""
      );

    return [
      safePair,
      safeTimeframe,
      safePattern,
      new Date(
        timestamp
      ).getTime(),
      Math.random()
        .toString(36)
        .slice(2, 8)
    ].join("-");
  }

  getMinimumPriceMovement(
    pair,
    price
  ) {
    const normalizedPair =
      String(
        pair || ""
      ).toUpperCase();

    if (
      normalizedPair.includes(
        "JPY"
      )
    ) {
      return 0.01;
    }

    if (
      normalizedPair.includes(
        "BTC"
      ) ||
      normalizedPair.includes(
        "ETH"
      )
    ) {
      return Math.max(
        price * 0.001,
        0.01
      );
    }

    return Math.max(
      price * 0.0001,
      0.0001
    );
  }

  getPricePrecision(pair) {
    const normalizedPair =
      String(
        pair || ""
      ).toUpperCase();

    if (
      normalizedPair.includes(
        "JPY"
      )
    ) {
      return 3;
    }

    if (
      normalizedPair.includes(
        "BTC"
      ) ||
      normalizedPair.includes(
        "ETH"
      )
    ) {
      return 2;
    }

    return 5;
  }

  roundPrice(
    value,
    pair
  ) {
    const numericValue =
      Number(value);

    if (
      !Number.isFinite(
        numericValue
      )
    ) {
      return null;
    }

    return Number(
      numericValue.toFixed(
        this.getPricePrecision(
          pair
        )
      )
    );
  }

  toNumber(
    value,
    fallback = 0
  ) {
    const number =
      Number(value);

    return Number.isFinite(
      number
    )
      ? number
      : fallback;
  }

  clamp(
    value,
    minimum,
    maximum
  ) {
    return Math.max(
      minimum,
      Math.min(
        maximum,
        Number(value)
      )
    );
  }

  // =====================================================
  // Learner Access
  // =====================================================

  getLearner() {
    return this.learner;
  }

  getLearningData() {
    return this.learner
      .getLearningData();
  }

  getDashboardData() {
    return this.learner
      .getDashboardData();
  }

  resolveSignal(
    signalId,
    outcome
  ) {
    return this.learner
      .resolveSignal(
        signalId,
        outcome
      );
  }

  runLearningCycle() {
    return this.learner
      .runLearningCycle();
  }

  getVersion() {
    return {
      engine:
        "PipSight Signal Generator",

      version:
        "4.0.0",

      adaptiveConfidence:
        true,

      marketRegime:
        true,

      signalRanking:
        true,

      riskRewardFilter:
        true,

      learnerIntegration:
        true
    };
  }
}

module.exports = SignalGenerator;
