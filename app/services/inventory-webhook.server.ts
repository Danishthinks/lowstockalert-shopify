import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { PlanTier, AlertStatus } from "../types";
import { sendLowStockAlert } from "./email.server";

export interface InventoryLevelUpdateWebhookPayload {
  inventory_item_id: number;
  location_id: number;
  available: number;
  updated_at: string;
}

interface GraphQLInventoryItemResponse {
  data?: {
    inventoryItem?: {
      id: string;
      variant?: {
        id: string;
        title: string;
        displayName: string;
        product?: {
          id: string;
          title: string;
          vendor: string;
        };
      };
    };
  };
  errors?: Array<{ message: string }>;
}

export interface WebhookProcessResult {
  success: boolean;
  actionTaken: "ALERT_SENT" | "ABORTED_ABOVE_THRESHOLD" | "ABORTED_QUOTA_EXCEEDED" | "SKIPPED_NOT_CONFIGURED" | "ERROR";
  reason?: string;
  details?: {
    productId?: string;
    variantId?: string;
    stockLevel?: number;
    threshold?: number;
    recipients?: string[];
  };
}

const INVENTORY_ITEM_QUERY = `#graphql
  query getVariantByInventoryItemId($id: ID!) {
    inventoryItem(id: $id) {
      id
      variant {
        id
        title
        displayName
        product {
          id
          title
          vendor
        }
      }
    }
  }
`;

/**
 * Normalizes an integer or GID to a Shopify InventoryItem GID
 */
function toInventoryItemGid(id: number | string): string {
  if (typeof id === "string" && id.startsWith("gid://shopify/InventoryItem/")) {
    return id;
  }
  return `gid://shopify/InventoryItem/${id}`;
}

/**
 * Core event-driven processor for `inventory_levels/update` webhooks.
 * Implements strict tiered logic, atomic quota management, and vendor routing.
 */
