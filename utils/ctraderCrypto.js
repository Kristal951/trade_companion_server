import crypto from "crypto";
import dotenv from 'dotenv'
dotenv.config()

const { TOKEN_ENC_KEY } = process.env;
if (!TOKEN_ENC_KEY) throw new Error("Missing env: TOKEN_ENC_KEY");

const ENC_KEY = Buffer.from(TOKEN_ENC_KEY, "hex");
if (ENC_KEY.length !== 32) throw new Error("TOKEN_ENC_KEY must be 64 hex chars (32 bytes).");

export function encryptText(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);

  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return { iv: iv.toString("base64"), tag: tag.toString("base64"), data: encrypted.toString("base64") };
}

export function decryptText(enc) {
  if (!enc?.data || !enc?.iv || !enc?.tag) return null;

  const iv = Buffer.from(enc.iv, "base64");
  const tag = Buffer.from(enc.tag, "base64");
  const data = Buffer.from(enc.data, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}
