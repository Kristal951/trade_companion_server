import {
  fetchMarketContext,
  getLivePrice,
  getLivePrices,
} from "../services/marketDataServices.js";

export const getPrice = async (req, res) => {
  const { instrument } = req.params;

  try {
    const data = await getLivePrice(instrument);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch price" });
  }
};

export const getPrices = async (req, res) => {
  const { instruments } = req.body;

  try {
    const data = await getLivePrices(instruments);
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed" });
  }
};

export const getMarket = async (req, res) => {
  const { instrument } = req.params;
  const depth = Number(req.query.depth) || 50;

  try {
    const data = await fetchMarketContext(instrument, depth);
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed" });
  }
};
