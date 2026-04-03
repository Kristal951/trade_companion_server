import { normalizePlan, PLAN_NAME } from "./index.js";

export const DAILY_SIGNAL_LIMITS = {
  [PLAN_NAME.FREE]: 0,
  [PLAN_NAME.BASIC]: 2,
  [PLAN_NAME.PRO]: 5,
  [PLAN_NAME.PREMIUM]: 10,
};

export function getDailySignalLimit(plan) {
  const normalized = normalizePlan(plan);
  return DAILY_SIGNAL_LIMITS[normalized] ?? 0;
}

export function isSignalEligiblePlan(plan) {
  const normalized = normalizePlan(plan);
  return [
    PLAN_NAME.BASIC,
    PLAN_NAME.PRO,
    PLAN_NAME.PREMIUM,
  ].includes(normalized);
}