/**
 * PipSight Pro AI - Institutional Signal Outcome Resolver
 *
 * Responsibilities:
 * - Resolve BUY / SELL outcomes without recalculating indicators
 * - Preserve legacy resolve(signal, latestCandle) API
 * - Support TP1 / TP2 / TP3 progressive lifecycle
 * - Handle partial wins, break-even and managed stops
 * - Apply conservative same-candle ambiguity handling
 * - Produce structured learning/performance metadata
 *
 * This module does not calculate EMA, RSI, MACD, ATR, confidence,
 * pattern weight, market regime or signal levels. It consumes the
 * levels and intelligence already produced by the existing system.
 */

class SignalResolver {

  constructor(options = {}) {

    this.options = {

      intrabarPolicy: "CONSERVATIVE",

      progressiveTargets: true,

      breakEvenAfterTP1: true,

      closeAtTP2WhenTP3Missing: true,

      preserveLegacyOutcomeFields: true,

      ...options

    };

    this.outcomes = Object.freeze({

      WIN: "WIN",

      PARTIAL_WIN: "PARTIAL_WIN",

      LOSS: "LOSS",

      BREAK_EVEN: "BREAK_EVEN",

      EXPIRED: "EXPIRED",

      NO_TRADE: "NO_TRADE",

      OPEN: "OPEN"

    });

    this.statuses = Object.freeze({

      NEW: "NEW",

      ACTIVE: "ACTIVE",

      PARTIAL: "PARTIAL",

      CLOSED: "CLOSED"

    });

  }

  /**
   * Backward-compatible resolver.
   *
   * Returns:
   * - WIN / LOSS / BREAK_EVEN / EXPIRED / NO_TRADE when finally closed
   * - PARTIAL_WIN when a new partial target is reached
   * - null while still open and no new event occurred
   */
  resolve(signal, latestCandle, context = {}) {

    const result =
      this.resolveDetailed(
        signal,
        latestCandle,
        context
      );

    return result
      ? result.event
      : null;

  }

  /**
   * Full institutional resolution result.
   */
  resolveDetailed(
    signal,
    latestCandle,
    context = {}
  ) {

    if (
      !signal ||
      !latestCandle
    ) {

      return null;

    }

    const timestamp =
      this.getTimestamp(
        context.now
      );

    this.initializeSignal(
      signal,
      timestamp
    );

    if (
      this.isFinallyResolved(
        signal
      )
    ) {

      return this.buildResult(
        signal,
        signal.outcome,
        false
      );

    }

    const validation =
      this.validateInputs(
        signal,
        latestCandle
      );

    if (
      !validation.valid
    ) {

      signal.resolverError =
        validation.reason;

      signal.lastResolverCheck =
        timestamp;

      return this.buildResult(
        signal,
        null,
        false,
        validation.reason
      );

    }

    if (
      this.isNoTradeSignal(
        signal
      )
    ) {

      this.closeSignal(
        signal,
        {

          outcome:
            this.outcomes.NO_TRADE,

          reason:
            "NO_TRADE",

          price:
            this.getReferencePrice(
              latestCandle
            ),

          timestamp

        }
      );

      return this.buildResult(
        signal,
        this.outcomes.NO_TRADE,
        true
      );

    }

    if (
      this.isExpired(
        signal,
        timestamp,
        context
      )
    ) {

      this.closeSignal(
        signal,
        {

          outcome:
            this.outcomes.EXPIRED,

          reason:
            "EXPIRED",

          price:
            this.getReferencePrice(
              latestCandle
            ),

          timestamp

        }
      );

      return this.buildResult(
        signal,
        this.outcomes.EXPIRED,
        true
      );

    }

    const levels =
      this.getLevels(
        signal
      );

    const candle =
      this.normalizeCandle(
        latestCandle
      );

    this.updateExcursionMetrics(
      signal,
      candle,
      timestamp
    );

    const event =
      signal.direction === "BUY"

        ? this.resolveBuy(
            signal,
            candle,
            levels,
            timestamp
          )

        : this.resolveSell(
            signal,
            candle,
            levels,
            timestamp
          );

    signal.lastResolverCheck =
      timestamp;

    signal.lastCheckedCandle =
      this.getCandleIdentity(
        latestCandle
      );

    return this.buildResult(
      signal,
      event,
      Boolean(event)
    );

  }

