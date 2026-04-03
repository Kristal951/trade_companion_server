import { instrumentDefinitions } from "../utils/index.js";

// --- API KEY ROTATION ---
const TWELVE_DATA_KEYS = [
  "5cf065b50cf64c3ab77a8a9927529bfb",
  "8b3a9763db2a4807a2e65b30a00de799",
  "132bb44fb1ec48e8b2d3692c8720a99b",
  "343128a9420249c5b3e191e384b66db5",
];

let tdKeyIndex = 0;

const getNextTwelveDataKey = () => {
  const key = TWELVE_DATA_KEYS[tdKeyIndex];
  tdKeyIndex = (tdKeyIndex + 1) % TWELVE_DATA_KEYS.length;
  return key;
};

// --- FOREX APIs ---
const forexAPIs = [
  {
    name: "TwelveData",
    url: (symbol) =>
      `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${getNextTwelveDataKey()}`,
    parser: (data) => (data?.price ? parseFloat(data.price) : null),
  },
];

// --- SYNTHETIC DATA ---
const generateSyntheticHistory = (
  currentPrice,
  count,
  volatilityPips = 10,
  pipSize = 0.0001
) => {
  const candles = [];
  let open = currentPrice;

  for (let i = 0; i < count; i++) {
    const time = new Date(Date.now() - i * 15 * 60 * 1000).toISOString();

    const change = (Math.random() - 0.5) * volatilityPips * pipSize * 5;
    const close = open;
    const prevOpen = close - change;

    const high = Math.max(prevOpen, close) + Math.random() * volatilityPips * pipSize;
    const low = Math.min(prevOpen, close) - Math.random() * volatilityPips * pipSize;

    candles.unshift({
      time,
      open: Number(prevOpen.toFixed(5)),
      high: Number(high.toFixed(5)),
      low: Number(low.toFixed(5)),
      close: Number(close.toFixed(5)),
      volume: Math.floor(Math.random() * 1000),
    });

    open = prevOpen;
  }

  return candles;
};

// --- LIVE PRICE ---
export const getLivePrice = async (instrument) => {
  const def = instrumentDefinitions[instrument];
  if (!def) return { price: null, isMock: true };

  for (const api of forexAPIs) {
    try {
      const res = await fetch(api.url(def.symbol || instrument));
      if (!res.ok) continue;

      const data = await res.json();
      const price = api.parser(data);

      if (price && !isNaN(price)) {
        return { price, isMock: false };
      }
    } catch (err) {
      console.warn(`API failed for ${instrument}`, err);
    }
  }

  return { price: def.mockPrice || 0, isMock: true };
};

// --- MULTIPLE PRICES ---
export const getLivePrices = async (instruments) => {
  const results = await Promise.all(
    instruments.map((inst) =>
      getLivePrice(inst).then((r) => ({ inst, ...r }))
    )
  );

  const map = {};
  results.forEach((r) => {
    map[r.inst] = { price: r.price, isMock: r.isMock };
  });

  return map;
};

// --- MARKET CONTEXT ---
export const fetchMarketContext = async (instrument, depth = 50) => {
  const def = instrumentDefinitions[instrument];

  const { price, isMock } = await getLivePrice(instrument);

  const currentPrice = price || def?.mockPrice || 0;
  const pipStep = def?.pipStep || 0.0001;

  const candles = generateSyntheticHistory(currentPrice, depth, 15, pipStep);

  return {
    instrument,
    currentPrice,
    isDataReal: !isMock,
    candles,
    trend: "UNKNOWN",
    details: isMock ? "Mock data" : "Live price",
  };
};