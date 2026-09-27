import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import shopify, { authenticate } from "./shopify.server";
import { createMockAdmin, MOCK_SHOP } from "./mock-shopify.server";
import prisma from "./db.server";

export interface AuthenticatedContext {
  session: {
    shop: string;
    email?: string;
    isOnline?: boolean;
  };
  admin: AdminApiContext;
  isMock: boolean;
  redirect?: (url: string, init?: any) => Response;
}

/**
 * Robust authentication helper that seamlessly falls back to local Mock Mode
 * only when testing locally without a live Shopify Partner store account.
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
      redirect: context.redirect,
    };
  } catch (error) {
    // 1. If authenticate.admin threw a Response (redirect / auth challenge),
    // we MUST rethrow it so Remix/Shopify can execute the response/redirect!
    if (error instanceof Response) {
      throw error;
    }

    // 2. Check if we have a real store session in the database
    const url = new URL(request.url);
    const requestedShop = url.searchParams.get("shop") || "smartstock-demo.myshopify.com";

    const existingSession = await prisma.session.findFirst({
      where: {
        OR: [
          { shop: requestedShop },
          { id: { contains: requestedShop } },
        ],
      },
    });

    if (existingSession) {
      try {
        const { admin } = await shopify.unauthenticated.admin(existingSession.shop);
        return {
          session: {
            shop: existingSession.shop,
            isOnline: existingSession.isOnline,
          },
          admin,
          isMock: false,
        };
      } catch (adminErr) {
        console.warn("[AuthHelper] unauthenticated.admin fallback error:", adminErr);
      }
    }

    // 3. Fallback to mock mode ONLY if no real session exists in database
    if (process.env.NODE_ENV !== "production") {
      return {
        session: {
          shop: requestedShop || MOCK_SHOP,
          email: "merchant@demo-store.com",
          isOnline: false,
        },
        admin: createMockAdmin(requestedShop || MOCK_SHOP),
        isMock: true,
      };
    }

    throw error;
  }
}
