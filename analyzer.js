/**
 * Pattern Analyzer - Detects 10+ chart patterns
 * Double Top/Bottom, Head & Shoulders, Triangles, Wedges, etc.
 *
 * v2: Professional-grade filters added
 *  - ATR volatility filter (dead-market rejection)
 *  - Synthetic volume confirmation
 *  - EMA(20/50) trend confirmation
 *  - RSI confirmation
 *  - Target price / Stop loss / Risk-Reward per pattern
 *  - Pattern age rejection (stale swing points)
 *  - Multi-factor confirmation score
 *  - Confidence % (Institutional / Very High / High / Medium / Low)
 *  - Fake-breakout rejection
 *  - Weighted priority ranking
 */

class PatternAnalyzer {
  constructor() {
    this.patterns = [
      'Double Top',
      'Double Bottom',
      'Head and Shoulders',
      'Inverse Head and Shoulders',
      'Ascending Triangle',
      'Descending Triangle',
      'Symmetric Triangle',
      'Rising Wedge',
      'Falling Wedge',
      'Pennant',
      'Flag',
      'Cup and Handle',
      'Rectangle Top',
      'Rectangle Bottom',
      'Diamond Top',
      'Diamond Bottom',
      'Bullish Engulfing',
      'Bearish Engulfing',
      // --- Phase 4: Smart Money Concepts ---
      'Liquidity Sweep (Buy-Side)',
      'Liquidity Sweep (Sell-Side)',
      'Break of Structure',
      'Change of Character',
      'Bullish Order Block',
      'Bearish Order Block',
      'Fair Value Gap (Bullish)',
      'Fair Value Gap (Bearish)'
    ];

    // Config used by the Step 3 swing-based detectors
    this.minSwingDistance = 3;         // min candles between two swing points
    this.priceTolerance = 0.02;        // 2% tolerance for peak/valley similarity
    this.breakoutConfirmationCandles = 2; // candles required to confirm a breakout

    // Step 5 configuration
    this.triangleLookback = 30;
    this.wedgeLookback = 30;
    this.regressionThreshold = 0.0005;
    this.minTouchCount = 3;       // min times price must touch flat support/resistance

    // Step 9 configuration
    this.timeframeWeights = {
        M5: 1,
        M15: 1.25,
        H1: 1.5,
        H4: 2
    };

    // --- New professional-grade config ---
    this.atrPeriod = 14;
    this.minATRPercent = 0.003;   // reject dead/low-volatility markets

    this.rsiPeriod = 14;
    this.rsiBuyMax = 35;          // BUY patterns need RSI below this
    this.rsiSellMin = 65;         // SELL patterns need RSI above this

    this.maxPatternAge = 10;      // candles since the pattern's key swing point

    this.slAtrMultiplier = 1.0;   // generic SL distance in ATR units (fallback)
    this.tpAtrMultiplier = 2.0;   // generic TP distance in ATR units (fallback, ~1:2 RR)

    // --- Phase 4: Smart Money Concepts (SMC) config ---
    this.liquidityTolerance = 0.0015;   // equal high/low tolerance (0.15%)
    this.obImpulseATRMultiplier = 1.2;  // impulse candle must be >= this * ATR to count as an order block
    this.obLookback = 20;               // candles to scan back for an order block
    this.fvgLookback = 15;              // candles to scan back for a fair value gap
    this.maxSMCPatternAge = 20;         // SMC patterns stay relevant longer than classic swing patterns

    // --- Phase 4: AI Scoring Engine weights (must sum to 1) ---
    // Phase 4 adaptive threshold bounds. The learner may recommend small
    // changes, but the analyzer always clamps them to ±20% of baseline.
    this.patternEvolutionBaseline = {
      priceTolerance: this.priceTolerance,
      regressionThreshold: this.regressionThreshold,
      minATRPercent: this.minATRPercent
    };
    this.patternEvolution = { ...this.patternEvolutionBaseline };

    this.signalScoreWeights = {
      pattern: 0.20,
      trend: 0.15,
      momentum: 0.10,   // RSI
      atr: 0.10,
      ema: 0.10,
      volume: 0.10,
      liquidity: 0.10,
      bos: 0.08,
      choch: 0.07
    };
  }

  // Fetch candle data from GitHub
  async fetchCandles() {
    try {
      const response = await fetch('https://raw.githubusercontent.com/7tpzbnydgg-commits/pipsight-worker/main/data/scalp-candles.json?t=' + Date.now());
      if (!response.ok) throw new Error('Failed to fetch candles');
      return await response.json();
    } catch (error) {
      console.error('Error fetching candles:', error.message);
      return null;
    }
  }

