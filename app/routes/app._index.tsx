import { useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  IndexTable,
  Box,
  Divider,
  List,
} from "@shopify/polaris";
import { authenticateAdminWithDevFallback } from "../auth-helper.server";
import prisma from "../db.server";
import { PlanTier } from "../types";
import { syncStoreSubscription } from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticateAdminWithDevFallback(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const welcome = url.searchParams.get("welcome");

  const chargeId = url.searchParams.get("charge_id");

  // Sync subscription if returning from upgrade
  if (welcome === "upgraded" || chargeId) {
    await syncStoreSubscription({ admin, shop });
    await prisma.storeSettings.updateMany({
      where: { shop },
      data: { hasCompletedOnboarding: true },
    });
  }

  const store = await prisma.storeSettings.findUnique({
    where: { shop },
  });

  const recentAlerts = await prisma.alertHistory.findMany({
    where: { shop },
    orderBy: { sentAt: "desc" },
    take: 10,
  });

  // Pro Tier Analytics: Top frequently triggered low-stock items
  let topStockouts: Array<{ productId: string; productTitle: string; count: number }> = [];

  if (store?.activePlan === PlanTier.PRO) {
    const stockoutAggregates = await prisma.alertHistory.groupBy({
      by: ["productId", "productTitle"],
      where: { shop },
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: "desc",
        },
      },
      take: 5,
    });

    topStockouts = stockoutAggregates.map((item) => ({
      productId: item.productId,
      productTitle: item.productTitle || "Unknown Product",
      count: item._count.id,
    }));
  }

  const customThresholdCount = await prisma.productThreshold.count({
    where: { shop },
  });

  return json({
    shop,
    activePlan: store?.activePlan || PlanTier.FREE,
    ownerEmail: store?.ownerEmail || "Not configured",
    globalThreshold: store?.globalThreshold ?? 5,
    alertCountThisMonth: store?.alertCountThisMonth ?? 0,
    customThresholdCount,
    welcome,
    recentAlerts: recentAlerts.map((a) => ({
      id: a.id,
      productTitle: a.productTitle || "Item",
      variantTitle: a.variantTitle || "",
      stockLevel: a.stockLevel,
      threshold: a.threshold,
      sentAt: a.sentAt.toISOString(),
      status: a.status,
      recipients: a.recipientEmails ? a.recipientEmails.split(",") : [],
    })),
    topStockouts,
  });
};

