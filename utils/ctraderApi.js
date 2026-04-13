import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import UserModel from "../models/User.js";
import { encryptText } from "./ctraderCrypto.js";

const { CTRADER_CLIENT_ID, CTRADER_CLIENT_SECRET } = process.env;

const SPOTWARE_ACCOUNTS_URL =
  "https://api.spotware.com/connect/tradingaccounts";

function mustEnv(name, val) {
  if (!val) throw new Error(`Missing env: ${name}`);
  return val;
}

export async function refreshCtraderTokenIfNeeded({
  userId,
  accessToken,
  refreshToken,
  expiresAt,
}) {
  const expMs = expiresAt ? new Date(expiresAt).getTime() : 0;
  const needsRefresh =
    !accessToken || !refreshToken || !expMs || expMs - Date.now() < 60_000;

  if (!needsRefresh) return { accessToken };

  mustEnv("CTRADER_CLIENT_ID", CTRADER_CLIENT_ID);
  mustEnv("CTRADER_CLIENT_SECRET", CTRADER_CLIENT_SECRET);

  const refreshUrl =
    `https://openapi.ctrader.com/apps/token` +
    `?grant_type=refresh_token` +
    `&refresh_token=${encodeURIComponent(refreshToken)}` +
    `&client_id=${encodeURIComponent(CTRADER_CLIENT_ID)}` +
    `&client_secret=${encodeURIComponent(CTRADER_CLIENT_SECRET)}`;

  const r = await fetch(refreshUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const data = await r.json();

  if (!r.ok || data?.errorCode) {
    throw new Error(data?.description || "Refresh failed");
  }

  const newAccessToken = data.accessToken || data.access_token;
  const newRefreshToken = data.refreshToken || data.refresh_token;
  const expiresIn = Number(data.expiresIn || data.expires_in);

  if (!newAccessToken || !Number.isFinite(expiresIn)) {
    throw new Error("Refresh response missing required token fields");
  }

  const acquiredAt = new Date();
  const newExpiresAt = new Date(Date.now() + expiresIn * 1000);

  const $set = {
    "cTraderConfig.accessTokenEnc": encryptText(newAccessToken),
    "cTraderConfig.acquiredAt": acquiredAt,
    "cTraderConfig.expiresAt": newExpiresAt,
    "cTraderConfig.isConnected": true,
  };

  if (newRefreshToken) {
    $set["cTraderConfig.refreshTokenEnc"] = encryptText(newRefreshToken);
  }

  await UserModel.updateOne({ _id: userId }, { $set });

  return { accessToken: newAccessToken };
}

export async function fetchCtraderAccounts(accessToken) {
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("fetchCtraderAccounts: accessToken must be a string");
  }

  const res = await axios.get(
    `${SPOTWARE_ACCOUNTS_URL}?access_token=${accessToken}`,
    {
      timeout: 15000,
    },
  );
  const raw = res.data;

  const accounts = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
      ? raw.data
      : [];

  return accounts;
}

export const normalizeSymbol = (str) =>
  str.replace("/", "").replace(/\s+/g, "").toUpperCase();

/**
 * cTrader Protobuf API always requires relative distances in 1/100,000th of a unit.
 */
const CTRADER_RELATIVE_MULTIPLIER = 100000;

export function calculateRelativeDistance(priceA, priceB, digits = 5) {
  if (priceA == null || priceB == null) return undefined;

  const diff = Math.abs(priceA - priceB);
  
  const factor = Math.pow(10, digits);
  const roundedDiff = Math.round(diff * factor) / factor;

  // Use Math.trunc to ensure a pure integer for Protobuf
  const relative = Math.trunc(Math.round(roundedDiff * CTRADER_RELATIVE_MULTIPLIER));

  return relative > 0 ? relative : undefined;
}

export function calculateVolume({
  lotSize,
  contractSize = 100000,
  volumeStep = 100, // Default to 100 if missing
  minVolume = 100,
  maxVolume = 10000000,
}) {
  // 1. Handle the "null" volumeStep from your payload
  const step = (volumeStep === null || volumeStep === 0) ? 100 : volumeStep;
  
  // 2. Ensure lotSize is a valid number (defaulting to 0.01)
  const safeLot = Number(lotSize) || 0.01;
  const safeContract = Number(contractSize) || 100000;

  // 3. Calculate raw volume: (Lots * ContractSize) * 100
  const rawVolume = safeLot * safeContract * 100;
  
  // 4. Normalize and ensure it's a whole number (Integer/Long)
  let volume = Math.trunc(Math.floor(rawVolume / step) * step);

  // 5. Clamp between min and max
  const finalVolume = Math.min(Math.max(volume, minVolume), maxVolume);
  
  return finalVolume;
}