export async function processInventoryLevelUpdate({
  shop,
  admin,
  payload,
}: {
  shop: string;
  admin: AdminApiContext;
  payload: InventoryLevelUpdateWebhookPayload;
}): Promise<WebhookProcessResult> {
  const { inventory_item_id, available, location_id } = payload;
  const inventoryItemGid = toInventoryItemGid(inventory_item_id);

  // 1. Fetch StoreSettings & active subscription status
  let storeSettings = await prisma.storeSettings.findUnique({
    where: { shop },
  });

  if (!storeSettings) {
    // Self-healing: Initialize store settings if webhook arrived before afterAuth hook finished
    storeSettings = await prisma.storeSettings.create({
      data: {
        shop,
        activePlan: PlanTier.FREE,
        globalThreshold: 5,
        alertCountThisMonth: 0,
      },
    });
  }

  // 2. Check and atomically handle monthly billing cycle reset (30-day window)
  const now = new Date();
  const resetThresholdDate = new Date(storeSettings.alertCountResetAt);
  resetThresholdDate.setDate(resetThresholdDate.getDate() + 30);

  if (now > resetThresholdDate) {
    storeSettings = await prisma.storeSettings.update({
      where: { shop },
      data: {
        alertCountThisMonth: 0,
        alertCountResetAt: now,
      },
    });
  }

  // 3. Resolve variant, product, and vendor from Shopify GraphQL Admin API
  const gqlResponse = await admin.graphql(INVENTORY_ITEM_QUERY, {
    variables: { id: inventoryItemGid },
  });

  const body = (await gqlResponse.json()) as GraphQLInventoryItemResponse;

  if (body.errors?.length || !body.data?.inventoryItem?.variant) {
    return {
      success: false,
      actionTaken: "ERROR",
      reason: body.errors?.map((e) => e.message).join(", ") || "Variant not found for inventory item",
    };
  }

  const variant = body.data.inventoryItem.variant;
  const product = variant.product;

  const variantId = variant.id;
  const productId = product?.id || "";
  const productTitle = product?.title || "Unknown Product";
  const variantTitle = variant.title === "Default Title" ? "" : variant.title;
  const productVendor = product?.vendor || "";

  // 4. Determine effective threshold: Product-specific override vs Store Global Threshold
  // Custom thresholds can only be active if merchant is on STARTER or PRO tier.
  let effectiveThreshold = storeSettings.globalThreshold;
  let vendorEmail: string | null = null;

  const isPaidTier = storeSettings.activePlan === PlanTier.STARTER || storeSettings.activePlan === PlanTier.PRO;

  if (isPaidTier) {
    const customThresholdRecord = await prisma.productThreshold.findUnique({
      where: {
        shop_variantId: {
          shop,
          variantId,
        },
      },
    });

    if (customThresholdRecord) {
      effectiveThreshold = customThresholdRecord.customThreshold;
      vendorEmail = customThresholdRecord.vendorEmail;
    }
  }

  // 5. Evaluate if inventory is at or below threshold
  if (available > effectiveThreshold) {
    return {
      success: true,
      actionTaken: "ABORTED_ABOVE_THRESHOLD",
      details: {
        productId,
        variantId,
        stockLevel: available,
        threshold: effectiveThreshold,
      },
    };
  }

  // 6. Quota Enforcement: Free tier strictly capped at 50 alerts per month
  if (storeSettings.activePlan === PlanTier.FREE && storeSettings.alertCountThisMonth >= 50) {
    await prisma.alertHistory.create({
      data: {
        shop,
        productId,
        variantId,
        inventoryItemId: inventoryItemGid,
        productTitle,
        variantTitle,
        stockLevel: available,
        threshold: effectiveThreshold,
        recipientEmails: "",
        tier: storeSettings.activePlan,
        status: AlertStatus.LIMIT_EXCEEDED,
        errorMessage: "Monthly limit of 50 alerts exceeded on Free tier.",
      },
    });

    return {
      success: false,
      actionTaken: "ABORTED_QUOTA_EXCEEDED",
      reason: "Free tier monthly limit of 50 alerts reached.",
    };
  }

  // 7. Verify recipient emails
  const ownerEmail = storeSettings.ownerEmail;
  if (!ownerEmail) {
    return {
      success: false,
      actionTaken: "SKIPPED_NOT_CONFIGURED",
      reason: "Store owner email is not configured in settings.",
    };
  }

  // 8. Dispatch Email Alert
  const recipients: string[] = [ownerEmail];
  if (isPaidTier && vendorEmail) {
    recipients.push(vendorEmail);
  }

  let emailError: string | null = null;
  try {
    await sendLowStockAlert({
      productName: productTitle,
      variantName: variantTitle,
      remainingStock: available,
      threshold: effectiveThreshold,
      ownerEmail,
      vendorEmail: isPaidTier ? vendorEmail : null,
      vendorName: productVendor,
      tier: storeSettings.activePlan as PlanTier,
      locationId: storeSettings.activePlan === PlanTier.PRO ? String(location_id) : undefined,
    });
  } catch (err: unknown) {
    emailError = err instanceof Error ? err.message : "Unknown email dispatch error";
  }

  // 9. Atomic Transaction: Record audit history & increment quota counter
  await prisma.$transaction([
    prisma.alertHistory.create({
      data: {
        shop,
        productId,
        variantId,
        inventoryItemId: inventoryItemGid,
        productTitle,
        variantTitle,
        stockLevel: available,
        threshold: effectiveThreshold,
        recipientEmails: recipients.join(","),
        tier: storeSettings.activePlan,
        status: emailError ? AlertStatus.FAILED : AlertStatus.SENT,
        errorMessage: emailError,
      },
    }),
    prisma.storeSettings.update({
      where: { shop },
      data: {
        alertCountThisMonth: {
          increment: 1,
        },
      },
    }),
  ]);

  return {
    success: !emailError,
    actionTaken: emailError ? "ERROR" : "ALERT_SENT",
    reason: emailError || undefined,
    details: {
      productId,
      variantId,
      stockLevel: available,
      threshold: effectiveThreshold,
      recipients,
    },
  };
}
