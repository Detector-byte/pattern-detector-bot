/**
 * Pattern Analyzer - Detects 10+ chart patterns
 * Double Top/Bottom, Head & Shoulders, Triangles, Wedges, etc.
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

    // Step 9 configuration
    this.timeframeWeights = {
        M5: 1,
        M15: 1.25,
        H1: 1.5,
        H4: 2
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

    const detectedPatterns = [];
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    // Double Top/Bottom
    const doubleTop = this.detectDoubleTop(candles, highs);
    if (doubleTop) detectedPatterns.push(doubleTop);

    const doubleBottom = this.detectDoubleBottom(candles, lows);
    if (doubleBottom) detectedPatterns.push(doubleBottom);

    // Head and Shoulders
    const hasPattern = this.detectHeadShoulders(candles, highs);
    if (hasPattern) detectedPatterns.push(hasPattern);

    const invPattern = this.detectInverseHeadShoulders(candles, lows);
    if (invPattern) detectedPatterns.push(invPattern);

    // Triangles
    const ascTriangle = this.detectAscendingTriangle(candles, highs, lows);
    if (ascTriangle) detectedPatterns.push(ascTriangle);

    const descTriangle = this.detectDescendingTriangle(candles, highs, lows);
    if (descTriangle) detectedPatterns.push(descTriangle);

    const symTriangle = this.detectSymmetricTriangle(candles, highs, lows);
    if (symTriangle) detectedPatterns.push(symTriangle);

    // Wedges
    const riseWedge = this.detectRisingWedge(candles, highs, lows);
    if (riseWedge) detectedPatterns.push(riseWedge);

    const fallWedge = this.detectFallingWedge(candles, highs, lows);
    if (fallWedge) detectedPatterns.push(fallWedge);

    // Pennants & Flags
    const pennant = this.detectPennant(candles, highs, lows);
    if (pennant) detectedPatterns.push(pennant);

    const flag = this.detectFlag(candles, highs, lows);
    if (flag) detectedPatterns.push(flag);

    // Cup and Handle
    const cupHandle = this.detectCupHandle(candles, lows, closes);
    if (cupHandle) detectedPatterns.push(cupHandle);

    // Rectangle
    const rectTop = this.detectRectangleTop(candles, highs);
    if (rectTop) detectedPatterns.push(rectTop);

    const rectBot = this.detectRectangleBottom(candles, lows);
    if (rectBot) detectedPatterns.push(rectBot);

    // Diamond
    const diamondTop = this.detectDiamondTop(candles, highs, lows);
    if (diamondTop) detectedPatterns.push(diamondTop);

    const diamondBot = this.detectDiamondBottom(candles, highs, lows);
    if (diamondBot) detectedPatterns.push(diamondBot);

    // Engulfing Patterns
    const bullEngulf = this.detectBullishEngulfing(candles);
    if (bullEngulf) detectedPatterns.push(bullEngulf);

    const bearEngulf = this.detectBearishEngulfing(candles);
    if (bearEngulf) detectedPatterns.push(bearEngulf);

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

    // Rank by confirmation first, then strength
    uniquePatterns.sort((a, b) => {
      if (b.confirmationScore !== a.confirmationScore) {
        return b.confirmationScore - a.confirmationScore;
      }
      return b.strength - a.strength;
    });

    // Keep only the best 5 patterns
    const ranked =
        this.calculateMultiTimeframeConfidence(
            uniquePatterns
        );
    return ranked
        .sort((a,b)=>b.weightedScore-a.weightedScore)
        .slice(0,5);
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
    const valley = Math.min(
      ...candles
        .slice(peak1.index, peak2.index + 1)
        .map(c => c.low)
    );

    // Breakout confirmation below the neckline
    if (!this.isBreakoutConfirmed(candles, valley, 'SELL')) return null;

    const strength = ((peak1.value - valley) / valley) * 100;
    const confirmationScore = this.calculatePatternQuality(strength, 88);

    return {
      name: 'Double Top',
      direction: 'SELL',
      strength: Math.round(strength),
      confirmationScore,
      reliability: this.getReliability(confirmationScore)
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
    const neckline = Math.max(
      ...candles
        .slice(low1.index, low2.index + 1)
        .map(c => c.high)
    );

    if (!this.isBreakoutConfirmed(candles, neckline, 'BUY')) return null;

    const strength = ((neckline - low1.value) / low1.value) * 100;
    const confirmationScore = this.calculatePatternQuality(strength, 88);

    return {
      name: 'Double Bottom',
      direction: 'BUY',
      strength: Math.round(strength),
      confirmationScore,
      reliability: this.getReliability(confirmationScore)
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
    const leftValley = Math.min(
      ...candles
        .slice(left.index, head.index + 1)
        .map(c => c.low)
    );
    const rightValley = Math.min(
      ...candles
        .slice(head.index, right.index + 1)
        .map(c => c.low)
    );
    const neckline = (leftValley + rightValley) / 2;

    // Breakout confirmation
    if (!this.isBreakoutConfirmed(candles, neckline, 'SELL'))
      return null;

    const strength =
      ((head.value - neckline) / neckline) * 100;
    const confirmationScore = this.calculatePatternQuality(
      strength,
      90
    );

    return {
      name: 'Head and Shoulders',
      direction: 'SELL',
      strength: Math.round(strength),
      confirmationScore,
      reliability: this.getReliability(confirmationScore)
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
    const leftPeak = Math.max(
      ...candles
        .slice(left.index, head.index + 1)
        .map(c => c.high)
    );
    const rightPeak = Math.max(
      ...candles
        .slice(head.index, right.index + 1)
        .map(c => c.high)
    );
    const neckline = (leftPeak + rightPeak) / 2;

    // Breakout confirmation
    if (!this.isBreakoutConfirmed(candles, neckline, 'BUY'))
      return null;

    const strength =
      ((neckline - head.value) / head.value) * 100;
    const confirmationScore = this.calculatePatternQuality(
      strength,
      90
    );

    return {
      name: 'Inverse Head and Shoulders',
      direction: 'BUY',
      strength: Math.round(strength),
      confirmationScore,
      reliability: this.getReliability(confirmationScore)
    };
  }

  detectAscendingTriangle(candles, highs, lows) {
    const recentHighs = highs.slice(-this.triangleLookback);
    const recentLows = lows.slice(-this.triangleLookback);

    const highSlope = this.linearRegressionSlope(recentHighs);
    const lowSlope = this.linearRegressionSlope(recentLows);

    if (
        Math.abs(highSlope) < this.regressionThreshold &&
        lowSlope > this.regressionThreshold
    ) {
        const resistance = Math.max(...recentHighs);
        if (!this.isBreakoutConfirmed(candles, resistance, "BUY"))
            return null;
        const confirmationScore = 90;
        return {
            name: "Ascending Triangle",
            direction: "BUY",
            strength: 82,
            confirmationScore,
            reliability: this.getReliability(confirmationScore)
        };
    }
    return null;
  }

  detectDescendingTriangle(candles, highs, lows) {
    const recentHighs = highs.slice(-this.triangleLookback);
    const recentLows = lows.slice(-this.triangleLookback);

    const highSlope = this.linearRegressionSlope(recentHighs);
    const lowSlope = this.linearRegressionSlope(recentLows);

    if (
        highSlope < -this.regressionThreshold &&
        Math.abs(lowSlope) < this.regressionThreshold
    ) {
        const support = Math.min(...recentLows);
        if (!this.isBreakoutConfirmed(candles, support, "SELL"))
            return null;
        const confirmationScore = 90;
        return {
            name: "Descending Triangle",
            direction: "SELL",
            strength: 82,
            confirmationScore,
            reliability: this.getReliability(confirmationScore)
        };
    }
    return null;
  }

  detectSymmetricTriangle(candles, highs, lows) {
      const recentHighs = highs.slice(-this.triangleLookback);
      const recentLows = lows.slice(-this.triangleLookback);
      const highSlope = this.linearRegressionSlope(recentHighs);
      const lowSlope = this.linearRegressionSlope(recentLows);
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

  detectRisingWedge(candles, highs, lows) {
      const recentHighs = highs.slice(-this.wedgeLookback);
      const recentLows = lows.slice(-this.wedgeLookback);
      const highSlope = this.linearRegressionSlope(recentHighs);
      const lowSlope = this.linearRegressionSlope(recentLows);
      if (
          highSlope > this.regressionThreshold &&
          lowSlope > this.regressionThreshold &&
          highSlope > lowSlope
      ) {
          const support = Math.min(...recentLows);
          if (!this.isBreakoutConfirmed(candles, support, "SELL"))
              return null;
          const trend = this.detectTrend(candles);
          if (trend !== "UP")
              return null;
          const confirmationScore = 90;
          return {
              name: "Rising Wedge",
              direction: "SELL",
              strength: 80,
              confirmationScore,
              reliability: this.getReliability(confirmationScore)
          };
      }
      return null;
  }

  detectFallingWedge(candles, highs, lows) {
      const recentHighs = highs.slice(-this.wedgeLookback);
      const recentLows = lows.slice(-this.wedgeLookback);
      const highSlope = this.linearRegressionSlope(recentHighs);
      const lowSlope = this.linearRegressionSlope(recentLows);
      if (
          highSlope < -this.regressionThreshold &&
          lowSlope < -this.regressionThreshold &&
          Math.abs(lowSlope) > Math.abs(highSlope)
      ) {
          const resistance = Math.max(...recentHighs);
          if (!this.isBreakoutConfirmed(candles, resistance, "BUY"))
              return null;
          const trend = this.detectTrend(candles);
          if (trend !== "DOWN")
              return null;
          const confirmationScore = 90;
          return {
              name: "Falling Wedge",
              direction: "BUY",
              strength: 80,
              confirmationScore,
              reliability: this.getReliability(confirmationScore)
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
                  ? Math.max(...recentHighs)
                  : Math.min(...recentLows);
          if (!this.isBreakoutConfirmed(candles, breakoutLevel, direction))
              return null;
          const confirmationScore = 91;
          return {
              name: "Pennant",
              direction,
              strength: 84,
              confirmationScore,
              reliability: this.getReliability(confirmationScore)
          };
      }
      return null;
  }

  detectFlag(candles, highs, lows) {
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
              Math.max(...highs.slice(-15));
          if (!this.isBreakoutConfirmed(candles, resistance, "BUY"))
              return null;
          const trend = this.detectTrend(candles);
          if (trend !== "UP")
              return null;
          const confirmationScore = 92;
          return {
              name: "Bull Flag",
              direction: "BUY",
              strength: 85,
              confirmationScore,
              reliability: this.getReliability(confirmationScore)
          };
      }
      if (
          impulse < -0.03 &&
          flagSlope > 0
      ) {
          const support =
              Math.min(...lows.slice(-15));
          if (!this.isBreakoutConfirmed(candles, support, "SELL"))
              return null;
          const trend = this.detectTrend(candles);
          if (trend !== "DOWN")
              return null;
          const confirmationScore = 92;
          return {
              name: "Bear Flag",
              direction: "SELL",
              strength: 85,
              confirmationScore,
              reliability: this.getReliability(confirmationScore)
          };
      }
      return null;
  }

  detectCupHandle(candles, lows, closes) {
    const n = candles.length;
    if (n < 30) return null;

    const recent = lows.slice(n - 30);
    const minIdx = recent.indexOf(Math.min(...recent));

    if (minIdx < 5 || minIdx > recent.length - 10) return null;

    // Cup formation
    const cupDepth = (Math.max(...recent.slice(0, minIdx)) - recent[minIdx]) / recent[minIdx];
    if (cupDepth < 0.02 || cupDepth > 0.15) return null;

    // Handle formation
    const handleHigh = Math.max(...recent.slice(minIdx + 1, minIdx + 6));
    const handleRange = (handleHigh - recent[minIdx]) / recent[minIdx];
    if (handleRange > 0.08) return null;

    const trend = this.detectTrend(candles);
    if (trend !== "UP")
        return null;

    const confirmationScore = 85;
    return {
      name: 'Cup and Handle',
      direction: 'BUY',
      strength: 72,
      confirmationScore,
      reliability: this.getReliability(confirmationScore)
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
        reliability: this.getReliability(confirmationScore)
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
        reliability: this.getReliability(confirmationScore)
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

  // Detect Swing Highs
  getSwingHighs(candles, left = 2, right = 2) {
    const swings = [];

    for (let i = left; i < candles.length - right; i++) {
      let isSwing = true;

      // Left side check
      for (let j = 1; j <= left; j++) {
        if (candles[i].high <= candles[i - j].high) {
          isSwing = false;
          break;
        }
      }

      if (!isSwing) continue;

      // Right side check
      for (let j = 1; j <= right; j++) {
        if (candles[i].high <= candles[i + j].high) {
          isSwing = false;
          break;
        }
      }

      if (isSwing) {
        swings.push({
          index: i,
          price: candles[i].high,
          candle: candles[i]
        });
      }
    }

    return swings;
  }

  // Detect Swing Lows
  getSwingLows(candles, left = 2, right = 2) {
    const swings = [];

    for (let i = left; i < candles.length - right; i++) {
      let isSwing = true;

      // Left side check
      for (let j = 1; j <= left; j++) {
        if (candles[i].low >= candles[i - j].low) {
          isSwing = false;
          break;
        }
      }

      if (!isSwing) continue;

      // Right side check
      for (let j = 1; j <= right; j++) {
        if (candles[i].low >= candles[i + j].low) {
          isSwing = false;
          break;
        }
      }

      if (isSwing) {
        swings.push({
          index: i,
          price: candles[i].low,
          candle: candles[i]
        });
      }
    }

    return swings;
  }

  // Detect overall market trend
  detectTrend(candles, period = 20) {

    if (!candles || candles.length < period)
      return "SIDEWAYS";

    const recent = candles.slice(-period);

    const first = recent[0].close;
    const last = recent[recent.length - 1].close;

    const change = ((last - first) / first) * 100;

    if (change >= 1)
      return "UP";

    if (change <= -1)
      return "DOWN";

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
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = (max - min) / min;
    return range < threshold;
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

  // Multi-timeframe confidence weighting
  calculateMultiTimeframeConfidence(patterns) {
      if (!patterns || patterns.length === 0)
          return [];
      return patterns.map(pattern => {
          const weight =
              this.timeframeWeights[
                  pattern.timeframe || "M5"
              ] || 1;
          let weightedScore =
              (
                  pattern.confirmationScore * 0.7 +
                  pattern.strength * 0.3
              ) * weight;
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