  // Detect all patterns in candles
    detectAllPatterns(candles, timeframe = "M5") {
    const diagnostics = {
      timeframe,
      candleCount:
        Array.isArray(candles)
          ? candles.length
          : 0,

      status: "RUNNING",
      rejectionStage: null,

      atr: null,
      atrPercent: null,
      minimumATRPercent:
        this.minATRPercent,

      rawCandidates: 0,
      detectorNulls: 0,
      postProcessRejected: 0,
      acceptedPatterns: 0,

      rejectionCounts: {
        patternAge: 0,
        rsiBuy: 0,
        rsiSell: 0,
        volume: 0,
        breakoutBuy: 0,
        breakoutSell: 0,
        invalidTarget: 0,
        invalidStopLoss: 0,
        invalidRiskReward: 0,
        confirmation: 0,
        confidence: 0,
        other: 0
      }
    };

    if (
      !Array.isArray(candles) ||
      candles.length < 30
    ) {
      diagnostics.status =
        "REJECTED";

      diagnostics.rejectionStage =
        "INSUFFICIENT_CANDLES";

      console.log(
        `🧪 Analyzer ${timeframe}: ${JSON.stringify(
          diagnostics
        )}`
      );

      return [];
    }

    // --- 1. ATR volatility gate: skip dead markets entirely ---
    const atr =
      this.calculateATR(
        candles,
        this.atrPeriod
      );

    const lastClose =
      Number(
        candles[
          candles.length - 1
        ]?.close
      );

    const atrPercent =
      Number.isFinite(lastClose) &&
      lastClose > 0
        ? atr / lastClose
        : 0;

    diagnostics.atr =
      Number.isFinite(atr)
        ? Number(atr.toFixed(8))
        : null;

    diagnostics.atrPercent =
      Number.isFinite(atrPercent)
        ? Number(atrPercent.toFixed(8))
        : null;

    if (
      !Number.isFinite(atrPercent) ||
      atrPercent <
        this.minATRPercent
    ) {
      diagnostics.status =
        "REJECTED";

      diagnostics.rejectionStage =
        "ATR_VOLATILITY_GATE";

      console.log(
        `🧪 Analyzer ${timeframe}: ${JSON.stringify(
          diagnostics
        )}`
      );

      return [];
    }

    const detectedPatterns = [];
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    // Shared context computed once per call (EMA / trend / RSI / volume / ATR%)
    // EMA20/EMA50 and trend are computed a single time here and reused by
    // every detector instead of each one recalculating them.
    let ema20 = null, ema50 = null, trend = "SIDEWAYS";
    if (candles.length >= 50) {
      ema20 = this.calculateEMA(closes, 20);
      ema50 = this.calculateEMA(closes, 50);
      if (ema20 > ema50) trend = "UP";
      else if (ema20 < ema50) trend = "DOWN";
    } else if (candles.length >= 20) {
      const recent = candles.slice(-20);
      const change =
        ((recent[recent.length - 1].close - recent[0].close) /
          recent[0].close) *
        100;

      if (change >= 1) trend = "UP";
      else if (change <= -1) trend = "DOWN";
    }

    // --- Phase 4: Swing highs/lows are used by every SMC detector.
    // Calculate them only once and reuse the results.
    const swingHighsSMC = this.findSwingHighs(highs);
    const swingLowsSMC = this.findSwingLows(lows);

    const liquiditySweep = this.detectLiquiditySweep(
      candles,
      swingHighsSMC,
      swingLowsSMC
    );

    const bos = this.detectBOS(
      candles,
      swingHighsSMC,
      swingLowsSMC,
      trend
    );

    const choch = this.detectCHOCH(
      candles,
      swingHighsSMC,
      swingLowsSMC,
      trend
    );

    const context = {
      ema20,
      ema50,
      trend,

      // RSI, volume and ATR are calculated once and reused by all patterns.
      rsi: this.calculateRSI(candles, this.rsiPeriod),
      volumeOk: this.confirmVolume(candles),
      atr,
      atrPercent,

      // Smart Money Concepts confluence
      liquiditySweep,
      bos,
      choch,

      // Filled immediately below
      marketRegime: null
    };

    // Detect market regime once for the complete candle set.
    context.marketRegime = this.detectMarketRegime(
      candles,
      context
    );

    // Common pattern collection helper.
    // Existing patterns pass through the same filters and enrichment logic.
    const collect = pattern => {
      if (!pattern) {
        diagnostics.detectorNulls += 1;

        return;
      }

      diagnostics.rawCandidates += 1;

      const enriched =
        this.postProcessPattern(
          pattern,
          candles,
          context,
          diagnostics
        );

      if (enriched) {
        detectedPatterns.push(
          enriched
        );

        diagnostics.acceptedPatterns += 1;

        return;
      }

      diagnostics.postProcessRejected += 1;
    };

    // Triangle and wedge detectors use the same 30-candle window.
    // Calculate recent arrays and regression slopes only once.
    const recentHighs30 = highs.slice(
      -this.triangleLookback
    );

    const recentLows30 = lows.slice(
      -this.triangleLookback
    );

    const highSlope30 =
      this.linearRegressionSlope(recentHighs30);

    const lowSlope30 =
      this.linearRegressionSlope(recentLows30);

    // Double Top / Double Bottom
    collect(
      this.detectDoubleTop(candles, highs)
    );

    collect(
      this.detectDoubleBottom(candles, lows)
    );

    // Head and Shoulders
    collect(
      this.detectHeadShoulders(candles, highs)
    );

    collect(
      this.detectInverseHeadShoulders(candles, lows)
    );

    // Triangles
    collect(
      this.detectAscendingTriangle(
        candles,
        recentHighs30,
        recentLows30,
        highSlope30,
        lowSlope30
      )
    );

    collect(
      this.detectDescendingTriangle(
        candles,
        recentHighs30,
        recentLows30,
        highSlope30,
        lowSlope30
      )
    );

    collect(
      this.detectSymmetricTriangle(
        candles,
        recentHighs30,
        recentLows30,
        highSlope30,
        lowSlope30
      )
    );

    // Wedges
    collect(
      this.detectRisingWedge(
        candles,
        recentHighs30,
        recentLows30,
        highSlope30,
        lowSlope30,
        trend
      )
    );

    collect(
      this.detectFallingWedge(
        candles,
        recentHighs30,
        recentLows30,
        highSlope30,
        lowSlope30,
        trend
      )
    );

    // Pennants and Flags
    collect(
      this.detectPennant(candles, highs, lows)
    );

    collect(
      this.detectFlag(
        candles,
        highs,
        lows,
        trend
      )
    );

    // Cup and Handle
    collect(
      this.detectCupHandle(
        candles,
        lows,
        closes,
        trend
      )
    );

    // Rectangles
    collect(
      this.detectRectangleTop(candles, highs)
    );

    collect(
      this.detectRectangleBottom(candles, lows)
    );

    // Diamonds
    collect(
      this.detectDiamondTop(
        candles,
        highs,
        lows
      )
    );

    collect(
      this.detectDiamondBottom(
        candles,
        highs,
        lows
      )
    );
   
    // Engulfing Patterns
    collect(
      this.detectBullishEngulfing(candles)
    );

    collect(
      this.detectBearishEngulfing(candles)
    );

    // --- Phase 4: Smart Money Concepts as standalone signals ---
    collect(liquiditySweep);
    collect(bos);
    collect(choch);

    collect(
      this.detectOrderBlock(candles, atr)
    );

    collect(
      this.detectFairValueGap(candles)
    );

    // Tag every detected pattern with its timeframe and regime.
    detectedPatterns.forEach(pattern => {
      pattern.timeframe = timeframe;
      pattern.marketRegime = context.marketRegime;
    });

    // Remove duplicate patterns.
    const uniquePatterns = detectedPatterns.filter(
      (pattern, index, self) =>
        index === self.findIndex(
          item =>
            item.name === pattern.name &&
            item.timeframe === pattern.timeframe
        )
    );

    // Rank by confirmation first, then pattern strength.
    uniquePatterns.sort((a, b) => {
      if (
        b.confirmationScore !==
        a.confirmationScore
      ) {
        return (
          b.confirmationScore -
          a.confirmationScore
        );
      }

      return b.strength - a.strength;
    });

    // Apply timeframe and multi-factor weighting.
    // Phase 4 Signal Score is the primary ranking metric.
    const ranked =
      this.calculateMultiTimeframeConfidence(
        uniquePatterns
      );

    const finalPatterns =
      ranked
        .sort(
          (a, b) =>
            (
              b.signalScore -
              a.signalScore
            ) ||
            (
              b.weightedScore -
              a.weightedScore
            )
        )
        .slice(0, 5);

    diagnostics.status =
      "COMPLETED";

    diagnostics.rejectionStage =
      null;

    diagnostics.uniquePatterns =
      uniquePatterns.length;

    diagnostics.returnedPatterns =
      finalPatterns.length;

    console.log(
      `🧪 Analyzer ${timeframe}: ${JSON.stringify(
        diagnostics
      )}`
    );

    return finalPatterns;

  // =====================================================
  // Step 3: Swing-based Double Top / Double Bottom
  // =====================================================

  detectDoubleTop(candles, highs) {
    const swings = this.findSwingHighs(highs);

    if (swings.length < 2) return null;

    const peak1 = swings[swings.length - 2];
    const peak2 = swings[swings.length - 1];

    // Peaks should not be too close together.
    if (
      peak2.index - peak1.index <
      this.minSwingDistance
    ) {
      return null;
    }

    // Peaks must be similar in price.
    const similarity =
      Math.abs(peak1.value - peak2.value) /
      Math.max(peak1.value, peak2.value);

    if (similarity > this.priceTolerance) {
      return null;
    }

    // Neckline is the lowest low between both peaks.
    const valley = this.lowest(
      candles
        .slice(
          peak1.index,
          peak2.index + 1
        )
        .map(candle => candle.low)
    );

    // Confirm a bearish breakout below the neckline.
    if (
      !this.isBreakoutConfirmed(
        candles,
        valley,
        'SELL'
      )
    ) {
      return null;
    }

    const strength =
      ((peak1.value - valley) / valley) *
      100;

    let confirmationScore =
      this.calculatePatternQuality(
        strength,
        88
      );

    // RSI divergence:
    // Price creates a flat or higher second peak,
    // while RSI creates a weaker second peak.
    const rsi1 = this.calculateRSIAtIndex(
      candles,
      peak1.index,
      this.rsiPeriod
    );

    const rsi2 = this.calculateRSIAtIndex(
      candles,
      peak2.index,
      this.rsiPeriod
    );

    const rsiDivergence =
      peak2.value >=
        peak1.value *
          (1 - this.priceTolerance) &&
      rsi2 < rsi1;

    if (rsiDivergence) {
      confirmationScore += 4;
    }

    // Volume divergence:
    // Volume should weaken into the second peak.
    const vol1 = this.volumeAround(
      candles,
      peak1.index
    );

    const vol2 = this.volumeAround(
      candles,
      peak2.index
    );

    const volumeDivergence =
      vol1 !== null && vol2 !== null
        ? vol2 < vol1
        : null;

    if (volumeDivergence) {
      confirmationScore += 3;
    }

    // Neckline retest adds further confirmation.
    const necklineRetestConfirmed =
      this.detectNecklineRetest(
        candles,
        peak1.index,
        peak2.index,
        valley
      );

    if (necklineRetestConfirmed) {
      confirmationScore += 3;
    }

    confirmationScore = Math.max(
      50,
      Math.min(
        95,
        Math.round(confirmationScore)
      )
    );

    return {
      name: 'Double Top',
      direction: 'SELL',
      strength: Math.round(strength),
      confirmationScore,
      reliability:
        this.getReliability(
          confirmationScore
        ),
      rsiDivergence,
      volumeDivergence,
      necklineRetestConfirmed,

      // Target equals neckline minus pattern height.
      targetPrice: +(
        valley -
        (peak1.value - valley)
      ).toFixed(5),

      // Stop loss sits above the second peak.
      stopLoss: +peak2.value.toFixed(5),
      breakoutLevel: valley,
      _ageIndex: peak2.index
    };
  }
    detectDoubleBottom(candles, lows) {
    const swings = this.findSwingLows(lows);

    if (swings.length < 2) return null;

    const low1 = swings[swings.length - 2];
    const low2 = swings[swings.length - 1];

    if (
      low2.index - low1.index <
      this.minSwingDistance
    ) {
      return null;
    }

    const similarity =
      Math.abs(low1.value - low2.value) /
      Math.max(low1.value, low2.value);

    if (similarity > this.priceTolerance) {
      return null;
    }

    // Neckline is the highest high between both lows.
    const neckline = this.highest(
      candles
        .slice(
          low1.index,
          low2.index + 1
        )
        .map(candle => candle.high)
    );

    if (
      !this.isBreakoutConfirmed(
        candles,
        neckline,
        'BUY'
      )
    ) {
      return null;
    }

    const strength =
      ((neckline - low1.value) /
        low1.value) *
      100;

    let confirmationScore =
      this.calculatePatternQuality(
        strength,
        88
      );

    // RSI divergence:
    // Price creates a flat or lower second low,
    // while RSI creates a stronger second low.
    const rsi1 = this.calculateRSIAtIndex(
      candles,
      low1.index,
      this.rsiPeriod
    );

    const rsi2 = this.calculateRSIAtIndex(
      candles,
      low2.index,
      this.rsiPeriod
    );

    const rsiDivergence =
      low2.value <=
        low1.value *
          (1 + this.priceTolerance) &&
      rsi2 > rsi1;

    if (rsiDivergence) {
      confirmationScore += 4;
    }

    // Volume divergence:
    // Selling volume should weaken into the second low.
    const vol1 = this.volumeAround(
      candles,
      low1.index
    );

    const vol2 = this.volumeAround(
      candles,
      low2.index
    );

    const volumeDivergence =
      vol1 !== null && vol2 !== null
        ? vol2 < vol1
        : null;

    if (volumeDivergence) {
      confirmationScore += 3;
    }

    // Neckline retest adds further confirmation.
    const necklineRetestConfirmed =
      this.detectNecklineRetest(
        candles,
        low1.index,
        low2.index,
        neckline
      );

    if (necklineRetestConfirmed) {
      confirmationScore += 3;
    }

    confirmationScore = Math.max(
      50,
      Math.min(
        95,
        Math.round(confirmationScore)
      )
    );

    return {
      name: 'Double Bottom',
      direction: 'BUY',
      strength: Math.round(strength),
      confirmationScore,
      reliability:
        this.getReliability(
          confirmationScore
        ),
      rsiDivergence,
      volumeDivergence,
      necklineRetestConfirmed,

      // Target equals neckline plus pattern height.
      targetPrice: +(
        neckline +
        (neckline - low1.value)
      ).toFixed(5),

      // Stop loss sits below the second low.
      stopLoss: +low2.value.toFixed(5),
      breakoutLevel: neckline,
      _ageIndex: low2.index
    };
  }

  detectHeadShoulders(candles) {
    const swings = this.findSwingHighs(
      candles.map(candle => candle.high)
    );

    if (swings.length < 3) return null;

    // Use the latest three swing highs.
    const left =
      swings[swings.length - 3];

    const head =
      swings[swings.length - 2];

    const right =
      swings[swings.length - 1];

    // The head must be above both shoulders.
    if (
      !(
        head.value > left.value &&
        head.value > right.value
      )
    ) {
      return null;
    }

    // Both shoulders should be reasonably similar.
    const shoulderDiff =
      Math.abs(left.value - right.value) /
      Math.max(left.value, right.value);

    if (shoulderDiff > 0.03) {
      return null;
    }

    // Enforce minimum spacing between swing points.
    if (
      head.index - left.index <
        this.minSwingDistance ||
      right.index - head.index <
        this.minSwingDistance
    ) {
      return null;
    }

    // Calculate the neckline from both valleys.
    const leftValley = this.lowest(
      candles
        .slice(
          left.index,
          head.index + 1
        )
        .map(candle => candle.low)
    );

    const rightValley = this.lowest(
      candles
        .slice(
          head.index,
          right.index + 1
        )
        .map(candle => candle.low)
    );

    const neckline =
      (leftValley + rightValley) / 2;

    if (
      !this.isBreakoutConfirmed(
        candles,
        neckline,
        'SELL'
      )
    ) {
      return null;
    }
        const strength =
      ((head.value - neckline) /
        neckline) *
      100;

    let confirmationScore =
      this.calculatePatternQuality(
        strength,
        90
      );

    // Shoulder symmetry is now scored instead of
    // relying only on a hard pass/fail threshold.
    const shoulderSymmetryScore =
      Math.max(
        0,
        100 - shoulderDiff * 2000
      );

    confirmationScore =
      confirmationScore * 0.85 +
      shoulderSymmetryScore * 0.15;

    // A declining neckline strengthens
    // the bearish Head and Shoulders setup.
    const necklineSlope =
      (rightValley - leftValley) /
      (right.index - head.index || 1);

    if (necklineSlope < 0) {
      confirmationScore += 3;
    }

    confirmationScore = Math.max(
      50,
      Math.min(
        95,
        Math.round(confirmationScore)
      )
    );

    return {
      name: 'Head and Shoulders',
      direction: 'SELL',
      strength: Math.round(strength),
      confirmationScore,
      reliability:
        this.getReliability(
          confirmationScore
        ),
      shoulderSymmetryScore:
        Math.round(
          shoulderSymmetryScore
        ),
      necklineSlope,

      // Target equals neckline minus
      // the height of the head.
      targetPrice: +(
        neckline -
        (head.value - neckline)
      ).toFixed(5),

      // Stop loss sits above the right shoulder.
      stopLoss: +right.value.toFixed(5),
      breakoutLevel: neckline,
      _ageIndex: right.index
    };
  }

  detectInverseHeadShoulders(candles) {
    const swings = this.findSwingLows(
      candles.map(candle => candle.low)
    );

    if (swings.length < 3) return null;

    // Use the latest three swing lows.
    const left =
      swings[swings.length - 3];

    const head =
      swings[swings.length - 2];

    const right =
      swings[swings.length - 1];

    // The head must be below both shoulders.
    if (
      !(
        head.value < left.value &&
        head.value < right.value
      )
    ) {
      return null;
    }

    // Both shoulders should be reasonably similar.
    const shoulderDiff =
      Math.abs(left.value - right.value) /
      Math.max(left.value, right.value);

    if (shoulderDiff > 0.03) {
      return null;
    }

    // Enforce minimum spacing between swing points.
    if (
      head.index - left.index <
        this.minSwingDistance ||
      right.index - head.index <
        this.minSwingDistance
    ) {
      return null;
    }

    // Calculate the neckline from both peaks.
    const leftPeak = this.highest(
      candles
        .slice(
          left.index,
          head.index + 1
        )
        .map(candle => candle.high)
    );

    const rightPeak = this.highest(
      candles
        .slice(
          head.index,
          right.index + 1
        )
        .map(candle => candle.high)
    );

    const neckline =
      (leftPeak + rightPeak) / 2;

    if (
      !this.isBreakoutConfirmed(
        candles,
        neckline,
        'BUY'
      )
    ) {
      return null;
    }

    const strength =
      ((neckline - head.value) /
        head.value) *
      100;

    let confirmationScore =
      this.calculatePatternQuality(
        strength,
        90
      );

    // Score shoulder symmetry for a smoother
    // and more reliable confirmation value.
    const shoulderSymmetryScore =
      Math.max(
        0,
        100 - shoulderDiff * 2000
      );

    confirmationScore =
      confirmationScore * 0.85 +
      shoulderSymmetryScore * 0.15;
    // A rising neckline strengthens
    // the bullish inverse Head and Shoulders setup.
    const necklineSlope =
      (rightPeak - leftPeak) /
      (right.index - head.index || 1);

    if (necklineSlope > 0) {
      confirmationScore += 3;
    }

    confirmationScore = Math.max(
      50,
      Math.min(
        95,
        Math.round(confirmationScore)
      )
    );

    return {
      name: 'Inverse Head and Shoulders',
      direction: 'BUY',
      strength: Math.round(strength),
      confirmationScore,
      reliability:
        this.getReliability(
          confirmationScore
        ),
      shoulderSymmetryScore:
        Math.round(
          shoulderSymmetryScore
        ),
      necklineSlope,

      // Target equals neckline plus
      // the height of the head.
      targetPrice: +(
        neckline +
        (neckline - head.value)
      ).toFixed(5),

      // Stop loss sits below the right shoulder.
      stopLoss: +right.value.toFixed(5),
      breakoutLevel: neckline,
      _ageIndex: right.index
    };
  }

  detectAscendingTriangle(
    candles,
    recentHighs,
    recentLows,
    highSlope,
    lowSlope
  ) {
    if (
      Math.abs(highSlope) <
        this.regressionThreshold &&
      lowSlope >
        this.regressionThreshold
    ) {
      const resistance =
        this.highest(recentHighs);

      // Flat resistance must be touched
      // multiple times to confirm the structure.
      const resistanceTouches =
        this.countTouches(
          recentHighs,
          resistance
        );

      if (
        resistanceTouches <
        this.minTouchCount
      ) {
        return null;
      }

      if (
        !this.isBreakoutConfirmed(
          candles,
          resistance,
          'BUY'
        )
      ) {
        return null;
      }

      const confirmationScore = 90;

      return {
        name: 'Ascending Triangle',
        direction: 'BUY',
        strength: 82,
        confirmationScore,
        reliability:
          this.getReliability(
            confirmationScore
          ),
        breakoutLevel: resistance,
        resistanceTouches
      };
    }

    return null;
  }

  detectDescendingTriangle(
    candles,
    recentHighs,
    recentLows,
    highSlope,
    lowSlope
  ) {
    if (
      highSlope <
        -this.regressionThreshold &&
      Math.abs(lowSlope) <
        this.regressionThreshold
    ) {
      const support =
        this.lowest(recentLows);

      // Flat support must be touched
      // multiple times to confirm the structure.
      const supportTouches =
        this.countTouches(
          recentLows,
          support
        );

      if (
        supportTouches <
        this.minTouchCount
      ) {
        return null;
      }

      if (
        !this.isBreakoutConfirmed(
          candles,
          support,
          'SELL'
        )
      ) {
        return null;
      }

      const confirmationScore = 90;

      return {
        name: 'Descending Triangle',
        direction: 'SELL',
        strength: 82,
        confirmationScore,
        reliability:
          this.getReliability(
            confirmationScore
          ),
        breakoutLevel: support,
        supportTouches
      };
    }

    return null;
  }

  detectSymmetricTriangle(
    candles,
    recentHighs,
    recentLows,
    highSlope,
    lowSlope
  ) {
    if (
      highSlope <
        -this.regressionThreshold &&
      lowSlope >
        this.regressionThreshold
    ) {
      const confirmationScore = 88;

      return {
        name: 'Symmetric Triangle',
        direction: 'NEUTRAL',
        strength: 78,
        confirmationScore,
        reliability:
          this.getReliability(
            confirmationScore
          )
      };
    }

    return null;
  }
    
  detectRisingWedge(
    candles,
    recentHighs,
    recentLows,
    highSlope,
    lowSlope,
    trend
  ) {
    if (
      highSlope >
        this.regressionThreshold &&
      lowSlope >
        this.regressionThreshold &&
      highSlope > lowSlope
    ) {
      const support =
        this.lowest(recentLows);

      if (
        !this.isBreakoutConfirmed(
          candles,
          support,
          'SELL'
        )
      ) {
        return null;
      }

      if (trend !== 'UP') {
        return null;
      }

      const confirmationScore = 90;

      return {
        name: 'Rising Wedge',
        direction: 'SELL',
        strength: 80,
        confirmationScore,
        reliability:
          this.getReliability(
            confirmationScore
          ),
        breakoutLevel: support
      };
    }

    return null;
  }

  detectFallingWedge(
    candles,
    recentHighs,
    recentLows,
    highSlope,
    lowSlope,
    trend
  ) {
    if (
      highSlope <
        -this.regressionThreshold &&
      lowSlope <
        -this.regressionThreshold &&
      Math.abs(lowSlope) >
        Math.abs(highSlope)
    ) {
      const resistance =
        this.highest(recentHighs);

      if (
        !this.isBreakoutConfirmed(
          candles,
          resistance,
          'BUY'
        )
      ) {
        return null;
      }

      if (trend !== 'DOWN') {
        return null;
      }

      const confirmationScore = 90;

      return {
        name: 'Falling Wedge',
        direction: 'BUY',
        strength: 80,
        confirmationScore,
        reliability:
          this.getReliability(
            confirmationScore
          ),
        breakoutLevel: resistance
      };
    }

    return null;
  }

  detectPennant(candles, highs, lows) {
    if (candles.length < 40) {
      return null;
    }

    const recentHighs =
      highs.slice(-20);

    const recentLows =
      lows.slice(-20);

    const highSlope =
      this.linearRegressionSlope(
        recentHighs
      );

    const lowSlope =
      this.linearRegressionSlope(
        recentLows
      );

    const closes =
      candles.map(candle => candle.close);

    const impulse =
      Math.abs(
        closes[20] - closes[0]
      ) / closes[0];

    if (
      impulse > 0.03 &&
      highSlope < 0 &&
      lowSlope > 0
    ) {
      const direction =
        closes[20] > closes[0]
          ? 'BUY'
          : 'SELL';

      const breakoutLevel =
        direction === 'BUY'
          ? this.highest(recentHighs)
          : this.lowest(recentLows);

      if (
        !this.isBreakoutConfirmed(
          candles,
          breakoutLevel,
          direction
        )
      ) {
        return null;
      }

      const confirmationScore = 91;

      return {
        name: 'Pennant',
        direction,
        strength: 84,
        confirmationScore,
        reliability:
          this.getReliability(
            confirmationScore
          ),
        breakoutLevel
      };
    }

    return null;
  }

  detectFlag(candles, highs, lows, trend) {
    if (candles.length < 40) {
      return null;
    }

    const closes =
      candles.map(candle => candle.close);

    const impulse =
      (closes[20] - closes[0]) /
      closes[0];

    const flagSlope =
      this.linearRegressionSlope(
        closes.slice(-15)
      );

    if (
      impulse > 0.03 &&
      flagSlope < 0
    ) {
      const resistance =
        this.highest(
          highs.slice(-15)
        );

      if (
        !this.isBreakoutConfirmed(
          candles,
          resistance,
          'BUY'
        )
      ) {
        return null;
      }

      if (trend !== 'UP') {
        return null;
      }

      const confirmationScore = 92;

      return {
        name: 'Bull Flag',
        direction: 'BUY',
        strength: 85,
        confirmationScore,
        reliability:
          this.getReliability(
            confirmationScore
          ),
        breakoutLevel: resistance
      };
    }

    if (
      impulse < -0.03 &&
      flagSlope > 0
    ) {
      const support =
        this.lowest(
          lows.slice(-15)
        );

      if (
        !this.isBreakoutConfirmed(
          candles,
          support,
          'SELL'
        )
      ) {
        return null;
      }

      if (trend !== 'DOWN') {
        return null;
      }

      const confirmationScore = 92;

      return {
        name: 'Bear Flag',
        direction: 'SELL',
        strength: 85,
        confirmationScore,
        reliability:
          this.getReliability(
            confirmationScore
          ),
        breakoutLevel: support
      };
    }

    return null;
  }

  detectCupHandle(
    candles,
    lows,
    closes,
    trend
  ) {
    const n = candles.length;

    if (n < 30) {
      return null;
    }

    const recent =
      lows.slice(n - 30);

    const minIdx =
      recent.indexOf(
        this.lowest(recent)
      );

    if (
      minIdx < 5 ||
      minIdx > recent.length - 10
    ) {
      return null;
    }

    // Cup formation.
    const cupDepth =
      (
        this.highest(
          recent.slice(0, minIdx)
        ) -
        recent[minIdx]
      ) /
      recent[minIdx];

    if (
      cupDepth < 0.02 ||
      cupDepth > 0.15
    ) {
      return null;
    }

    // Handle formation.
    const handleHigh =
      this.highest(
        recent.slice(
          minIdx + 1,
          minIdx + 6
        )
      );

    const handleRange =
      (
        handleHigh -
        recent[minIdx]
      ) /
      recent[minIdx];

    if (handleRange > 0.08) {
      return null;
    }

    if (trend !== 'UP') {
      return null;
    }

    const confirmationScore = 85;

    return {
      name: 'Cup and Handle',
      direction: 'BUY',
      strength: 72,
      confirmationScore,
      reliability:
        this.getReliability(
          confirmationScore
        ),
      breakoutLevel: handleHigh
    };
  }

  detectRectangleTop(candles, highs) {
    const n = candles.length;

    if (n < 20) {
      return null;
    }

    const recent =
      highs.slice(n - 20);

    if (
      this.isFlat(recent, 0.01)
    ) {
      const confirmationScore = 70;

      return {
        name: 'Rectangle Top',
        direction: 'SELL',
        strength: 65,
        confirmationScore,
        reliability:
          this.getReliability(
            confirmationScore
          ),
        breakoutLevel:
          this.lowest(recent)
      };
    }

    return null;
  }

  detectRectangleBottom(candles, lows) {
    const n = candles.length;

    if (n < 20) {
      return null;
    }

    const recent =
      lows.slice(n - 20);

    if (
      this.isFlat(recent, 0.01)
    ) {
      const confirmationScore = 70;

      return {
        name: 'Rectangle Bottom',
        direction: 'BUY',
        strength: 65,
        confirmationScore,
        reliability:
          this.getReliability(
            confirmationScore
          ),
        breakoutLevel:
          this.highest(recent)
      };
    }

    return null;
  }

  detectDiamondTop(
    candles,
    highs,
    lows
  ) {
    const n = candles.length;

    if (n < 25) {
      return null;
    }

    const recent = {
      highs: highs.slice(n - 25),
      lows: lows.slice(n - 25)
    };
    const mid = Math.floor(
      recent.highs.length / 2
    );

    const firstHalfExpand =
      recent.highs[0] -
        recent.lows[0] <
      recent.highs[mid] -
        recent.lows[mid];

    const secondHalfShrink =
      recent.highs[mid] -
        recent.lows[mid] >
      recent.highs[
        recent.highs.length - 1
      ] -
        recent.lows[
          recent.lows.length - 1
        ];

    if (
      firstHalfExpand &&
      secondHalfShrink
    ) {
      const confirmationScore = 80;

      return {
        name: 'Diamond Top',
        direction: 'SELL',
        strength: 73,
        confirmationScore,
        reliability:
          this.getReliability(
            confirmationScore
          )
      };
    }

    return null;
  }

  detectDiamondBottom(
    candles,
    highs,
    lows
  ) {
    const n = candles.length;

    if (n < 25) {
      return null;
    }

    const recent = {
      highs: highs.slice(n - 25),
      lows: lows.slice(n - 25)
    };

    const mid = Math.floor(
      recent.highs.length / 2
    );

    const firstHalfExpand =
      recent.highs[0] -
        recent.lows[0] <
      recent.highs[mid] -
        recent.lows[mid];

    const secondHalfShrink =
      recent.highs[mid] -
        recent.lows[mid] >
      recent.highs[
        recent.highs.length - 1
      ] -
        recent.lows[
          recent.lows.length - 1
        ];

    if (
      firstHalfExpand &&
      secondHalfShrink
    ) {
      const confirmationScore = 80;

      return {
        name: 'Diamond Bottom',
        direction: 'BUY',
        strength: 73,
        confirmationScore,
        reliability:
          this.getReliability(
            confirmationScore
          )
      };
    }

    return null;
  }

  detectBullishEngulfing(candles) {
    if (
      !candles ||
      candles.length < 2
    ) {
      return null;
    }

    const previous =
      candles[candles.length - 2];

    const current =
      candles[candles.length - 1];

    const previousBearish =
      previous.close <
      previous.open;

    const currentBullish =
      current.close >
      current.open;

    const bodyEngulfed =
      current.open <=
        previous.close &&
      current.close >=
        previous.open;

    if (
      previousBearish &&
      currentBullish &&
      bodyEngulfed
    ) {
      const previousBody =
        Math.abs(
          previous.close -
          previous.open
        );

      const currentBody =
        Math.abs(
          current.close -
          current.open
        );

      const bodyRatio =
        previousBody > 0
          ? currentBody /
            previousBody
          : 1;

      const strength =
        Math.min(
          95,
          Math.round(
            70 + bodyRatio * 10
          )
        );

      const confirmationScore =
        Math.min(
          93,
          Math.round(
            78 + bodyRatio * 7
          )
        );

      return {
        name: 'Bullish Engulfing',
        direction: 'BUY',
        strength,
        confirmationScore,
        reliability:
          this.getReliability(
            confirmationScore
          ),
        _ageIndex:
          candles.length - 1
      };
    }

    return null;
  }

  detectBearishEngulfing(candles) {
    if (
      !candles ||
      candles.length < 2
    ) {
      return null;
    }

    const previous =
      candles[candles.length - 2];

    const current =
      candles[candles.length - 1];

    const previousBullish =
      previous.close >
      previous.open;

    const currentBearish =
      current.close <
      current.open;

    const bodyEngulfed =
      current.open >=
        previous.close &&
      current.close <=
        previous.open;

    if (
      previousBullish &&
      currentBearish &&
      bodyEngulfed
    ) {
      const previousBody =
        Math.abs(
          previous.close -
          previous.open
        );

      const currentBody =
        Math.abs(
          current.close -
          current.open
        );

      const bodyRatio =
        previousBody > 0
          ? currentBody /
            previousBody
          : 1;

      const strength =
        Math.min(
          95,
          Math.round(
            70 + bodyRatio * 10
          )
        );

      const confirmationScore =
        Math.min(
          93,
          Math.round(
            78 + bodyRatio * 7
          )
        );

      return {
        name: 'Bearish Engulfing',
        direction: 'SELL',
        strength,
        confirmationScore,
        reliability:
          this.getReliability(
            confirmationScore
          ),
        _ageIndex:
          candles.length - 1
      };
    }

    return null;
  }

  // =====================================================
  // Phase 4: Smart Money Concepts
  // =====================================================

  /**
   * Detect equal swing highs.
   *
   * Equal highs may represent buy-side liquidity
   * resting above the market.
   */
  detectEqualHighs(
    swingHighs,
    tolerancePercent =
      this.liquidityTolerance
  ) {
    if (
      !swingHighs ||
      swingHighs.length < 2
    ) {
      return null;
    }

    // Start with the latest swing points because
    // recent liquidity levels are more relevant.
    for (
      let i = swingHighs.length - 1;
      i > 0;
      i--
    ) {
      for (
        let j = i - 1;
        j >= 0;
        j--
      ) {
        const first =
          swingHighs[j];

        const second =
          swingHighs[i];

        const difference =
          Math.abs(
            second.value -
            first.value
          ) / first.value;

        if (
          difference <=
          tolerancePercent
        ) {
          return {
            level:
              (
                first.value +
                second.value
              ) / 2,

            indices: [
              first.index,
              second.index
            ],

            first,
            second
          };
        }
      }
    }

    return null;
  }

  /**
   * Detect equal swing lows.
   *
   * Equal lows may represent sell-side liquidity
   * resting below the market.
   */
  detectEqualLows(
    swingLows,
    tolerancePercent =
      this.liquidityTolerance
  ) {
    if (
      !swingLows ||
      swingLows.length < 2
    ) {
      return null;
    }

    for (
      let i = swingLows.length - 1;
      i > 0;
      i--
    ) {
      for (
        let j = i - 1;
        j >= 0;
        j--
      ) {
        const first =
          swingLows[j];

        const second =
          swingLows[i];

        const difference =
          Math.abs(
            second.value -
            first.value
          ) / first.value;

        if (
          difference <=
          tolerancePercent
        ) {
          return {
            level:
              (
                first.value +
                second.value
              ) / 2,

            indices: [
              first.index,
              second.index
            ],

            first,
            second
          };
        }
      }
    }

    return null;
  }

  /**
   * Detect a liquidity sweep.
   *
   * A valid sweep temporarily trades through
   * an equal-high/equal-low liquidity level,
   * then closes back inside the previous range.
   */
  detectLiquiditySweep(
    candles,
    swingHighs,
    swingLows
  ) {
    if (
      !candles ||
      candles.length < 5
    ) {
      return null;
    }

    const lastIndex =
      candles.length - 1;

    const current =
      candles[lastIndex];

    const previous =
      candles[lastIndex - 1];

    const equalHighs =
      this.detectEqualHighs(
        swingHighs
      );

    const equalLows =
      this.detectEqualLows(
        swingLows
      );

    // Buy-side liquidity sweep:
    // Price trades above equal highs,
    // but closes back below the level.
    if (
      equalHighs &&
      current.high >
        equalHighs.level &&
      current.close <
        equalHighs.level
    ) {
      const rejection =
        (
          current.high -
          current.close
        ) /
        current.high;

      const confirmationScore =
        Math.min(
          95,
          Math.round(
            82 +
            rejection * 1000
          )
        );

      return {
        name:
          'Liquidity Sweep (Buy-Side)',
        direction: 'SELL',
        strength:
          Math.min(
            95,
            Math.round(
              75 +
              rejection * 1000
            )
          ),
        confirmationScore,
        reliability:
          this.getReliability(
            confirmationScore
          ),
        liquidityLevel:
          equalHighs.level,
        sweptLevel:
          equalHighs.level,
        previousClose:
          previous.close,
        breakoutLevel:
          equalHighs.level,
        _ageIndex:
          lastIndex
      };
    }

    // Sell-side liquidity sweep:
    // Price trades below equal lows,
    // but closes back above the level.
    if (
      equalLows &&
      current.low <
        equalLows.level &&
      current.close >
        equalLows.level
    ) {
      const rejection =
        (
          current.close -
          current.low
        ) /
        current.low;

      const confirmationScore =
        Math.min(
          95,
          Math.round(
            82 +
            rejection * 1000
          )
        );

      return {
        name:
          'Liquidity Sweep (Sell-Side)',
        direction: 'BUY',
        strength:
          Math.min(
            95,
            Math.round(
              75 +
              rejection * 1000
            )
          ),
        confirmationScore,
        reliability:
          this.getReliability(
            confirmationScore
          ),
        liquidityLevel:
          equalLows.level,
        sweptLevel:
          equalLows.level,
        previousClose:
          previous.close,
        breakoutLevel:
          equalLows.level,
        _ageIndex:
          lastIndex
      };
    }

    return null;
  }

  /**
   * Detect Break of Structure.
   *
   * A bullish BOS occurs when price closes above
   * the latest confirmed swing high.
   *
   * A bearish BOS occurs when price closes below
   * the latest confirmed swing low.
   */
  detectBOS(
    candles,
    swingHighs,
    swingLows,
    trend = 'SIDEWAYS'
  ) {
    if (
      !candles ||
      candles.length < 5
    ) {
      return null;
    }

    const lastIndex =
      candles.length - 1;

    const current =
      candles[lastIndex];

    const previous =
      candles[lastIndex - 1];

    const latestHigh =
      this.getLatestSwingBeforeIndex(
        swingHighs,
        lastIndex
      );

    const latestLow =
      this.getLatestSwingBeforeIndex(
        swingLows,
        lastIndex
      );

    // Bullish continuation BOS.
    if (
      latestHigh &&
      current.close >
        latestHigh.value &&
      previous.close <=
        latestHigh.value
    ) {
      const breakoutStrength =
        (
          current.close -
          latestHigh.value
        ) /
        latestHigh.value;

      let confirmationScore =
        Math.min(
          95,
          Math.round(
            82 +
            breakoutStrength * 1000
          )
        );

      // A BOS aligned with the existing trend
      // receives a small confirmation boost.
      if (trend === 'UP') {
        confirmationScore =
          Math.min(
            95,
            confirmationScore + 4
          );
      }

      return {
        name: 'Break of Structure',
        direction: 'BUY',
        structureType:
          'BULLISH_BOS',
        strength:
          Math.min(
            95,
            Math.round(
              75 +
              breakoutStrength * 1000
            )
          ),
        confirmationScore,
        reliability:
          this.getReliability(
            confirmationScore
          ),
        brokenSwingIndex:
          latestHigh.index,
        breakoutLevel:
          latestHigh.value,
        _ageIndex:
          lastIndex,
        _maxAge:
          this.maxSMCPatternAge
      };
    }

    // Bearish continuation BOS.
    if (
      latestLow &&
      current.close <
        latestLow.value &&
      previous.close >=
        latestLow.value
    ) {
      const breakoutStrength =
        (
          latestLow.value -
          current.close
        ) /
        latestLow.value;

      let confirmationScore =
        Math.min(
          95,
          Math.round(
            82 +
            breakoutStrength * 1000
          )
        );

      if (trend === 'DOWN') {
        confirmationScore =
          Math.min(
            95,
            confirmationScore + 4
          );
      }

      return {
        name: 'Break of Structure',
        direction: 'SELL',
        structureType:
          'BEARISH_BOS',
        strength:
          Math.min(
            95,
            Math.round(
              75 +
              breakoutStrength * 1000
            )
          ),
        confirmationScore,
        reliability:
          this.getReliability(
            confirmationScore
          ),
        brokenSwingIndex:
          latestLow.index,
        breakoutLevel:
          latestLow.value,
        _ageIndex:
          lastIndex,
        _maxAge:
          this.maxSMCPatternAge
      };
    }

    return null;
  }

  detectCHOCH(
    candles,
    swingHighs,
    swingLows,
    trend
  ) {
    const lastClose =
      candles[candles.length - 1].close;

    // Bullish Change of Character:
    // Existing downtrend breaks above
    // the latest confirmed swing high.
    if (
      trend === 'DOWN' &&
      swingHighs.length >= 1
    ) {
      const lastSwingHigh =
        swingHighs[
          swingHighs.length - 1
        ];

      if (
        lastClose >
        lastSwingHigh.value
      ) {
        const strength =
          (
            (
              lastClose -
              lastSwingHigh.value
            ) /
            lastSwingHigh.value
          ) *
          100;

        return {
          name:
            'Change of Character',
          direction: 'BUY',
          strength:
            Math.min(
              Math.round(
                strength * 20
              ),
              100
            ),
          confirmationScore: 80,
          reliability:
            this.getReliability(80),
          breakoutLevel:
            lastSwingHigh.value,
          _ageIndex:
            lastSwingHigh.index,
          _maxAge:
            this.maxSMCPatternAge
        };
      }
    }

    // Bearish Change of Character:
    // Existing uptrend breaks below
    // the latest confirmed swing low.
    if (
      trend === 'UP' &&
      swingLows.length >= 1
    ) {
      const lastSwingLow =
        swingLows[
          swingLows.length - 1
        ];

      if (
        lastClose <
        lastSwingLow.value
      ) {
        const strength =
          (
            (
              lastSwingLow.value -
              lastClose
            ) /
            lastSwingLow.value
          ) *
          100;

        return {
          name:
            'Change of Character',
          direction: 'SELL',
          strength:
            Math.min(
              Math.round(
                strength * 20
              ),
              100
            ),
          confirmationScore: 80,
          reliability:
            this.getReliability(80),
          breakoutLevel:
            lastSwingLow.value,
          _ageIndex:
            lastSwingLow.index,
          _maxAge:
            this.maxSMCPatternAge
        };
      }
    }

    return null;
  }

  /**
   * Detect institutional Order Blocks.
   *
   * An Order Block is treated as the final
   * opposite-direction candle before a strong
   * impulsive market move.
   */
  detectOrderBlock(candles, atr) {
    const n = candles.length;

    if (
      n < 6 ||
      !atr
    ) {
      return null;
    }

    const start =
      Math.max(
        1,
        n - this.obLookback
      );

    // Scan from newest to oldest so the most
    // recent valid Order Block is returned.
    for (
      let i = n - 2;
      i >= start;
      i--
    ) {
      const candle =
        candles[i];

      const next =
        candles[i + 1];

      // Bullish Order Block:
      // A bearish candle followed immediately
      // by a strong bullish impulse.
      if (
        candle.close <
        candle.open
      ) {
        const impulseMove =
          next.close -
          next.open;

        if (
          impulseMove >
          atr *
            this.obImpulseATRMultiplier
        ) {
          const mitigated =
            candles
              .slice(i + 2)
              .some(
                future =>
                  future.low <=
                    candle.high &&
                  future.low >=
                    candle.low
              );

          return {
            name:
              'Bullish Order Block',
            direction: 'BUY',
            strength:
              Math.min(
                Math.round(
                  (
                    impulseMove /
                    atr
                  ) *
                  20
                ),
                100
              ),
            confirmationScore:
              mitigated ? 70 : 83,
            reliability:
              this.getReliability(
                mitigated ? 70 : 83
              ),
            obHigh: candle.high,
            obLow: candle.low,
            mitigated,
            _ageIndex: i,
            _maxAge:
              this.maxSMCPatternAge
          };
        }
      }

      // Bearish Order Block:
      // A bullish candle followed immediately
      // by a strong bearish impulse.
      if (
        candle.close >
        candle.open
      ) {
        const impulseMove =
          next.open -
          next.close;

        if (
          impulseMove >
          atr *
            this.obImpulseATRMultiplier
        ) {
          const mitigated =
            candles
              .slice(i + 2)
              .some(
                future =>
                  future.high >=
                    candle.low &&
                  future.high <=
                    candle.high
              );

          return {
            name:
              'Bearish Order Block',
            direction: 'SELL',
            strength:
              Math.min(
                Math.round(
                  (
                    impulseMove /
                    atr
                  ) *
                  20
                ),
                100
              ),
            confirmationScore:
              mitigated ? 70 : 83,
            reliability:
              this.getReliability(
                mitigated ? 70 : 83
              ),
            obHigh: candle.high,
            obLow: candle.low,
            mitigated,
            _ageIndex: i,
            _maxAge:
              this.maxSMCPatternAge
          };
        }
      }
    }

    return null;
  }
  detectFairValueGap(candles) {
    const n = candles.length;

    if (n < 3) {
      return null;
    }

    const start =
      Math.max(
        2,
        n - this.fvgLookback
      );

    // Scan from newest to oldest so the latest
    // unbalanced price area is prioritised.
    for (
      let i = n - 1;
      i >= start;
      i--
    ) {
      const firstCandle =
        candles[i - 2];

      const thirdCandle =
        candles[i];

      // Bullish Fair Value Gap:
      // The third candle's low remains above
      // the first candle's high.
      if (
        firstCandle.high <
        thirdCandle.low
      ) {
        const gapSize =
          (
            (
              thirdCandle.low -
              firstCandle.high
            ) /
            firstCandle.high
          ) *
          100;

        return {
          name:
            'Fair Value Gap (Bullish)',
          direction: 'BUY',
          strength:
            Math.min(
              Math.round(
                gapSize * 20
              ),
              100
            ),
          confirmationScore: 78,
          reliability:
            this.getReliability(78),
          gapTop:
            thirdCandle.low,
          gapBottom:
            firstCandle.high,
          _ageIndex: i,
          _maxAge:
            this.maxSMCPatternAge
        };
      }

      // Bearish Fair Value Gap:
      // The third candle's high remains below
      // the first candle's low.
      if (
        firstCandle.low >
        thirdCandle.high
      ) {
        const gapSize =
          (
            (
              firstCandle.low -
              thirdCandle.high
            ) /
            thirdCandle.high
          ) *
          100;

        return {
          name:
            'Fair Value Gap (Bearish)',
          direction: 'SELL',
          strength:
            Math.min(
              Math.round(
                gapSize * 20
              ),
              100
            ),
          confirmationScore: 78,
          reliability:
            this.getReliability(78),
          gapTop:
            firstCandle.low,
          gapBottom:
            thirdCandle.high,
          _ageIndex: i,
          _maxAge:
            this.maxSMCPatternAge
        };
      }
    }

    return null;
  }

  // =====================================================
  // EMA Trend Detection
  // =====================================================

  /**
   * Standalone trend helper retained for
   * backward compatibility.
   *
   * detectAllPatterns() already calculates EMA values
   * once and passes the result through shared context.
   */
  detectTrend(candles, period = 20) {
    if (
      !candles ||
      candles.length <
        Math.max(period, 50)
    ) {
      // Fall back to percentage change when
      // EMA50 cannot be calculated.
      if (
        !candles ||
        candles.length < period
      ) {
        return 'SIDEWAYS';
      }

      const recent =
        candles.slice(-period);

      const change =
        (
          (
            recent[
              recent.length - 1
            ].close -
            recent[0].close
          ) /
          recent[0].close
        ) *
        100;

      if (change >= 1) {
        return 'UP';
      }

      if (change <= -1) {
        return 'DOWN';
      }

      return 'SIDEWAYS';
    }

    const closes =
      candles.map(
        candle => candle.close
      );

    const ema20 =
      this.calculateEMA(
        closes,
        20
      );

    const ema50 =
      this.calculateEMA(
        closes,
        50
      );

    if (ema20 > ema50) {
      return 'UP';
    }

    if (ema20 < ema50) {
      return 'DOWN';
    }

    return 'SIDEWAYS';
  }

  // =====================================================
  // General Helper Functions
  // =====================================================

  isTrendingUp(values, threshold) {
    if (values.length < 5) {
      return false;
    }

    const change =
      (
        values[
          values.length - 1
        ] -
        values[0]
      ) /
      values[0];

    return change > threshold;
  }

  isTrendingDown(values, threshold) {
    if (values.length < 5) {
      return false;
    }

    const change =
      (
        values[0] -
        values[
          values.length - 1
        ]
      ) /
      values[0];

    return change > threshold;
  }

  isFlat(values, threshold) {
    if (values.length < 5) {
      return false;
    }

    const max =
      this.highest(values);

    const min =
      this.lowest(values);

    const range =
      (max - min) / min;

    return range < threshold;
  }

  // --- Phase 2: efficient max/min helpers ---
  // Avoid Math.max(...largeArray) and Math.min(...largeArray),
  // which may create unnecessary call-stack and memory pressure.
  highest(values) {
    let max = -Infinity;

    for (
      let i = 0;
      i < values.length;
      i++
    ) {
      if (values[i] > max) {
        max = values[i];
      }
    }

    return max;
  }

  lowest(values) {
    let min = Infinity;

    for (
      let i = 0;
      i < values.length;
      i++
    ) {
      if (values[i] < min) {
        min = values[i];
      }
    }

    return min;
  }

  // Count how many times price touched
  // a support or resistance level.
  countTouches(
    values,
    level,
    tolerancePercent = 0.0015
  ) {
    if (!level) {
      return 0;
    }

    let count = 0;

    for (
      let i = 0;
      i < values.length;
      i++
    ) {
      const distance =
        Math.abs(
          values[i] - level
        ) / level;

      if (
        distance <=
        tolerancePercent
      ) {
        count++;
      }
    }

    return count;
  }

  // Calculate average synthetic volume
  // around a historical swing point.
  volumeAround(
    candles,
    index,
    window = 3
  ) {
    const start =
      Math.max(
        0,
        index - window
      );

    const end =
      Math.min(
        candles.length,
        index + window + 1
      );

    const slice =
      candles.slice(start, end);

    if (
      slice.length === 0 ||
      slice[0].volume === undefined
    ) {
      return null;
    }

    let totalVolume = 0;

    for (
      let i = 0;
      i < slice.length;
      i++
    ) {
      totalVolume +=
        slice[i].volume || 0;
    }

    return (
      totalVolume /
      slice.length
    );
  }

  // Calculate RSI as it existed at
  // a specific historical candle.
  calculateRSIAtIndex(
    candles,
    index,
    period = 14
  ) {
    if (index < period) {
      return 50;
    }

    return this.calculateRSI(
      candles.slice(
        0,
        index + 1
      ),
      period
    );
  }

  // Confirm whether price revisited
  // a neckline at least twice.
  detectNecklineRetest(
    candles,
    startIdx,
    endIdx,
    level,
    tolerancePercent = 0.0015
  ) {
    let touches = 0;

    for (
      let i = startIdx;
      i <= endIdx &&
      i < candles.length;
      i++
    ) {
      const candle =
        candles[i];

      const lowTouch =
        Math.abs(
          candle.low - level
        ) / level <=
        tolerancePercent;

      const highTouch =
        Math.abs(
          candle.high - level
        ) / level <=
        tolerancePercent;

      if (
        lowTouch ||
        highTouch
      ) {
        touches++;
      }
    }

    return touches >= 2;
  }

  // =====================================================
  // Swing Detection Helpers
  // =====================================================

  findSwingHighs(
    highs,
    left = 2,
    right = 2
  ) {
    const swings = [];

    for (
      let i = left;
      i < highs.length - right;
      i++
    ) {
      let isSwing = true;

      for (
        let j = i - left;
        j <= i + right;
        j++
      ) {
        if (j === i) {
          continue;
        }

        if (
          highs[j] >= highs[i]
        ) {
          isSwing = false;
          break;
        }
      }

      if (isSwing) {
        swings.push({
          index: i,
          value: highs[i]
        });
      }
    }

    return swings;
  }

  // Find Swing Lows
  findSwingLows(
    lows,
    left = 2,
    right = 2
  ) {
    const swings = [];

    for (
      let i = left;
      i < lows.length - right;
      i++
    ) {
      let isSwing = true;

      for (
        let j = i - left;
        j <= i + right;
        j++
      ) {
        if (j === i) {
          continue;
        }

        if (
          lows[j] <= lows[i]
        ) {
          isSwing = false;
          break;
        }
      }

      if (isSwing) {
        swings.push({
          index: i,
          value: lows[i]
        });
      }
    }

    return swings;
  }

  // =====================================================
  // Breakout Confirmation
  // =====================================================

  isBreakoutConfirmed(
    candles,
    level,
    direction
  ) {
    const last =
      candles.slice(
        -this.breakoutConfirmationCandles
      );

    if (
      last.length <
      this.breakoutConfirmationCandles
    ) {
      return false;
    }

    if (direction === 'BUY') {
      return last.every(
        candle =>
          candle.close > level
      );
    }

    return last.every(
      candle =>
        candle.close < level
    );
  }

  // =====================================================
  // Pattern Quality Score
  // =====================================================

  calculatePatternQuality(
    strength,
    confirmation
  ) {
    const score =
      strength * 0.6 +
      confirmation * 0.4;

    return Math.max(
      50,
      Math.min(
        95,
        Math.round(score)
      )
    );
  }

  // =====================================================
  // Linear Regression Helpers
  // =====================================================

  linearRegressionSlope(values) {
    const n = values.length;

    if (n < 2) {
      return 0;
    }

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    for (
      let i = 0;
      i < n;
      i++
    ) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumXX += i * i;
    }

    const denominator =
      n * sumXX -
      sumX * sumX;

    if (denominator === 0) {
      return 0;
    }

    return (
      (
        n * sumXY -
        sumX * sumY
      ) /
      denominator
    );
  }

