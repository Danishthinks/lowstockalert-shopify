import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import {
  AppProvider,
  Page,
  Layout,
  Card,
  Text,
  Badge,
  Button,
  BlockStack,
  InlineStack,
  Divider,
  List,
  Box,
  TextField,
  Banner,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import { login } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (shop) {
    return redirect(`/app?${url.searchParams.toString()}`);
  }

  return json({});
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  let shop = (formData.get("shop") as string || "").trim();

  if (!shop) {
    return json({ error: "Please enter your Shopify store domain." }, { status: 400 });
  }

  // Clean URL prefixes if entered by merchant
  shop = shop.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!shop.includes(".")) {
    shop = `${shop}.myshopify.com`;
  }

  return redirect(`/auth/login?shop=${encodeURIComponent(shop)}`);
};

export default function LandingAndLoginPage() {
  const [shop, setShop] = useState("");
  const actionData = useActionData<{ error?: string }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <AppProvider i18n={polarisTranslations}>
      <Page narrowWidth>
        <BlockStack gap="600">
          {/* Header & Hero */}
          <Box paddingBlockStart="600" paddingBlockEnd="400">
            <BlockStack gap="300" align="center">
              <InlineStack gap="200" align="center">
                <Text as="h1" variant="heading2xl" fontWeight="bold">
                  Low Stock Alert
                </Text>
                <Badge tone="success">Verified Shopify App</Badge>
              </InlineStack>
              <Text as="p" variant="bodyLg" tone="subdued" alignment="center">
                Automated inventory monitoring, custom low-stock thresholds, and direct supplier Purchase Order (PO) dispatch.
              </Text>
            </BlockStack>
          </Box>

          {/* Login / Installation Card */}
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  Log in or Install on Your Store
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Enter your myshopify.com store address to open the dashboard or install Low Stock Alert.
                </Text>
              </BlockStack>

              {actionData?.error && (
                <Banner tone="critical" title="Invalid Store Domain">
                  <p>{actionData.error}</p>
                </Banner>
              )}

              <Form method="post">
                <BlockStack gap="300">
                  <TextField
                    label="Shopify Store Domain"
                    name="shop"
                    value={shop}
                    onChange={setShop}
                    placeholder="example.myshopify.com"
                    autoComplete="on"
                    helpText="Example: my-store.myshopify.com or my-store"
                  />
                  <Button
                    submit
                    variant="primary"
                    size="large"
                    loading={isSubmitting}
                  >
                    Log In / Install App
                  </Button>
                </BlockStack>
              </Form>
            </BlockStack>
          </Card>

          {/* Key Value Propositions */}
          <Layout>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">⚡ Real-Time Monitoring</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Instant event-driven webhook alerts triggered the exact second an item sells out or drops below minimum thresholds.
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">📦 Automated Supplier POs</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Dual-route alerts directly to supplier vendors with white-label Purchase Order replenishment formatting.
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">🏢 Multi-Location &amp; Analytics</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Track inventory across multiple retail branches and warehouses with frequent stockout prevention insights.
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

          {/* Pricing Overview */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Transparent Subscription Plans</Text>
                <Badge tone="info">No Surprise Fees</Badge>
              </InlineStack>
              <Divider />
              <Layout>
                <Layout.Section variant="oneThird">
                  <BlockStack gap="200">
                    <Text as="h4" variant="headingSm">Free Tier</Text>
                    <Text as="p" variant="headingLg" fontWeight="bold">$0 / month</Text>
                    <List type="bullet">
                      <List.Item>50 monthly email alerts</List.Item>
                      <List.Item>Global stock threshold</List.Item>
                      <List.Item>Store owner notifications</List.Item>
                    </List>
                  </BlockStack>
                </Layout.Section>
                <Layout.Section variant="oneThird">
                  <BlockStack gap="200">
                    <Text as="h4" variant="headingSm">Starter Tier</Text>
                    <Text as="p" variant="headingLg" fontWeight="bold">$9 / month</Text>
                    <List type="bullet">
                      <List.Item>Unlimited email alerts</List.Item>
                      <List.Item>Per-variant threshold overrides</List.Item>
                      <List.Item>Automated vendor PO emails</List.Item>
                      <List.Item>White-label email templates</List.Item>
                    </List>
                  </BlockStack>
                </Layout.Section>
                <Layout.Section variant="oneThird">
                  <BlockStack gap="200">
                    <Text as="h4" variant="headingSm">Pro Tier</Text>
                    <Text as="p" variant="headingLg" fontWeight="bold">$29 / month</Text>
                    <List type="bullet">
                      <List.Item>Everything in Starter</List.Item>
                      <List.Item>Multi-location fulfillment tracking</List.Item>
                      <List.Item>Frequent stockout analytics</List.Item>
                      <List.Item>Priority email delivery</List.Item>
                    </List>
                  </BlockStack>
                </Layout.Section>
              </Layout>
            </BlockStack>
          </Card>

          {/* Footer */}
          <Box paddingBlockEnd="600">
            <InlineStack align="center" gap="400">
              <Text as="span" variant="bodySm" tone="subdued">
                © {new Date().getFullYear()} Low Stock Alert. Powered by Shopify Remix &amp; Polaris.
              </Text>
            </InlineStack>
          </Box>
        </BlockStack>
      </Page>
    </AppProvider>
  );
}
