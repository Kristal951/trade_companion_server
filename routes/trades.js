import express from "express";
import { getUserTrades } from "../controllers/Trades.js";
import { executeSignal } from "../utils/trade.js";
import { authenticateUser } from "../middlewares/authenticateUser.js";

const router = express.Router();

router.post("/execute", authenticateUser, executeSignal);

router.get("/", authenticateUser, getUserTrades);

export default router;
