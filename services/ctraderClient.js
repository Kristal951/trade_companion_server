import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { loadProtos } from "../utils/loadProtos.js";
import UserModel from "../models/User.js";
import { decryptText } from "../utils/ctraderCrypto.js";
import { buildAccountAuthPayload, buildAppAuthPayload } from "./auth.js";

class CTraderClient {
  constructor() {
    this.ws = null;
    this.root = null;
    this.pending = new Map();
    this.connected = false;
    this.heartbeatInterval = null;
    this.isAccountAuthenticated = false;
    this.apiVersion = "99";
    this.symbolCache = {};
  }

  async connect() {
    if (!this.root) this.root = await loadProtos();

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
    }

    clearInterval(this.heartbeatInterval);

    console.log("🔗 Connecting to cTrader WebSocket...");
    this.ws = new WebSocket("wss://demo.ctraderapi.com:5035");

    this.ws.once("open", async () => {
      console.log("✅ cTrader TCP Connected");
      this.connected = true;

      try {
        await this.getVersion();
        console.log("📤 Sending App Auth (2100)...");

        const appPayload = buildAppAuthPayload();

        const appRes = await this.send(
          2100,
          "ProtoOAApplicationAuthReq",
          appPayload,
        );

        if (appRes.payloadType === 2142) {
          throw new Error("App auth failed");
        }

        console.log("✅ App Auth Confirmed");

        this.startHeartbeat();

        await this.warmupAccountAuth();

        console.log("🚀 cTrader fully connected & stable");
      } catch (err) {
        console.error("❌ Handshake Failed:", err.message);
        this.ws.terminate();
      }
    });

    this.ws.on("message", (data) => {
      const message = this.decode(data);
      if (!message) return;

      if (message.payloadType === 51) return;

      console.log("📥 Incoming payloadType:", message.payloadType);

      if (message.payloadType === 2142) {
        console.error("❌ cTrader ERROR RESPONSE:", message);

        if (message.clientMsgId && this.pending.has(message.clientMsgId)) {
          const { reject } = this.pending.get(message.clientMsgId);
          reject(new Error("cTrader rejected request"));
          this.pending.delete(message.clientMsgId);
        }

        return;
      }

      if (message.clientMsgId && this.pending.has(message.clientMsgId)) {
        const { resolve } = this.pending.get(message.clientMsgId);
        resolve(message);
        this.pending.delete(message.clientMsgId);
      }
    });

    this.ws.on("close", (code) => {
      this.connected = false;
      this.isAccountAuthenticated = false;
      this.symbolCache = {};

      clearInterval(this.heartbeatInterval);

      console.log(`⚠️ Disconnected (${code}) - reconnecting in 5s...`);

      setTimeout(() => this.connect(), 5000);
    });