  linearRegressionIntercept(
    values,
    slope
  ) {
    const n = values.length;

    if (n === 0) {
      return 0;
    }

    let sumX = 0;
    let sumY = 0;

    for (
      let i = 0;
      i < n;
      i++
    ) {
      sumX += i;
      sumY += values[i];
    }

    return (
      sumY -
      slope * sumX
    ) / n;
  }

  predictRegressionValue(
    index,
    slope,
    intercept
  ) {
    return (
      slope * index +
      intercept
    );
  }

  // =====================================================
  // Reliability and Confidence Labels
  // =====================================================

  getReliability(score) {
    if (score >= 90) {
      return 'Very High';
    }

    if (score >= 80) {
      return 'High';
    }

    if (score >= 70) {
      return 'Medium';
    }

    if (score >= 60) {
      return 'Low';
    }

    return 'Very Low';
  }

  getConfidenceLabel(score) {
    if (score >= 95) {
      return 'Institutional';
    }

    if (score >= 90) {
      return 'Very High';
    }

    if (score >= 80) {
      return 'High';
    }

    if (score >= 70) {
      return 'Medium';
    }

    return 'Low';
  }

  // =====================================================
  // ATR
  // =====================================================

  calculateATR(
    candles,
    period = 14
  ) {
    if (
      !candles ||
      candles.length <
        period + 1
    ) {
      return 0;
    }

    const startIndex =
      Math.max(
        1,
        candles.length - period
      );

    let trueRangeTotal = 0;
    let trueRangeCount = 0;

    // Only the latest period is required.
    // This avoids creating a full temporary TR array.
    for (
      let i = startIndex;
      i < candles.length;
      i++
    ) {
      const high =
        candles[i].high;

      const low =
        candles[i].low;

      const previousClose =
        candles[i - 1].close;

      const trueRange =
        Math.max(
          high - low,
          Math.abs(
            high -
            previousClose
          ),
          Math.abs(
            low -
            previousClose
          )
        );

      trueRangeTotal +=
        trueRange;

      trueRangeCount++;
    }

    return trueRangeCount > 0
      ? trueRangeTotal /
        trueRangeCount
      : 0;
  }

