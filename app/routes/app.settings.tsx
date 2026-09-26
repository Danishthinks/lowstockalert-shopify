import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Button,
  Banner,
  ProgressBar,
  Text,
  Badge,
  InlineStack,
  BlockStack,
  Box,
  Divider,
} from "@shopify/polaris";
import { authenticateAdminWithDevFallback } from "../auth-helper.server";
import prisma from "../db.server";
import { PlanTier } from "../types";

interface ActionResponse {
  success?: boolean;
  errors?: {
    ownerEmail?: string;
    globalThreshold?: string;
    general?: string;
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminWithDevFallback(request);
  const shop = session.shop;

  let store = await prisma.storeSettings.findUnique({
    where: { shop },
  });

  if (!store) {
    store = await prisma.storeSettings.create({
      data: {
        shop,
        ownerEmail: "",
        globalThreshold: 5,
        activePlan: PlanTier.FREE,
      },
    });
  }

  return json({
    shop: store.shop,
    ownerEmail: store.ownerEmail || "",
    globalThreshold: store.globalThreshold,
    activePlan: store.activePlan,
    alertCountThisMonth: store.alertCountThisMonth,
    maxFreeAlerts: 50,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminWithDevFallback(request);
  const shop = session.shop;
  const formData = await request.formData();

  const ownerEmail = String(formData.get("ownerEmail") || "").trim();
  const rawGlobalThreshold = String(formData.get("globalThreshold") || "").trim();
  const globalThreshold = parseInt(rawGlobalThreshold, 10);

  const errors: Record<string, string> = {};

  if (!ownerEmail || !ownerEmail.includes("@")) {
    errors.ownerEmail = "Please enter a valid owner email address.";
  }

  if (isNaN(globalThreshold) || globalThreshold < 0) {
    errors.globalThreshold = "Global threshold must be a non-negative number.";
  }

  if (Object.keys(errors).length > 0) {
    return json<ActionResponse>({ errors }, { status: 400 });
  }

  await prisma.storeSettings.update({
    where: { shop },
    data: {
      ownerEmail,
      globalThreshold,
    },
  });

  return json<ActionResponse>({ success: true });
};

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResponse>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [ownerEmail, setOwnerEmail] = useState(data.ownerEmail);
  const [globalThreshold, setGlobalThreshold] = useState(String(data.globalThreshold));

  const isSubmitting = navigation.state === "submitting";
  const isFreePlan = data.activePlan === PlanTier.FREE;
  const quotaPercentage = isFreePlan
    ? Math.min(100, Math.round((data.alertCountThisMonth / data.maxFreeAlerts) * 100))
    : 0;

  const handleSubmit = () => {
    const formData = new FormData();
    formData.append("ownerEmail", ownerEmail);
    formData.append("globalThreshold", globalThreshold);
    submit(formData, { method: "POST" });
  };

  return (
    <Page title="Store Settings" subtitle="Configure notification thresholds and alert recipients.">
      <BlockStack gap="500">
        {actionData?.success && (
          <Banner title="Settings saved successfully" tone="success" onDismiss={() => {}} />
        )}

        {actionData?.errors?.general && (
          <Banner title="Configuration error" tone="critical">
            <p>{actionData.errors.general}</p>
          </Banner>
        )}

        <Layout>
          {/* Main Configuration Card */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Alert Configuration
                </Text>
                <Text as="p" tone="subdued">
                  Set the primary destination for low-stock warnings and the default stock threshold applied across your entire catalog.
                </Text>

                <FormLayout>
                  <TextField
                    label="Store Owner Notification Email"
                    type="email"
                    value={ownerEmail}
                    onChange={setOwnerEmail}
                    error={actionData?.errors?.ownerEmail}
                    helpText="Primary inbox that receives inventory alerts whenever stock hits minimum levels."
                    autoComplete="email"
                  />

                  <TextField
                    label="Global Low-Stock Threshold"
                    type="number"
                    value={globalThreshold}
                    onChange={setGlobalThreshold}
                    error={actionData?.errors?.globalThreshold}
                    helpText="Default trigger level. An alert is dispatched when available inventory falls to or below this count."
                    autoComplete="off"
                    min={0}
                  />

                  <InlineStack align="end">
                    <Button variant="primary" loading={isSubmitting} onClick={handleSubmit}>
                      Save Settings
                    </Button>
                  </InlineStack>
                </FormLayout>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Plan & Usage Summary Sidebar */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between">
                    <Text as="h3" variant="headingSm">
                      Active Subscription
                    </Text>
                    <Badge tone={isFreePlan ? "info" : "success"}>{data.activePlan}</Badge>
                  </InlineStack>

                  <Divider />

                  {isFreePlan ? (
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm">
                          Monthly Quota:
                        </Text>
                        <Text as="span" variant="bodySm" fontWeight="semibold">
                          {data.alertCountThisMonth} / {data.maxFreeAlerts} alerts
                        </Text>
                      </InlineStack>

                      <ProgressBar
                        progress={quotaPercentage}
                        tone={quotaPercentage >= 90 ? "critical" : quotaPercentage >= 70 ? "highlight" : "primary"}
                        size="small"
                      />

                      <Text as="p" variant="bodyXs" tone="subdued">
                        Your free tier resets every 30 days. Upgrade to remove limits and unlock vendor routing.
                      </Text>

                      <Box paddingBlockStart="200">
                        <Button url="/app/pricing" fullWidth variant="primary">
                          Upgrade to Unlimited
                        </Button>
                      </Box>
                    </BlockStack>
                  ) : (
                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="success">
                        &bull; Unlimited alerts active
                      </Text>
                      <Text as="p" variant="bodySm" tone="success">
                        &bull; Automated vendor routing enabled
                      </Text>
                      {data.activePlan === PlanTier.PRO && (
                        <Text as="p" variant="bodySm" tone="success">
                          &bull; Multi-location tracking active
                        </Text>
                      )}
                      <Box paddingBlockStart="200">
                        <Button url="/app/pricing" fullWidth>
                          Manage Plan
                        </Button>
                      </Box>
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    Webhook Engine
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Inventory monitoring runs 100% event-driven via Shopify webhooks. Zero delay, zero cron jobs.
                  </Text>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
