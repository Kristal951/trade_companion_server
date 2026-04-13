// controllers/tradeSignalController.js
import mongoose from "mongoose";
import { TradeSignal } from "../models/TradeSignal.js";
import { runSignalScanJob } from "../jobs/runSignalScanJob.js";

/**
 * Build a stable dedupe key so identical signals can't be saved twice.
 * Normalize instrument/type and price precision.
 */
function makeDedupeKey(body) {
  const userId = String(body.userId || "").trim();
  const instrument = String(body.instrument || "")
    .trim()
    .toUpperCase();
  const type = String(body.type || "")
    .trim()
    .toUpperCase(); // BUY/SELL

  const ep = Number(body.entryPrice);
  const sl = Number(body.stopLoss);

  const epStr = Number.isFinite(ep) ? ep.toFixed(2) : "NaN";
  const slStr = Number.isFinite(sl) ? sl.toFixed(2) : "NaN";

  const tpStr = (Array.isArray(body.takeProfits) ? body.takeProfits : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .map((n) => n.toFixed(2))
    .join(",");

  const aiStr = body.isAI ? "AI" : "MANUAL";

  return `${userId}|${instrument}|${type}|${epStr}|${slStr}|${tpStr}|${aiStr}`;
}

function parseBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return undefined;
  if (v.toLowerCase() === "true") return true;
  if (v.toLowerCase() === "false") return false;
  return undefined;
}

function toUpperTrim(v) {
  return v == null ? undefined : String(v).trim().toUpperCase();
}

function toStrTrim(v) {
  return v == null ? undefined : String(v).trim();
}

/**
 * POST /api/signals
 * Save a trade signal (AI or manual). Dedupe protected.
 */
export const save_signal = async (req, res) => {
  const {
    userId,
    instrument,
    type,
    isAI,
    entryPrice,
    stopLoss,
    takeProfits,
    confidence,
    reasoning,
    technicalReasoning,
    lotSize,
    riskAmount,
    meta,
  } = req.body;

  if (!userId || !instrument || !type) {
    return res.status(400).json({ message: "Missing: userId/instrument/type" });
  }

  if (typeof isAI !== "boolean") {
    return res.status(400).json({ message: "isAI must be true/false" });
  }

  if (!Array.isArray(takeProfits) || takeProfits.length === 0) {
    return res
      .status(400)
      .json({ message: "takeProfits must be a non-empty array" });
  }

  const epNum = Number(entryPrice);
  const slNum = Number(stopLoss);

  if (!Number.isFinite(epNum) || epNum <= 0) {
    return res.status(400).json({ message: "entryPrice must be a number > 0" });
  }
  if (!Number.isFinite(slNum) || slNum <= 0) {
    return res.status(400).json({ message: "stopLoss must be a number > 0" });
  }

  const tps = takeProfits.map((n) => Number(n));
  if (tps.some((n) => !Number.isFinite(n) || n <= 0)) {
    return res
      .status(400)
      .json({ message: "takeProfits must contain numbers > 0" });
  }

  try {
    const instrumentNorm = String(instrument).trim().toUpperCase();
    const typeNorm = String(type).trim().toUpperCase();

    const dedupeKey = makeDedupeKey({
      ...req.body,
      instrument: instrumentNorm,
      type: typeNorm,
      entryPrice: epNum,
      stopLoss: slNum,
      takeProfits: tps,
    });

    const newSignal = await TradeSignal.create({
      userId: String(userId).trim(),
      instrument: instrumentNorm,
      type: typeNorm,
      isAI,
      entryPrice: epNum,
      stopLoss: slNum,
      takeProfits: tps,
      confidence: confidence == null ? null : Number(confidence),
      reasoning: reasoning == null ? null : String(reasoning),
      technicalReasoning:
        technicalReasoning == null ? null : String(technicalReasoning),
      lotSize: lotSize == null ? null : Number(lotSize),
      riskAmount: riskAmount == null ? null : Number(riskAmount),
      meta:
        meta && typeof meta === "object" && !Array.isArray(meta) ? meta : null,

      dedupeKey,
      status: "NEW",
    });

    return res.status(201).json({ ok: true, signal: newSignal });
  } catch (error) {
    if (String(error?.code) === "11000") {
      return res
        .status(409)
        .json({ ok: false, message: "Signal already saved (duplicate)." });
    }
    console.error("save_signal error:", error);
    return res
      .status(500)
      .json({ ok: false, message: "Failed to save signal" });
  }
};

export const markSignalAsExecuted = async (req, res) => {
  const { id } = req.params;
  const { executedPrice, executedAt, brokerOrderId } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ ok: false, error: "Invalid signal id" });
  }

  const priceNum = Number(executedPrice);
  if (!Number.isFinite(priceNum) || priceNum <= 0) {
    return res
      .status(400)
      .json({ ok: false, error: "executedPrice must be a number > 0" });
  }

  const parsedExecutedAt = executedAt ? new Date(executedAt) : new Date();
  if (Number.isNaN(parsedExecutedAt.getTime())) {
    return res
      .status(400)
      .json({ ok: false, error: "executedAt must be a valid date" });
  }

  const set = {
    status: "EXECUTED",
    executedPrice: priceNum,
    executedAt: parsedExecutedAt,
  };

  if (brokerOrderId) {
    set.meta = { brokerOrderId: String(brokerOrderId).trim() };
  }

  try {
    const signal = await TradeSignal.findOneAndUpdate(
      {
        _id: id,
        status: { $nin: ["EXECUTED", "CANCELLED", "EXPIRED", "CLOSED"] },
      },
      { $set: set },
      { new: true },
    );

    if (!signal) {
      const existing = await TradeSignal.findById(id);
      if (!existing)
        return res.status(404).json({ ok: false, error: "Signal not found" });

      if (existing.status === "EXECUTED") {
        return res.status(200).json({
          ok: true,
          message: "Already executed",
          signal: existing,
        });
      }

      return res.status(409).json({
        ok: false,
        error: `Cannot execute because signal is ${existing.status}`,
      });
    }

    return res.status(200).json({ ok: true, signal });
  } catch (error) {
    console.error("markSignalAsExecuted error:", error);
    return res
      .status(500)
      .json({ ok: false, message: "Failed to mark executed" });
  }
};

