import { GoogleGenAI } from "@google/genai";
import { instrumentDefinitions, normalizePlan } from "../utils/index.js";
import { fetchMarketContext } from "./marketDataServices.js";
import { isSignalEligiblePlan } from "../utils/signal.js";

const GENERATION_MODEL = "gemini-3-flash-preview";

const TARGET_INSTRUMENTS = [
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "USD/CHF",
  "USD/CAD",
  "AUD/USD",
  "NZD/USD",
  "EUR/JPY",
  "GBP/JPY",
  "EUR/GBP",
  "AUD/JPY",
  "NZD/JPY",
  "AUD/NZD",
  "EUR/CHF",
  "XAU/USD",
  "XAG/USD",
  "BTC/USD",
  "ETH/USD",
  "US500",
  "US100",
];

const getAI = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  return new GoogleGenAI({ apiKey });
};

const safeParseAIResponse = (text) => {
  if (!text) return null;

  try {
    let cleaned = text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");

    if (first === -1 || last === -1 || first >= last) return null;

    return JSON.parse(cleaned.slice(first, last + 1));
  } catch {
    return null;
  }
};

const withRetry = async (fn, retries = 3, baseDelay = 2000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = i === retries - 1;
      const status = error?.status || error?.response?.status;
      const message = error?.message || "";

      const is429 =
        status === 429 ||
        message.includes("429") ||
        message.includes("RESOURCE_EXHAUSTED");
      const is503 =
        status === 503 ||
        message.includes("503") ||
        message.includes("UNAVAILABLE");
      const isNetworkError =
        error.code === "ECONNRESET" || message.includes("fetch failed");

      if ((is429 || is503 || isNetworkError) && !isLastAttempt) {
        const jitter = Math.random() * 1000;
        const delay = baseDelay * Math.pow(2, i) + jitter;

        console.warn(
          `[RETRY ${i + 1}/${retries}] Reason: ${is429 ? "Quota" : is503 ? "Overloaded" : "Network"}. ` +
            `Retrying in ${Math.round(delay)}ms...`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }
};

let rotationIndex = 0;

const calculateTechnicalSummary = (candles) => {
  if (!candles || candles.length < 200) {
    return { trend: "NEUTRAL", sma200: 0, sma50: 0, lastPrice: 0 };
  }

  const closes = candles.map((c) => c.close);
  const lastPrice = closes[closes.length - 1];
  const sma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
  const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;

  let trend = "SIDEWAYS";

  if (lastPrice > sma200) {
    trend = lastPrice > sma50 ? "STRONG BULLISH" : "BULLISH PULLBACK";
  } else {
    trend = lastPrice < sma50 ? "STRONG BEARISH" : "BEARISH RETRACEMENT";
  }

  return { trend, sma200, sma50, lastPrice };
};

const isMarketOpen = (instrument) => {
  const now = new Date();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();

  const def = instrumentDefinitions[instrument];
  if (!def) return false;

  if (def.isDeriv) return true;
  if (["BTC/USD", "ETH/USD", "SOL/USD"].includes(instrument)) return true;

  if (day === 6) return false;
  if (day === 0 && hour < 22) return false;
  if (day === 5 && hour >= 22) return false;

  return true;
};

export async function scanForSignals({ userPlan, userSettings }) {
  const normalizedPlan = normalizePlan(userPlan);

  if (process.env.SIGNAL_SCAN_TEST_MODE === "true") {
    return {
      signalFound: true,
      instrument: "BTC/USD",
      type: "BUY",
      entryPrice: 72938.38,
      stopLoss: 72407.00,
      takeProfits: [75000],
      lotSize: 0.02,
      confidence: 95,
      reasoning: "Standardized test signal with correct directionality",
      technicalReasoning:
        "Testing SELL logic with relative SL/TP distance scaling",
    };
  }

  // signalFound: true,
  //   instrument: "EUR/USD",
  //   type: "SELL",
  //   entryPrice: 1.085,
  //   stopLoss: 1.087,
  //   takeProfits: [1.082],
  //   lotSize: 0.01,
  //   confidence: 95,
  //   reasoning: "Standardized test signal with correct directionality",
  //   technicalReasoning:
  //     "Testing SELL logic with relative SL/TP distance scaling",
  // };

  if (!isSignalEligiblePlan(normalizedPlan)) {
    return { signalFound: false, reason: "Plan not eligible" };
  }

  const PRIORITY_INSTRUMENTS = ["XAU/USD", "BTC/USD"];
  const ROTATION_POOL = TARGET_INSTRUMENTS.filter(
    (inst) => !PRIORITY_INSTRUMENTS.includes(inst),
  );

  const currentBatch = [...PRIORITY_INSTRUMENTS];
  const SLOTS_FOR_ROTATION = 3;

  for (let i = 0; i < SLOTS_FOR_ROTATION; i++) {
    const index = (rotationIndex + i) % ROTATION_POOL.length;
    currentBatch.push(ROTATION_POOL[index]);
  }

  rotationIndex = (rotationIndex + SLOTS_FOR_ROTATION) % ROTATION_POOL.length;

  const openBatch = currentBatch.filter(isMarketOpen);

  if (!openBatch.length) {
    return { signalFound: false, reason: "All markets closed" };
  }

  const marketContextsRaw = await Promise.all(
    openBatch.map((inst) => fetchMarketContext(inst, 500)),
  );

  const marketContexts = marketContextsRaw.filter(
    (ctx) => ctx.isDataReal || ctx.candles.length > 0,
  );

  if (!marketContexts.length) {
    return { signalFound: false, reason: "No market data available" };
  }

  const marketDataString = marketContexts
    .map((ctx) => {
      const techSummary = calculateTechnicalSummary(ctx.candles);
      const last96 = ctx.candles.slice(-96);

      const rawCandlesStr =
        last96.length > 0
          ? last96
              .map(
                (c) =>
                  `[${c.time.split("T")[1]?.slice(0, 5)}] O:${c.open} H:${c.high} L:${c.low} C:${c.close}`,
              )
              .join("\n")
          : "Candle data unavailable";

      return `
=== INSTRUMENT: ${ctx.instrument} ===
Current Price: ${ctx.currentPrice}
MACRO TREND: ${techSummary.trend}
${rawCandlesStr}
================================
`;
    })
    .join("\n");

  const patternPrompt = `
You are an elite algorithmic trading engine.

STRICT OUTPUT RULES:
- Return ONLY valid JSON
- No markdown
- No extra explanation
- If no setup exists, return {"pass": false}

RULES:
- Trade only with macro trend
- Reject choppy/ranging conditions
- Risk-reward must exceed 1.5
- Return only one best setup

MARKET DATA:
${marketDataString}

Schema:
{
  "pass": true,
  "instrument": "XAU/USD",
  "type": "BUY",
  "entryPrice": 2300.5,
  "stopLoss": 2292.0,
  "takeProfit1": 2312.5,
  "pattern_score": 0.95,
  "reason_short": "Brief explanation"
}
`;

  const analystPrompt = `
You are a senior financial analyst validating a trade signal.

STRICT OUTPUT RULES:
- Return ONLY valid JSON
- No markdown
- No extra commentary

Check the technical strength and high-impact news in the next 60 minutes.

Schema:
{
  "confidence": 88,
  "reason": "Brief explanation"
}
`;

  try {
    const ai = getAI();

    const patternResponse = await withRetry(() =>
      ai.models.generateContent({
        model: GENERATION_MODEL,
        contents: `Analyze the market data. Current UTC time: ${new Date().toUTCString()}.`,
        config: {
          systemInstruction: patternPrompt,
          tools: [{ googleSearch: {} }],
        },
      }),
    );

    const patternResult = safeParseAIResponse(patternResponse.text || "");
    if (!patternResult || !patternResult.pass) {
      return { signalFound: false, reason: "No valid setup found" };
    }

    const analystResponse = await withRetry(() =>
      ai.models.generateContent({
        model: GENERATION_MODEL,
        contents: `Validate this setup:\n${JSON.stringify(patternResult, null, 2)}`,
        config: {
          systemInstruction: analystPrompt,
          tools: [{ googleSearch: {} }],
        },
      }),
    );

    const analystResult = safeParseAIResponse(analystResponse.text || "") || {
      confidence: 70,
      reason: "Validation fallback used",
    };

    const finalConfidence = Math.min(
      100,
      (patternResult.pattern_score || 0) * 60 +
        (analystResult.confidence || 0) * 0.4,
    );

    if (finalConfidence < 85) {
      return { signalFound: false, reason: "Confidence too low" };
    }

    const instrumentProps = instrumentDefinitions[patternResult.instrument];
    if (!instrumentProps) {
      return { signalFound: false, reason: "Unknown instrument config" };
    }

    const currentEquity = parseFloat(userSettings.balance || "10000");
    const riskPct = parseFloat(userSettings.risk || "1");
    const riskAmount = currentEquity * (riskPct / 100);

    const entryPrice = parseFloat(patternResult.entryPrice);
    const stopLoss = parseFloat(patternResult.stopLoss);
    const takeProfit1 = parseFloat(patternResult.takeProfit1);

    if ([entryPrice, stopLoss, takeProfit1].some(Number.isNaN)) {
      return { signalFound: false, reason: "Invalid numeric values" };
    }

    const pipStep = instrumentProps.pipStep;
    const contractSize = instrumentProps.contractSize;
    const quoteCurrency = instrumentProps.quoteCurrency;

    const stopDistPrice = Math.abs(entryPrice - stopLoss);
    const stopLossInPips = stopDistPrice / pipStep;

    let pipValueInUSDForOneLot = pipStep * contractSize;
    if (quoteCurrency === "JPY") {
      pipValueInUSDForOneLot = (pipStep * contractSize) / 150;
    }

    let lotSize = 0;
    const totalRiskPerLot = stopLossInPips * pipValueInUSDForOneLot;

    if (totalRiskPerLot > 0) {
      lotSize = riskAmount / totalRiskPerLot;
    }

    return {
      signalFound: true,
      instrument: patternResult.instrument,
      type: patternResult.type,
      entryPrice,
      stopLoss,
      takeProfit1,
      confidence: parseFloat(finalConfidence.toFixed(2)),
      reasoning: analystResult.reason,
      technicalReasoning: patternResult.reason_short,
      lotSize: Math.max(0.01, parseFloat(lotSize.toFixed(2))),
      riskAmount: parseFloat(riskAmount.toFixed(2)),
    };
  } catch (error) {
    console.error("scanForSignals failed:", error);

    if (
      error?.status === 429 ||
      error?.message?.includes("RESOURCE_EXHAUSTED") ||
      error?.message?.includes('"code":429')
    ) {
      return {
        signalFound: false,
        reason: "AI quota exceeded",
      };
    }

    return { signalFound: false, reason: "Unhandled scanner error" };
  }
}