  /**
   * Resolve multiple signals using either:
   * - a candle lookup function, or
   * - candles[pair][timeframe]
   */
  resolveBatch(
    signals,
    candleSource,
    context = {}
  ) {

    if (
      !Array.isArray(
        signals
      )
    ) {

      return [];

    }

    const results = [];

    for (
      const signal of signals
    ) {

      const candle =
        this.getCandleForSignal(
          signal,
          candleSource
        );

      if (!candle) {

        continue;

      }

      const result =
        this.resolveDetailed(
          signal,
          candle,
          context
        );

      if (result) {

        results.push(
          result
        );

      }

    }

    return results;

  }

  initializeSignal(
    signal,
    timestamp
  ) {

    signal.createdAt =
      signal.createdAt ||
      signal.timestamp ||
      timestamp;

    signal.tradeStatus =
      signal.tradeStatus ||
      this.statuses.ACTIVE;

    signal.status =
      signal.status ||
      this.statuses.ACTIVE;

    signal.targetProgress = {

      tp1Hit: false,

      tp2Hit: false,

      tp3Hit: false,

      highestTargetReached: 0,

      partialEvents: [],

      ...(
        signal.targetProgress ||
        {}
      )

    };

    if (
      !Array.isArray(
        signal.targetProgress
          .partialEvents
      )
    ) {

      signal.targetProgress
        .partialEvents = [];

    }

    signal.initialStopLoss =
      this.toFiniteNumber(
        signal.initialStopLoss
      ) ??
      this.toFiniteNumber(
        signal.stopLoss
      );

    signal.managedStopLoss =
      this.toFiniteNumber(
        signal.managedStopLoss
      ) ??
      this.toFiniteNumber(
        signal.stopLoss
      );

    signal.resolutionVersion =
      signal.resolutionVersion ||
      1;

  }

  validateInputs(
    signal,
    candle
  ) {

    const direction =
      String(
        signal.direction ||
        ""
      ).toUpperCase();

    if (
      ![
        "BUY",
        "SELL",
        "NEUTRAL"
      ].includes(direction)
    ) {

      return {

        valid: false,

        reason:
          `unsupported direction: ${signal.direction}`

      };

    }

    const normalized =
      this.normalizeCandle(
        candle
      );

    if (
      !Number.isFinite(
        normalized.high
      ) ||
      !Number.isFinite(
        normalized.low
      )
    ) {

      return {

        valid: false,

        reason:
          "latest candle is missing valid high/low values"

      };

    }

    if (
      direction === "NEUTRAL" ||
      signal.signal === "HOLD"
    ) {

      return {
        valid: true
      };

    }

    const levels =
      this.getLevels(
        signal
      );

    if (
      !Number.isFinite(
        levels.stopLoss
      )
    ) {

      return {

        valid: false,

        reason:
          "signal is missing a valid stop loss"

      };

    }

    if (
      !Number.isFinite(
        levels.tp1
      )
    ) {

      return {

        valid: false,

        reason:
          "signal is missing a valid take profit"

      };

    }

    return {
      valid: true
    };

  }

  resolveBuy(
    signal,
    candle,
    levels,
    timestamp
  ) {

    const stopHit =
      candle.low <=
      levels.stopLoss;

    const tp1Hit =
      candle.high >=
      levels.tp1;

    const tp2Hit =
      Number.isFinite(
        levels.tp2
      ) &&
      candle.high >=
      levels.tp2;

    const tp3Hit =
      Number.isFinite(
        levels.tp3
      ) &&
      candle.high >=
      levels.tp3;

    if (
      stopHit &&
      (
        tp1Hit ||
        tp2Hit ||
        tp3Hit
      )
    ) {

      return this.resolveAmbiguousCandle(
        signal,
        levels,
        timestamp,
        Math.max(

          tp3Hit ? 3 : 0,

          tp2Hit ? 2 : 0,

          tp1Hit ? 1 : 0

        )
      );

    }

    if (stopHit) {

      return this.resolveStop(
        signal,
        levels.stopLoss,
        timestamp
      );

    }

    return this.resolveTargets(
      signal,
      levels,
      timestamp,
      {

        tp1Hit,

        tp2Hit,

        tp3Hit

      }
    );

  }

