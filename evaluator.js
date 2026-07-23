/**
 * Signal Evaluator
 * Automatically checks whether a signal reached TP or SL.
 */

class SignalEvaluator {

  constructor() {}

  evaluateSignal(signal, candles) {

    if (!signal || !candles || candles.length === 0)
      return null;

    if (
      signal.outcome &&
      signal.outcome !== null
    ) {
      return signal.outcome;
    }

    const entry = signal.entry;
    const tp = signal.takeProfit;
    const sl = signal.stopLoss;

    if (
      entry == null ||
      tp == null ||
      sl == null
    ) {
      return null;
    }

    const afterSignal = candles.filter(c => {

      return new Date(c.time || c.timestamp)
        >= new Date(signal.timestamp);

    });

    for (const candle of afterSignal) {

      if (signal.direction === "BUY") {

        if (candle.high >= tp)
          return "WIN";

        if (candle.low <= sl)
          return "LOSS";

      }

      if (signal.direction === "SELL") {

        if (candle.low <= tp)
          return "WIN";

        if (candle.high >= sl)
          return "LOSS";

      }

    }

    return null;

  }

}

module.exports = SignalEvaluator;
