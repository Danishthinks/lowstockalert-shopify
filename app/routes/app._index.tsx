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
} from "@shopify/polaris";
import { authenticateAdminWithDevFallback } from "../auth-helper.server";
import prisma from "../db.server";
import { PlanTier } from "../types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminWithDevFallback(request);
  const shop = session.shop;

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
  const isFree = data.activePlan === PlanTier.FREE;

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
      ]}
    >
      <BlockStack gap="500">
        {!data.ownerEmail || data.ownerEmail === "Not configured" ? (
          <Banner
            title="Action Required: Setup Alert Email"
            tone="warning"
            action={{ content: "Configure Email", url: "/app/settings" }}
          >
            <p>Please enter your store owner notification email in Settings to receive alerts when inventory drops.</p>
          </Banner>
        ) : null}

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
                    Manage
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
                <Badge tone="magic">Pro Feature</Badge>
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
