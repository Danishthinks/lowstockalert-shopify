import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import { PlanTier } from "./types";
import prisma from "./db.server";

export const MOCK_SHOP = "demo-store.myshopify.com";

export const MOCK_CATALOG = [
  {
    id: "gid://shopify/Product/1001",
    title: "Classic Heavyweight Hoodie",
    vendor: "Acme Apparel",
    variants: {
      nodes: [
        {
          id: "gid://shopify/ProductVariant/2001",
          title: "Black / Small",
          inventoryQuantity: 3,
          inventoryItem: { id: "gid://shopify/InventoryItem/3001" },
        },
        {
          id: "gid://shopify/ProductVariant/2002",
          title: "Black / Medium",
          inventoryQuantity: 12,
          inventoryItem: { id: "gid://shopify/InventoryItem/3002" },
        },
        {
          id: "gid://shopify/ProductVariant/2003",
          title: "Black / Large",
          inventoryQuantity: 0,
          inventoryItem: { id: "gid://shopify/InventoryItem/3003" },
        },
      ],
    },
  },
  {
    id: "gid://shopify/Product/1002",
    title: "Leather High-Top Sneakers",
    vendor: "SoleCraft Footwear",
    variants: {
      nodes: [
        {
          id: "gid://shopify/ProductVariant/2004",
          title: "Vintage Brown / US 9",
          inventoryQuantity: 4,
          inventoryItem: { id: "gid://shopify/InventoryItem/3004" },
        },
        {
          id: "gid://shopify/ProductVariant/2005",
          title: "Vintage Brown / US 10",
          inventoryQuantity: 1,
          inventoryItem: { id: "gid://shopify/InventoryItem/3005" },
        },
        {
          id: "gid://shopify/ProductVariant/2006",
          title: "Vintage Brown / US 11",
          inventoryQuantity: 9,
          inventoryItem: { id: "gid://shopify/InventoryItem/3006" },
        },
      ],
    },
  },
  {
    id: "gid://shopify/Product/1003",
    title: "Minimalist Ceramic Coffee Mug",
    vendor: "Nordic Pottery",
    variants: {
      nodes: [
        {
          id: "gid://shopify/ProductVariant/2007",
          title: "Matte Black",
          inventoryQuantity: 18,
          inventoryItem: { id: "gid://shopify/InventoryItem/3007" },
        },
        {
          id: "gid://shopify/ProductVariant/2008",
          title: "Sand White",
          inventoryQuantity: 2,
          inventoryItem: { id: "gid://shopify/InventoryItem/3008" },
        },
      ],
    },
  },
  {
    id: "gid://shopify/Product/1004",
    title: "Organic Cotton T-Shirt",
    vendor: "EcoWear Ltd",
    variants: {
      nodes: [
        {
          id: "gid://shopify/ProductVariant/2009",
          title: "Sage Green / M",
          inventoryQuantity: 1,
          inventoryItem: { id: "gid://shopify/InventoryItem/3009" },
        },
        {
          id: "gid://shopify/ProductVariant/2010",
          title: "Sage Green / L",
          inventoryQuantity: 22,
          inventoryItem: { id: "gid://shopify/InventoryItem/3010" },
        },
      ],
    },
  },
];

/**
 * Creates a mock Shopify AdminApiContext for testing without an active Shopify store account.
 */