export default function DashboardIndex() {
  const data = useLoaderData<typeof loader>();
  const isPro = data.activePlan === PlanTier.PRO;
  const isPaid = data.activePlan === PlanTier.STARTER || data.activePlan === PlanTier.PRO;
  const isFree = data.activePlan === PlanTier.FREE;

  const [guideDismissed, setGuideDismissed] = useState(false);

  return (
    <Page
      title="Inventory Health Dashboard"
      subtitle={`Connected to ${data.shop}`}
      primaryAction={{
        content: "Configure Overrides",
        url: "/app/products",
      }}
      secondaryActions={[
        {
          content: "Store Settings",
          url: "/app/settings",
        },
        {
          content: "Plans & Billing",
          url: "/app/pricing",
        },
      ]}
    >
      <BlockStack gap="500">
        {/* Welcome Celebration Banners */}
        {data.welcome === "free" && !guideDismissed && (
          <Banner
            title="🎉 Welcome to Low Stock Alert! (Free Plan Active)"
            tone="success"
            onDismiss={() => setGuideDismissed(true)}
          >
            <p>
              Your store is now set up on the <strong>Free Tier</strong> (50 free alert emails per month).
              Follow the 3-step Quick Start Guide below to configure your alert email and thresholds in under 2 minutes!
            </p>
          </Banner>
        )}

        {data.welcome === "upgraded" && !guideDismissed && (
          <Banner
            title={`⭐ Welcome to the ${data.activePlan} Tier!`}
            tone="success"
            onDismiss={() => setGuideDismissed(true)}
          >
            <p>
              Your subscription upgrade was successful! Your store now has access to all {data.activePlan} features. Check out your unlocked features guide below.
            </p>
          </Banner>
        )}

        {/* Action Required: Email Warning */}
        {(!data.ownerEmail || data.ownerEmail === "Not configured") && (
          <Banner
            title="Action Required: Setup Alert Email"
            tone="warning"
            action={{ content: "Configure Email", url: "/app/settings" }}
          >
            <p>Please enter your store owner notification email in Settings to receive alerts when inventory drops.</p>
          </Banner>
        )}

        {/* Quick Start Guide (Simple Words for All Merchants) */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  📖 Quick Start Guide: How to Use Low Stock Alert
                </Text>
                <Badge tone="info">Simple 3-Step Setup</Badge>
              </InlineStack>
            </InlineStack>
            <Divider />

            <Layout>
              <Layout.Section variant="oneThird">
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm" fontWeight="bold">
                    1️⃣ Set Alert Email &amp; Threshold
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Go to <strong><Link to="/app/settings">Store Settings</Link></strong> and enter your email address. Then set your default minimum stock level (e.g. alert me when any item drops to 5 or fewer units).
                  </Text>
                </BlockStack>
              </Layout.Section>

              <Layout.Section variant="oneThird">
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm" fontWeight="bold">
                    2️⃣ Customize Products &amp; Vendors
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Open <strong><Link to="/app/products">Product Thresholds</Link></strong> to view your catalog. You can set specific custom thresholds for fast-selling items, or add vendor emails for automated restock orders.
                  </Text>
                </BlockStack>
              </Layout.Section>

              <Layout.Section variant="oneThird">
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm" fontWeight="bold">
                    3️⃣ Automatic 24/7 Monitoring
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    You don't need to keep the app open! Whenever an item sells on your Shopify store, our system detects it in real-time and immediately sends an alert email before you run out of stock.
                  </Text>
                </BlockStack>
              </Layout.Section>
            </Layout>
          </BlockStack>
        </Card>

        {/* Unlocked Features Guide for Starter & Pro Merchants */}
        {isPaid && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    🚀 {data.activePlan} Tier Unlocked Superpowers
                  </Text>
                  <Badge tone="success">Active Plan</Badge>
                </InlineStack>
              </InlineStack>
              <Divider />

              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">
                  Your store is running on the <strong>{data.activePlan} Plan</strong>. Here is how to use your unlocked features:
                </Text>

                <List type="bullet">
                  <List.Item>
                    <strong>Automated Vendor Purchase Orders (PO):</strong> In the{" "}
                    <strong><Link to="/app/products">Product Thresholds</Link></strong> tab, click "Edit" on any product and enter your supplier/vendor's email address. When that product reaches low stock, an automated Purchase Order email is sent directly to your vendor to replenish inventory!
                  </List.Item>
                  <List.Item>
                    <strong>Unlimited Monthly Alerts:</strong> Your alerts are never capped or restricted. All stock changes are delivered instantly 24/7.
                  </List.Item>
                  <List.Item>
                    <strong>Clean White-Label Emails:</strong> Your alert emails are sent with clean, professional formatting without any promotional watermarks.
                  </List.Item>
                  {isPro && (
                    <>
                      <List.Item>
                        <strong>Multi-Location Inventory Tracking:</strong> Stock is tracked across all your physical store locations and warehouses independently so you know exactly which branch needs restocking.
                      </List.Item>
                      <List.Item>
                        <strong>Frequent Stockout Analytics:</strong> The analytics panel below shows you which items run out of stock most frequently so you can optimize reordering schedules.
                      </List.Item>
                    </>
                  )}
                </List>
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        {/* Metric Summary Cards */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">
                  Active Subscription
                </Text>
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {data.activePlan}
                  </Text>
                  <Button url="/app/pricing" size="slim">
                    Manage Plan
                  </Button>
                </InlineStack>
                <Text as="p" variant="bodyXs" tone="subdued">
                  {isFree ? `${data.alertCountThisMonth} / 50 alerts sent this month` : "Unlimited alert volume"}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">
                  Global Alert Threshold
                </Text>
                <Text as="p" variant="headingLg" fontWeight="bold">
                  &le; {data.globalThreshold} units
                </Text>
                <Text as="p" variant="bodyXs" tone="subdued">
                  Applies to all catalog items without overrides
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">
                  Custom Variant Rules
                </Text>
                <Text as="p" variant="headingLg" fontWeight="bold">
                  {data.customThresholdCount} active
                </Text>
                <Text as="p" variant="bodyXs" tone="subdued">
                  {isFree ? "Locked on Free Tier" : "Automated vendor routing enabled"}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Pro Analytics: Most Frequently Out-of-Stock Items */}
        {isPro ? (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="050">
                  <Text as="h2" variant="headingMd">
                    Pro Analytics: Frequent Stockout Items
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Catalog items with the highest frequency of inventory depletion alerts.
                  </Text>
                </BlockStack>
                <Badge tone="magic">Pro Feature Active</Badge>
              </InlineStack>

              <Divider />

              {data.topStockouts.length > 0 ? (
                <IndexTable
                  resourceName={{ singular: "product", plural: "products" }}
                  itemCount={data.topStockouts.length}
                  headings={[{ title: "Product Title" }, { title: "Alert Count (Stockouts)" }]}
                  selectable={false}
                >
                  {data.topStockouts.map((item, idx) => (
                    <IndexTable.Row id={item.productId} key={item.productId} position={idx}>
                      <IndexTable.Cell>
                        <Text variant="bodyMd" fontWeight="semibold" as="span">
                          {item.productTitle}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge tone="critical">{`${item.count} alerts triggered`}</Badge>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              ) : (
                <Box padding="300">
                  <Text as="p" tone="subdued">
                    No repeated stockout events recorded yet in this cycle.
                  </Text>
                </Box>
              )}
            </BlockStack>
          </Card>
        ) : (
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Stockout Frequency Analytics
                </Text>
                <Badge tone="info">Available on Pro</Badge>
              </InlineStack>
              <Text as="p" tone="subdued">
                Gain real-time business intelligence into which catalog items suffer from recurring supply chain stockouts.
              </Text>
              <Box paddingBlockStart="200">
                <Button url="/app/pricing">Upgrade to Pro ($29/mo)</Button>
              </Box>
            </BlockStack>
          </Card>
        )}

        {/* Recent Alerts Feed */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Recent Inventory Alerts
            </Text>
            <Divider />

            {data.recentAlerts.length > 0 ? (
              <IndexTable
                resourceName={{ singular: "alert", plural: "alerts" }}
                itemCount={data.recentAlerts.length}
                headings={[
                  { title: "Item" },
                  { title: "Stock Level" },
                  { title: "Threshold" },
                  { title: "Recipients" },
                  { title: "Status" },
                  { title: "Timestamp" },
                ]}
                selectable={false}
              >
                {data.recentAlerts.map((alert, idx) => (
                  <IndexTable.Row id={alert.id} key={alert.id} position={idx}>
                    <IndexTable.Cell>
                      <Text variant="bodyMd" fontWeight="semibold" as="span">
                        {alert.productTitle} {alert.variantTitle ? `(${alert.variantTitle})` : ""}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={alert.stockLevel <= 0 ? "critical" : "warning"}>
                        {`${alert.stockLevel} units`}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span">&le; {alert.threshold}</Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm">
                        {alert.recipients.join(", ") || "None"}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={alert.status === "SENT" ? "success" : "critical"}>
                        {alert.status}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {new Date(alert.sentAt).toLocaleString()}
                      </Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            ) : (
              <Box padding="300">
                <Text as="p" tone="subdued">
                  No inventory alerts have been triggered yet. All stocks are healthy!
                </Text>
              </Box>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
