/**
 * Signal Outcome Resolver
 * Automatically marks signals as WIN or LOSS
 */

resolve(signal, latestCandle) {

  if (!signal || !latestCandle) return null;

  if (signal.outcome) return signal.outcome;

  // HOLD / Neutral signals
  if (
    signal.direction === "NEUTRAL" ||
    signal.signal === "HOLD"
  ) {
    signal.outcome = "NO_TRADE";
    return signal.outcome;
  }

  // Expired signal
  if (
    signal.expiresAt &&
    new Date() > new Date(signal.expiresAt)
  ) {
    signal.outcome = "EXPIRED";
    return signal.outcome;
  }

  const high = latestCandle.high;
  const low = latestCandle.low;

  // Backward compatibility
  const tp1 =
    signal.takeProfit1 ??
    signal.takeProfit;

  const tp2 =
    signal.takeProfit2 ??
    tp1;

  const tp3 =
    signal.takeProfit3 ??
    tp2;

  // BUY
  if (signal.direction === "BUY") {

    if (high >= tp3) {
      signal.outcome = "WIN";
      signal.exitReason = "TP3";
      signal.exitPrice = tp3;
    }

    else if (high >= tp2) {
      signal.outcome = "WIN";
      signal.exitReason = "TP2";
      signal.exitPrice = tp2;
    }

    else if (high >= tp1) {
      signal.outcome = "PARTIAL_WIN";
      signal.exitReason = "TP1";
      signal.exitPrice = tp1;
    }

    else if (low <= signal.stopLoss) {
      signal.outcome = "LOSS";
      signal.exitReason = "STOP_LOSS";
      signal.exitPrice = signal.stopLoss;
    }

  }

  // SELL
  else if (signal.direction === "SELL") {

    if (low <= tp3) {
      signal.outcome = "WIN";
      signal.exitReason = "TP3";
      signal.exitPrice = tp3;
    }

    else if (low <= tp2) {
      signal.outcome = "WIN";
      signal.exitReason = "TP2";
      signal.exitPrice = tp2;
    }

    else if (low <= tp1) {
      signal.outcome = "PARTIAL_WIN";
      signal.exitReason = "TP1";
      signal.exitPrice = tp1;
    }

    else if (high >= signal.stopLoss) {
      signal.outcome = "LOSS";
      signal.exitReason = "STOP_LOSS";
      signal.exitPrice = signal.stopLoss;
    }

  }

  if (signal.outcome) {
    signal.exitTime = new Date().toISOString();
  }

  return signal.outcome || null;
}
