/**
 * PipSight Pro AI - Institutional Signal Evaluator
 *
 * Historical evaluation layer for generated signals.
 *
 * Responsibilities:
 * - Preserve evaluateSignal(signal, candles) compatibility
 * - Reuse SignalResolver for TP / SL / partial / expiry decisions
 * - Evaluate the complete candle path after signal creation
 * - Produce performance and learning metadata
 * - Avoid recalculating indicators, confidence, pattern weight or regime
 */

const SignalResolver = require("./resolver");

class SignalEvaluator {

  constructor(options = {}) {

    this.options = {

      mutateSignal: false,

      sortCandles: true,

      skipDuplicateCandles: true,

      includeEntryCandle: true,

      resolverOptions: {},

      ...options

    };

    this.resolver =

      options.resolver instanceof SignalResolver

        ? options.resolver

        : new SignalResolver(
            this.options.resolverOptions
          );

  }

  /**
   * Backward-compatible API.
   *
   * Returns:
   * - Final outcome
   * - Latest partial event
   * - null if still unresolved
   */
  evaluateSignal(
    signal,
    candles,
    context = {}
  ) {

    const result =
      this.evaluateDetailed(
        signal,
        candles,
        context
      );

    if (!result) {

      return null;

    }

    return (

      result.outcome ||

      result.lastEvent ||

      null

    );

  }

  /**
   * Full institutional historical evaluation.
   *
   * Outcome decisions are delegated to resolver.js so
   * live and historical evaluation use identical rules.
   */
  evaluateDetailed(
    signal,
    candles,
    context = {}
  ) {

    if (
      !signal ||
      !Array.isArray(candles) ||
      candles.length === 0
    ) {

      return null;

    }

    if (
      signal.outcome &&
      this.isFinalOutcome(
        signal.outcome
      )
    ) {

      return this.buildExistingResult(
        signal
      );

    }

    const validation =
      this.validateSignal(
        signal
      );

    if (
      !validation.valid
    ) {

      return {

        signal,

        outcome: null,

        lastEvent: null,

        isFinal: false,

        evaluatedCandles: 0,

        error:
          validation.reason,

        events: [],

        metrics: null,

        learningFeedback: null

      };

    }

    const workingSignal =

      this.options.mutateSignal ||

      context.mutateSignal === true

        ? signal

        : this.cloneSignal(
            signal
          );

    const preparedCandles =
      this.prepareCandles(
        workingSignal,
        candles,
        context
      );

    if (
      preparedCandles.length === 0
    ) {

      return {

        signal:
          workingSignal,

        outcome: null,

        lastEvent: null,

        isFinal: false,

        evaluatedCandles: 0,

        error: null,

        events: [],

        metrics:
          this.buildPathMetrics(
            workingSignal,
            []
          ),

        learningFeedback: null

      };

    }

    const events = [];

    let lastEvent = null;

    let evaluatedCandles = 0;

    let finalResult = null;

    for (
      const candle of
      preparedCandles
    ) {

      const resolution =
        this.resolver.resolveDetailed(
          workingSignal,
          candle,
          {

            ...context,

            now:
              this.getCandleTime(
                candle
              ) ||
              context.now

          }
        );

      evaluatedCandles++;

      if (
        resolution?.changed &&
        resolution.event
      ) {

        lastEvent =
          resolution.event;

        events.push({

          event:
            resolution.event,

          outcome:
            resolution.outcome,

          status:
            resolution.status,

          tradeStatus:
            resolution.tradeStatus,

          candleTime:
            this.getCandleTime(
              candle
            ),

          exitPrice:

            workingSignal.exitPrice ??

            workingSignal
              .lastPartialPrice ??

            null,

          exitReason:

            workingSignal.exitReason ??

            workingSignal
              .managementReason ??

            null

        });

      }

      if (
        resolution?.isFinal
      ) {

        finalResult =
          resolution;

        break;

      }

    }

    const evaluatedPath =
      preparedCandles.slice(
        0,
        evaluatedCandles
      );

    const metrics =
      this.buildPathMetrics(
        workingSignal,
        evaluatedPath
      );

    workingSignal.evaluation = {

      evaluatedAt:
        new Date()
          .toISOString(),

      evaluatedCandles,

      firstCandleTime:
        this.getCandleTime(
          evaluatedPath[0]
        ),

      lastCandleTime:
        this.getCandleTime(
          evaluatedPath[
            evaluatedPath.length - 1
          ]
        ),

      eventCount:
        events.length,

      final:
        Boolean(
          finalResult
        ),

      metrics

    };

    const learningFeedback =
      this.buildLearningFeedback(
        workingSignal,
        metrics,
        events
      );

    if (
      learningFeedback
    ) {

      workingSignal
        .evaluationLearningFeedback =
        learningFeedback;

    }

    return {

      signal:
        workingSignal,

      outcome:

        workingSignal.outcome ||

        finalResult?.outcome ||

        null,

      lastEvent,

      isFinal:
        Boolean(
          finalResult?.isFinal
        ),

      evaluatedCandles,

      error:
        finalResult?.error ||
        null,

      events,

      metrics,

      learningFeedback

    };

  }

