import express from 'express'
import { getPlans } from '../controllers/Plans.js'
const router = express.Router()

router.get('/getPlans', getPlans)

export default router