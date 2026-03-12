import express from 'express'
import { getPlanByID, getPlans, startSubscriptionPayment } from '../controllers/Plans.js'
const router = express.Router()

router.get('/getPlans', getPlans)
router.post('/startSubscriptionPayment', startSubscriptionPayment)
router.get('/getPlan/:planId', getPlanByID)

export default router