    this.ws.on("error", (err) => {
      console.error("❌ Socket Error:", err);
    });
  }

  async getSymbols(ctidTraderAccountId) {
    if (this.symbolCache?.[ctidTraderAccountId]) {
      return this.symbolCache[ctidTraderAccountId];
    }

    const res = await this.send(2114, "ProtoOASymbolsListReq", {
      ctidTraderAccountId: Number(ctidTraderAccountId),
    });

    if (res.payloadType !== 2115) {
      throw new Error(
        `Unexpected response fetching symbols: ${res.payloadType}`,
      );
    }

    const symbols =
      res.payload?.symbol ??
      res.payload?.symbols ??
      res.payload?.ctidSymbol ??
      [];

    if (!this.symbolCache) this.symbolCache = {};
    this.symbolCache[ctidTraderAccountId] = symbols;

    return symbols;
  }

  async getAccounts(token) {
    const res = await this.send(2149, "ProtoOAGetAccountListByAccessTokenReq", {
      accessToken: token,
    });

    if (!res || res.payloadType !== 2150) {
      throw new Error("Failed to fetch accounts from cTrader");
    }

    const accounts = res.payload?.ctidTraderAccount ?? [];
    console.log(accounts);
    return accounts;
  }

  async warmupAccountAuth() {
    try {
      const user = await UserModel.findOne({
        "cTraderConfig.isConnected": true,
      }).select("+cTraderConfig.accessTokenEnc +cTraderConfig.accountId");

      if (!user) {
        console.warn("ℹ️ No connected users found");
        return;
      }

      const token = decryptText(user.cTraderConfig.accessTokenEnc);
      const accountId = String(user.cTraderConfig.accountId);

      const accounts = await this.getAccounts(token);
      const valid = accounts.some(
        (a) =>
          String(a.ctidTraderAccountId) ===
          String(user.cTraderConfig.accountId),
      );

      if (valid) {
        console.log("ℹ️ stored accountID is valid");
      }

      if (!valid) {
        throw new Error(
          "Stored accountId does not belong to this token. Reconnect required.",
        );
      }

      console.log(`📤 Sending Account Auth (2102) for ${accountId}`);

      const payload = buildAccountAuthPayload(token, accountId);

      const response = await this.send(2102, "ProtoOAAccountAuthReq", payload);

      if (!response || response.payloadType === 2142) {
        throw new Error("Account auth rejected by cTrader");
      }

      if (response.payloadType !== 2103) {
        throw new Error(
          `Unexpected account auth response: ${response.payloadType}`,
        );
      }

      console.log(`✅ Account ${accountId} Authorized`);

      this.isAccountAuthenticated = true;
    } catch (err) {
      console.error("❌ Account Auth Failed:", err.message);
      throw err;
    }
  }

  async getVersion() {
    const response = await this.send(2104, "ProtoOAVersionReq", {});
    if (response.payloadType === 2105) {
      this.apiVersion = response.payload.version;
      console.log(`✅ Server Version set to: ${this.apiVersion}`);
      return this.apiVersion;
    }
  }

  async send(payloadType, payloadName, data) {
    if (!this.connected || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not open");
    }

    const clientMsgId = uuidv4();
    const SpecificType = this.root.lookupType(payloadName);
    const ProtoMessage = this.root.lookupType("ProtoMessage");

    const innerPayload = { ...data };
    if (payloadType === 2100) {
      innerPayload.version = this.apiVersion;
    }

    const errMsg = SpecificType.verify(innerPayload);
    if (errMsg) throw Error(`${payloadName} validation failed: ${errMsg}`);

    const payloadBuffer = SpecificType.encode(
      SpecificType.create(innerPayload),
    ).finish();

    const envelopeData = {
      payloadType,
      payload: payloadBuffer,
      clientMsgId,
      version: this.apiVersion,
    };

    const envelope = ProtoMessage.encode(
      ProtoMessage.create(envelopeData),
    ).finish();

    console.log(
      `📤 Sending ${payloadName} (${payloadType}) | ID: ${clientMsgId}`,
    );

    return new Promise((resolve, reject) => {
      this.pending.set(clientMsgId, { resolve, reject, payloadType });

      this.ws.send(envelope);

      setTimeout(() => {
        if (this.pending.has(clientMsgId)) {
          this.pending.delete(clientMsgId);
          reject(new Error(`Timeout waiting for response: ${payloadName}`));
        }
      }, 15000);
    });
  }

  decode(buffer) {
    try {
      const ProtoMessage = this.root.lookupType("ProtoMessage");
      const decoded = ProtoMessage.decode(buffer);
      let payload = null;

      try {
        const typeMap = {
          2101: "ProtoOAApplicationAuthRes",
          2103: "ProtoOAAccountAuthRes",
          2105: "ProtoOAVersionRes",
          2115: "ProtoOASymbolsListRes",
          2126: "ProtoOAExecutionEvent",
          2132: "ProtoOAOrderErrorEvent",
          2142: "ProtoOAErrorRes",
          2150: "ProtoOAGetAccountListByAccessTokenRes",
          2114: "ProtoOASymbolsListReq",
          2115: "ProtoOASymbolsListRes",
          2116: "ProtoOASymbolByIdReq",
          2117: "ProtoOASymbolByIdRes",
          2118: "ProtoOASymbolChangedEvent",
        };

        const typeName = typeMap[decoded.payloadType];

        if (typeName) {
          const PayloadType = this.root.lookupType(typeName);
          const decodedPayload = PayloadType.decode(decoded.payload);

          payload = PayloadType.toObject(decodedPayload, {
            defaults: true,
            arrays: true,
            longs: String,
            enums: String,
          });

          // console.log(`📦 Decoded ${typeName}:`, payload);
        }
      } catch (err) {
        console.warn("Payload decode failed:", err.message);
      }

      return {
        ...decoded,
        payload,
      };
    } catch (err) {
      console.error("Envelope decode failed:", err.message);
      return null;
    }
  }
  startHeartbeat() {
    clearInterval(this.heartbeatInterval);

    this.heartbeatInterval = setInterval(() => {
      if (this.connected && this.ws.readyState === WebSocket.OPEN) {
        const ProtoMessage = this.root.lookupType("ProtoMessage");

        const hb = ProtoMessage.encode(
          ProtoMessage.create({
            payloadType: 51,
            payload: Buffer.alloc(0),
          }),
        ).finish();

        this.ws.send(hb);
      }
    }, 25000);
  }
}

export const ctraderClient = new CTraderClient();
