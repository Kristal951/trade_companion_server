import { instrumentDefinitions } from "../utils/index.js";


/* =========================
   ENV CONFIG (IMPORTANT)
========================= */
const TWELVE_DATA_KEYS = process.env.TWELVE_DATA_KEYS?.split(",") || [];
const ALPHA_VANTAGE_KEY = process.env.ALPHA_VANTAGE_KEY || "";

let tdKeyIndex = 0;

const getNextTwelveDataKey = () => {
  const key = TWELVE_DATA_KEYS[tdKeyIndex];
  tdKeyIndex = (tdKeyIndex + 1) % TWELVE_DATA_KEYS.length;
  return key;
};

/* =========================
   SAFE FETCH (TIMEOUT)
========================= */
const safeFetch = async (url, timeout = 5000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
};

/* =========================
   FOREX API CONFIG
========================= */
const forexAPIs = [
  {
    name: "TwelveData",
    fetch: async (symbol) => {
      for (let i = 0; i < TWELVE_DATA_KEYS.length; i++) {
        const key = getNextTwelveDataKey();
        try {
          const res = await safeFetch(
            `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${key}`,
          );

          if (!res.ok) continue;

          const data = await res.json();
          if (data?.price) return parseFloat(data.price);
        } catch {}
      }
      return null;
    },
  },
  {
    name: "AlphaVantage",
    fetch: async (symbol) => {
      if (!ALPHA_VANTAGE_KEY) return null;

      const [from, to] = symbol.split("/");
      try {
        const res = await safeFetch(
          `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${ALPHA_VANTAGE_KEY}`,
        );

        const data = await res.json();
        return parseFloat(
          data?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"],
        );
      } catch {
        return null;
      }
    },
  },
];

/* =========================
   SYNTHETIC DATA (FIXED)
========================= */
const generateSyntheticHistory = (
  currentPrice,
  count,
  volatilityPips = 10,
  pipSize = 0.0001,
) => {
  const candles = [];
  let price = currentPrice;

  for (let i = 0; i < count; i++) {
    const time = new Date(Date.now() - i * 15 * 60 * 1000).toISOString();

    const change = (Math.random() - 0.5) * volatilityPips * pipSize;
    const open = price;
    const close = open + change;

    const high = Math.max(open, close) + Math.random() * pipSize;
    const low = Math.min(open, close) - Math.random() * pipSize;

    candles.unshift({
      time,
      open: +open.toFixed(5),
      high: +high.toFixed(5),
      low: +low.toFixed(5),
      close: +close.toFixed(5),
      volume: Math.floor(Math.random() * 1000),
    });

    price = close;
  }

  return candles;
};

/* =========================
   DERIV WS (IMPROVED)
========================= */
const DERIV_WS_URL = "wss://ws.binaryws.com/websockets/v3?app_id=1089";

const getDerivMarketData = (symbol, count = 50) => {
  return new Promise((resolve) => {
    const ws = new WebSocket(DERIV_WS_URL);
    let resolved = false;

    const cleanup = () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    };

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({
          instrument: symbol,
          currentPrice: 0,
          isDataReal: false,
          candles: [],
          trend: "UNKNOWN",
        });
      }
    }, 10000);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          ticks_history: symbol,
          adjust_start_time: 1,
          count,
          end: "latest",
          style: "candles",
          granularity: 900,
        }),
      );
    };

    ws.onmessage = (msg) => {
      if (resolved) return;

      try {
        const data = JSON.parse(msg.data);

        if (data.error) {
          resolved = true;
          cleanup();
          return resolve({
            instrument: symbol,
            currentPrice: 0,
            isDataReal: false,
            candles: [],
            trend: "UNKNOWN",
          });
        }

        if (data.candles) {
          const candles = data.candles.map((c) => ({
            time: new Date(c.epoch * 1000).toISOString(),
            open: +c.open,
            high: +c.high,
            low: +c.low,
            close: +c.close,
            volume: 0,
          }));

          const closes = candles.map((c) => c.close);
          const shortMA = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
          const longMA = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;

          let trend = "SIDEWAYS";
          if (shortMA > longMA * 1.0005) trend = "UP";
          else if (shortMA < longMA * 0.9995) trend = "DOWN";

          resolved = true;
          clearTimeout(timeout);
          cleanup();

          resolve({
            instrument: symbol,
            currentPrice: closes.at(-1) || 0,
            isDataReal: true,
            candles,
            trend,
            details: `Live Deriv data | Trend: ${trend}`,
          });
        }
      } catch {}
    };

    ws.onerror = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({
          instrument: symbol,
          currentPrice: 0,
          isDataReal: false,
          candles: [],
          trend: "UNKNOWN",
        });
      }
    };
  });
};

/* =========================
   GET LIVE PRICE
========================= */
export const getLivePrice = async (instrument) => {
  const def = instrumentDefinitions[instrument];
  if (!def) return { price: null, isMock: true };

  if (def.isDeriv) {
    const ctx = await getDerivMarketData(def.symbol, 1);
    return ctx.isDataReal
      ? { price: ctx.currentPrice, isMock: false }
      : { price: def.mockPrice, isMock: true };
  }

  for (const api of forexAPIs) {
    const price = await api.fetch(def.symbol);
    if (price) return { price, isMock: false };
  }

  return { price: def.mockPrice, isMock: true };
};

/* =========================
   GET MULTIPLE PRICES (SAFE)
========================= */
export const getLivePrices = async (instruments) => {
  const results = {};

  for (const inst of instruments) {
    results[inst] = await getLivePrice(inst); // sequential to avoid rate limits
  }

  return results;
};

/* =========================
   MARKET CONTEXT
========================= */
export const fetchMarketContext = async (instrument, depth = 50) => {
  const def = instrumentDefinitions[instrument];

  if (def?.isDeriv) {
    const ctx = await getDerivMarketData(def.symbol, depth);
    if (ctx.isDataReal) return { ...ctx, instrument };

    return {
      instrument,
      currentPrice: def.mockPrice,
      isDataReal: false,
      candles: generateSyntheticHistory(def.mockPrice, depth),
      trend: "UNKNOWN",
      details: "Fallback synthetic data",
    };
  }

  const { price, isMock } = await getLivePrice(instrument);
  const currentPrice = price || def?.mockPrice || 0;

  return {
    instrument,
    currentPrice,
    isDataReal: !isMock,
    candles: generateSyntheticHistory(currentPrice, depth),
    trend: "UNKNOWN",
    details: isMock ? "Mock data" : "Live price",
  };
};
