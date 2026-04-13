// services/activeTradeStreamer.js

import { TradeSignal } from "../models/TradeSignal.js";
import { getIO } from "../sockets/io.js";
import { getLivePrice } from "./marketDataServices.js";

export const startActiveTradeStream = () => {
  const io = getIO();
  setInterval(async () => {
    const activeTrades = await TradeSignal.find({ status: "active" });

    for (const trade of activeTrades) {
      const priceData = await getLivePrice(trade.instrument);

      const currentPrice = priceData.price;

      let pnl = 0;
      if (currentPrice) {
        pnl = (currentPrice - trade.entryPrice) * trade.lotSize * 100000;
      }

      io.to(trade.userId.toString()).emit("trade_update", {
        tradeId: trade._id,
        instrument: trade.instrument,
        entryPrice: trade.entryPrice,
        currentPrice,
        pnl,
      });
    }
  }, 2000);
};