  resolveSell(
    signal,
    candle,
    levels,
    timestamp
  ) {

    const stopHit =
      candle.high >=
      levels.stopLoss;

    const tp1Hit =
      candle.low <=
      levels.tp1;

    const tp2Hit =
      Number.isFinite(
        levels.tp2
      ) &&
      candle.low <=
      levels.tp2;

    const tp3Hit =
      Number.isFinite(
        levels.tp3
      ) &&
      candle.low <=
      levels.tp3;

    if (
      stopHit &&
      (
        tp1Hit ||
        tp2Hit ||
        tp3Hit
      )
    ) {

      return this.resolveAmbiguousCandle(
        signal,
        levels,
        timestamp,
        Math.max(

          tp3Hit ? 3 : 0,

          tp2Hit ? 2 : 0,

          tp1Hit ? 1 : 0

        )
      );

    }

    if (stopHit) {

      return this.resolveStop(
        signal,
        levels.stopLoss,
        timestamp
      );

    }

    return this.resolveTargets(
      signal,
      levels,
      timestamp,
      {

        tp1Hit,

        tp2Hit,

        tp3Hit

      }
    );

  }

  resolveTargets(
    signal,
    levels,
    timestamp,
    hits
  ) {

    const highestTarget =
      hits.tp3Hit

        ? 3

        : hits.tp2Hit

          ? 2

          : hits.tp1Hit

            ? 1

            : 0;

    if (
      highestTarget === 0
    ) {

      return null;

    }

    const previousTarget =
      Number(
        signal.targetProgress
          .highestTargetReached
      ) ||
      0;

    if (
      highestTarget <=
      previousTarget
    ) {

      return null;

    }

    if (
      !this.shouldUseProgressiveTargets(
        signal,
        levels
      )
    ) {

      const outcome =
        highestTarget >= 2

          ? this.outcomes.WIN

          : this.outcomes.PARTIAL_WIN;

      this.recordTargetProgress(
        signal,
        highestTarget,
        timestamp
      );

      this.closeSignal(
        signal,
        {

          outcome,

          reason:
            `TP${highestTarget}`,

          price:
            levels[
              `tp${highestTarget}`
            ],

          timestamp

        }
      );

      return outcome;

    }

    for (
      let target =
        previousTarget + 1;

      target <=
        highestTarget;

      target++
    ) {

      this.recordTargetProgress(
        signal,
        target,
        timestamp
      );

    }

    const finalTarget =
      this.getFinalTargetNumber(
        levels
      );

    if (
      highestTarget >=
      finalTarget
    ) {

      this.closeSignal(
        signal,
        {

          outcome:
            this.outcomes.WIN,

          reason:
            `TP${finalTarget}`,

          price:
            levels[
              `tp${finalTarget}`
            ],

          timestamp

        }
      );

      return this.outcomes.WIN;

    }

    signal.tradeStatus =
      this.statuses.PARTIAL;

    signal.status =
      this.statuses.PARTIAL;

    signal.partialOutcome =
      this.outcomes.PARTIAL_WIN;

    signal.lastPartialTime =
      timestamp;

    signal.lastPartialPrice =
      levels[
        `tp${highestTarget}`
      ];

    if (
      highestTarget >= 1 &&
      this.shouldMoveToBreakEven(
        signal
      )
    ) {

      this.applyBreakEven(
        signal,
        timestamp
      );

    }

    return this.outcomes.PARTIAL_WIN;

  }

  resolveStop(
    signal,
    stopPrice,
    timestamp
  ) {

    const entry =
      this.toFiniteNumber(
        signal.entry
      );

    const breakEvenStop =
      Boolean(
        signal.breakEvenApplied
      );

    const outcome =
      breakEvenStop &&
      Number.isFinite(entry) &&
      this.pricesApproximatelyEqual(
        stopPrice,
        entry
      )

        ? this.outcomes.BREAK_EVEN

        : this.outcomes.LOSS;

    this.closeSignal(
      signal,
      {

        outcome,

        reason:
          breakEvenStop
            ? "BREAK_EVEN_STOP"
            : "STOP_LOSS",

        price:
          stopPrice,

        timestamp

      }
    );

    return outcome;

  }

