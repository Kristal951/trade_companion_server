import Trade from "../models/Trade.js";
import { executeSignal } from "../utils/trade.js";

export const getUserTrades = async (req, res) => {
  try {
    const trades = await Trade.find({
      userId: req.user.id,
    }).sort({ createdAt: -1 });

    res.json(trades);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const executeTrade = async (req, res) => {
  const { signalId, entryPrice } = req.body;
  try {
    const trade = await executeSignal(signalId, req.user.id, entryPrice);

    res.json(trade);
  } catch (error) {
    console.log(error);
    throw error;
  }
};
