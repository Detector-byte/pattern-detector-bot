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
    if (!candles || candles.length < 30) return [];

    // --- 1. ATR volatility gate: skip dead markets entirely ---
    const atr = this.calculateATR(candles, this.atrPeriod);
    const lastClose = candles[candles.length - 1].close;
    const atrPercent = lastClose > 0 ? atr / lastClose : 0;
    if (atrPercent < this.minATRPercent) {
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
      const enriched = this.postProcessPattern(
        pattern,
        candles,
        context
      );

      if (enriched) {
        detectedPatterns.push(enriched);
      }
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

    return ranked
      .sort(
        (a, b) =>
          (b.signalScore - a.signalScore) ||
          (b.weightedScore - a.weightedScore)
      )
      .slice(0, 5);
  }

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
