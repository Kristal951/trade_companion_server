import crypto from "crypto";
import UserModel from "../models/User.js";
import { decryptText, encryptText } from "../utils/ctraderCrypto.js";
import {
  refreshCtraderTokenIfNeeded,
  fetchCtraderAccounts,
} from "../utils/ctraderApi.js";
import { createAndSendNotification } from "../services/Notification.js";

const {
  CTRADER_CLIENT_ID,
  CTRADER_CLIENT_SECRET,
  CTRADER_REDIRECT_URI,
  CTRADER_SCOPE = "trading",
  FRONTEND_BASE_URL = "http://localhost:3000",
  NODE_ENV = "development",
  CTRADER_STATE_HMAC_SECRET,
} = process.env;
const processedCodes = new Set();

function mustEnv(name, val) {
  if (!val) throw new Error(`Missing env: ${name}`);
}

function base64urlEncode(bufOrStr) {
  const buf = Buffer.isBuffer(bufOrStr)
    ? bufOrStr
    : Buffer.from(String(bufOrStr), "utf8");

  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecodeToBuffer(str) {
  const b64 = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(b64 + pad, "base64");
}

function getCtraderClientSecret() {
  return CTRADER_CLIENT_SECRET;
}

function signState(payloadObj) {
  mustEnv("CTRADER_STATE_HMAC_SECRET", CTRADER_STATE_HMAC_SECRET);

  const payload = base64urlEncode(JSON.stringify(payloadObj));
  const sig = base64urlEncode(
    crypto
      .createHmac("sha256", CTRADER_STATE_HMAC_SECRET)
      .update(payload)
      .digest(),
  );

  return `${payload}.${sig}`;
}

function verifyState(state) {
  mustEnv("CTRADER_STATE_HMAC_SECRET", CTRADER_STATE_HMAC_SECRET);

  const s = String(state || "");
  const dot = s.indexOf(".");
  if (dot <= 0) return null;

  const payload = s.slice(0, dot);
  const sigB64Url = s.slice(dot + 1);
  if (!payload || !sigB64Url) return null;

  const expectedBytes = crypto
    .createHmac("sha256", CTRADER_STATE_HMAC_SECRET)
    .update(payload)
    .digest();

  let providedBytes;
  try {
    providedBytes = base64urlDecodeToBuffer(sigB64Url);
  } catch {
    return null;
  }

  if (providedBytes.length !== expectedBytes.length) return null;
  if (!crypto.timingSafeEqual(providedBytes, expectedBytes)) return null;

  try {
    const json = base64urlDecodeToBuffer(payload).toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export const connectUrl = async (req, res) => {
  const userId = req.user?.userId || req.user?._id;
  if (!userId) return res.status(401).send("Unauthorized");

  const user = await UserModel.findById(userId);
  if (!user) return res.status(404).json({ message: "User not found" });

  const allowedPlans = ["premium", "pro"];
  const userPlan = user.subscribedPlan?.toLowerCase();

  if (!allowedPlans.includes(userPlan)) {
    return res.status(403).json({
      message:
        "Access denied. This feature requires a Premium or Pro subscription.",
    });
  }

  mustEnv("CTRADER_CLIENT_ID", CTRADER_CLIENT_ID);
  mustEnv("CTRADER_REDIRECT_URI", CTRADER_REDIRECT_URI);
  mustEnv("CTRADER_STATE_HMAC_SECRET", CTRADER_STATE_HMAC_SECRET);

  const stateObj = {
    uid: String(userId),
    aud: String(CTRADER_CLIENT_ID),
    nonce: crypto.randomBytes(16).toString("hex"),
    exp: Date.now() + 10 * 60 * 1000,
  };

  const state = signState(stateObj);

  res.cookie("ctrader_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: NODE_ENV === "production",
    maxAge: 10 * 60 * 1000,
    path: "/",
  });

  const authUrl =
    `https://id.ctrader.com/my/settings/openapi/grantingaccess/` +
    `?client_id=${encodeURIComponent(CTRADER_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(CTRADER_REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(CTRADER_SCOPE)}` +
    `&product=web` +
    `&state=${encodeURIComponent(state)}`;

  return res.json({ url: authUrl });
};

export const callback = async (req, res) => {
  const { code, state } = req.query;

  if (!code) return res.status(400).send("Missing code");
  if (!state) return res.status(400).send("Missing state");

  if (processedCodes.has(code)) {
    return res.status(400).send("Code already processed");
  }

  processedCodes.add(code);

  console.log("OAuth callback hit:", {
    state,
    time: new Date().toISOString(),
  });

  try {
    const stateCookie = req.cookies?.ctrader_oauth_state;
    console.log(stateCookie);
    if (!stateCookie) {
      return res.status(400).send("Security error: Missing state cookie");
    }

    if (String(stateCookie) !== String(state)) {
      return res
        .status(400)
        .send("Security error: State mismatch or session expired");
    }

    const decoded = verifyState(state);
    if (!decoded) return res.status(400).send("Invalid state");

    if (Date.now() > Number(decoded.exp || 0)) {
      return res.status(400).send("State expired");
    }

    if (String(decoded.aud) !== String(CTRADER_CLIENT_ID)) {
      return res.status(400).send("Invalid state audience");
    }

    const userId = decoded.uid;
    if (!userId) {
      return res.status(400).send("User identification failed");
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    mustEnv("CTRADER_CLIENT_ID", CTRADER_CLIENT_ID);
    mustEnv("CTRADER_REDIRECT_URI", CTRADER_REDIRECT_URI);

    const clientSecret = getCtraderClientSecret();
    mustEnv("CTRADER_CLIENT_SECRET (or CTRADER_SECRET_ID)", clientSecret);

    const tokenRes = await fetch("https://openapi.ctrader.com/apps/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: CTRADER_REDIRECT_URI,
        client_id: CTRADER_CLIENT_ID,
        client_secret: clientSecret,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("Token exchange failed:", errText);
      return res.status(400).send("Token exchange failed");
    }

    const data = await tokenRes.json();
    console.log(data);

    const accessToken = data.access_token || data.accessToken;
    const refreshToken = data.refresh_token || data.refreshToken;
    const expiresIn = Number(data.expires_in || data.expiresIn);

    console.log("Token response received");

    if (!accessToken || !refreshToken || !Number.isFinite(expiresIn)) {
      return res.status(400).send("Token response missing required fields");
    }

    const accounts = await fetchCtraderAccounts(accessToken);

    const defaultAccount = accounts[0]?.accountId
      ? String(accounts[0].accountId)
      : null;

    const selectedAccountId = user.cTraderConfig?.accountId || defaultAccount;

    const selectedAccount = accounts.find(
      (acc) => String(acc.accountId) === selectedAccountId,
    );
    console.log(selectedAccount, "account");

    if (!selectedAccount) {
      return res.status(400).send("Selected cTrader account not found");
    }
    const acquiredAt = new Date();
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    const accessTokenEnc = encryptText(accessToken);
    const refreshTokenEnc = encryptText(refreshToken);

    await UserModel.updateOne(
      { _id: userId },
      {
        $set: {
          "cTraderConfig.accessTokenEnc": accessTokenEnc,
          "cTraderConfig.refreshTokenEnc": refreshTokenEnc,
          "cTraderConfig.acquiredAt": acquiredAt,
          "cTraderConfig.accountId": selectedAccountId,
          "cTraderConfig.cachedBalance": selectedAccount?.balance ?? 0,
          "cTraderConfig.cachedEquity": selectedAccount?.equity ?? 0,
          "cTraderConfig.cachedMargin": selectedAccount?.margin ?? 0,
          "tradeSettings.balance": selectedAccount?.balance ?? 0,
          "cTraderConfig.lastSyncedAt": new Date(),
          "cTraderConfig.expiresAt": expiresAt,
          "cTraderConfig.scope": data.scope ?? null,
          "cTraderConfig.tokenType":
            data.token_type ?? data.tokenType ?? "bearer",
          "cTraderConfig.isConnected": true,
        },
      },
    );

    await createAndSendNotification({
      io: req.app.get("io"),
      recipient: userId,
      title: "cTrader connected",
      message: "Your cTrader account was connected successfully.",
      type: "app_update",
      linkTo: "/settings?tab=ctrader",
      dedupeKey: `ctrader_connected_${userId}_${code}`,
    });

    // Clear OAuth state cookie
    res.clearCookie("ctrader_oauth_state", { path: "/" });

    return res.redirect(
      `${FRONTEND_BASE_URL}/settings?tab=ctrader&linked=success`,
    );
  } catch (err) {
    console.error("Callback error:", err);
    return res.status(500).send("Server error during token exchange");
  }
};

export const getStatus = async (req, res) => {
  const userId = req.user?.userId || req.user?._id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const user = await UserModel.findOne({ _id: userId }).select(
    "+cTraderConfig.accessTokenEnc +cTraderConfig.refreshTokenEnc",
  );

  const cfg = user?.cTraderConfig;
  const connected = !!cfg?.isConnected && !!cfg?.refreshTokenEnc?.data;

  if (!connected) {
    return res.json({ connected: false, accounts: [], activeAccountId: null });
  }

  try {
    let accessToken = decryptText(cfg.accessTokenEnc);
    const refreshToken = decryptText(cfg.refreshTokenEnc);

    const refreshed = await refreshCtraderTokenIfNeeded({
      userId,
      accessToken,
      refreshToken,
      expiresAt: cfg.expiresAt,
    });

    if (!refreshed?.accessToken) {
      throw new Error("Token refresh failed");
    }

    accessToken = refreshed.accessToken;

    const accounts = await fetchCtraderAccounts(accessToken);
    const defaultAccountId = accounts.length
      ? String(accounts[0].accountId)
      : null;

    return res.json({
      connected: true,
      accounts: accounts.map((a) => ({
        accID: String(a.accountId),
        accName: a.accountNumber,
        live: !!a.live,
        brokerName:
          a.brokerAccountDisplayName ||
          `${a.brokerTitle} ${a.live ? "Live" : "Demo"}`,
        brokerTitle: a.brokerTitle || a.brokerName,
        currency: a.depositCurrency,
        accType: a.traderAccountType,
        levarage: a.levarage,
        balance: a.balance,
        deleted: !!a.deleted,
        status: a.accountStatus,
        swapFree: !!a.swapFree,
        moneyDigits: a.moneyDigits,
      })),
      activeAccountId: cfg.accountId || defaultAccountId,
    });
  } catch (err) {
    console.error("getStatus error:", err);

    await UserModel.updateOne(
      { _id: userId },
      {
        $set: {
          "cTraderConfig.isConnected": false,
          "cTraderConfig.accountId": null,
        },
        $unset: {
          "cTraderConfig.accessTokenEnc": "",
          "cTraderConfig.refreshTokenEnc": "",
          "cTraderConfig.acquiredAt": "",
          "cTraderConfig.expiresAt": "",
        },
      },
    );

    return res.status(401).json({
      message: "cTrader session expired or revoked. Please reconnect.",
    });
  }
};

export const setActiveAccount = async (req, res) => {
  const userId = req.user?.userId || req.user?._id;

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { accountId } = req.body;

  if (!accountId) {
    return res.status(400).json({ message: "accountId is required" });
  }

  try {
    const user = await UserModel.findOne({ _id: userId }).select(
      "+cTraderConfig.accessTokenEnc +cTraderConfig.refreshTokenEnc",
    );

    const cfg = user?.cTraderConfig;

    if (!cfg?.isConnected) {
      return res.status(400).json({ message: "Not connected" });
    }

    let accessToken = decryptText(cfg.accessTokenEnc);
    const refreshToken = decryptText(cfg.refreshTokenEnc);

    const refreshed = await refreshCtraderTokenIfNeeded({
      userId,
      accessToken,
      refreshToken,
      expiresAt: cfg.expiresAt,
    });

    accessToken = refreshed.accessToken;

    const accounts = await fetchCtraderAccounts(accessToken);

    const account = accounts.find(
      (a) => String(a.accountId) === String(accountId),
    );

    if (!account) {
      return res.status(400).json({
        message: "Account not found for this user",
      });
    }

    await UserModel.updateOne(
      { _id: userId },
      { $set: { "cTraderConfig.accountId": String(accountId) } },
    );

    return res.json({
      success: true,
      activeAccountId: String(accountId),
      accountBalance: account.balance,
    });
  } catch (error) {
    console.error("setActiveAccount error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
};

export const disconnectCtrader = async (req, res) => {
  const userId = req.user?.userId || req.user?._id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  await UserModel.updateOne(
    { _id: userId },
    {
      $set: {
        "cTraderConfig.isConnected": false,
        "cTraderConfig.autoTradeEnabled": false,
        "cTraderConfig.accountId": null,
      },
      $unset: {
        "cTraderConfig.accessTokenEnc": "",
        "cTraderConfig.refreshTokenEnc": "",
        "cTraderConfig.acquiredAt": "",
        "cTraderConfig.expiresAt": "",
        "cTraderConfig.scope": "",
        "cTraderConfig.tokenType": "",
      },
    },
  );

  return res.json({ success: true });
};

export const setCtraderSettings = async (req, res) => {
  const userId = req.user?.userId || req.user?._id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const { accountId, autoTradeEnabled } = req.body ?? {};
  console.log(accountId, autoTradeEnabled);

  const patch = {};
  if (typeof autoTradeEnabled === "boolean") {
    patch["cTraderConfig.autoTradeEnabled"] = autoTradeEnabled;
  }
  if (accountId !== undefined && accountId !== null) {
    patch["cTraderConfig.accountId"] = String(accountId);
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ message: "No valid fields provided" });
  }

  const user = await UserModel.findById(userId).select(
    "+cTraderConfig.accessTokenEnc +cTraderConfig.refreshTokenEnc",
  );

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  const cfg = user?.cTraderConfig;
  if (!cfg?.isConnected || !cfg?.refreshTokenEnc?.data) {
    return res.status(400).json({ message: "Not connected to cTrader" });
  }

  if (patch["cTraderConfig.accountId"]) {
    let accessToken = decryptText(cfg.accessTokenEnc);
    const refreshToken = decryptText(cfg.refreshTokenEnc);

    const refreshed = await refreshCtraderTokenIfNeeded({
      userId,
      accessToken,
      refreshToken,
      expiresAt: cfg.expiresAt,
    });

    accessToken = refreshed.accessToken;

    const accounts = await fetchCtraderAccounts(accessToken);

    const exists = accounts.some(
      (a) => String(a.accountId) === String(patch["cTraderConfig.accountId"]),
    );

    if (!exists) {
      return res
        .status(400)
        .json({ message: "Account not found for this user" });
    }
  }

  await UserModel.updateOne({ _id: userId }, { $set: patch });

  return res.json({
    success: true,
    accountId: patch["cTraderConfig.accountId"] ?? cfg.accountId ?? null,
    autoTradeEnabled:
      patch["cTraderConfig.autoTradeEnabled"] ?? cfg.autoTradeEnabled ?? false,
  });
};

export const setAutoTrade = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?._id;

    const { enabled, accountId } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ message: "`enabled` must be boolean." });
    }

    const user = await UserModel.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found." });

    const planRaw = (user.plan || user.subscribedPlan || "")
      .toString()
      .toUpperCase();
    const isPaid = planRaw === "PRO" || planRaw === "PREMIUM";
    if (!isPaid) {
      return res.status(403).json({
        message: "Upgrade to Pro or Premium to enable auto-trading.",
      });
    }

    if (!user.cTraderConfig?.isConnected) {
      return res.status(400).json({
        message: "Connect your cTrader account first.",
      });
    }

    const finalAccountId = accountId || user.cTraderConfig.accountId;
    if (!finalAccountId) {
      return res.status(400).json({
        message: "No cTrader account selected.",
      });
    }

    await UserModel.updateOne(
      { _id: userId },
      {
        $set: {
          "cTraderConfig.accountId": String(finalAccountId),
          "cTraderConfig.autoTradeEnabled": enabled,
          "cTraderConfig.isConnected": true,
        },
      },
    );

    return res.status(200).json({
      success: true,
      cTraderConfig: {
        accountId: user.cTraderConfig.accountId,
        isConnected: user.cTraderConfig.isConnected,
        autoTradeEnabled: user.cTraderConfig.autoTradeEnabled,
      },
    });
  } catch (err) {
    console.error("setAutoTrade error:", err);
    return res.status(500).json({ message: "Failed to update auto-trading." });
  }
};

export const setAllowedPairs = async (req, res) => {
  const { pairs } = req.body;
  const userId = req.user?.userId || req.user?._id;

  if (!Array.isArray(pairs)) {
    return res.status(400).json({ error: "Pairs must be an array" });
  }

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  try {
    const user = await UserModel.findById(userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Ensure config exists
    if (!user.cTraderConfig) {
      user.cTraderConfig = {};
    }

    // Clean pairs
    const cleanedPairs = [
      ...new Set(pairs.filter((p) => typeof p === "string" && p.trim() !== "")),
    ];

    user.cTraderConfig.allowedPairs = cleanedPairs;

    await user.save();

    return res.status(200).json({
      message: "Allowed pairs updated successfully",
      allowedPairs: user.cTraderConfig.allowedPairs,
    });
  } catch (error) {
    console.error("setAllowedPairs error:", error);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
};