  resolveAmbiguousCandle(
    signal,
    levels,
    timestamp,
    highestTarget
  ) {

    const policy =
      String(

        signal.intrabarPolicy ||

        this.options
          .intrabarPolicy ||

        "CONSERVATIVE"

      ).toUpperCase();

    signal.intrabarAmbiguity = {

      detectedAt:
        timestamp,

      policy,

      stopHit: true,

      highestTargetHit:
        highestTarget

    };

    if (
      policy ===
      "TARGET_FIRST"
    ) {

      return this.resolveTargets(
        signal,
        levels,
        timestamp,
        {

          tp1Hit:
            highestTarget >= 1,

          tp2Hit:
            highestTarget >= 2,

          tp3Hit:
            highestTarget >= 3

        }
      );

    }

    if (
      policy ===
      "NO_TRADE"
    ) {

      this.closeSignal(
        signal,
        {

          outcome:
            this.outcomes.NO_TRADE,

          reason:
            "AMBIGUOUS_INTRABAR_PATH",

          price:
            this.toFiniteNumber(
              signal.entry
            ),

          timestamp

        }
      );

      return this.outcomes.NO_TRADE;

    }

    /*
     * Conservative institutional policy:
     * when TP and SL are both inside the same candle,
     * candle data cannot prove which was reached first.
     */
    return this.resolveStop(
      signal,
      levels.stopLoss,
      timestamp
    );

  }

  recordTargetProgress(
    signal,
    targetNumber,
    timestamp
  ) {

    const key =
      `tp${targetNumber}Hit`;

    if (
      signal.targetProgress[
        key
      ]
    ) {

      return;

    }

    const levels =
      this.getLevels(
        signal
      );

    signal.targetProgress[
      key
    ] = true;

    signal.targetProgress
      .highestTargetReached =
      Math.max(

        signal.targetProgress
          .highestTargetReached ||
        0,

        targetNumber

      );

    signal.targetProgress
      .partialEvents
      .push({

        target:
          targetNumber,

        price:
          levels[
            `tp${targetNumber}`
          ],

        timestamp

      });

  }

  applyBreakEven(
    signal,
    timestamp
  ) {

    const entry =
      this.toFiniteNumber(
        signal.entry
      );

    if (
      !Number.isFinite(entry)
    ) {

      return;

    }

    signal.managedStopLoss =
      entry;

    /*
     * stopLoss is updated so existing index.js logic,
     * dashboards and consumers enforce the managed stop.
     */
    signal.stopLoss =
      entry;

    signal.breakEvenApplied =
      true;

    signal.breakEvenAppliedAt =
      timestamp;

    signal.managementReason =
      "TP1_REACHED_MOVE_STOP_TO_BREAK_EVEN";

  }

  closeSignal(
    signal,
    resolution
  ) {

    signal.outcome =
      resolution.outcome;

    signal.tradeStatus =
      this.statuses.CLOSED;

    signal.status =
      resolution.outcome;

    signal.exitReason =
      resolution.reason;

    signal.exitPrice =
      resolution.price;

    signal.exitTime =
      resolution.timestamp;

    signal.resolvedAt =
      resolution.timestamp;

    signal.lastUpdated =
      resolution.timestamp;

    signal.resolutionVersion =
      (
        signal.resolutionVersion ||
        1
      ) + 1;

    const startedAt =
      new Date(
        signal.createdAt
      ).getTime();

    const endedAt =
      new Date(
        resolution.timestamp
      ).getTime();

    if (
      Number.isFinite(
        startedAt
      ) &&
      Number.isFinite(
        endedAt
      )
    ) {

      signal.tradeDurationMinutes =
        Math.max(

          0,

          Math.round(
            (
              endedAt -
              startedAt
            ) /
            60000
          )

        );

    }

    signal.performance =
      this.buildPerformanceMetadata(
        signal
      );

    signal.learningFeedback =
      this.buildLearningFeedback(
        signal
      );

  }

  updateExcursionMetrics(
    signal,
    candle,
    timestamp
  ) {

    const entry =
      this.toFiniteNumber(
        signal.entry
      );

    if (
      !Number.isFinite(entry)
    ) {

      return;

    }

    let favorableMove = 0;

    let adverseMove = 0;

    if (
      signal.direction ===
      "BUY"
    ) {

      favorableMove =
        candle.high -
        entry;

      adverseMove =
        entry -
        candle.low;

    } else if (
      signal.direction ===
      "SELL"
    ) {

      favorableMove =
        entry -
        candle.low;

      adverseMove =
        candle.high -
        entry;

    }

    signal.maxFavorableExcursion =
      Math.max(

        this.toFiniteNumber(
          signal.maxFavorableExcursion
        ) ||
        0,

        favorableMove,

        0

      );

    signal.maxAdverseExcursion =
      Math.max(

        this.toFiniteNumber(
          signal.maxAdverseExcursion
        ) ||
        0,

        adverseMove,

        0

      );

    signal.excursionUpdatedAt =
      timestamp;

  }