/**
 * ==============================
 * VALIDATE TRADE DIRECTION
 * ==============================
 */
function validateTrade({ type, entryPrice, stopLoss, takeProfit }) {
  if (!type || !entryPrice) return; // Skip if missing crucial data

  if (type === "BUY") {
    if (stopLoss >= entryPrice) throw new Error("Invalid SL for BUY (must be below entry)");
    if (takeProfit <= entryPrice) throw new Error("Invalid TP for BUY (must be above entry)");
  } else if (type === "SELL") {
    if (stopLoss <= entryPrice) throw new Error("Invalid SL for SELL (must be above entry)");
    if (takeProfit >= entryPrice) throw new Error("Invalid TP for SELL (must be below entry)");
  } else {
    throw new Error(`Invalid trade type: ${type}`);
  }
}

/**
 * ==============================
 * BUILD MULTI TP ORDERS (WEIGHTED)
 * ==============================
 */
export function buildMultiTPOrders({ signal, symbol }) {
  // 1. Destructure with safe fallbacks from the symbol payload
  const { 
    contractSize = 100000, 
    volumeStep = 100, 
    minVolume = 100, 
    maxVolume = 10000000, 
    digits = 5 
  } = symbol;

  // 2. Identify the lot size (checking multiple possible keys)
  const lotSize = signal.lotSize || 0.01;

  const { takeProfits = [], weights, type, entryPrice, stopLoss } = signal;

  if (!takeProfits.length) {
    throw new Error("takeProfits array is required");
  }

  // ✅ Validate trade direction
  validateTrade({ type, entryPrice, stopLoss, takeProfit: takeProfits[0] });

  // 3. Calculate total volume and LOG it immediately for debugging
  const totalVolume = calculateVolume({
    lotSize,
    contractSize,
    volumeStep,
    minVolume,
    maxVolume,
  });

  if (isNaN(totalVolume)) {
    throw new Error(`Volume calculation failed. Check lotSize(${lotSize}) or contractSize(${contractSize})`);
  }

  // 4. Weight distribution
  let finalWeights;
  if (weights && weights.length === takeProfits.length) {
    const sum = weights.reduce((a, b) => a + b, 0);
    finalWeights = weights.map((w) => w / sum);
  } else {
    finalWeights = takeProfits.map(() => 1 / takeProfits.length);
  }

  // 5. Use the specific step for allocation
  const step = (volumeStep === null || volumeStep === 0) ? 100 : volumeStep;

  // 6. Allocate volumes - ensuring every step is truncated to an integer
  const allocatedVolumes = finalWeights.map((w) => {
    const rawAllocated = totalVolume * w;
    return Math.trunc(Math.floor(rawAllocated / step) * step);
  });

  // 7. Handle remainder in chunks of `step`
  const allocatedSum = allocatedVolumes.reduce((a, b) => a + b, 0);
  let remainder = totalVolume - allocatedSum;

  let i = 0;
  while (remainder >= step) {
    allocatedVolumes[i] += step;
    remainder -= step;
    i = (i + 1) % allocatedVolumes.length;
  }

  // 8. Build orders and cast EVERY number to an Integer/BigInt if necessary
  return takeProfits.map((tp, index) => {
    const relativeTP = calculateRelativeDistance(entryPrice, tp, digits);
    const relativeSL = calculateRelativeDistance(entryPrice, stopLoss, digits);

    if (!relativeTP || !relativeSL) {
      throw new Error(`Invalid SL/TP distance calculated for TP level ${index + 1}`);
    }

    return {
      // Final cast to ensure the Protobuf library sees a clean whole number
      volume: Math.trunc(allocatedVolumes[index]),
      relativeStopLoss: Math.trunc(relativeSL),
      relativeTakeProfit: Math.trunc(relativeTP),
    };
  });
}