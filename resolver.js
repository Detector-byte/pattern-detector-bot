/**
 * Signal Outcome Resolver
 * Automatically marks signals as WIN / LOSS / PARTIAL_WIN / EXPIRED
 */

class SignalResolver {

  constructor() {

    this.outcomes = {
      WIN: "WIN",
      PARTIAL_WIN: "PARTIAL_WIN",
      LOSS: "LOSS",
      EXPIRED: "EXPIRED",
      NO_TRADE: "NO_TRADE",
      OPEN: "OPEN"
    };

  }

  resolve(signal, latestCandle) {

    if (!signal || !latestCandle) return null;

    // Initialize tracking
    if (!signal.createdAt) {
      signal.createdAt = new Date().toISOString();
    }

    if (!signal.tradeStatus) {
      signal.tradeStatus = this.outcomes.OPEN;
    }

    // Already resolved
    if (signal.outcome) {
      return signal.outcome;
    }

    // Neutral / Hold
    if (
      signal.direction === "NEUTRAL" ||
      signal.signal === "HOLD"
    ) {

      signal.outcome = this.outcomes.NO_TRADE;
      signal.tradeStatus = "CLOSED";
      signal.exitReason = "NO_TRADE";
      signal.exitTime = new Date().toISOString();

      return signal.outcome;

    }

    // Expired
    if (
      signal.expiresAt &&
      new Date() > new Date(signal.expiresAt)
    ) {

      signal.outcome = this.outcomes.EXPIRED;
      signal.tradeStatus = "CLOSED";
      signal.exitReason = "EXPIRED";
      signal.exitTime = new Date().toISOString();

      return signal.outcome;

    }

    const high = latestCandle.high;
    const low = latestCandle.low;

    // Backward compatibility
    const tp1 = signal.takeProfit1 ?? signal.takeProfit;
    const tp2 = signal.takeProfit2 ?? tp1;
    const tp3 = signal.takeProfit3 ?? tp2;

    // BUY
    if (signal.direction === "BUY") {

      if (high >= tp3) {

        signal.outcome = this.outcomes.WIN;
        signal.tradeStatus = "CLOSED";
        signal.exitReason = "TP3";
        signal.exitPrice = tp3;

      }

      else if (high >= tp2) {

        signal.outcome = this.outcomes.WIN;
        signal.tradeStatus = "CLOSED";
        signal.exitReason = "TP2";
        signal.exitPrice = tp2;

      }

      else if (high >= tp1) {

        signal.outcome = this.outcomes.PARTIAL_WIN;
        signal.tradeStatus = "CLOSED";
        signal.exitReason = "TP1";
        signal.exitPrice = tp1;

      }

      else if (low <= signal.stopLoss) {

        signal.outcome = this.outcomes.LOSS;
        signal.tradeStatus = "CLOSED";
        signal.exitReason = "STOP_LOSS";
        signal.exitPrice = signal.stopLoss;

      }

    }

    // SELL
    else if (signal.direction === "SELL") {

      if (low <= tp3) {

        signal.outcome = this.outcomes.WIN;
        signal.tradeStatus = "CLOSED";
        signal.exitReason = "TP3";
        signal.exitPrice = tp3;

      }

      else if (low <= tp2) {

        signal.outcome = this.outcomes.WIN;
        signal.tradeStatus = "CLOSED";
        signal.exitReason = "TP2";
        signal.exitPrice = tp2;

      }

      else if (low <= tp1) {

        signal.outcome = this.outcomes.PARTIAL_WIN;
        signal.tradeStatus = "CLOSED";
        signal.exitReason = "TP1";
        signal.exitPrice = tp1;

      }

      else if (high >= signal.stopLoss) {

        signal.outcome = this.outcomes.LOSS;
        signal.tradeStatus = "CLOSED";
        signal.exitReason = "STOP_LOSS";
        signal.exitPrice = signal.stopLoss;

      }

    }

    if (signal.outcome) {

      signal.exitTime = new Date().toISOString();

      const start = new Date(signal.createdAt);
      const end = new Date(signal.exitTime);

      signal.tradeDurationMinutes =
        Math.round((end - start) / 60000);

    }

    return signal.outcome || null;

  }

}

module.exports = SignalResolver;