  buildPerformanceMetadata(
    signal
  ) {

    const entry =
      this.toFiniteNumber(
        signal.entry
      );

    const exit =
      this.toFiniteNumber(
        signal.exitPrice
      );

    const initialStop =
      this.toFiniteNumber(
        signal.initialStopLoss
      );

    const initialRisk =
      Number.isFinite(entry) &&
      Number.isFinite(
        initialStop
      )

        ? Math.abs(
            entry -
            initialStop
          )

        : null;

    let realizedMove =
      null;

    if (
      Number.isFinite(entry) &&
      Number.isFinite(exit)
    ) {

      realizedMove =
        signal.direction ===
        "SELL"

          ? entry -
            exit

          : exit -
            entry;

    }

    const realizedR =
      Number.isFinite(
        initialRisk
      ) &&
      initialRisk > 0 &&
      Number.isFinite(
        realizedMove
      )

        ? realizedMove /
          initialRisk

        : null;

    return {

      initialRisk,

      realizedMove,

      realizedR:
        Number.isFinite(
          realizedR
        )

          ? Number(
              realizedR
                .toFixed(3)
            )

          : null,

      maxFavorableExcursion:
        this.toFiniteNumber(
          signal
            .maxFavorableExcursion
        ) ||
        0,

      maxAdverseExcursion:
        this.toFiniteNumber(
          signal
            .maxAdverseExcursion
        ) ||
        0,

      highestTargetReached:
        signal.targetProgress
          ?.highestTargetReached ||
        0,

      partialCount:
        signal.targetProgress
          ?.partialEvents
          ?.length ||
        0

    };

  }

  buildLearningFeedback(
    signal
  ) {

    return {

      signalId:
        signal.signalId ||
        signal.id ||
        signal.timestamp ||
        null,

      pair:
        signal.pair ||
        null,

      timeframe:
        signal.timeframe ||
        null,

      pattern:
        signal.pattern ||
        null,

      direction:
        signal.direction ||
        null,

      outcome:
        signal.outcome ||
        null,

      exitReason:
        signal.exitReason ||
        null,

      marketRegime:
        signal.marketRegime ||
        null,

      marketState:
        signal.marketState
          ?.state ||
        signal.marketState ||
        null,

      strategy:
        signal.strategyPriority
          ?.primary ||
        signal.strategy ||
        null,

      aiScore:
        this.toFiniteNumber(
          signal.aiScore
        ),

      confidence:
        this.toFiniteNumber(

          signal
            .finalAIConfidence ??

          signal.confidence

        ),

      qualityGrade:
        signal.qualityGrade ||
        null,

      realizedR:
        signal.performance
          ?.realizedR ??
        null,

      tradeDurationMinutes:
        signal
          .tradeDurationMinutes ??
        null,

      highestTargetReached:
        signal.targetProgress
          ?.highestTargetReached ||
        0,

      resolvedAt:
        signal.resolvedAt ||
        null

    };

  }

  buildResult(
    signal,
    event,
    changed,
    error = null
  ) {

    return {

      signal,

      event,

      outcome:
        signal.outcome ||
        null,

      status:
        signal.status ||
        null,

      tradeStatus:
        signal.tradeStatus ||
        null,

      changed,

      isFinal:
        this.isFinallyResolved(
          signal
        ),

      error,

      learningFeedback:
        signal.learningFeedback ||
        null

    };

  }

  getLevels(signal) {

    const tp1 =
      this.toFiniteNumber(

        signal.takeProfit1 ??

        signal.takeProfit

      );

    const explicitTp2 =
      this.toFiniteNumber(
        signal.takeProfit2
      );

    const explicitTp3 =
      this.toFiniteNumber(
        signal.takeProfit3
      );

    return {

      stopLoss:
        this.toFiniteNumber(
          signal.managedStopLoss
        ) ??
        this.toFiniteNumber(
          signal.stopLoss
        ),

      tp1,

      tp2:
        explicitTp2 ??
        tp1,

      tp3:
        explicitTp3 ??
        explicitTp2 ??
        tp1,

      hasExplicitTp2:
        Number.isFinite(
          explicitTp2
        ),

      hasExplicitTp3:
        Number.isFinite(
          explicitTp3
        )

    };

  }

  getFinalTargetNumber(
    levels
  ) {

    if (
      levels.hasExplicitTp3
    ) {

      return 3;

    }

    if (
      levels.hasExplicitTp2
    ) {

      return 2;

    }

    return 1;

  }

