import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError, useLocation } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider as ShopifyAppProvider } from "@shopify/shopify-app-remix/react";
import {
  AppProvider as PolarisAppProvider,
  Box,
  InlineStack,
  Text,
  Badge,
  Button,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticateAdminWithDevFallback } from "../auth-helper.server";
import prisma from "../db.server";
import { syncStoreSubscription } from "../services/billing.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { isMock, session, admin } = await authenticateAdminWithDevFallback(request);
  const url = new URL(request.url);
  const welcome = url.searchParams.get("welcome");
  const chargeId = url.searchParams.get("charge_id");

  // If returning from Shopify subscription approval, immediately sync charge & mark onboarding complete
  if (welcome === "upgraded" || chargeId) {
    try {
      await syncStoreSubscription({ admin, shop: session.shop });
    } catch (err) {
      console.warn("[App Loader] syncStoreSubscription error:", err);
    }
    await prisma.storeSettings.updateMany({
      where: { shop: session.shop },
      data: { hasCompletedOnboarding: true },
    });
  }

  // If first-time merchant install, route to plan selection onboarding
  const store = await prisma.storeSettings.findUnique({
    where: { shop: session.shop },
  });

  if (store && !store.hasCompletedOnboarding && !url.pathname.includes("/app/pricing")) {
    return redirect(`/app/pricing?onboarding=true`);
  }

  return json({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    isMock,
    shop: session.shop,
  });
};

export default function App() {
  const { apiKey, isMock, shop } = useLoaderData<typeof loader>();
  const location = useLocation();

  if (isMock) {
    return (
      <PolarisAppProvider i18n={polarisTranslations}>
        {/* Standalone Browser Navigation Bar for testing without a Shopify account */}
        <Box
          padding="300"
          background="bg-surface-secondary"
          borderBlockEndWidth="025"
          borderColor="border"
        >
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="300" blockAlign="center">
              <Text as="span" fontWeight="bold" variant="bodyMd">
                Low-Stock Monitor
              </Text>
              <Badge tone="info">{`Shop: ${shop}`}</Badge>
              <Badge tone="attention">Standalone Preview Mode</Badge>
            </InlineStack>

            <InlineStack gap="200">
              <Button
                url="/app"
                variant={location.pathname === "/app" ? "primary" : "tertiary"}
              >
                Dashboard
              </Button>
              <Button
                url="/app/products"
                variant={location.pathname.startsWith("/app/products") ? "primary" : "tertiary"}
              >
                Products &amp; Thresholds
              </Button>
              <Button
                url="/app/settings"
                variant={location.pathname.startsWith("/app/settings") ? "primary" : "tertiary"}
              >
                Settings
              </Button>
              <Button
                url="/app/pricing"
                variant={location.pathname.startsWith("/app/pricing") ? "primary" : "tertiary"}
              >
                Plans &amp; Billing
              </Button>
            </InlineStack>
          </InlineStack>
        </Box>
        <Box padding="400">
          <Outlet />
        </Box>
      </PolarisAppProvider>
    );
  }

  return (
    <ShopifyAppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Dashboard</Link>
        <Link to="/app/products">Product Thresholds</Link>
        <Link to="/app/settings">Store Settings</Link>
        <Link to="/app/pricing">Plans &amp; Billing</Link>
      </NavMenu>
      <Box
        padding="300"
        background="bg-surface-secondary"
        borderBlockEndWidth="025"
        borderColor="border"
      >
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="300" blockAlign="center">
            <Text as="span" fontWeight="bold" variant="bodyMd">
              Low-Stock Alert
            </Text>
            <Badge tone="success">Engine: Active</Badge>
          </InlineStack>

          <InlineStack gap="200">
            <Button
              url="/app"
              variant={location.pathname === "/app" ? "primary" : "tertiary"}
            >
              📊 Dashboard
            </Button>
            <Button
              url="/app/products"
              variant={location.pathname.startsWith("/app/products") ? "primary" : "tertiary"}
            >
              📦 Product Thresholds
            </Button>
            <Button
              url="/app/settings"
              variant={location.pathname.startsWith("/app/settings") ? "primary" : "tertiary"}
            >
              ⚙️ Settings
            </Button>
            <Button
              url="/app/pricing"
              variant={location.pathname.startsWith("/app/pricing") ? "primary" : "tertiary"}
            >
              💳 Plans &amp; Billing
            </Button>
          </InlineStack>
        </InlineStack>
      </Box>
      <Outlet />
    </ShopifyAppProvider>
  );
}

// Error boundary for standard Shopify Remix app error formatting
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
