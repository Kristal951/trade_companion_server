import axios from "axios";
import UserModel from "../models/User.js";
import { encryptText } from "./ctraderCrypto.js";

const {
  CTRADER_CLIENT_ID,
  CTRADER_CLIENT_SECRET, // use this consistently
} = process.env;

const SPOTWARE_PROFILE_URL = "https://api.spotware.com/connect/profile";
const SPOTWARE_ACCOUNTS_URL = "https://api.spotware.com/connect/tradingaccounts";

function mustEnv(name, val) {
  if (!val) throw new Error(`Missing env: ${name}`);
  return val;
}

/**
 * Refresh access token if missing or expiring soon.
 * Returns { accessToken } always (fresh or existing).
 */
export async function refreshCtraderTokenIfNeeded({
  userId,
  accessToken,
  refreshToken,
  expiresAt,
}) {
  const expMs = expiresAt ? new Date(expiresAt).getTime() : 0;
  const needsRefresh =
    !accessToken ||
    !refreshToken ||
    !expMs ||
    expMs - Date.now() < 60_000; // refresh if < 60s left

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

  // normalize fields (cTrader can return both forms)
  const newAccessToken = data.accessToken || data.access_token;
  const newRefreshToken = data.refreshToken || data.refresh_token; // may be undefined
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

  const res = await axios.get(`${SPOTWARE_ACCOUNTS_URL}?access_token=${accessToken}`, {
    timeout: 15000,
  });
  const raw = res.data;

  const accounts = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];

  return accounts;
}

export async function fetchCtraderProfile(accessToken) {
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("fetchCtraderProfile: accessToken must be a string");
  }

  const { data } = await axios.get(`${SPOTWARE_PROFILE_URL}?access_token=${accessToken}`, {
    timeout: 15000,
  });

  return data;
}
