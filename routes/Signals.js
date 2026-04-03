import express from "express";
import {
  getActiveSignals,
  getAISignalsForUser,
  getUserSignals,
  markSignalAsExecuted,
  save_signal,
  scanForSignals,
} from "../controllers/Signals.js";
import { authenticateUser } from "../middlewares/authenticateUser.js";

const router = express.Router();

router.post("/save_signal", save_signal);
router.patch("/:id/execute_signal", markSignalAsExecuted);
router.get("/ai/user/:userId", getAISignalsForUser);
router.post("/scan-signals", scanForSignals);
router.get("/my-signals", authenticateUser, getUserSignals);
router.get("/my-active-signals", authenticateUser, getActiveSignals);

export default router;