  // =====================================================
  // Synthetic FX Volume Confirmation
  // =====================================================

  confirmVolume(candles) {
    if (
      !candles ||
      candles.length < 20
    ) {
      return true;
    }

    const last =
      candles[
        candles.length - 1
      ];

    // Do not reject a pattern when
    // the candle source has no volume field.
    if (
      last.volume === undefined
    ) {
      return true;
    }

    let totalVolume = 0;

    const start =
      candles.length - 20;

    for (
      let i = start;
      i < candles.length;
      i++
    ) {
      totalVolume +=
        candles[i].volume || 0;
    }

    const averageVolume =
      totalVolume / 20;

    return (
      last.volume >
      averageVolume
    );
  }

  // =====================================================
  // Exponential Moving Average
  // =====================================================

  calculateEMA(values, period) {
    if (
      !values ||
      values.length === 0
    ) {
      return 0;
    }

    const multiplier =
      2 / (period + 1);

    let ema = values[0];

    for (
      let i = 1;
      i < values.length;
      i++
    ) {
      ema =
        values[i] *
          multiplier +
        ema *
          (1 - multiplier);
    }

    return ema;
  }

  // =====================================================
  // Relative Strength Index
  // =====================================================

  calculateRSI(
    candles,
    period = 14
  ) {
    if (
      !candles ||
      candles.length <
        period + 1
    ) {
      return 50;
    }

    let gains = 0;
    let losses = 0;

    const start =
      candles.length -
      period;

    for (
      let i = start;
      i < candles.length;
      i++
    ) {
      const difference =
        candles[i].close -
        candles[i - 1].close;

      if (difference > 0) {
        gains += difference;
      } else {
        losses -= difference;
      }
    }

    if (losses === 0) {
      return 100;
    }

    const relativeStrength =
      gains / losses;

    return (
      100 -
      100 /
        (
          1 +
          relativeStrength
        )
    );
  }

