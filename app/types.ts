export const PlanTier = {
  FREE: "FREE",
  STARTER: "STARTER",
  PRO: "PRO",
} as const;

export type PlanTier = (typeof PlanTier)[keyof typeof PlanTier];

export const AlertStatus = {
  SENT: "SENT",
  FAILED: "FAILED",
  LIMIT_EXCEEDED: "LIMIT_EXCEEDED",
} as const;

export type AlertStatus = (typeof AlertStatus)[keyof typeof AlertStatus];
