import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation, useSubmit, Form, Link } from "@remix-run/react";
import {
  AppProvider,
  Page,
  Layout,
  Card,
  Text,
  Badge,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Divider,
  List,
  Box,
  TextField,
  Select,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import prisma from "../db.server";
import { PLANS } from "../services/billing.server";
import { sendLowStockAlert } from "../services/email.server";
import { PlanTier } from "../types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (shop) {
    return redirect(`/app?${url.searchParams.toString()}`);
  }

  // Fetch local dev stats
  const totalStores = await prisma.storeSettings.count();
  const totalAlerts = await prisma.alertHistory.count();
  const recentAlerts = await prisma.alertHistory.findMany({
    take: 8,
    orderBy: { sentAt: "desc" },
  });

  const demoStore = await prisma.storeSettings.findUnique({
    where: { shop: "demo-store.myshopify.com" },
  });

  return json({
    totalStores,
    totalAlerts,
    currentDemoPlan: (demoStore?.activePlan as PlanTier) || PlanTier.FREE,
    plans: PLANS,
    recentAlerts: recentAlerts.map((a) => ({
      id: a.id,
      productTitle: a.productTitle || "Demo Item",
      variantTitle: a.variantTitle || "",
      stockLevel: a.stockLevel,
      threshold: a.threshold,
      tier: a.tier,
      status: a.status,
      recipients: a.recipientEmails ? a.recipientEmails.split(",") : [],
      sentAt: a.sentAt.toISOString(),
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "SIMULATE_ALERT") {
    try {
      const tier = (String(formData.get("tier") || "STARTER") as PlanTier);
      const productName = String(formData.get("productName") || "Premium Heavyweight Hoodie");
      const variantName = String(formData.get("variantName") || "Black / Large");
      const vendorName = String(formData.get("vendorName") || "Acme Apparel");
      const stock = parseInt(String(formData.get("stock") || "2"), 10);
      const threshold = parseInt(String(formData.get("threshold") || "5"), 10);
      const ownerEmail = String(formData.get("ownerEmail") || "smartstock779@gmail.com");
      const vendorEmail = String(formData.get("vendorEmail") || "smartstock779@gmail.com");
      const locationName = String(formData.get("locationName") || "Main Fulfillment Warehouse");

      const isPaid = tier === PlanTier.STARTER || tier === PlanTier.PRO;
      const effectiveVendorEmail = isPaid && vendorEmail ? vendorEmail : null;

      const result = await sendLowStockAlert({
        productName,
        variantName,
        remainingStock: stock,
        threshold,
        ownerEmail,
        vendorEmail: effectiveVendorEmail,
        vendorName,
        tier,
        locationName: tier === PlanTier.PRO ? locationName : undefined,
      });

      const recipients = [ownerEmail];
      if (effectiveVendorEmail) {
        recipients.push(effectiveVendorEmail);
      }

      await prisma.alertHistory.create({
        data: {
          shop: "demo-store.myshopify.com",
          productId: "gid://shopify/Product/1001",
          variantId: "gid://shopify/ProductVariant/2003",
          productTitle: productName,
          variantTitle: variantName,
          stockLevel: stock,
          threshold,
          recipientEmails: recipients.join(","),
          tier,
          status: result.success ? "SENT" : "FAILED",
        },
      });

      // Sync StoreSettings active plan so the app views reflect this tier
      await prisma.storeSettings.upsert({
        where: { shop: "demo-store.myshopify.com" },
        update: { activePlan: tier, ownerEmail },
        create: { shop: "demo-store.myshopify.com", activePlan: tier, ownerEmail },
      });

      return json({
        simulated: true,
        productName,
        variantName,
        stock,
        threshold,
        tier,
        ownerEmail,
        vendorEmail: effectiveVendorEmail,
        vendorName,
        previewUrl: result.previewUrl,
        vendorPreviewUrl: result.vendorPreviewUrl,
        notice: result.notice,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return json({
        simulated: false,
        error: errorMessage,
      });
    }
  }

  const shop = String(formData.get("shop") || "").trim();
  if (shop) {
    const sanitized = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return redirect(`/auth?shop=${sanitized}`);
  }

  return json({ error: "Please enter a valid shop domain." });
};

export default function Index() {
  const { totalStores, totalAlerts, currentDemoPlan, plans, recentAlerts } = useLoaderData<typeof loader>();
  const actionData = useActionData<{
    simulated?: boolean;
    productName?: string;
    variantName?: string;
    stock?: number;
    threshold?: number;
    tier?: PlanTier;
    ownerEmail?: string;
    vendorEmail?: string | null;
    vendorName?: string;
    previewUrl?: string | null;
    vendorPreviewUrl?: string | null;
    notice?: string;
    error?: string;
  }>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [shopDomain, setShopDomain] = useState("");
  const [selectedTier, setSelectedTier] = useState<string>(currentDemoPlan || PlanTier.STARTER);
  const [productName, setProductName] = useState("Premium Heavyweight Hoodie");
  const [variantName, setVariantName] = useState("Black / Large");
  const [vendorName, setVendorName] = useState("Acme Apparel");
  const [stock, setStock] = useState("2");
  const [threshold, setThreshold] = useState("5");
  const [ownerEmail, setOwnerEmail] = useState("smartstock779@gmail.com");
  const [vendorEmail, setVendorEmail] = useState("smartstock779@gmail.com");
  const [locationName, setLocationName] = useState("Chicago Warehouse - Bay 4");

  const isSubmitting = navigation.state === "submitting";

  const handleSimulate = () => {
    const formData = new FormData();
    formData.append("intent", "SIMULATE_ALERT");
    formData.append("tier", selectedTier);
    formData.append("productName", productName);
    formData.append("variantName", variantName);
    formData.append("vendorName", vendorName);
    formData.append("stock", stock);
    formData.append("threshold", threshold);
    formData.append("ownerEmail", ownerEmail);
    formData.append("vendorEmail", vendorEmail);
    formData.append("locationName", locationName);
    submit(formData, { method: "POST" });
  };

  const isPaid = selectedTier === PlanTier.STARTER || selectedTier === PlanTier.PRO;
  const isPro = selectedTier === PlanTier.PRO;

  return (
    <AppProvider i18n={polarisTranslations}>
      <Page
        title="Low-Stock Alert App"
        subtitle="Event-Driven Inventory Monitoring for Shopify (Antigravity Architecture)"
        primaryAction={{
          content: "Open Live App",
          url: "/app",
        }}
      >
        <BlockStack gap="500">
          {actionData?.error && (
            <Banner title="Simulation Dispatch Failed" tone="critical">
              <p>{actionData.error}</p>
            </Banner>
          )}

          {actionData?.notice && (
            <Banner title="Resend Sandbox Notice" tone="info">
              <p>{actionData.notice}</p>
            </Banner>
          )}

          {actionData?.simulated && (
            <Banner
              title={`Simulation Dispatched (${actionData.tier} Tier)`}
              tone="success"
            >
              <BlockStack gap="300">
                <p>
                  Dispatched low-stock event for <strong>{actionData.productName}</strong> (
                  {actionData.variantName}). Stock is <strong>{actionData.stock} units</strong> (Threshold:{" "}
                  <strong>&le; {actionData.threshold}</strong>).
                </p>

                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="200">
                    <Text as="p" fontWeight="bold">
                      Dispatched Notifications:
                    </Text>

                    {/* Email 1: Store Owner */}
                    <InlineStack gap="300" blockAlign="center">
                      <Badge tone="info">Store Owner</Badge>
                      <Text as="span">{actionData.ownerEmail}</Text>
                      {actionData.previewUrl ? (
                        <Button
                          size="micro"
                          url={actionData.previewUrl}
                          target="_blank"
                          variant="primary"
                        >
                          Open Owner Email Preview &rarr;
                        </Button>
                      ) : null}
                    </InlineStack>

                    {/* Email 2: Vendor Routing */}
                    <InlineStack gap="300" blockAlign="center">
                      <Badge tone={actionData.vendorEmail ? "success" : "attention"}>
                        Vendor Routing
                      </Badge>
                      {actionData.vendorEmail ? (
                        <>
                          <Text as="span">
                            {actionData.vendorEmail} ({actionData.vendorName})
                          </Text>
                          {actionData.vendorPreviewUrl ? (
                            <Button
                              size="micro"
                              url={actionData.vendorPreviewUrl}
                              target="_blank"
                              variant="primary"
                              tone="success"
                            >
                              Open Vendor PO Re-order Preview &rarr;
                            </Button>
                          ) : null}
                        </>
                      ) : (
                        <Text as="span" tone="subdued">
                          Not routed to vendor (Free Tier policy: Store owner only). Upgrade to Starter to unlock.
                        </Text>
                      )}
                    </InlineStack>
                  </BlockStack>
                </Box>

                <InlineStack gap="300">
                  <Button url="/app" size="slim">
                    View Updated Dashboard &rarr;
                  </Button>
                  <Button url="/app/products" size="slim">
                    View Product Overrides Table &rarr;
                  </Button>
                </InlineStack>
              </BlockStack>
            </Banner>
          )}

          {/* Quick Connect & Architecture Status */}
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Standalone Interactive Testing Portal
                    </Text>
                    <Badge tone="success">Engine Online &amp; Ready</Badge>
                  </InlineStack>

                  <Text as="p" tone="subdued">
                    You can test the entire app locally without a Shopify account. Use the live simulator below to test automated vendor routing across Free, Starter ($9/mo), and Pro ($29/mo) plans.
                  </Text>

                  <InlineStack gap="300">
                    <Button url="/app" variant="primary">
                      Open Dashboard
                    </Button>
                    <Button url="/app/products">
                      Product Overrides (IndexTable)
                    </Button>
                    <Button url="/app/settings">
                      Store Settings
                    </Button>
                    <Button url="/app/pricing">
                      Billing &amp; Tiers
                    </Button>
                  </InlineStack>

                  <Divider />

                  <InlineStack gap="600">
                    <div>
                      <Text as="p" tone="subdued" variant="bodySm">
                        Framework
                      </Text>
                      <Text as="p" fontWeight="bold">
                        Shopify Remix + Vite
                      </Text>
                    </div>
                    <div>
                      <Text as="p" tone="subdued" variant="bodySm">
                        UI System
                      </Text>
                      <Text as="p" fontWeight="bold">
                        Shopify Polaris (Latest)
                      </Text>
                    </div>
                    <div>
                      <Text as="p" tone="subdued" variant="bodySm">
                        Database Engine
                      </Text>
                      <Text as="p" fontWeight="bold">
                        Prisma (SQLite &amp; PostgreSQL)
                      </Text>
                    </div>
                    <div>
                      <Text as="p" tone="subdued" variant="bodySm">
                        Webhooks
                      </Text>
                      <Text as="p" fontWeight="bold">
                        inventory_levels/update
                      </Text>
                    </div>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    Live Engine Stats
                  </Text>
                  <Divider />
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      Active Demo Plan:
                    </Text>
                    <Badge tone="info">{currentDemoPlan}</Badge>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      Total Alerts Dispatched:
                    </Text>
                    <Text as="span" fontWeight="bold">
                      {totalAlerts}
                    </Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      Webhook Listener:
                    </Text>
                    <Badge tone="success">/webhooks (Active)</Badge>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

          {/* Interactive Webhook Simulator with Multi-Tier and Vendor Routing */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="050">
                  <Text as="h2" variant="headingMd">
                    Live Webhook Event Simulator (Multi-Tier &amp; Automated Vendor Routing)
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Simulate how the event-driven webhook dispatches emails and enforces tier features.
                  </Text>
                </BlockStack>
                <Badge tone="magic">Interactive Testing</Badge>
              </InlineStack>

              <Divider />

              <BlockStack gap="400">
                {/* Tier Selector */}
                <Select
                  label="Select Subscription Plan Tier to Test"
                  options={[
                    {
                      label: "Free Tier ($0/mo) — Store Owner Only, Watermark Included, 50 Alert Cap",
                      value: PlanTier.FREE,
                    },
                    {
                      label: "Starter Tier ($9/mo) — Automated Vendor Routing (Owner + Vendor Dual Routing), Unlimited",
                      value: PlanTier.STARTER,
                    },
                    {
                      label: "Pro Tier ($29/mo) — Vendor Routing + Multi-Location Fulfillment + Analytics",
                      value: PlanTier.PRO,
                    },
                  ]}
                  value={selectedTier}
                  onChange={setSelectedTier}
                  helpText={
                    selectedTier === PlanTier.FREE
                      ? "Free Tier will send ONLY to the store owner with the Antigravity footer watermark."
                      : "Starter and Pro tiers will automatically dispatch 2 distinct emails: one to the store owner and one directly to the vendor."
                  }
                />

                {/* Product & Stock details */}
                <Layout>
                  <Layout.Section variant="oneHalf">
                    <TextField
                      label="Product Name"
                      value={productName}
                      onChange={setProductName}
                      autoComplete="off"
                    />
                  </Layout.Section>

                  <Layout.Section variant="oneHalf">
                    <TextField
                      label="Variant Title"
                      value={variantName}
                      onChange={setVariantName}
                      autoComplete="off"
                    />
                  </Layout.Section>

                  <Layout.Section variant="oneHalf">
                    <TextField
                      label="Remaining Available Stock"
                      type="number"
                      value={stock}
                      onChange={setStock}
                      helpText="Must be &le; threshold to trigger an alert"
                      autoComplete="off"
                    />
                  </Layout.Section>

                  <Layout.Section variant="oneHalf">
                    <TextField
                      label="Alert Threshold"
                      type="number"
                      value={threshold}
                      onChange={setThreshold}
                      autoComplete="off"
                    />
                  </Layout.Section>

                  <Layout.Section variant="oneHalf">
                    <TextField
                      label="Store Owner Email"
                      type="email"
                      value={ownerEmail}
                      onChange={setOwnerEmail}
                      helpText="Resend's free test domain delivers directly to your registered account (smartstock779@gmail.com)"
                      autoComplete="email"
                    />
                  </Layout.Section>

                  <Layout.Section variant="oneHalf">
                    <TextField
                      label={`Vendor Direct Email ${!isPaid ? "(Locked on Free Tier)" : "(Automated Routing)"}`}
                      type="email"
                      value={vendorEmail}
                      onChange={setVendorEmail}
                      disabled={!isPaid}
                      helpText={
                        !isPaid
                          ? "On Free tier, emails are sent to Store Owner only. Upgrade to Starter/Pro to enable automated vendor re-orders."
                          : "Set to smartstock779@gmail.com for live delivery, or any address to generate a live web preview link."
                      }
                      autoComplete="email"
                    />
                  </Layout.Section>

                  <Layout.Section variant="oneHalf">
                    <TextField
                      label="Vendor Brand Name"
                      value={vendorName}
                      onChange={setVendorName}
                      disabled={!isPaid}
                      autoComplete="off"
                    />
                  </Layout.Section>

                  {isPro && (
                    <Layout.Section variant="oneHalf">
                      <TextField
                        label="Fulfillment Location (Pro Tier Feature)"
                        value={locationName}
                        onChange={setLocationName}
                        helpText="Multi-location inventory tracking attaches this fulfillment center to the alert."
                        autoComplete="off"
                      />
                    </Layout.Section>
                  )}
                </Layout>

                <InlineStack align="end">
                  <Button
                    variant="primary"
                    tone="critical"
                    size="large"
                    loading={isSubmitting}
                    onClick={handleSimulate}
                  >
                    Trigger Automated Low-Stock Drop
                  </Button>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>

          {/* Pricing Tiers Overview */}
          <BlockStack gap="300">
            <Text as="h2" variant="headingLg">
              Supported Pricing Tiers &amp; Capabilities
            </Text>
            <Layout>
              {[PlanTier.FREE, PlanTier.STARTER, PlanTier.PRO].map((key) => {
                const plan = plans[key];
                return (
                  <Layout.Section variant="oneThird" key={key}>
                    <Card>
                      <BlockStack gap="300">
                        <InlineStack align="space-between">
                          <Text as="h3" variant="headingMd">
                            {plan.title}
                          </Text>
                          <Badge tone={key === PlanTier.FREE ? "info" : "success"}>
                            {`$${plan.price}/mo`}
                          </Badge>
                        </InlineStack>
                        <Text as="p" tone="subdued" variant="bodySm">
                          {plan.description}
                        </Text>
                        <Divider />
                        <List type="bullet">
                          {plan.features.map((f, i) => (
                            <List.Item key={i}>{f}</List.Item>
                          ))}
                        </List>
                      </BlockStack>
                    </Card>
                  </Layout.Section>
                );
              })}
            </Layout>
          </BlockStack>

          {/* Recent Alert Audit Table */}
          {recentAlerts.length > 0 && (
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Recent Dispatched Alert Ledger
                </Text>
                <Divider />
                <BlockStack gap="200">
                  {recentAlerts.map((alert) => (
                    <Box key={alert.id} padding="200" background="bg-surface-secondary" borderRadius="200">
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="200">
                          <Badge tone={alert.stockLevel <= 0 ? "critical" : "warning"}>
                            {`${alert.stockLevel} left`}
                          </Badge>
                          <Text as="span" fontWeight="bold">
                            {alert.productTitle} {alert.variantTitle ? `(${alert.variantTitle})` : ""}
                          </Text>
                        </InlineStack>
                        <InlineStack gap="300" blockAlign="center">
                          <Badge tone="info">{`Tier: ${alert.tier}`}</Badge>
                          <Badge tone={alert.status === "SENT" ? "success" : "critical"}>
                            {alert.status}
                          </Badge>
                          <Text as="span" variant="bodyXs" tone="subdued">
                            Recipients: {alert.recipients.join(" & ") || "Owner"}
                          </Text>
                        </InlineStack>
                      </InlineStack>
                    </Box>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          )}
        </BlockStack>
      </Page>
    </AppProvider>
  );
}
