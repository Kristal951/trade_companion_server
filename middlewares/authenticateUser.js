import jwt from "jsonwebtoken";
import Session from "../models/Session.js";

export const authenticateUser = async (req, res, next) => {
  try {
    if (req.method === "OPTIONS") return next();

    const authHeader = req.headers.authorization;

    let token =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length).trim()
        : null;

    if (!token) {
      const cookieToken = req.cookies?.accessToken;
      if (typeof cookieToken === "string" && cookieToken.trim()) {
        token = cookieToken.trim();
      }
    }

    const isDev = process.env.NODE_ENV !== "production";
    const path = req.baseUrl + req.path;

    const queryTokenRaw = req.query?.token;
    const queryToken = typeof queryTokenRaw === "string" ? queryTokenRaw : null;

    if (!token && isDev && queryToken) {
      const allowedQueryTokenPaths = ["/api/ctrader/connect"];
      if (allowedQueryTokenPaths.includes(path)) token = queryToken.trim();
    }

    if (!token) {
      return res.status(401).json({ message: "Missing or malformed token" });
    }

    if (isDev) {
      const source =
        authHeader?.startsWith("Bearer ")
          ? "header"
          : req.cookies?.accessToken
            ? "cookie"
            : queryToken
              ? "query"
              : "none";
      console.log(`[AUTH] ${req.method} ${path} tokenSource=${source}`);
    }

    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    if (!payload?.sessionId || !payload?.userId) {
      return res.status(401).json({ message: "Invalid token payload" });
    }

    const session = await Session.findOne({
      sessionId: payload.sessionId,
      revoked: false,
    }).lean();

    if (!session) {
      return res.status(401).json({ message: "Session revoked or expired" });
    }

    if (session.expiresAt && Date.now() > new Date(session.expiresAt).getTime()) {
      return res.status(401).json({ message: "Session expired" });
    }

    req.user = payload;
    next();
  } catch (err) {
    const message = err?.name === "TokenExpiredError" ? "Token expired" : "Invalid token";
    return res.status(401).json({ message });
  }
};
