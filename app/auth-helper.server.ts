import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { authenticate } from "./shopify.server";
import { createMockAdmin, MOCK_SHOP } from "./mock-shopify.server";

export interface AuthenticatedContext {
  session: {
    shop: string;
    email?: string;
    isOnline?: boolean;
  };
  admin: AdminApiContext;
  isMock: boolean;
}

/**
 * Robust authentication helper that seamlessly falls back to local Mock Mode
 * when testing locally without a live Shopify Partner store account.
 */
export async function authenticateAdminWithDevFallback(
  request: Request
): Promise<AuthenticatedContext> {
  try {
    const context = await authenticate.admin(request);
    return {
      session: {
        shop: context.session.shop,
        isOnline: context.session.isOnline,
      },
      admin: context.admin,
      isMock: false,
    };
  } catch (error) {
    // If running in development and accessed directly outside Shopify Admin iframe
    if (process.env.NODE_ENV !== "production") {
      const url = new URL(request.url);
      const requestedShop = url.searchParams.get("shop") || MOCK_SHOP;

      return {
        session: {
          shop: requestedShop,
          email: "merchant@demo-store.com",
          isOnline: false,
        },
        admin: createMockAdmin(requestedShop),
        isMock: true,
      };
    }

    throw error;
  }
}
