#!/usr/bin/env node
/**
 * Pattern Detection AI Bot - Main Entry Point
 * Real-time chart pattern recognition with self-learning
 * Runs every 5 minutes via GitHub Actions
 */

const fs = require('fs');
const path = require('path');
const PatternAnalyzer = require('./src/analyzer');
const LearningSystem = require('./src/learner');
const SignalGenerator = require('./src/signals');

const DATA_DIR = path.join(__dirname, 'data');
const SIGNALS_FILE = path.join(DATA_DIR, 'pattern-signals.json');
const CONFIDENCE_FILE = path.join(DATA_DIR, 'pattern-confidence.json');
const LEARNING_FILE = path.join(DATA_DIR, 'pattern-learning.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize files if not exist
function initializeFiles() {
  if (!fs.existsSync(SIGNALS_FILE)) {
    fs.writeFileSync(SIGNALS_FILE, JSON.stringify({ signals: [], updatedAt: new Date().toISOString(), stale: {} }, null, 2));
  }
  if (!fs.existsSync(CONFIDENCE_FILE)) {
    fs.writeFileSync(CONFIDENCE_FILE, JSON.stringify({ patterns: {}, updatedAt: new Date().toISOString() }, null, 2));
  }
  if (!fs.existsSync(LEARNING_FILE)) {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify({ history: [], stats: {}, updatedAt: new Date().toISOString() }, null, 2));
  }
}

// Load existing data
function loadData() {
  try {
    const signals = JSON.parse(fs.readFileSync(SIGNALS_FILE, 'utf8'));
    const confidence = JSON.parse(fs.readFileSync(CONFIDENCE_FILE, 'utf8'));
    const learning = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
    return { signals, confidence, learning };
  } catch (err) {
    console.error('Error loading data:', err.message);
    return { signals: { signals: [], updatedAt: new Date().toISOString(), stale: {} }, confidence: { patterns: {}, updatedAt: new Date().toISOString() }, learning: { history: [], stats: {}, updatedAt: new Date().toISOString() } };
  }
}

// Main bot execution
async function runBot() {
  console.log('🤖 Pattern Detection Bot Starting...');
  console.log(`⏰ Execution time: ${new Date().toISOString()}`);

  try {
    initializeFiles();
    const data = loadData();
    
    const analyzer = new PatternAnalyzer();
    const learner = new LearningSystem(data.learning, data.confidence);
    const signalGen = new SignalGenerator();

    // Fetch candle data for both pairs
    console.log('📊 Fetching candle data...');
    const candles = await analyzer.fetchCandles();
    
    if (!candles || Object.keys(candles).length === 0) {
      console.warn('⚠️ No candle data available');
      updateStaleness('data-fetch-failed');
      return;
    }

    // Process each pair and timeframe
    console.log('🔍 Analyzing patterns...');
    const newSignals = [];
    const pairs = ['XAUUSD', 'GBPJPY'];
    const timeframes = ['5m', '15m', '30m', '1H', '4H'];

    for (const pair of pairs) {
      if (!candles[pair]) continue;

      for (const tf of timeframes) {
        const tfCandles = candles[pair][tf];
        if (!tfCandles || tfCandles.length < 20) continue;

        // Detect patterns
        const patterns = analyzer.detectAllPatterns(tfCandles);
        
        for (const pattern of patterns) {
          // Get historical confidence for this pattern
          const historicalConfidence = learner.getPatternConfidence(pattern.name, pair, tf);
          
          // Calculate confidence
          const confidence = learner.calculateConfidence(
            pattern.strength,
            historicalConfidence,
            pattern.confirmationScore
          );

          // Only generate signals for high-confidence patterns (>70%)
          if (confidence >= 70) {
            const signal = signalGen.generateSignal(
              pair,
              tf,
              pattern,
              confidence,
              tfCandles[tfCandles.length - 1]
            );

            newSignals.push({
              ...signal,
              confidence,
              historicalAccuracy: historicalConfidence,
              timestamp: new Date().toISOString()
            });

            console.log(`✅ ${pair} ${tf} - ${pattern.name}: ${signal.direction} (${confidence}% confidence)`);
          }
        }
      }
    }

    // Update learning system with new signals
    learner.updateHistory(newSignals);
    
    // Save all data
    saveData(newSignals, data.signals.signals, learner.getConfidenceData(), learner.getLearningData());

    console.log(`\n✨ Bot execution complete`);
    console.log(`📈 Signals generated: ${newSignals.length}`);
    console.log(`💾 Data saved successfully`);

  } catch (error) {
    console.error('❌ Bot execution failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Save data to files
function saveData(newSignals, existingSignals, confidenceData, learningData) {
  try {
    // Merge signals - remove duplicates, keep latest
    const allSignals = [...existingSignals, ...newSignals];
    const uniqueSignals = Array.from(
      new Map(
        allSignals.map(s => [
          `${s.pair}_${s.timeframe}_${s.pattern}`,
          s
        ])
      ).values()
    ).slice(-500); // Keep last 500 signals

    const signalsData = {
      signals: uniqueSignals,
      updatedAt: new Date().toISOString(),
      stale: {}
    };

    const confidenceDataToSave = {
      patterns: confidenceData,
      updatedAt: new Date().toISOString()
    };

    const learningDataToSave = {
      history: learningData.history || [],
      stats: learningData.stats || {},
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(SIGNALS_FILE, JSON.stringify(signalsData, null, 2));
    fs.writeFileSync(CONFIDENCE_FILE, JSON.stringify(confidenceDataToSave, null, 2));
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningDataToSave, null, 2));

  } catch (err) {
    console.error('Error saving data:', err.message);
  }
}

// Mark data as stale if fetch fails
function updateStaleness(reason) {
  try {
    const data = JSON.parse(fs.readFileSync(SIGNALS_FILE, 'utf8'));
    data.stale = { XAUUSD: true, GBPJPY: true, reason, timestamp: new Date().toISOString() };
    fs.writeFileSync(SIGNALS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error updating staleness:', err.message);
  }
}

// Run bot
runBot().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