  shouldUseProgressiveTargets(
    signal,
    levels
  ) {

    if (
      signal.progressiveTargets !==
      undefined
    ) {

      return Boolean(
        signal.progressiveTargets
      );

    }

    if (
      signal.multiTargetEnabled !==
      undefined
    ) {

      return Boolean(
        signal.multiTargetEnabled
      );

    }

    return Boolean(

      this.options
        .progressiveTargets &&

      (
        levels.hasExplicitTp2 ||
        levels.hasExplicitTp3
      )

    );

  }

  shouldMoveToBreakEven(
    signal
  ) {

    if (
      signal.breakEvenAfterTP1 !==
      undefined
    ) {

      return Boolean(
        signal.breakEvenAfterTP1
      );

    }

    return Boolean(
      this.options
        .breakEvenAfterTP1
    );

  }

  isFinallyResolved(signal) {

    return Boolean(

      signal.outcome &&

      signal.tradeStatus ===
      this.statuses.CLOSED

    );

  }

  isNoTradeSignal(signal) {

    return (

      String(
        signal.direction ||
        ""
      ).toUpperCase() ===
      "NEUTRAL" ||

      String(
        signal.signal ||
        ""
      ).toUpperCase() ===
      "HOLD"

    );

  }

  isExpired(
    signal,
    timestamp,
    context
  ) {

    const explicitExpiry =
      signal.expiresAt;

    if (explicitExpiry) {

      const expiryTime =
        new Date(
          explicitExpiry
        ).getTime();

      const now =
        new Date(
          timestamp
        ).getTime();

      if (
        Number.isFinite(
          expiryTime
        ) &&
        now >= expiryTime
      ) {

        return true;

      }

    }

    /*
     * Optional expiryMap may be passed from index.js.
     * Resolver does not duplicate timeframe expiry rules.
     */
    const expiryMap =
      context.expiryMap;

    const expiryDuration =
      expiryMap?.[
        signal.timeframe
      ];

    if (
      !Number.isFinite(
        expiryDuration
      )
    ) {

      return false;

    }

    const createdAt =
      new Date(
        signal.createdAt
      ).getTime();

    const now =
      new Date(
        timestamp
      ).getTime();

    return (

      Number.isFinite(
        createdAt
      ) &&

      Number.isFinite(now) &&

      now -
      createdAt >=
      expiryDuration

    );

  }

  normalizeCandle(candle) {

    return {

      open:
        this.toFiniteNumber(
          candle.open
        ),

      high:
        this.toFiniteNumber(
          candle.high
        ),

      low:
        this.toFiniteNumber(
          candle.low
        ),

      close:
        this.toFiniteNumber(
          candle.close
        ),

      timestamp:
        candle.timestamp ||
        candle.time ||
        candle.date ||
        null

    };

  }

  getReferencePrice(candle) {

    return (

      this.toFiniteNumber(
        candle.close
      ) ??

      this.toFiniteNumber(
        candle.open
      ) ??

      this.toFiniteNumber(
        candle.high
      ) ??

      this.toFiniteNumber(
        candle.low
      ) ??

      null

    );

  }

  getCandleIdentity(candle) {

    return (

      candle.timestamp ||

      candle.time ||

      candle.date ||

      null

    );

  }

  getCandleForSignal(
    signal,
    source
  ) {

    if (
      typeof source ===
      "function"
    ) {

      return source(
        signal
      );

    }

    if (
      !source ||
      typeof source !==
      "object"
    ) {

      return null;

    }

    const value =
      source?.[
        signal.pair
      ]?.[
        signal.timeframe
      ];

    if (
      Array.isArray(value)
    ) {

      return (
        value[
          value.length - 1
        ] ||
        null
      );

    }

    return value || null;

  }

  getTimestamp(now) {

    const date =
      now
        ? new Date(now)
        : new Date();

    return Number.isNaN(
      date.getTime()
    )

      ? new Date()
          .toISOString()

      : date
          .toISOString();

  }

  pricesApproximatelyEqual(
    first,
    second
  ) {

    const difference =
      Math.abs(
        first -
        second
      );

    const scale =
      Math.max(

        Math.abs(first),

        Math.abs(second),

        1

      );

    return (
      difference <=
      scale * 1e-8
    );

  }

  toFiniteNumber(value) {

    const number =
      Number(value);

    return Number.isFinite(number)
      ? number
      : null;

  }

}

module.exports = SignalResolver;