export function createMockAdmin(shop: string = MOCK_SHOP): AdminApiContext {
  return {
    graphql: (async (query: string, options?: { variables?: Record<string, unknown> }) => {
      // 1. Mock getCatalogProducts
      if (query.includes("getCatalogProducts")) {
        return new Response(JSON.stringify({ data: { products: { nodes: MOCK_CATALOG } } }));
      }

      // 2. Mock getVariantByInventoryItemId
      if (query.includes("getVariantByInventoryItemId")) {
        const id = options?.variables?.id as string | undefined;
        for (const p of MOCK_CATALOG) {
          for (const v of p.variants.nodes) {
            if (v.inventoryItem.id === id || (id && v.inventoryItem.id.endsWith(id.split("/").pop()!))) {
              return new Response(
                JSON.stringify({
                  data: {
                    inventoryItem: {
                      id: v.inventoryItem.id,
                      variant: {
                        id: v.id,
                        title: v.title,
                        displayName: `${p.title} - ${v.title}`,
                        product: {
                          id: p.id,
                          title: p.title,
                          vendor: p.vendor,
                        },
                      },
                    },
                  },
                })
              );
            }
          }
        }

        // Fallback demo variant
        return new Response(
          JSON.stringify({
            data: {
              inventoryItem: {
                id: id || "gid://shopify/InventoryItem/3001",
                variant: {
                  id: "gid://shopify/ProductVariant/2001",
                  title: "Black / Small",
                  displayName: "Classic Heavyweight Hoodie - Black / Small",
                  product: {
                    id: "gid://shopify/Product/1001",
                    title: "Classic Heavyweight Hoodie",
                    vendor: "Acme Apparel",
                  },
                },
              },
            },
          })
        );
      }

      // 3. Mock getActiveSubscriptions
      if (query.includes("getActiveSubscriptions")) {
        const store = await prisma.storeSettings.findUnique({ where: { shop } });
        if (store && store.activePlan !== PlanTier.FREE) {
          return new Response(
            JSON.stringify({
              data: {
                currentAppInstallation: {
                  activeSubscriptions: [
                    {
                      id: store.subscriptionChargeId || "gid://shopify/AppSubscription/mock-charge-123",
                      name: `Low Stock Alert - ${store.activePlan}`,
                      status: "ACTIVE",
                      test: true,
                    },
                  ],
                },
              },
            })
          );
        }
        return new Response(
          JSON.stringify({
            data: {
              currentAppInstallation: {
                activeSubscriptions: [],
              },
            },
          })
        );
      }

      // 4. Mock AppSubscriptionCreate
      if (query.includes("AppSubscriptionCreate")) {
        const name = ((options?.variables?.name as string) || "").toUpperCase();
        const returnUrl = (options?.variables?.returnUrl as string) || "/app/pricing";
        let tier: PlanTier = PlanTier.FREE;
        if (name.includes("PRO")) tier = PlanTier.PRO;
        else if (name.includes("STARTER")) tier = PlanTier.STARTER;

        await prisma.storeSettings.upsert({
          where: { shop },
          update: {
            activePlan: tier,
            hasCompletedOnboarding: true,
            subscriptionChargeId: "gid://shopify/AppSubscription/demo-sub-gid",
          },
          create: {
            shop,
            activePlan: tier,
            hasCompletedOnboarding: true,
            subscriptionChargeId: "gid://shopify/AppSubscription/demo-sub-gid",
          },
        });

        const separator = returnUrl.includes("?") ? "&" : "?";
        return new Response(
          JSON.stringify({
            data: {
              appSubscriptionCreate: {
                appSubscription: {
                  id: "gid://shopify/AppSubscription/demo-sub-gid",
                  status: "ACTIVE",
                },
                confirmationUrl: `${returnUrl}${separator}planActivated=${tier}`,
                userErrors: [],
              },
            },
          })
        );
      }

      // 5. Mock AppSubscriptionCancel
      if (query.includes("AppSubscriptionCancel")) {
        await prisma.storeSettings.update({
          where: { shop },
          data: {
            activePlan: PlanTier.FREE,
            subscriptionChargeId: null,
          },
        });

        return new Response(
          JSON.stringify({
            data: {
              appSubscriptionCancel: {
                appSubscription: {
                  id: "gid://shopify/AppSubscription/demo-sub-gid",
                  status: "CANCELLED",
                },
                userErrors: [],
              },
            },
          })
        );
      }

      return new Response(JSON.stringify({ data: {} }));
    }) as unknown as AdminApiContext["graphql"],
    rest: {} as unknown as AdminApiContext["rest"],
  };
}