export const getAllAISignals = async (req, res) => {
  try {
    const {
      userId,
      instrument,
      status,
      type,
      isAI,
      page = "1",
      limit = "20",
      sort = "-createdAt",
      from,
      to,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const filter = {};

    const isAIBool = parseBool(isAI);
    filter.isAI = isAIBool === undefined ? true : isAIBool;

    const userIdNorm = toStrTrim(userId);
    if (userIdNorm) filter.userId = userIdNorm;

    const instrumentNorm = toUpperTrim(instrument);
    if (instrumentNorm) filter.instrument = instrumentNorm;

    const statusNorm = toUpperTrim(status);
    if (statusNorm) filter.status = statusNorm;

    const typeNorm = toUpperTrim(type);
    if (typeNorm) filter.type = typeNorm;

    if (from || to) {
      const createdAt = {};
      if (from) {
        const d1 = new Date(from);
        if (!Number.isNaN(d1.getTime())) createdAt.$gte = d1;
      }
      if (to) {
        const d2 = new Date(to);
        if (!Number.isNaN(d2.getTime())) createdAt.$lte = d2;
      }
      if (Object.keys(createdAt).length > 0) filter.createdAt = createdAt;
    }

    const [items, total] = await Promise.all([
      TradeSignal.find(filter)
        .sort(String(sort))
        .skip(skip)
        .limit(limitNum)
        .lean(),
      TradeSignal.countDocuments(filter),
    ]);

    return res.status(200).json({
      ok: true,
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
      items,
    });
  } catch (error) {
    console.error("getAllAISignals error:", error);
    return res
      .status(500)
      .json({ ok: false, message: "Failed to fetch AI signals" });
  }
};

export const getAISignalsForUser = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        ok: false,
        message: "userId param is required",
      });
    }

    const {
      instrument,
      status,
      type,
      page = "1",
      limit = "20",
      sort = "-createdAt",
      from,
      to,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const filter = {
      userId: String(userId).trim(),
      isAI: true,
    };

    if (instrument) {
      filter.instrument = String(instrument).trim().toUpperCase();
    }

    if (status) {
      filter.status = String(status).trim().toUpperCase();
    }

    if (type) {
      filter.type = String(type).trim().toUpperCase();
    }

    if (from || to) {
      filter.createdAt = {};

      if (from) {
        const d1 = new Date(from);
        if (!Number.isNaN(d1.getTime())) {
          filter.createdAt.$gte = d1;
        }
      }

      if (to) {
        const d2 = new Date(to);
        if (!Number.isNaN(d2.getTime())) {
          filter.createdAt.$lte = d2;
        }
      }

      if (Object.keys(filter.createdAt).length === 0) {
        delete filter.createdAt;
      }
    }

    const [signals, total] = await Promise.all([
      TradeSignal.find(filter)
        .sort(String(sort))
        .skip(skip)
        .limit(limitNum)
        .lean(),

      TradeSignal.countDocuments(filter),
    ]);

    return res.status(200).json({
      ok: true,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      limit: limitNum,
      items: signals,
    });
  } catch (error) {
    console.error("getAISignalsForUser error:", error);
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch user AI signals",
    });
  }
};
export const scanForSignals = async (req, res) => {
  console.log("scan-signals route hit");
  console.log("auth header:", req.headers.authorization);
  try {
    const authHeader = req.headers.authorization;
    const expected = `Bearer ${process.env.CRON_SECRET}`;

    if (!process.env.CRON_SECRET) {
      console.log("CRON_SECRET missing");
      return res
        .status(500)
        .json({ ok: false, error: "CRON_SECRET is missing on server" });
    }

    if (authHeader !== expected) {
      console.log(authHeader, expected);
      console.log("Unauthorized request");
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    console.log("Authorization passed");
    const summary = await runSignalScanJob();
    console.log("Job finished:", summary);

    return res.json({
      ok: true,
      ranAt: new Date().toISOString(),
      summary,
    });
  } catch (error) {
    console.error("scan-signals job failed:", error);
    return res.status(500).json({
      ok: false,
      error: "Job failed",
    });
  }
};

export const getUserSignals = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id || req.user.userId;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Unauthorized",
      });
    }

    const { limit = 100, status } = req.query;

    const query = {
      userId: String(userId),
    };

    if (status) {
      query.status = status.toUpperCase();
    }

    const signals = await TradeSignal.find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .lean();

    return res.json({
      ok: true,
      count: signals.length,
      signals,
    });
  } catch (error) {
    console.error("GET /my-signals error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to fetch signals",
    });
  }
};
export const getActiveSignals = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id || req.user.userId;
    console.log(userId)

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Unauthorized",
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const skip = (page - 1) * limit;

    const query = {
      userId,
      status: { $in: ["NEW", "EXECUTED"] },
    };

    const [signals, total, totalSigs] = await Promise.all([
      TradeSignal.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),

      TradeSignal.countDocuments(query),

     TradeSignal.find({ userId: userId })
    ]);

    res.json({
      data: signals,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch signals" });
  }
};
