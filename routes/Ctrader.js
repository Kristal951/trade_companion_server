import express from 'express'
import { callback, connectUrl, disconnectCtrader, getStatus, setActiveAccount, setAutoTrade, setCtraderSettings } from '../controllers/Ctrader.js'
import { authenticateUser } from '../middlewares/authenticateUser.js'

const router = express.Router()

router.get('/callback', callback)
router.get("/connect-url", authenticateUser, connectUrl);
router.get("/status", authenticateUser, getStatus);
router.post("/set-active-account", authenticateUser, setActiveAccount);
router.post("/disconnect", authenticateUser, disconnectCtrader);
router.post("/settings", authenticateUser, setCtraderSettings);
router.patch("/auto-trade", authenticateUser, setAutoTrade);

export default router