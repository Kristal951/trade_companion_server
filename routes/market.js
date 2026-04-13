import express from "express";
import { getMarket, getPrice, getPrices } from "../controllers/market.js";

const router = express.Router();

router.get("/price/:instrument", getPrice);
router.post("/prices", getPrices);
router.get("/market/:instrument", getMarket);

export default router;
