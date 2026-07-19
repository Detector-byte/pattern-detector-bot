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
  detectAllPatterns(candles) {
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

    return detectedPatterns;
  }

  detectDoubleTop(candles, highs) {
    const n = candles.length;
    if (n < 20) return null;

    const recent = highs.slice(n - 20);
    const peak1Idx = recent.indexOf(Math.max(...recent.slice(0, 10)));
    const peak2Idx = recent.indexOf(Math.max(...recent.slice(10)));

    if (peak1Idx < 0 || peak2Idx <= peak1Idx) return null;

    const similarity = Math.abs(recent[peak1Idx] - recent[peak2Idx]) / recent[peak1Idx];
    if (similarity > 0.02) return null; // Peaks too different

    const valley = Math.min(...recent.slice(peak1Idx + 1, peak2Idx));
    const strength = ((recent[peak1Idx] - valley) / valley) * 100;

    return {
      name: 'Double Top',
      direction: 'SELL',
      strength: Math.min(strength, 100),
      confirmationScore: 85 - (similarity * 100)
    };
  }

  detectDoubleBottom(candles, lows) {
    const n = candles.length;
    if (n < 20) return null;

    const recent = lows.slice(n - 20);
    const valley1Idx = recent.indexOf(Math.min(...recent.slice(0, 10)));
    const valley2Idx = recent.indexOf(Math.min(...recent.slice(10)));

    if (valley1Idx < 0 || valley2Idx <= valley1Idx) return null;

    const similarity = Math.abs(recent[valley1Idx] - recent[valley2Idx]) / recent[valley2Idx];
    if (similarity > 0.02) return null;

    const peak = Math.max(...recent.slice(valley1Idx + 1, valley2Idx));
    const strength = ((peak - recent[valley1Idx]) / recent[valley1Idx]) * 100;

    return {
      name: 'Double Bottom',
      direction: 'BUY',
      strength: Math.min(strength, 100),
      confirmationScore: 85 - (similarity * 100)
    };
  }

  detectHeadShoulders(candles, highs) {
    const n = candles.length;
    if (n < 25) return null;

    const recent = highs.slice(n - 25);
    const maxIdx = recent.indexOf(Math.max(...recent));

    if (maxIdx < 5 || maxIdx > recent.length - 6) return null;

    const leftShoulder = Math.max(...recent.slice(0, maxIdx - 3));
    const head = recent[maxIdx];
    const rightShoulder = Math.max(...recent.slice(maxIdx + 3));

    const shoulderSimilarity = Math.abs(leftShoulder - rightShoulder) / leftShoulder;
    if (shoulderSimilarity > 0.05) return null;

    const neckline = Math.min(...recent.slice(maxIdx - 3, maxIdx + 3));
    const strength = ((head - neckline) / neckline) * 100;

    return {
      name: 'Head and Shoulders',
      direction: 'SELL',
      strength: Math.min(strength, 100),
      confirmationScore: 88
    };
  }

  detectInverseHeadShoulders(candles, lows) {
    const n = candles.length;
    if (n < 25) return null;

    const recent = lows.slice(n - 25);
    const minIdx = recent.indexOf(Math.min(...recent));

    if (minIdx < 5 || minIdx > recent.length - 6) return null;

    const leftShoulder = Math.min(...recent.slice(0, minIdx - 3));
    const head = recent[minIdx];
    const rightShoulder = Math.min(...recent.slice(minIdx + 3));

    const shoulderSimilarity = Math.abs(leftShoulder - rightShoulder) / leftShoulder;
    if (shoulderSimilarity > 0.05) return null;

    const neckline = Math.max(...recent.slice(minIdx - 3, minIdx + 3));
    const strength = ((neckline - head) / head) * 100;

    return {
      name: 'Inverse Head and Shoulders',
      direction: 'BUY',
      strength: Math.min(strength, 100),
      confirmationScore: 88
    };
  }

  detectAscendingTriangle(candles, highs, lows) {
    const n = candles.length;
    if (n < 20) return null;

    const recent = { highs: highs.slice(n - 20), lows: lows.slice(n - 20) };
    
    // Check for rising lows and flat highs
    const lowTrend = this.isTrendingUp(recent.lows, 0.02);
    const highFlat = this.isFlat(recent.highs, 0.015);

    if (lowTrend && highFlat) {
      const strength = ((recent.highs[0] - recent.lows[0]) / recent.lows[0]) * 100;
      return {
        name: 'Ascending Triangle',
        direction: 'BUY',
        strength: Math.min(strength, 100),
        confirmationScore: 82
      };
    }
    return null;
  }

  detectDescendingTriangle(candles, highs, lows) {
    const n = candles.length;
    if (n < 20) return null;

    const recent = { highs: highs.slice(n - 20), lows: lows.slice(n - 20) };
    
    // Check for falling highs and flat lows
    const highTrend = this.isTrendingDown(recent.highs, 0.02);
    const lowFlat = this.isFlat(recent.lows, 0.015);

    if (highTrend && lowFlat) {
      const strength = ((recent.highs[0] - recent.lows[0]) / recent.lows[0]) * 100;
      return {
        name: 'Descending Triangle',
        direction: 'SELL',
        strength: Math.min(strength, 100),
        confirmationScore: 82
      };
    }
    return null;
  }

  detectSymmetricTriangle(candles, highs, lows) {
    const n = candles.length;
    if (n < 20) return null;

    const recent = { highs: highs.slice(n - 20), lows: lows.slice(n - 20) };
    
    // Check for converging highs and lows
    const highTrend = this.isTrendingDown(recent.highs, 0.015);
    const lowTrend = this.isTrendingUp(recent.lows, 0.015);

    if (highTrend && lowTrend) {
      const strength = ((recent.highs[0] - recent.lows[0]) / recent.lows[0]) * 100;
      return {
        name: 'Symmetric Triangle',
        direction: 'NEUTRAL',
        strength: Math.min(strength, 100),
        confirmationScore: 75
      };
    }
    return null;
  }

  detectRisingWedge(candles, highs, lows) {
    const n = candles.length;
    if (n < 20) return null;

    const recent = { highs: highs.slice(n - 20), lows: lows.slice(n - 20) };
    
    // Rising highs and rising lows, highs steeper
    const highTrend = this.isTrendingUp(recent.highs, 0.025);
    const lowTrend = this.isTrendingUp(recent.lows, 0.015);

    if (highTrend && lowTrend) {
      return {
        name: 'Rising Wedge',
        direction: 'SELL',
        strength: 70,
        confirmationScore: 78
      };
    }
    return null;
  }

  detectFallingWedge(candles, highs, lows) {
    const n = candles.length;
    if (n < 20) return null;

    const recent = { highs: highs.slice(n - 20), lows: lows.slice(n - 20) };
    
    // Falling highs and falling lows, lows steeper
    const highTrend = this.isTrendingDown(recent.highs, 0.015);
    const lowTrend = this.isTrendingDown(recent.lows, 0.025);

    if (highTrend && lowTrend) {
      return {
        name: 'Falling Wedge',
        direction: 'BUY',
        strength: 70,
        confirmationScore: 78
      };
    }
    return null;
  }

  detectPennant(candles, highs, lows) {
    const n = candles.length;
    if (n < 20) return null;

    const recent = { highs: highs.slice(n - 20), lows: lows.slice(n - 20), closes: candles.slice(n - 20).map(c => c.close) };
    
    // Small triangle after strong move
    const range = recent.highs[0] - recent.lows[0];
    const newRange = recent.highs[recent.highs.length - 1] - recent.lows[recent.lows.length - 1];
    
    if (newRange < range * 0.3) {
      const prevTrend = recent.closes[0] > recent.closes[10] ? 'DOWN' : 'UP';
      return {
        name: 'Pennant',
        direction: prevTrend === 'UP' ? 'BUY' : 'SELL',
        strength: 65,
        confirmationScore: 72
      };
    }
    return null;
  }

  detectFlag(candles, highs, lows) {
    const n = candles.length;
    if (n < 20) return null;

    const recent = candles.slice(n - 20);
    const closes = recent.map(c => c.close);
    
    // Small consolidation after strong move
    const firstHalf = closes.slice(0, 10);
    const secondHalf = closes.slice(10);
    
    const firstRange = Math.max(...firstHalf) - Math.min(...firstHalf);
    const secondRange = Math.max(...secondHalf) - Math.min(...secondHalf);
    
    if (secondRange < firstRange * 0.4) {
      const trend = closes[0] > closes[10] ? 'DOWN' : 'UP';
      return {
        name: 'Flag',
        direction: trend === 'UP' ? 'BUY' : 'SELL',
        strength: 68,
        confirmationScore: 75
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

    return {
      name: 'Cup and Handle',
      direction: 'BUY',
      strength: 72,
      confirmationScore: 85
    };
  }

  detectRectangleTop(candles, highs) {
    const n = candles.length;
    if (n < 20) return null;

    const recent = highs.slice(n - 20);
    if (this.isFlat(recent, 0.01)) {
      return {
        name: 'Rectangle Top',
        direction: 'SELL',
        strength: 65,
        confirmationScore: 70
      };
    }
    return null;
  }

  detectRectangleBottom(candles, lows) {
    const n = candles.length;
    if (n < 20) return null;

    const recent = lows.slice(n - 20);
    if (this.isFlat(recent, 0.01)) {
      return {
        name: 'Rectangle Bottom',
        direction: 'BUY',
        strength: 65,
        confirmationScore: 70
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
      return {
        name: 'Diamond Top',
        direction: 'SELL',
        strength: 73,
        confirmationScore: 80
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
      return {
        name: 'Diamond Bottom',
        direction: 'BUY',
        strength: 73,
        confirmationScore: 80
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
      return {
        name: 'Bullish Engulfing',
        direction: 'BUY',
        strength: Math.min(strength, 100),
        confirmationScore: 80
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
      return {
        name: 'Bearish Engulfing',
        direction: 'SELL',
        strength: Math.min(strength, 100),
        confirmationScore: 80
      };
    }
    return null;
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
}

module.exports = PatternAnalyzer;
