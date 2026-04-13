import dotenv from "dotenv";
dotenv.config();
import Long from 'long'


export function buildAppAuthPayload() {
  const clientId = process.env.CTRADER_CLIENT_ID?.trim();
  const clientSecret = process.env.CTRADER_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error(
      "❌ Missing CTRADER_CLIENT_ID or CTRADER_CLIENT_SECRET in .env"
    );
  }

  return {
    clientId,
    clientSecret,
     version: "1.0" 
  };
}

export function buildAccountAuthPayload(accessToken, accountId) {
  if (!accessToken) {
    throw new Error("❌ Missing accessToken for account auth");
  }

  if (!accountId) {
    throw new Error("❌ Missing accountId for account auth");
  }

  return {
    ctidTraderAccountId: Long.fromString(accountId),
    accessToken: accessToken.trim(),
  };
}