import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  DeliveryMethod,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY || "development_api_key",
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "development_api_secret",
  apiVersion: ApiVersion.October24,
  scopes: process.env.SCOPES?.split(",") || [
    "read_products",
    "read_inventory",
    "read_locations",
  ],
  appUrl: process.env.SHOPIFY_APP_URL || "http://localhost:3000",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
  webhooks: {
    INVENTORY_LEVELS_UPDATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      // 1. Register Webhooks programmatically if not using declarative TOML webhooks
      await shopify.registerWebhooks({ session });

      // 2. Query shop email to pre-fill StoreSettings if not existing
      try {
        const response = await admin.graphql(
          `#graphql
          query getShopDetails {
            shop {
              email
              contactEmail
            }
          }`
        );
        const data = await response.json();
        const shopEmail = data.data?.shop?.contactEmail || data.data?.shop?.email;

        // Upsert default StoreSettings
        await prisma.storeSettings.upsert({
          where: { shop: session.shop },
          update: {},
          create: {
            shop: session.shop,
            ownerEmail: shopEmail || session.onlineAccessInfo?.associated_user?.email || null,
            globalThreshold: 5,
            activePlan: "FREE",
          },
        });
      } catch (error) {
        console.error(`[AfterAuth] Failed to initialize store settings for ${session.shop}:`, error);
      }
    },
  },
});

export default shopify;
export const apiVersion = ApiVersion.October24;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
