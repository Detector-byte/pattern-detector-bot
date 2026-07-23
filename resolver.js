/**
 * Signal Outcome Resolver
 * Automatically marks signals as WIN or LOSS
 */

resolve(signal, latestCandle) {

  if (!signal || !latestCandle) return null;

  // Initialize tracking
  if (!signal.createdAt) {
    signal.createdAt = new Date().toISOString();
  }

  if (!signal.tradeStatus) {
    signal.tradeStatus = "OPEN";
  }

  // Already resolved
  if (signal.outcome) return signal.outcome;

  // HOLD / Neutral signals
  if (
    signal.direction === "NEUTRAL" ||
    signal.signal === "HOLD"
  ) {
    signal.outcome = "NO_TRADE";
    signal.tradeStatus = "CLOSED";
    signal.exitReason = "NO_TRADE";
    signal.exitTime = new Date().toISOString();
    return signal.outcome;
  }

  // Expired signal
  if (
    signal.expiresAt &&
    new Date() > new Date(signal.expiresAt)
  ) {
    signal.outcome = "EXPIRED";
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
      signal.outcome = "WIN";
      signal.tradeStatus = "CLOSED";
      signal.exitReason = "TP3";
      signal.exitPrice = tp3;
    }

    else if (high >= tp2) {
      signal.outcome = "WIN";
      signal.tradeStatus = "CLOSED";
      signal.exitReason = "TP2";
      signal.exitPrice = tp2;
    }

    else if (high >= tp1) {
      signal.outcome = "PARTIAL_WIN";
      signal.tradeStatus = "CLOSED";
      signal.exitReason = "TP1";
      signal.exitPrice = tp1;
    }

    else if (low <= signal.stopLoss) {
      signal.outcome = "LOSS";
      signal.tradeStatus = "CLOSED";
      signal.exitReason = "STOP_LOSS";
      signal.exitPrice = signal.stopLoss;
    }

  }

  // SELL
  else if (signal.direction === "SELL") {

    if (low <= tp3) {
      signal.outcome = "WIN";
      signal.tradeStatus = "CLOSED";
      signal.exitReason = "TP3";
      signal.exitPrice = tp3;
    }

    else if (low <= tp2) {
      signal.outcome = "WIN";
      signal.tradeStatus = "CLOSED";
      signal.exitReason = "TP2";
      signal.exitPrice = tp2;
    }

    else if (low <= tp1) {
      signal.outcome = "PARTIAL_WIN";
      signal.tradeStatus = "CLOSED";
      signal.exitReason = "TP1";
      signal.exitPrice = tp1;
    }

    else if (high >= signal.stopLoss) {
      signal.outcome = "LOSS";
      signal.tradeStatus = "CLOSED";
      signal.exitReason = "STOP_LOSS";
      signal.exitPrice = signal.stopLoss;
    }

  }

  if (signal.outcome) {

    signal.exitTime = new Date().toISOString();

    if (signal.createdAt) {

      const start = new Date(signal.createdAt);
      const end = new Date(signal.exitTime);

      signal.tradeDurationMinutes =
        Math.round((end - start) / 60000);

    }

  }

  return signal.outcome || null;
}