  // =====================================================
  // Phase 4: Market Regime Detection
  // =====================================================

  /**
   * Detect the current market regime.
   *
   * Shared ATR and trend calculations are accepted
   * through sharedContext so detectAllPatterns()
   * does not calculate indicators more than once.
   *
   * Possible outputs:
   * - TRENDING_UP
   * - TRENDING_DOWN
   * - RANGING
   * - HIGH_VOLATILITY
   * - LOW_VOLATILITY
   */
  detectMarketRegime(
    candles,
    sharedContext = {}
  ) {
    if (
      !candles ||
      candles.length < 20
    ) {
      return 'RANGING';
    }

    const sampleSize =
      Math.min(
        50,
        candles.length
      );

    const start =
      candles.length -
      sampleSize;

    let totalRange = 0;
    let closeTotal = 0;

    for (
      let i = start;
      i < candles.length;
      i++
    ) {
      const candle =
        candles[i];

      totalRange +=
        Math.abs(
          candle.high -
          candle.low
        );

      closeTotal +=
        candle.close;
    }

    const averageClose =
      closeTotal /
      sampleSize;

    const averageRange =
      totalRange /
      sampleSize;

    const atr =
      Number.isFinite(
        sharedContext.atr
      )
        ? sharedContext.atr
        : this.calculateATR(
            candles,
            this.atrPeriod
          );

    const atrPercent =
      Number.isFinite(
        sharedContext.atrPercent
      )
        ? sharedContext.atrPercent
        : averageClose > 0
          ? atr /
            averageClose
          : 0;

    const normalizedRange =
      averageClose > 0
        ? averageRange /
          averageClose
        : 0;

    // Volatility regimes take priority
    // over directional classifications.
    if (
      atrPercent >=
        this.minATRPercent *
          2.5 ||
      normalizedRange >=
        this.minATRPercent *
          3
    ) {
      return 'HIGH_VOLATILITY';
    }

    if (
      atrPercent <=
      this.minATRPercent *
        1.15
    ) {
      return 'LOW_VOLATILITY';
    }

    if (
      sharedContext.trend ===
      'UP'
    ) {
      return 'TRENDING_UP';
    }

    if (
      sharedContext.trend ===
      'DOWN'
    ) {
      return 'TRENDING_DOWN';
    }

    return 'RANGING';
  }