  /**
   * Evaluate multiple signals against:
   *
   * candles[pair][timeframe]
   *
   * or a candle lookup function.
   */
  evaluateBatch(
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
      const signal of
      signals
    ) {

      const candles =
        this.getCandlesForSignal(
          signal,
          candleSource
        );

      if (
        !Array.isArray(candles) ||
        candles.length === 0
      ) {

        continue;

      }

      const result =
        this.evaluateDetailed(
          signal,
          candles,
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

  /**
   * Return only finalized results.
   * Useful before sending evaluation feedback to learner.js.
   */
  getResolvedEvaluations(
    results
  ) {

    return (
      Array.isArray(results)
        ? results
        : []
    ).filter(
      result =>

        result &&

        result.isFinal &&

        result.outcome
    );

  }

  validateSignal(
    signal
  ) {

    const direction =
      String(
        signal.direction ||
        ""
      ).toUpperCase();

    const signalType =
      String(
        signal.signal ||
        ""
      ).toUpperCase();

    if (
      ![
        "BUY",
        "SELL",
        "NEUTRAL"
      ].includes(direction) &&
      signalType !== "HOLD"
    ) {

      return {

        valid: false,

        reason:
          `unsupported direction: ${signal.direction}`

      };

    }

    const timestamp =
      this.getSignalTime(
        signal
      );

    if (
      !timestamp ||
      !Number.isFinite(
        new Date(
          timestamp
        ).getTime()
      )
    ) {

      return {

        valid: false,

        reason:
          "signal is missing a valid timestamp"

      };

    }

    if (
      direction === "NEUTRAL" ||
      signalType === "HOLD"
    ) {

      return {
        valid: true
      };

    }

    const entry =
      this.toFiniteNumber(
        signal.entry
      );

    const stopLoss =
      this.toFiniteNumber(
        signal.stopLoss
      );

    const takeProfit =
      this.toFiniteNumber(

        signal.takeProfit1 ??

        signal.takeProfit

      );

    if (
      !Number.isFinite(entry) ||
      !Number.isFinite(stopLoss) ||
      !Number.isFinite(takeProfit)
    ) {

      return {

        valid: false,

        reason:
          "signal is missing valid entry, stop loss or take profit values"

      };

    }

    return {
      valid: true
    };

  }

  /**
   * Select only candles occurring after signal creation.
   */
  prepareCandles(
    signal,
    candles,
    context = {}
  ) {

    const signalTime =
      new Date(
        this.getSignalTime(
          signal
        )
      ).getTime();

    const includeEntryCandle =

      context.includeEntryCandle ??

      this.options
        .includeEntryCandle;

    let prepared =
      candles
        .filter(Boolean)
        .filter(
          candle => {

            const candleTimeValue =
              this.getCandleTime(
                candle
              );

            if (
              !candleTimeValue
            ) {

              return false;

            }

            const candleTime =
              new Date(
                candleTimeValue
              ).getTime();

            if (
              !Number.isFinite(
                candleTime
              )
            ) {

              return false;

            }

            return includeEntryCandle

              ? candleTime >=
                signalTime

              : candleTime >
                signalTime;

          }
        );

    if (

      context.sortCandles ??

      this.options.sortCandles

    ) {

      prepared.sort(
        (
          first,
          second
        ) =>

          new Date(
            this.getCandleTime(
              first
            )
          ).getTime() -

          new Date(
            this.getCandleTime(
              second
            )
          ).getTime()
      );

    }

    if (

      context.skipDuplicateCandles ??

      this.options
        .skipDuplicateCandles

    ) {

      const seen =
        new Set();

      prepared =
        prepared.filter(
          candle => {

            const identity =
              this.getCandleIdentity(
                candle
              );

            if (
              seen.has(
                identity
              )
            ) {

              return false;

            }

            seen.add(
              identity
            );

            return true;

          }
        );

    }

    return prepared;

  }

  /**
   * Calculate trade-path statistics only.
   *
   * This does not recalculate indicators or AI scores.
   */
  buildPathMetrics(
    signal,
    candles
  ) {

    const entry =
      this.toFiniteNumber(
        signal.entry
      );

    const direction =
      String(
        signal.direction ||
        ""
      ).toUpperCase();

    const stopLoss =
      this.toFiniteNumber(

        signal.initialStopLoss ??

        signal.stopLoss

      );

    if (
      !Number.isFinite(entry)
    ) {

      return null;

    }

    let maximumFavorableExcursion = 0;

    let maximumAdverseExcursion = 0;

    let highestPrice =
      -Infinity;

    let lowestPrice =
      Infinity;

    for (
      const candle of
      candles
    ) {

      const high =
        this.toFiniteNumber(
          candle.high
        );

      const low =
        this.toFiniteNumber(
          candle.low
        );

      if (
        !Number.isFinite(high) ||
        !Number.isFinite(low)
      ) {

        continue;

      }

      highestPrice =
        Math.max(
          highestPrice,
          high
        );

      lowestPrice =
        Math.min(
          lowestPrice,
          low
        );

      if (
        signal.direction ===
        "BUY"
      ) {

        maximumFavorableExcursion =
          Math.max(

            maximumFavorableExcursion,

            high -
            entry,

            0

          );

        maximumAdverseExcursion =
          Math.max(

            maximumAdverseExcursion,

            entry -
            low,

            0

          );

      }

      if (
        signal.direction ===
        "SELL"
      ) {

        maximumFavorableExcursion =
          Math.max(

            maximumFavorableExcursion,

            entry -
            low,

            0

          );

        maximumAdverseExcursion =
          Math.max(

            maximumAdverseExcursion,

            high -
            entry,

            0

          );

      }

    }

    const initialRisk =
      Number.isFinite(
        stopLoss
      )

        ? Math.abs(
            entry -
            stopLoss
          )

        : null;

    const mfeR =
      initialRisk > 0

        ? maximumFavorableExcursion /
          initialRisk

        : null;

    const maeR =
      initialRisk > 0

        ? maximumAdverseExcursion /
          initialRisk

        : null;

    const firstTime =
      candles.length > 0

        ? new Date(
            this.getCandleTime(
              candles[0]
            )
          ).getTime()

        : null;

    const lastTime =
      candles.length > 0

        ? new Date(
            this.getCandleTime(
              candles[
                candles.length - 1
              ]
            )
          ).getTime()

        : null;

    const durationMinutes =
      Number.isFinite(firstTime) &&
      Number.isFinite(lastTime)

        ? Math.max(

            0,

            Math.round(
              (
                lastTime -
                firstTime
              ) /
              60000
            )

          )

        : 0;

    return {

      evaluatedCandles:
        candles.length,

      highestPrice:
        Number.isFinite(
          highestPrice
        )

          ? highestPrice

          : null,

      lowestPrice:
        Number.isFinite(
          lowestPrice
        )

          ? lowestPrice

          : null,

      maximumFavorableExcursion:
        this.round(
          maximumFavorableExcursion,
          6
        ),

      maximumAdverseExcursion:
        this.round(
          maximumAdverseExcursion,
          6
        ),

      initialRisk:
        this.round(
          initialRisk,
          6
        ),

      mfeR:
        this.round(
          mfeR,
          3
        ),

      maeR:
        this.round(
          maeR,
          3
        ),

      durationMinutes

    };

  }

  /**
   * Build structured feedback for learner.js and reports.
   */
  buildLearningFeedback(
    signal,
    metrics,
    events
  ) {

    if (
      !signal.outcome
    ) {

      return null;

    }

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
        signal.outcome,

      exitReason:
        signal.exitReason ||
        null,

      exitPrice:
        signal.exitPrice ??
        null,

      confidence:
        this.toFiniteNumber(

          signal.finalAIConfidence ??

          signal.confidence

        ),

      adaptiveConfidence:
        this.toFiniteNumber(
          signal.adaptiveConfidence
        ),

      aiScore:
        this.toFiniteNumber(
          signal.aiScore
        ),

      qualityGrade:
        signal.qualityGrade ||
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

      patternWeight:
        this.toFiniteNumber(
          signal.patternWeight
        ),

      riskReward:
        this.toFiniteNumber(
          signal.riskReward
        ),

      highestTargetReached:

        signal.targetProgress
          ?.highestTargetReached ||

        0,

      realizedR:

        signal.performance
          ?.realizedR ??

        null,

      mfeR:
        metrics?.mfeR ??
        null,

      maeR:
        metrics?.maeR ??
        null,

      tradeDurationMinutes:

        signal.tradeDurationMinutes ??

        metrics?.durationMinutes ??

        null,

      eventCount:
        events.length,

      evaluatedAt:
        new Date()
          .toISOString()

    };

  }

  buildExistingResult(
    signal
  ) {

    return {

      signal,

      outcome:
        signal.outcome,

      lastEvent:
        signal.outcome,

      isFinal: true,

      evaluatedCandles: 0,

      error: null,

      events: [],

      metrics:

        signal.evaluation
          ?.metrics ||

        signal.performance ||

        null,

      learningFeedback:

        signal
          .evaluationLearningFeedback ||

        signal.learningFeedback ||

        null

    };

  }

  isFinalOutcome(
    outcome
  ) {

    return [

      "WIN",

      "LOSS",

      "BREAK_EVEN",

      "EXPIRED",

      "NO_TRADE"

    ].includes(
      String(
        outcome
      ).toUpperCase()
    );

  }

  getCandlesForSignal(
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

    const candles =
      source?.[
        signal.pair
      ]?.[
        signal.timeframe
      ];

    return Array.isArray(
      candles
    )

      ? candles

      : null;

  }

  getSignalTime(
    signal
  ) {

    return (

      signal.timestamp ||

      signal.createdAt ||

      signal.generatedAt ||

      null

    );

  }

  getCandleTime(
    candle
  ) {

    if (!candle) {

      return null;

    }

    return (

      candle.time ||

      candle.timestamp ||

      candle.date ||

      candle.datetime ||

      null

    );

  }

  getCandleIdentity(
    candle
  ) {

    const timestamp =
      this.getCandleTime(
        candle
      );

    if (timestamp) {

      return String(
        timestamp
      );

    }

    return [

      candle.open,

      candle.high,

      candle.low,

      candle.close

    ].join("_");

  }

  cloneSignal(
    signal
  ) {

    if (
      typeof structuredClone ===
      "function"
    ) {

      try {

        return structuredClone(
          signal
        );

      } catch (_) {

        // Fall back to JSON-compatible cloning.

      }

    }

    return JSON.parse(
      JSON.stringify(
        signal
      )
    );

  }

    toFiniteNumber(
    value
  ) {

    if (
      value === null ||
      value === undefined ||
      (
        typeof value === "string" &&
        value.trim() === ""
      )
    ) {

      return null;

    }

    const number =
      Number(value);

    return Number.isFinite(
      number
    )

      ? number

      : null;

  }

    round(
    value,
    digits = 2
  ) {

    if (
      value === null ||
      value === undefined ||
      (
        typeof value === "string" &&
        value.trim() === ""
      )
    ) {

      return null;

    }

    const number =
      Number(value);

    if (
      !Number.isFinite(
        number
      )
    ) {

      return null;

    }

    return Number(
      number.toFixed(
        digits
      )
    );

  }

module.exports = SignalEvaluator;
