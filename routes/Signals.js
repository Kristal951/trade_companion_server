import express from "express";
import { getAISignalsForUser, markSignalAsExecuted, save_signal } from "../controllers/Signals.js";
const router = express.Router();

router.post("/save_signal", save_signal);
router.patch('/:id/execute_signal', markSignalAsExecuted)
router.get("/ai/user/:userId", getAISignalsForUser);

export default router;