  // =====================================================
  // Phase 4: Pattern Evolution
  // =====================================================

  /**
   * Apply learner-recommended detector thresholds.
   *
   * Every value is restricted to ±20% of its
   * original baseline to prevent aggressive changes.
   *
   * Existing method signatures and detector APIs
   * remain unchanged.
   */
  applyPatternEvolution(
    recommendations = {}
  ) {
    const keys =
      Object.keys(
        this.patternEvolutionBaseline
      );

    for (
      let i = 0;
      i < keys.length;
      i++
    ) {
      const key = keys[i];

      const baseline =
        this.patternEvolutionBaseline[
          key
        ];

      const proposed =
        Number(
          recommendations[key]
        );

      if (
        !Number.isFinite(
          proposed
        )
      ) {
        continue;
      }

      const minimum =
        baseline * 0.8;

      const maximum =
        baseline * 1.2;

      const safeValue =
        Math.max(
          minimum,
          Math.min(
            maximum,
            proposed
          )
        );

      this[key] =
        safeValue;

      this.patternEvolution[
        key
      ] = safeValue;
    }

    return {
      ...this.patternEvolution
    };
  }

  // =====================================================
  // Pattern Filtering and Enrichment
  // =====================================================

  /**
   * Enrich and validate a detected pattern.
   *
   * Existing filters remain active:
   * - Pattern age
   * - RSI
   * - Volume
   * - Fake breakout
   * - Target price
   * - Stop loss
   * - Risk/reward
   * - Multi-factor confirmation
   * - Confidence
   *
   * Phase 4 additions:
   * - Market regime
   * - Signal score
   * - Reasoning context
   */
  postProcessPattern(
    pattern,
    candles,
    context,
    diagnostics = null
  ) {
    const recordRejection =
      reason => {
        if (
          !diagnostics ||
          !diagnostics.rejectionCounts ||
          !Object.prototype.hasOwnProperty.call(
            diagnostics.rejectionCounts,
            reason
          )
        ) {
          return;
        }

        diagnostics.rejectionCounts[
          reason
        ] += 1;
      };

    if (!pattern) {
      recordRejection(
        "other"
      );

      return null;
    }

    // Pattern age rejection.
    if (
      pattern._ageIndex !==
      undefined
    ) {
      const age =
        (
          candles.length - 1
        ) -
        pattern._ageIndex;

      const maxAge =
        pattern._maxAge ||
        this.maxPatternAge;

      if (age > maxAge) {
        recordRejection(
          "patternAge"
        );

        return null;
      }

      pattern.patternAge = age;
    }

    // RSI confirmation.
    if (
      pattern.direction ===
        "BUY" &&
      context.rsi >
        this.rsiBuyMax
    ) {
      recordRejection(
        "rsiBuy"
      );

      return null;
    }

    if (
      pattern.direction ===
        "SELL" &&
      context.rsi <
        this.rsiSellMin
    ) {
      recordRejection(
        "rsiSell"
      );

      return null;
    }

    // Volume confirmation.
    if (!context.volumeOk) {
      recordRejection(
        "volume"
      );

      return null;
    }

    // Fake breakout rejection.
    if (
      pattern.breakoutLevel !==
      undefined
    ) {
      const lastClose =
        candles[
          candles.length - 1
        ].close;

      if (
        pattern.direction ===
          "BUY" &&
        lastClose <
          pattern.breakoutLevel
      ) {
        recordRejection(
          "breakoutBuy"
        );

        return null;
      }

      if (
        pattern.direction ===
          "SELL" &&
        lastClose >
          pattern.breakoutLevel
      ) {
        recordRejection(
          "breakoutSell"
        );

        return null;
      }
    }

    const entry =
      candles[
        candles.length - 1
      ].close;

    pattern.entry =
      +entry.toFixed(5);

    // Generate ATR-based target and stop only
    // when a detector has not supplied its own.
    if (
      pattern.direction !==
      'NEUTRAL'
    ) {
      if (
        pattern.stopLoss ===
          undefined ||
        pattern.targetPrice ===
          undefined
      ) {
        if (
          pattern.direction ===
          'BUY'
        ) {
          pattern.stopLoss =
            +(
              entry -
              context.atr *
                this.slAtrMultiplier
            ).toFixed(5);

          pattern.targetPrice =
            +(
              entry +
              context.atr *
                this.tpAtrMultiplier
            ).toFixed(5);
        } else {
          pattern.stopLoss =
            +(
              entry +
              context.atr *
                this.slAtrMultiplier
            ).toFixed(5);

          pattern.targetPrice =
            +(
              entry -
              context.atr *
                this.tpAtrMultiplier
            ).toFixed(5);
        }
      }

      const risk =
        Math.abs(
          entry -
          pattern.stopLoss
        );

      const reward =
        Math.abs(
          pattern.targetPrice -
          entry
        );

      pattern.RR =
        risk > 0
          ? +(
              reward / risk
            ).toFixed(2)
          : null;
    } else {
      pattern.stopLoss = null;
      pattern.targetPrice = null;
      pattern.RR = null;
    }

    const trendAligned =
      (
        context.trend ===
          'UP' &&
        pattern.direction ===
          'BUY'
      ) ||
      (
        context.trend ===
          'DOWN' &&
        pattern.direction ===
          'SELL'
      );

    const trendScore =
      trendAligned
        ? 100
        : pattern.direction ===
            'NEUTRAL'
          ? 60
          : 40;

    const volumeScore =
      context.volumeOk
        ? 100
        : 0;

    const rsiScore =
      pattern.direction ===
      'BUY'
        ? Math.max(
            0,
            Math.min(
              100,
              100 -
                context.rsi *
                  1.5
            )
          )
        : pattern.direction ===
          'SELL'
          ? Math.max(
              0,
              Math.min(
                100,
                (
                  context.rsi -
                  50
                ) *
                  2
              )
            )
          : 50;

    const atrScore =
      Math.min(
        100,
        (
          context.atrPercent /
          this.minATRPercent
        ) *
          50
      );

    // A pattern only reaches this stage when
    // breakout checks have already passed.
    const breakoutScore = 100;

    const multiScore =
      volumeScore * 0.15 +
      rsiScore * 0.15 +
      trendScore * 0.20 +
      breakoutScore * 0.25 +
      atrScore * 0.10 +
      pattern.strength * 0.15;

    pattern.multiScore =
      Math.round(
        Math.max(
          0,
          Math.min(
            100,
            multiScore
          )
        )
      );

    const confidence =
      Math.round(
        pattern.confirmationScore *
          0.4 +
        trendScore * 0.2 +
        volumeScore * 0.15 +
        rsiScore * 0.15 +
        atrScore * 0.1
      );

    pattern.confidence =
      Math.max(
        40,
        Math.min(
          99,
          confidence
        )
      );

    pattern.confidenceLabel =
      this.getConfidenceLabel(
        pattern.confidence
      );

    // Phase 4 unified technical and
    // Smart Money confluence score.
    pattern.signalScore =
      this.calculateSignalScore(
        pattern,
        context,
        {
          trendScore,
          rsiScore,
          atrScore,
          volumeScore
        }
      );

    pattern.signalLabel =
      this.getConfidenceLabel(
        pattern.signalScore
      );

    pattern.marketRegime =
      context.marketRegime;

    // Reusable evidence snapshot.
    // signals.js converts this into human-readable
    // reasoning and decisionTrace fields.
    pattern.reasoningContext = {
      trend: trendAligned,

      ema:
        context.ema20 !== null &&
        context.ema50 !== null,

      rsi: true,

      atr:
        context.atrPercent >=
        this.minATRPercent,

      volume:
        context.volumeOk,

      breakout:
        pattern.breakoutLevel !==
        undefined,

      liquidity:
        Boolean(
          context.liquiditySweep
        ),

      bos:
        Boolean(context.bos),

      choch:
        Boolean(context.choch),

      marketRegime:
        context.marketRegime,

      ema20:
        context.ema20,

      ema50:
        context.ema50,

      rsiValue:
        +context.rsi.toFixed(2),

      atrValue:
        +context.atr.toFixed(5),

      atrPercent:
        +(
          context.atrPercent *
          100
        ).toFixed(3)
    };

    delete pattern._ageIndex;
    delete pattern._maxAge;

    return pattern;
  }

