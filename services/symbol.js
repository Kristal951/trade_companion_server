import { redis } from "../queues/ctrader.js";
import { ctraderClient } from "./ctraderClient.js";

const SYMBOLS_CACHE_KEY = (accountId) => `ctrader:${accountId}:symbols:all`;

/* -------------------- CONFIG -------------------- */

const INSTRUMENT_CONFIGS = {
  FOREX: [
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
  ],
  COMMODITIES: ["XAU/USD", "XAG/USD"],
  SINGLES: ["BTC/USD", "ETH/USD", "US500", "US100"],
};

const normalizeName = (name = "") =>
  String(name).replace("/", "").toUpperCase();

/* 🔥 Precompute */
const NORMALIZED_CONFIGS = {
  FOREX: INSTRUMENT_CONFIGS.FOREX.map(normalizeName),
  COMMODITIES: INSTRUMENT_CONFIGS.COMMODITIES.map(normalizeName),
  SINGLES: INSTRUMENT_CONFIGS.SINGLES.map(normalizeName),
};

/* -------------------- CONTRACT SIZE -------------------- */

const getContractSizeFor = (symbol) => {
  const rawName = symbol?.symbolName || symbol?.name || "";
  const normalized = normalizeName(rawName);

  if (!normalized) {
    console.warn("⚠️ Missing symbol name for contract size fallback");
    return 100000;
  }

  if (NORMALIZED_CONFIGS.FOREX.includes(normalized)) return 100000;
  if (NORMALIZED_CONFIGS.COMMODITIES.includes(normalized)) return 100;
  if (NORMALIZED_CONFIGS.SINGLES.includes(normalized)) return 1;

  /* Smart fallback */
  if (normalized.includes("XAU") || normalized.includes("XAG")) return 100;
  if (normalized.includes("BTC") || normalized.includes("ETH")) return 1;

  return 100000;
};

/* -------------------- SERVICE -------------------- */

export class SymbolService {
  constructor(accountId) {
    this.accountId = accountId;
  }

  async getAllSymbols() {
    const key = SYMBOLS_CACHE_KEY(this.accountId);

    /* ---------- CACHE ---------- */
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);

    /* ---------- FETCH LIGHT SYMBOLS ---------- */
    const lightRes = await ctraderClient.getSymbols(this.accountId);

    const lightSymbols =
      lightRes ||
      lightRes?.payload?.symbols ||
      lightRes?.payload?.symbol ||
      lightRes?.symbols ||
      [];

    if (!Array.isArray(lightRes) || !lightSymbols.length) {
      throw new Error("No symbols returned from broker (2115)");
    }

    /* ---------- MAP ID → NAME ---------- */
    const nameMap = new Map();

    for (const s of lightSymbols) {
      const id = Number(s.symbolId);
      const name = s.symbolName || s.name;

      if (id && name) {
        nameMap.set(id, name);
      }
    }

    const allIds = Array.from(nameMap.keys());

    if (!allIds.length) {
      throw new Error("No valid symbol IDs found");
    }

    /* ---------- FETCH FULL SYMBOL DATA ---------- */
    const fullSymbols = await this._fetchInChunks(allIds);

    if (!fullSymbols.length) {
      throw new Error("No symbol specs returned (2116)");
    }

    /* ---------- NORMALIZE + REPAIR ---------- */
    const normalized = fullSymbols.map((s) => {
      const id = Number(s.symbolId);

      // Inject missing name
      if (!s.symbolName && nameMap.has(id)) {
        s.symbolName = nameMap.get(id);
      }

      return this._normalizeSymbol(s);
    });

    await redis.set(key, JSON.stringify(normalized), "EX", 3600);

    return normalized;
  }

  async _fetchInChunks(ids, chunkSize = 200) {
    let allFullData = [];

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);

      try {
        const response = await ctraderClient.send(
          2116,
          "ProtoOASymbolByIdReq",
          {
            ctidTraderAccountId: Number(this.accountId),
            symbolId: chunk,
            includeTradingSettings: true,
          },
        );

        const symbols =
          response?.payload?.symbols ||
          response?.payload?.symbol ||
          response?.symbols ||
          [];

        if (Array.isArray(symbols) && symbols.length > 0) {
          allFullData.push(...symbols);
        } else {
          console.error("❌ Invalid 2116 payload:", response);
        }
      } catch (err) {
        console.error("❌ Chunk fetch failed:", err);
      }
    }

    return allFullData;
  }

  _normalizeSymbol(symbol) {
    const digits = symbol.digits ?? 5;

    const safeNum = (val, fallback) => {
      const parsed = Number(val);
      return isNaN(parsed) || val === null ? fallback : parsed;
    };

    let brokerContractSize = Number(symbol.contractSize);

    if (!brokerContractSize || brokerContractSize <= 0) {
      brokerContractSize = getContractSizeFor(symbol);
    }

    const symbolName = symbol.symbolName || symbol.name || "";

    if (!symbolName) {
      console.warn(`⚠️ Symbol ${symbol.symbolId} has no name`);
    }

    return {
      symbolId: Number(symbol.symbolId),
      symbolName,

      digits,

      pipPosition: safeNum(
        symbol.pipPosition,
        digits === 3 || digits === 2 ? 2 : 4,
      ),

      tickSize: safeNum(symbol.tickSize, Math.pow(10, -digits)),

      volumeStep: safeNum(symbol.volumeStep, 100),
      minVolume: safeNum(symbol.minVolume, 100),
      maxVolume: safeNum(symbol.maxVolume, 100000000),

      contractSize: brokerContractSize,
      symbolCategoryId: symbol.symbolCategoryId,
    };
  }

  async getSymbolById(symbolId) {
    const symbols = await this.getAllSymbols();

    if (!Array.isArray(symbols)) {
      throw new Error("Symbols cache is invalid");
    }

    const symbol = symbols.find((s) => String(s.symbolId) === String(symbolId));

    if (!symbol) {
      throw new Error(`Symbol ${symbolId} not found`);
    }

    return symbol;
  }

  async refreshCache() {
    const key = SYMBOLS_CACHE_KEY(this.accountId);
    await redis.del(key);
    return this.getAllSymbols();
  }
}
