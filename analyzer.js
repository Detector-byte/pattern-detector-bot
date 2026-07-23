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
      'Bearish Engulfing'
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
      const change = ((recent[recent.length - 1].close - recent[0].close) / recent[0].close) * 100;
      if (change >= 1) trend = "UP";
      else if (change <= -1) trend = "DOWN";
    }

    const context = {
      ema20,
      ema50,
      trend,
      rsi: this.calculateRSI(candles, this.rsiPeriod),
      volumeOk: this.confirmVolume(candles),
      atr,
      atrPercent
    };

    const collect = (pattern) => {
      const enriched = this.postProcessPattern(pattern, candles, context);
      if (enriched) detectedPatterns.push(enriched);
    };

    // --- Phase 2: triangleLookback === wedgeLookback (both 30), so the
    // recent-highs/lows window and its regression slope are identical for
    // every triangle + wedge detector. Compute once here and reuse instead
    // of each of the 5 detectors re-slicing and re-running the regression.
    const recentHighs30 = highs.slice(-this.triangleLookback);
    const recentLows30 = lows.slice(-this.triangleLookback);
    const highSlope30 = this.linearRegressionSlope(recentHighs30);
    const lowSlope30 = this.linearRegressionSlope(recentLows30);

    // Double Top/Bottom
    collect(this.detectDoubleTop(candles, highs));
    collect(this.detectDoubleBottom(candles, lows));

    // Head and Shoulders
    collect(this.detectHeadShoulders(candles, highs));
    collect(this.detectInverseHeadShoulders(candles, lows));

    // Triangles
    collect(this.detectAscendingTriangle(candles, recentHighs30, recentLows30, highSlope30, lowSlope30));
    collect(this.detectDescendingTriangle(candles, recentHighs30, recentLows30, highSlope30, lowSlope30));
    collect(this.detectSymmetricTriangle(candles, recentHighs30, recentLows30, highSlope30, lowSlope30));

    // Wedges
    collect(this.detectRisingWedge(candles, recentHighs30, recentLows30, highSlope30, lowSlope30, trend));
    collect(this.detectFallingWedge(candles, recentHighs30, recentLows30, highSlope30, lowSlope30, trend));

    // Pennants & Flags
    collect(this.detectPennant(candles, highs, lows));
    collect(this.detectFlag(candles, highs, lows, trend));

    // Cup and Handle
    collect(this.detectCupHandle(candles, lows, closes, trend));

    // Rectangle
    collect(this.detectRectangleTop(candles, highs));
    collect(this.detectRectangleBottom(candles, lows));

    // Diamond
    collect(this.detectDiamondTop(candles, highs, lows));
    collect(this.detectDiamondBottom(candles, highs, lows));

    // Engulfing Patterns
    collect(this.detectBullishEngulfing(candles));
    collect(this.detectBearishEngulfing(candles));

    // Tag every detected pattern with the timeframe it was found on
    detectedPatterns.forEach(pattern => {
      pattern.timeframe = timeframe;
    });

    // Remove duplicate patterns
    const uniquePatterns = detectedPatterns.filter(
      (pattern, index, self) =>
        index === self.findIndex(
          p =>
            p.name === pattern.name &&
            p.timeframe === pattern.timeframe
        )
    );

    // Rank by confirmation first, then strength (pre-weighting order)
    uniquePatterns.sort((a, b) => {
      if (b.confirmationScore !== a.confirmationScore) {
        return b.confirmationScore - a.confirmationScore;
      }
      return b.strength - a.strength;
    });

    // Multi-timeframe + multi-factor weighted ranking, keep top 5
    const ranked = this.calculateMultiTimeframeConfidence(uniquePatterns);
    return ranked
        .sort((a, b) => b.weightedScore - a.weightedScore)
        .slice(0, 5);
  }

  // --- Step 3: swing-based Double Top / Double Bottom ---

  detectDoubleTop(candles, highs) {
    const swings = this.findSwingHighs(highs);
    if (swings.length < 2) return null;

    const peak1 = swings[swings.length - 2];
    const peak2 = swings[swings.length - 1];

    // Peaks should not be too close together
    if (peak2.index - peak1.index < this.minSwingDistance) return null;

    // Peaks must be similar in price
    const similarity = Math.abs(peak1.value - peak2.value) / Math.max(peak1.value, peak2.value);
    if (similarity > this.priceTolerance) return null;

    // Neckline = lowest low between the two peaks
    const valley = this.lowest(
      candles
        .slice(peak1.index, peak2.index + 1)
        .map(c => c.low)
    );

    // Breakout confirmation below the neckline
    if (!this.isBreakoutConfirmed(candles, valley, 'SELL')) return null;

    const strength = ((peak1.value - valley) / valley) * 100;
    let confirmationScore = this.calculatePatternQuality(strength, 88);

    // --- Accuracy: RSI divergence (price flat/higher high, RSI lower high) ---
    const rsi1 = this.calculateRSIAtIndex(candles, peak1.index, this.rsiPeriod);
    const rsi2 = this.calculateRSIAtIndex(candles, peak2.index, this.rsiPeriod);
    const rsiDivergence = peak2.value >= peak1.value * (1 - this.priceTolerance) && rsi2 < rsi1;
    if (rsiDivergence) confirmationScore += 4;

    // --- Accuracy: volume divergence (weaker volume into the 2nd peak) ---
    const vol1 = this.volumeAround(candles, peak1.index);
    const vol2 = this.volumeAround(candles, peak2.index);
    const volumeDivergence = (vol1 !== null && vol2 !== null) ? vol2 < vol1 : null;
    if (volumeDivergence) confirmationScore += 3;

    // --- Accuracy: neckline retest (price revisited the neckline more than once) ---
    const necklineRetestConfirmed = this.detectNecklineRetest(candles, peak1.index, peak2.index, valley);
    if (necklineRetestConfirmed) confirmationScore += 3;

    confirmationScore = Math.max(50, Math.min(95, Math.round(confirmationScore)));

    return {
      name: 'Double Top',
      direction: 'SELL',
      strength: Math.round(strength),
      confirmationScore,
      reliability: this.getReliability(confirmationScore),
      rsiDivergence,
      volumeDivergence,
      necklineRetestConfirmed,
      // Target = neckline - (peak1 - neckline)
      targetPrice: +(valley - (peak1.value - valley)).toFixed(5),
      // Stop above the second peak
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

    if (low2.index - low1.index < this.minSwingDistance) return null;

    const similarity = Math.abs(low1.value - low2.value) / Math.max(low1.value, low2.value);
    if (similarity > this.priceTolerance) return null;

    // Neckline = highest high between the two lows
    const neckline = this.highest(
      candles
        .slice(low1.index, low2.index + 1)
        .map(c => c.high)
    );

    if (!this.isBreakoutConfirmed(candles, neckline, 'BUY')) return null;

    const strength = ((neckline - low1.value) / low1.value) * 100;
    let confirmationScore = this.calculatePatternQuality(strength, 88);

    // --- Accuracy: RSI divergence (price flat/lower low, RSI higher low) ---
    const rsi1 = this.calculateRSIAtIndex(candles, low1.index, this.rsiPeriod);
    const rsi2 = this.calculateRSIAtIndex(candles, low2.index, this.rsiPeriod);
    const rsiDivergence = low2.value <= low1.value * (1 + this.priceTolerance) && rsi2 > rsi1;
    if (rsiDivergence) confirmationScore += 4;

    // --- Accuracy: volume divergence (weaker selling volume into the 2nd low) ---
    const vol1 = this.volumeAround(candles, low1.index);
    const vol2 = this.volumeAround(candles, low2.index);
    const volumeDivergence = (vol1 !== null && vol2 !== null) ? vol2 < vol1 : null;
    if (volumeDivergence) confirmationScore += 3;

    // --- Accuracy: neckline retest (price revisited the neckline more than once) ---
    const necklineRetestConfirmed = this.detectNecklineRetest(candles, low1.index, low2.index, neckline);
    if (necklineRetestConfirmed) confirmationScore += 3;

    confirmationScore = Math.max(50, Math.min(95, Math.round(confirmationScore)));

    return {
      name: 'Double Bottom',
      direction: 'BUY',
      strength: Math.round(strength),
      confirmationScore,
      reliability: this.getReliability(confirmationScore),
      rsiDivergence,
      volumeDivergence,
      necklineRetestConfirmed,
      // Target = neckline + (neckline - low1)
      targetPrice: +(neckline + (neckline - low1.value)).toFixed(5),
      // Stop below the second low
      stopLoss: +low2.value.toFixed(5),
      breakoutLevel: neckline,
      _ageIndex: low2.index
    };
  }

  detectHeadShoulders(candles) {
    const swings = this.findSwingHighs(candles.map(c => c.high));
    if (swings.length < 3) return null;

    // Last three swing highs
    const left = swings[swings.length - 3];
    const head = swings[swings.length - 2];
    const right = swings[swings.length - 1];

    // Head must be highest
    if (!(head.value > left.value && head.value > right.value))
      return null;

    // Shoulders should be similar
    const shoulderDiff =
      Math.abs(left.value - right.value) /
      Math.max(left.value, right.value);
    if (shoulderDiff > 0.03)
      return null;

    // Minimum spacing
    if (
      head.index - left.index < this.minSwingDistance ||
      right.index - head.index < this.minSwingDistance
    )
      return null;

    // Neckline
    const leftValley = this.lowest(
      candles
        .slice(left.index, head.index + 1)
        .map(c => c.low)
    );
    const rightValley = this.lowest(
      candles
        .slice(head.index, right.index + 1)
        .map(c => c.low)
    );
    const neckline = (leftValley + rightValley) / 2;

    // Breakout confirmation
    if (!this.isBreakoutConfirmed(candles, neckline, 'SELL'))
      return null;

    const strength =
      ((head.value - neckline) / neckline) * 100;
    let confirmationScore = this.calculatePatternQuality(
      strength,
      90
    );

    // --- Accuracy: score-based shoulder symmetry instead of a hard pass/fail cutoff ---
    const shoulderSymmetryScore = Math.max(0, 100 - shoulderDiff * 2000);
    confirmationScore = confirmationScore * 0.85 + shoulderSymmetryScore * 0.15;

    // --- Accuracy: neckline slope - a declining neckline is a stronger bearish signal ---
    const necklineSlope = (rightValley - leftValley) / (right.index - head.index || 1);
    if (necklineSlope < 0) confirmationScore += 3;

    confirmationScore = Math.max(50, Math.min(95, Math.round(confirmationScore)));

    return {
      name: 'Head and Shoulders',
      direction: 'SELL',
      strength: Math.round(strength),
      confirmationScore,
      reliability: this.getReliability(confirmationScore),
      shoulderSymmetryScore: Math.round(shoulderSymmetryScore),
      necklineSlope,
      // Target = neckline - (head - neckline)
      targetPrice: +(neckline - (head.value - neckline)).toFixed(5),
      // Stop above the right shoulder
      stopLoss: +right.value.toFixed(5),
      breakoutLevel: neckline,
      _ageIndex: right.index
    };
  }

  detectInverseHeadShoulders(candles) {
    const swings = this.findSwingLows(candles.map(c => c.low));
    if (swings.length < 3) return null;

    // Last three swing lows
    const left = swings[swings.length - 3];
    const head = swings[swings.length - 2];
    const right = swings[swings.length - 1];

    // Head must be lowest
    if (!(head.value < left.value && head.value < right.value))
      return null;

    // Shoulders should be similar
    const shoulderDiff =
      Math.abs(left.value - right.value) /
      Math.max(left.value, right.value);
    if (shoulderDiff > 0.03)
      return null;

    // Minimum spacing
    if (
      head.index - left.index < this.minSwingDistance ||
      right.index - head.index < this.minSwingDistance
    )
      return null;

    // Neckline
    const leftPeak = this.highest(
      candles
        .slice(left.index, head.index + 1)
        .map(c => c.high)
    );
    const rightPeak = this.highest(
      candles
        .slice(head.index, right.index + 1)
        .map(c => c.high)
    );
    const neckline = (leftPeak + rightPeak) / 2;

    // Breakout confirmation
    if (!this.isBreakoutConfirmed(candles, neckline, 'BUY'))
      return null;

    const strength =
      ((neckline - head.value) / head.value) * 100;
    let confirmationScore = this.calculatePatternQuality(
      strength,
      90
    );

    // --- Accuracy: score-based shoulder symmetry instead of a hard pass/fail cutoff ---
    const shoulderSymmetryScore = Math.max(0, 100 - shoulderDiff * 2000);
    confirmationScore = confirmationScore * 0.85 + shoulderSymmetryScore * 0.15;

    // --- Accuracy: neckline slope - a rising neckline is a stronger bullish signal ---
    const necklineSlope = (rightPeak - leftPeak) / (right.index - head.index || 1);
    if (necklineSlope > 0) confirmationScore += 3;

    confirmationScore = Math.max(50, Math.min(95, Math.round(confirmationScore)));

    return {
      name: 'Inverse Head and Shoulders',
      direction: 'BUY',
      strength: Math.round(strength),
      confirmationScore,
      reliability: this.getReliability(confirmationScore),
      shoulderSymmetryScore: Math.round(shoulderSymmetryScore),
      necklineSlope,
      // Target = neckline + (neckline - head)
      targetPrice: +(neckline + (neckline - head.value)).toFixed(5),
      // Stop below the right shoulder
      stopLoss: +right.value.toFixed(5),
      breakoutLevel: neckline,
      _ageIndex: right.index
    };
  }

  detectAscendingTriangle(candles, recentHighs, recentLows, highSlope, lowSlope) {
    if (
        Math.abs(highSlope) < this.regressionThreshold &&
        lowSlope > this.regressionThreshold
    ) {
        const resistance = this.highest(recentHighs);

        // Accuracy: flat resistance should actually be touched multiple times,
        // not just be the single highest point in the window
        const resistanceTouches = this.countTouches(recentHighs, resistance);
        if (resistanceTouches < this.minTouchCount) return null;

        if (!this.isBreakoutConfirmed(candles, resistance, "BUY"))
            return null;
        const confirmationScore = 90;
        return {
            name: "Ascending Triangle",
            direction: "BUY",
            strength: 82,
            confirmationScore,
            reliability: this.getReliability(confirmationScore),
            breakoutLevel: resistance,
            resistanceTouches
        };
    }
    return null;
  }

  detectDescendingTriangle(candles, recentHighs, recentLows, highSlope, lowSlope) {
    if (
        highSlope < -this.regressionThreshold &&
        Math.abs(lowSlope) < this.regressionThreshold
    ) {
        const support = this.lowest(recentLows);

        // Accuracy: flat support should actually be touched multiple times
        const supportTouches = this.countTouches(recentLows, support);
        if (supportTouches < this.minTouchCount) return null;

        if (!this.isBreakoutConfirmed(candles, support, "SELL"))
            return null;
        const confirmationScore = 90;
        return {
            name: "Descending Triangle",
            direction: "SELL",
            strength: 82,
            confirmationScore,
            reliability: this.getReliability(confirmationScore),
            breakoutLevel: support,
            supportTouches
        };
    }
    return null;
  }

  detectSymmetricTriangle(candles, recentHighs, recentLows, highSlope, lowSlope) {
      if (
          highSlope < -this.regressionThreshold &&
          lowSlope > this.regressionThreshold
      ) {
          const confirmationScore = 88;
          return {
              name: "Symmetric Triangle",
              direction: "NEUTRAL",
              strength: 78,
              confirmationScore,
              reliability: this.getReliability(confirmationScore)
          };
      }
      return null;
  }

  detectRisingWedge(candles, recentHighs, recentLows, highSlope, lowSlope, trend) {
      if (
          highSlope > this.regressionThreshold &&
          lowSlope > this.regressionThreshold &&
          highSlope > lowSlope
      ) {
          const support = this.lowest(recentLows);
          if (!this.isBreakoutConfirmed(candles, support, "SELL"))
              return null;
          if (trend !== "UP")
              return null;
          const confirmationScore = 90;
          return {
              name: "Rising Wedge",
              direction: "SELL",
              strength: 80,
              confirmationScore,
              reliability: this.getReliability(confirmationScore),
              breakoutLevel: support
          };
      }
      return null;
  }

  detectFallingWedge(candles, recentHighs, recentLows, highSlope, lowSlope, trend) {
      if (
          highSlope < -this.regressionThreshold &&
          lowSlope < -this.regressionThreshold &&
          Math.abs(lowSlope) > Math.abs(highSlope)
      ) {
          const resistance = this.highest(recentHighs);
          if (!this.isBreakoutConfirmed(candles, resistance, "BUY"))
              return null;
          if (trend !== "DOWN")
              return null;
          const confirmationScore = 90;
          return {
              name: "Falling Wedge",
              direction: "BUY",
              strength: 80,
              confirmationScore,
              reliability: this.getReliability(confirmationScore),
              breakoutLevel: resistance
          };
      }
      return null;
  }

  detectPennant(candles, highs, lows) {
      if (candles.length < 40) return null;
      const recentHighs = highs.slice(-20);
      const recentLows = lows.slice(-20);
      const highSlope = this.linearRegressionSlope(recentHighs);
      const lowSlope = this.linearRegressionSlope(recentLows);
      const closes = candles.map(c => c.close);
      const impulse =
          Math.abs(closes[20] - closes[0]) /
          closes[0];
      if (
          impulse > 0.03 &&
          highSlope < 0 &&
          lowSlope > 0
      ) {
          const direction =
              closes[20] > closes[0]
                  ? "BUY"
                  : "SELL";
          const breakoutLevel =
              direction === "BUY"
                  ? this.highest(recentHighs)
                  : this.lowest(recentLows);
          if (!this.isBreakoutConfirmed(candles, breakoutLevel, direction))
              return null;
          const confirmationScore = 91;
          return {
              name: "Pennant",
              direction,
              strength: 84,
              confirmationScore,
              reliability: this.getReliability(confirmationScore),
              breakoutLevel
          };
      }
      return null;
  }

  detectFlag(candles, highs, lows, trend) {
      if (candles.length < 40)
          return null;
      const closes = candles.map(c => c.close);
      const impulse =
          (closes[20] - closes[0]) / closes[0];
      const flagSlope =
          this.linearRegressionSlope(
              closes.slice(-15)
          );
      if (
          impulse > 0.03 &&
          flagSlope < 0
      ) {
          const resistance =
              this.highest(highs.slice(-15));
          if (!this.isBreakoutConfirmed(candles, resistance, "BUY"))
              return null;
          if (trend !== "UP")
              return null;
          const confirmationScore = 92;
          return {
              name: "Bull Flag",
              direction: "BUY",
              strength: 85,
              confirmationScore,
              reliability: this.getReliability(confirmationScore),
              breakoutLevel: resistance
          };
      }
      if (
          impulse < -0.03 &&
          flagSlope > 0
      ) {
          const support =
              this.lowest(lows.slice(-15));
          if (!this.isBreakoutConfirmed(candles, support, "SELL"))
              return null;
          if (trend !== "DOWN")
              return null;
          const confirmationScore = 92;
          return {
              name: "Bear Flag",
              direction: "SELL",
              strength: 85,
              confirmationScore,
              reliability: this.getReliability(confirmationScore),
              breakoutLevel: support
          };
      }
      return null;
  }

  detectCupHandle(candles, lows, closes, trend) {
    const n = candles.length;
    if (n < 30) return null;

    const recent = lows.slice(n - 30);
    const minIdx = recent.indexOf(this.lowest(recent));

    if (minIdx < 5 || minIdx > recent.length - 10) return null;

    // Cup formation
    const cupDepth = (this.highest(recent.slice(0, minIdx)) - recent[minIdx]) / recent[minIdx];
    if (cupDepth < 0.02 || cupDepth > 0.15) return null;

    // Handle formation
    const handleHigh = this.highest(recent.slice(minIdx + 1, minIdx + 6));
    const handleRange = (handleHigh - recent[minIdx]) / recent[minIdx];
    if (handleRange > 0.08) return null;

    if (trend !== "UP")
        return null;

    const confirmationScore = 85;
    return {
      name: 'Cup and Handle',
      direction: 'BUY',
      strength: 72,
      confirmationScore,
      reliability: this.getReliability(confirmationScore),
      breakoutLevel: handleHigh
    };
  }

  detectRectangleTop(candles, highs) {
    const n = candles.length;
    if (n < 20) return null;

    const recent = highs.slice(n - 20);
    if (this.isFlat(recent, 0.01)) {
      const confirmationScore = 70;
      return {
        name: 'Rectangle Top',
        direction: 'SELL',
        strength: 65,
        confirmationScore,
        reliability: this.getReliability(confirmationScore),
        breakoutLevel: this.lowest(recent)
      };
    }
    return null;
  }

  detectRectangleBottom(candles, lows) {
    const n = candles.length;
    if (n < 20) return null;

    const recent = lows.slice(n - 20);
    if (this.isFlat(recent, 0.01)) {
      const confirmationScore = 70;
      return {
        name: 'Rectangle Bottom',
        direction: 'BUY',
        strength: 65,
        confirmationScore,
        reliability: this.getReliability(confirmationScore),
        breakoutLevel: this.highest(recent)
      };
    }
    return null;
  }

  detectDiamondTop(candles, highs, lows) {
    const n = candles.length;
    if (n < 25) return null;

    const recent = { highs: highs.slice(n - 25), lows: lows.slice(n - 25) };
    const mid = Math.floor(recent.highs.length / 2);

    const firstHalfExpand = recent.highs[0] - recent.lows[0] < recent.highs[mid] - recent.lows[mid];
    const secondHalfShrink = recent.highs[mid] - recent.lows[mid] > recent.highs[recent.highs.length - 1] - recent.lows[recent.lows.length - 1];

    if (firstHalfExpand && secondHalfShrink) {
      const confirmationScore = 80;
      return {
        name: 'Diamond Top',
        direction: 'SELL',
        strength: 73,
        confirmationScore,
        reliability: this.getReliability(confirmationScore)
      };
    }
    return null;
  }

  detectDiamondBottom(candles, highs, lows) {
    const n = candles.length;
    if (n < 25) return null;

    const recent = { highs: highs.slice(n - 25), lows: lows.slice(n - 25) };
    const mid = Math.floor(recent.lows.length / 2);

    const firstHalfExpand = recent.highs[0] - recent.lows[0] < recent.highs[mid] - recent.lows[mid];
    const secondHalfShrink = recent.highs[mid] - recent.lows[mid] > recent.highs[recent.highs.length - 1] - recent.lows[recent.lows.length - 1];

    if (firstHalfExpand && secondHalfShrink) {
      const confirmationScore = 80;
      return {
        name: 'Diamond Bottom',
        direction: 'BUY',
        strength: 73,
        confirmationScore,
        reliability: this.getReliability(confirmationScore)
      };
    }
    return null;
  }

  detectBullishEngulfing(candles) {
    const n = candles.length;
    if (n < 2) return null;

    const prev = candles[n - 2];
    const curr = candles[n - 1];

    if (prev.close <= prev.open && curr.close > curr.open &&
        curr.open <= prev.close && curr.close >= prev.open) {
      const strength = ((curr.close - curr.open) / curr.open) * 100;
      const confirmationScore = 80;
      return {
        name: 'Bullish Engulfing',
        direction: 'BUY',
        strength: Math.min(strength, 100),
        confirmationScore,
        reliability: this.getReliability(confirmationScore)
      };
    }
    return null;
  }

  detectBearishEngulfing(candles) {
    const n = candles.length;
    if (n < 2) return null;

    const prev = candles[n - 2];
    const curr = candles[n - 1];

    if (prev.close >= prev.open && curr.close < curr.open &&
        curr.open >= prev.close && curr.close <= prev.open) {
      const strength = ((curr.open - curr.close) / curr.close) * 100;
      const confirmationScore = 80;
      return {
        name: 'Bearish Engulfing',
        direction: 'SELL',
        strength: Math.min(strength, 100),
        confirmationScore,
        reliability: this.getReliability(confirmationScore)
      };
    }
    return null;
  }

  // --- 3. EMA trend confirmation (replaces plain % change trend) ---
  // Kept as a standalone helper for callers outside detectAllPatterns();
  // inside detectAllPatterns() the trend is now computed once and passed
  // in via context/parameters instead of being recalculated per detector.
  detectTrend(candles, period = 20) {
    if (!candles || candles.length < Math.max(period, 50)) {
      // not enough data for EMA50 - fall back to simple % change
      if (!candles || candles.length < period) return "SIDEWAYS";
      const recent = candles.slice(-period);
      const change = ((recent[recent.length - 1].close - recent[0].close) / recent[0].close) * 100;
      if (change >= 1) return "UP";
      if (change <= -1) return "DOWN";
      return "SIDEWAYS";
    }

    const closes = candles.map(c => c.close);
    const ema20 = this.calculateEMA(closes, 20);
    const ema50 = this.calculateEMA(closes, 50);

    if (ema20 > ema50) return "UP";
    if (ema20 < ema50) return "DOWN";
    return "SIDEWAYS";
  }

  // Helper functions
  isTrendingUp(values, threshold) {
    if (values.length < 5) return false;
    const change = (values[values.length - 1] - values[0]) / values[0];
    return change > threshold;
  }

  isTrendingDown(values, threshold) {
    if (values.length < 5) return false;
    const change = (values[0] - values[values.length - 1]) / values[0];
    return change > threshold;
  }

  isFlat(values, threshold) {
    if (values.length < 5) return false;
    const max = this.highest(values);
    const min = this.lowest(values);
    const range = (max - min) / min;
    return range < threshold;
  }

  // --- Phase 2: cheap max/min over an array without the spread-operator cost ---
  // Math.max(...bigArray) / Math.min(...bigArray) push every element onto the
  // call stack and can even throw on very large arrays. A plain loop is both
  // faster and safer, so every Math.max(...)/Math.min(...) over an array in
  // this file now goes through these two helpers.
  highest(values) {
    let max = -Infinity;
    for (let i = 0; i < values.length; i++) {
      if (values[i] > max) max = values[i];
    }
    return max;
  }

  lowest(values) {
    let min = Infinity;
    for (let i = 0; i < values.length; i++) {
      if (values[i] < min) min = values[i];
    }
    return min;
  }

  // --- Phase 2: touch-count helper for triangle support/resistance validation ---
  countTouches(values, level, tolerancePercent = 0.0015) {
    if (!level) return 0;
    let count = 0;
    for (let i = 0; i < values.length; i++) {
      if (Math.abs(values[i] - level) / level <= tolerancePercent) count++;
    }
    return count;
  }

  // --- Phase 2: average synthetic volume in a small window around a swing index ---
  volumeAround(candles, index, window = 3) {
    const start = Math.max(0, index - window);
    const end = Math.min(candles.length, index + window + 1);
    const slice = candles.slice(start, end);
    if (slice.length === 0 || slice[0].volume === undefined) return null;
    return slice.reduce((a, b) => a + (b.volume || 0), 0) / slice.length;
  }

  // --- Phase 2: RSI as of a specific historical candle index (for divergence checks) ---
  calculateRSIAtIndex(candles, index, period = 14) {
    if (index < period) return 50;
    return this.calculateRSI(candles.slice(0, index + 1), period);
  }

  // --- Phase 2: neckline retest - counts how many times price revisited a level ---
  detectNecklineRetest(candles, startIdx, endIdx, level, tolerancePercent = 0.0015) {
    let touches = 0;
    for (let i = startIdx; i <= endIdx && i < candles.length; i++) {
      const c = candles[i];
      if (
        Math.abs(c.low - level) / level <= tolerancePercent ||
        Math.abs(c.high - level) / level <= tolerancePercent
      ) {
        touches++;
      }
    }
    return touches >= 2;
  }

  // --- Step 2 helpers ---

  // Find Swing Highs (returns {index, value} pairs, used by Step 3 detectors)
  findSwingHighs(highs, left = 2, right = 2) {
    const swings = [];

    for (let i = left; i < highs.length - right; i++) {
      let isSwing = true;

      for (let j = i - left; j <= i + right; j++) {
        if (j === i) continue;
        if (highs[j] >= highs[i]) {
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

  // Find Swing Lows (returns {index, value} pairs, used by Step 3 detectors)
  findSwingLows(lows, left = 2, right = 2) {
    const swings = [];

    for (let i = left; i < lows.length - right; i++) {
      let isSwing = true;

      for (let j = i - left; j <= i + right; j++) {
        if (j === i) continue;
        if (lows[j] <= lows[i]) {
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

  // Breakout Confirmation
  isBreakoutConfirmed(candles, level, direction) {
    const last = candles.slice(-this.breakoutConfirmationCandles);

    if (direction === 'BUY') {
      return last.every(c => c.close > level);
    }
    return last.every(c => c.close < level);
  }

  // Pattern Quality Score
  calculatePatternQuality(strength, confirmation) {
    let score = strength * 0.6 + confirmation * 0.4;
    return Math.max(50, Math.min(95, Math.round(score)));
  }

  // Linear Regression Slope
  linearRegressionSlope(values) {
    const n = values.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumXX += i * i;
    }

    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  }

  // Linear Regression Intercept
  linearRegressionIntercept(values, slope) {
    const n = values.length;
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
    }
    return (sumY - slope * sumX) / n;
  }

  // Predict line value
  predictRegressionValue(index, slope, intercept) {
    return slope * index + intercept;
  }

  // Reliability label based on confirmation score
  getReliability(score) {
      if (score >= 90)
          return "Very High";
      if (score >= 80)
          return "High";
      if (score >= 70)
          return "Medium";
      if (score >= 60)
          return "Low";
      return "Very Low";
  }

  // --- 10. Confidence % label (Institutional / Very High / High / Medium / Low) ---
  getConfidenceLabel(score) {
      if (score >= 95) return "Institutional";
      if (score >= 90) return "Very High";
      if (score >= 80) return "High";
      if (score >= 70) return "Medium";
      return "Low";
  }

  // --- 1. Average True Range ---
  calculateATR(candles, period = 14) {
    if (!candles || candles.length < period + 1) return 0;
    const trs = [];

    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      trs.push(Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      ));
    }

    return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  // --- 2. Synthetic FX volume confirmation ---
  confirmVolume(candles) {
    if (candles.length < 20) return true;
    // If candles don't carry a volume field at all, don't block detection on it
    if (candles[candles.length - 1].volume === undefined) return true;

    const avg = candles
      .slice(-20)
      .reduce((a, b) => a + (b.volume || 0), 0) / 20;

    return candles[candles.length - 1].volume > avg;
  }

  // --- 3. EMA ---
  calculateEMA(values, period) {
    if (!values || values.length === 0) return 0;
    const k = 2 / (period + 1);
    let ema = values[0];

    for (let i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
    }

    return ema;
  }

  // --- 4. RSI ---
  calculateRSI(candles, period = 14) {
    const closes = candles.map(c => c.close);
    if (closes.length < period + 1) return 50; // neutral if not enough data

    let gains = 0;
    let losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
  }

  // --- 5/6/7/8/9/10/11: enrich + filter a raw candidate pattern ---
  // Applies RSI confirmation, volume confirmation, pattern age rejection,
  // fake-breakout rejection, target/stop/RR, and the multi-confirmation score.
  postProcessPattern(pattern, candles, context) {
    if (!pattern) return null;

    // 8. Pattern age rejection (only meaningful for swing-based patterns)
    if (pattern._ageIndex !== undefined) {
      const age = (candles.length - 1) - pattern._ageIndex;
      if (age > this.maxPatternAge) return null;
    }

    // 4. RSI confirmation
    if (pattern.direction === 'BUY' && context.rsi > this.rsiBuyMax) return null;
    if (pattern.direction === 'SELL' && context.rsi < this.rsiSellMin) return null;

    // 2. Volume confirmation
    if (!context.volumeOk) return null;

    // 11. Fake-breakout rejection: re-check the very last close against the
    // level the pattern broke out from (extra safety on top of isBreakoutConfirmed)
    if (pattern.breakoutLevel !== undefined) {
      const lastClose = candles[candles.length - 1].close;
      if (pattern.direction === 'BUY' && lastClose < pattern.breakoutLevel) return null;
      if (pattern.direction === 'SELL' && lastClose > pattern.breakoutLevel) return null;
    }

    const entry = candles[candles.length - 1].close;
    pattern.entry = +entry.toFixed(5);

    // 6. Stop loss / 5. Target price - use pattern-specific values if the
    // detector already set them, otherwise fall back to an ATR-based target
    if (pattern.direction !== 'NEUTRAL') {
      if (pattern.stopLoss === undefined || pattern.targetPrice === undefined) {
        if (pattern.direction === 'BUY') {
          pattern.stopLoss = +(entry - context.atr * this.slAtrMultiplier).toFixed(5);
          pattern.targetPrice = +(entry + context.atr * this.tpAtrMultiplier).toFixed(5);
        } else if (pattern.direction === 'SELL') {
          pattern.stopLoss = +(entry + context.atr * this.slAtrMultiplier).toFixed(5);
          pattern.targetPrice = +(entry - context.atr * this.tpAtrMultiplier).toFixed(5);
        }
      }

      // 7. Risk/Reward
      const risk = Math.abs(entry - pattern.stopLoss);
      const reward = Math.abs(pattern.targetPrice - entry);
      pattern.RR = risk > 0 ? +(reward / risk).toFixed(2) : null;
    } else {
      pattern.stopLoss = null;
      pattern.targetPrice = null;
      pattern.RR = null;
    }

    // 9. Multi-factor confirmation score (0-100)
    const trendAligned =
      (context.trend === 'UP' && pattern.direction === 'BUY') ||
      (context.trend === 'DOWN' && pattern.direction === 'SELL');
    const trendScore = trendAligned ? 100 : (pattern.direction === 'NEUTRAL' ? 60 : 40);
    const volumeScore = context.volumeOk ? 100 : 0;
    const rsiScore = pattern.direction === 'BUY'
      ? Math.max(0, Math.min(100, 100 - context.rsi * 1.5))
      : pattern.direction === 'SELL'
        ? Math.max(0, Math.min(100, (context.rsi - 50) * 2))
        : 50;
    const atrScore = Math.min(100, (context.atrPercent / this.minATRPercent) * 50);
    const breakoutScore = 100; // already survived isBreakoutConfirmed + fake-breakout check

    let multiScore =
      volumeScore * 0.15 +
      rsiScore * 0.15 +
      trendScore * 0.20 +
      breakoutScore * 0.25 +
      atrScore * 0.10 +
      pattern.strength * 0.15;
    pattern.multiScore = Math.round(Math.max(0, Math.min(100, multiScore)));

    // 10. Confidence %
    const confidence = Math.round(
      pattern.confirmationScore * 0.4 +
      trendScore * 0.2 +
      volumeScore * 0.15 +
      rsiScore * 0.15 +
      atrScore * 0.1
    );
    pattern.confidence = Math.max(40, Math.min(99, confidence));
    pattern.confidenceLabel = this.getConfidenceLabel(pattern.confidence);

    delete pattern._ageIndex;
    return pattern;
  }

  // --- 12. Multi-timeframe + multi-factor weighted priority ranking ---
  calculateMultiTimeframeConfidence(patterns) {
      if (!patterns || patterns.length === 0)
          return [];
      return patterns.map(pattern => {
          const weight =
              this.timeframeWeights[
                  pattern.timeframe || "M5"
              ] || 1;

          // weightedScore = strength*.20 + confirmation*.25 + trend/RSI/volume/ATR (via multiScore)*.45 + timeframe*.05... normalized to a 0-100+ scale
          let weightedScore =
              (
                  pattern.strength * 0.20 +
                  pattern.confirmationScore * 0.25 +
                  (pattern.multiScore || 0) * 0.45 +
                  weight * 20 * 0.05 // timeframe contributes on the same rough scale
              );

          if (pattern.direction === "NEUTRAL") {
              weightedScore *= 0.85;
          }

          return {
              ...pattern,
              weightedScore: Math.round(weightedScore)
          };
      });
  }
}

module.exports = PatternAnalyzer;