  // =====================================================
  // Phase 4: Unified AI Signal Score
  // =====================================================

  /**
   * Combine technical and Smart Money evidence
   * into a single score from 0 to 100.
   *
   * This is the analyzer-level technical score.
   * signals.js later combines it with historical,
   * market, pattern and risk/reward intelligence
   * to create the final overall AI score.
   */
  calculateSignalScore(
    pattern,
    context,
    precomputed
  ) {
    const {
      trendScore,
      rsiScore,
      atrScore,
      volumeScore
    } = precomputed;

    const weights =
      this.signalScoreWeights;

    // EMA score measures trend separation.
    let emaScore = 50;

    if (
      context.ema20 !== null &&
      context.ema50 !== null &&
      context.ema50 !== 0
    ) {
      const emaGapPercent =
        Math.abs(
          context.ema20 -
          context.ema50
        ) /
        context.ema50;

      emaScore =
        Math.min(
          100,
          (
            emaGapPercent /
            0.005
          ) *
            100
        );
    }

    // A missing SMC factor is neutral.
    // An aligned factor receives full score,
    // while an opposing factor is penalised.
    const confluenceScore =
      factor => {
        if (!factor) {
          return 50;
        }

        return (
          factor.direction ===
          pattern.direction
        )
          ? 100
          : 20;
      };

    const liquidityScore =
      confluenceScore(
        context.liquiditySweep
      );

    const bosScore =
      confluenceScore(
        context.bos
      );

    const chochScore =
      confluenceScore(
        context.choch
      );

    const score =
      pattern.confirmationScore *
        weights.pattern +
      trendScore *
        weights.trend +
      rsiScore *
        weights.momentum +
      atrScore *
        weights.atr +
      emaScore *
        weights.ema +
      volumeScore *
        weights.volume +
      liquidityScore *
        weights.liquidity +
      bosScore *
        weights.bos +
      chochScore *
        weights.choch;

    return Math.max(
      0,
      Math.min(
        100,
        Math.round(score)
      )
    );
  }

  // =====================================================
  // Multi-Timeframe Priority Ranking
  // =====================================================

  calculateMultiTimeframeConfidence(
    patterns
  ) {
    if (
      !patterns ||
      patterns.length === 0
    ) {
      return [];
    }

    return patterns.map(
      pattern => {
        const timeframeWeight =
          this.timeframeWeights[
            pattern.timeframe ||
            'M5'
          ] || 1;

        let weightedScore =
          pattern.strength *
            0.20 +
          pattern.confirmationScore *
            0.25 +
          (
            pattern.multiScore ||
            0
          ) *
            0.35 +
          (
            pattern.signalScore ||
            0
          ) *
            0.15 +
          timeframeWeight *
            20 *
            0.05;

        if (
          pattern.direction ===
          'NEUTRAL'
        ) {
          weightedScore *= 0.85;
        }

        return {
          ...pattern,
          weightedScore:
            Math.round(
              weightedScore
            )
        };
      }
    );
  }
}

module.exports = PatternAnalyzer;

  

  
