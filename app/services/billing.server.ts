import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { PlanTier } from "../types";
import prisma from "../db.server";

export interface PlanConfig {
  id: PlanTier;
  title: string;
  price: number;
  interval: "EVERY_30_DAYS";
  description: string;
  features: string[];
  maxAlertsPerMonth: number | "UNLIMITED";
  vendorRouting: boolean;
  multiLocation: boolean;
  analytics: boolean;
  watermark: boolean;
}

export const PLANS: Record<PlanTier, PlanConfig> = {
  [PlanTier.FREE]: {
    id: PlanTier.FREE,
    title: "Free Tier",
    price: 0,
    interval: "EVERY_30_DAYS",
    description: "Essential inventory safety net for small catalogs.",
    features: [
      "Global low-stock threshold",
      "Up to 50 email alerts per month",
      "Store owner notifications only",
      "Antigravity footer watermark",
    ],
    maxAlertsPerMonth: 50,
    vendorRouting: false,
    multiLocation: false,
    analytics: false,
    watermark: true,
  },
  [PlanTier.STARTER]: {
    id: PlanTier.STARTER,
    title: "Starter Tier",
    price: 9.0,
    interval: "EVERY_30_DAYS",
    description: "Automate supplier communication with custom thresholds.",
    features: [
      "Unlimited email alerts",
      "Per-variant custom stock thresholds",
      "Automated vendor re-order routing",
      "White-label branded emails (No watermark)",
    ],
    maxAlertsPerMonth: "UNLIMITED",
    vendorRouting: true,
    multiLocation: false,
    analytics: false,
    watermark: false,
  },
  [PlanTier.PRO]: {
    id: PlanTier.PRO,
    title: "Pro Tier",
    price: 29.0,
    interval: "EVERY_30_DAYS",
    description: "Multi-location inventory tracking with advanced stockout analytics.",
    features: [
      "Everything in Starter Tier",
      "Multi-location fulfillment tracking",
      "Frequent stockout analytics dashboard",
      "Priority webhook dispatch queue",
    ],
    maxAlertsPerMonth: "UNLIMITED",
    vendorRouting: true,
    multiLocation: true,
    analytics: true,
    watermark: false,
  },
};

const APP_SUBSCRIPTION_CREATE_MUTATION = `#graphql
  mutation AppSubscriptionCreate(
    $name: String!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $returnUrl: URL!
    $test: Boolean
  ) {
    appSubscriptionCreate(
      name: $name
      lineItems: $lineItems
      returnUrl: $returnUrl
      test: $test
    ) {
      appSubscription {
        id
        status
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

const APP_SUBSCRIPTION_CANCEL_MUTATION = `#graphql
  mutation AppSubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query getActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        currentPeriodEnd
        lineItems {
          plan {
            pricingDetails {
              ... on AppRecurringPricing {
                price {
                  amount
                  currencyCode
                }
                interval
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Checks Shopify GraphQL for active recurring application charges
 * and synchronizes the merchant's local database record.
 */
export async function syncStoreSubscription({
  admin,
  shop,
}: {
  admin: AdminApiContext;
  shop: string;
}): Promise<PlanTier> {
  try {
    const response = await admin.graphql(GET_ACTIVE_SUBSCRIPTIONS_QUERY);
    const data = await response.json();
    const activeSubscriptions = data.data?.currentAppInstallation?.activeSubscriptions || [];

    let currentTier: PlanTier = PlanTier.FREE;
    let subscriptionId: string | null = null;

    if (activeSubscriptions.length > 0) {
      const activeSub = activeSubscriptions[0];
      subscriptionId = activeSub.id;
      const subName = (activeSub.name || "").toUpperCase();

      if (subName.includes("PRO")) {
        currentTier = PlanTier.PRO;
      } else if (subName.includes("STARTER")) {
        currentTier = PlanTier.STARTER;
      }
    }

    await prisma.storeSettings.upsert({
      where: { shop },
      update: {
        activePlan: currentTier,
        subscriptionChargeId: subscriptionId,
      },
      create: {
        shop,
        activePlan: currentTier,
        subscriptionChargeId: subscriptionId,
        globalThreshold: 5,
      },
    });

    return currentTier;
  } catch (err) {
    console.error(`[Billing] Failed to sync subscription for ${shop}:`, err);
    const existing = await prisma.storeSettings.findUnique({ where: { shop } });
    return (existing?.activePlan as PlanTier) || PlanTier.FREE;
  }
}

/**
 * Initiates a new subscription charge via Shopify GraphQL.
 * Returns the confirmation URL that the merchant must visit to approve the charge.
 */
export async function createSubscriptionPlan({
  admin,
  shop,
  plan,
  returnUrl,
  isTest = process.env.SHOPIFY_BILLING_TEST === "false" ? false : true,
}: {
  admin: AdminApiContext;
  shop: string;
  plan: PlanTier;
  returnUrl: string;
  isTest?: boolean;
}): Promise<{ confirmationUrl?: string; error?: string }> {
  if (plan === PlanTier.FREE) {
    // If downgrading to Free, cancel any active subscription
    await cancelSubscriptionPlan({ admin, shop });
    return { confirmationUrl: returnUrl };
  }

  const selectedPlan = PLANS[plan];

  const response = await admin.graphql(APP_SUBSCRIPTION_CREATE_MUTATION, {
    variables: {
      name: `Low Stock Alert - ${selectedPlan.title}`,
      returnUrl,
      test: isTest,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: {
                amount: selectedPlan.price,
                currencyCode: "USD",
              },
              interval: "EVERY_30_DAYS",
            },
          },
        },
      ],
    },
  });

  const body = await response.json();
  const result = body.data?.appSubscriptionCreate;

  if (result?.userErrors?.length) {
    const errorMsg = result.userErrors.map((e: { message: string }) => e.message).join(", ");
    console.error(`[Billing] appSubscriptionCreate failed for ${shop}:`, errorMsg);
    return { error: errorMsg };
  }

  return { confirmationUrl: result?.confirmationUrl };
}

/**
 * Cancels an active recurring application charge and resets the store to Free Tier.
 */
export async function cancelSubscriptionPlan({
  admin,
  shop,
}: {
  admin: AdminApiContext;
  shop: string;
}): Promise<boolean> {
  const store = await prisma.storeSettings.findUnique({ where: { shop } });

  if (store?.subscriptionChargeId) {
    try {
      await admin.graphql(APP_SUBSCRIPTION_CANCEL_MUTATION, {
        variables: { id: store.subscriptionChargeId },
      });
    } catch (err) {
      console.warn(`[Billing] Error canceling subscription ${store.subscriptionChargeId}:`, err);
    }
  }

  await prisma.storeSettings.update({
    where: { shop },
    data: {
      activePlan: PlanTier.FREE,
      subscriptionChargeId: null,
    },
  });

  return true;
}

/**
 * Tier Guard helper for backend route actions and loaders.
 * Validates whether the store possesses the required tier privileges.
 */
export function hasTierPrivilege(currentPlan: PlanTier, requiredTier: PlanTier): boolean {
  const rank: Record<PlanTier, number> = {
    [PlanTier.FREE]: 0,
    [PlanTier.STARTER]: 1,
    [PlanTier.PRO]: 2,
  };

  return rank[currentPlan] >= rank[requiredTier];
}
