/**
 * Signal Outcome Resolver
 * Automatically marks signals as WIN or LOSS
 */

class SignalResolver {

  constructor() {}

  resolve(signal, latestCandle) {

    if (!signal || !latestCandle)
      return null;

    // Already resolved
    if (signal.outcome)
      return signal.outcome;

    const high = latestCandle.high;
    const low = latestCandle.low;

    // BUY signal
    if (signal.direction === "BUY") {

      if (high >= signal.takeProfit) {
        signal.outcome = "WIN";
      }
      else if (low <= signal.stopLoss) {
        signal.outcome = "LOSS";
      }

    }

    // SELL signal
    else if (signal.direction === "SELL") {

      if (low <= signal.takeProfit) {
        signal.outcome = "WIN";
      }
      else if (high >= signal.stopLoss) {
        signal.outcome = "LOSS";
      }

    }

    return signal.outcome || null;

  }

}

module.exports = SignalResolver;
