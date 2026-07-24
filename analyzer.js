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

  

  
