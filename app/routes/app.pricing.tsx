import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
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
  Divider,
  List,
  Box,
  ProgressBar,
} from "@shopify/polaris";
import { authenticateAdminWithDevFallback } from "../auth-helper.server";
import prisma from "../db.server";
import {
  PLANS,
  createSubscriptionPlan,
  cancelSubscriptionPlan,
  syncStoreSubscription,
} from "../services/billing.server";
import { PlanTier } from "../types";

interface ActionResponse {
  error?: string;
  confirmationUrl?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticateAdminWithDevFallback(request);
  const shop = session.shop;

  // Sync with Shopify to get verified active charge state
  const activePlan = await syncStoreSubscription({ admin, shop });

  const store = await prisma.storeSettings.findUnique({
    where: { shop },
  });

  return json({
    activePlan,
    alertCountThisMonth: store?.alertCountThisMonth ?? 0,
    maxFreeAlerts: 50,
    plans: PLANS,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticateAdminWithDevFallback(request);
  const shop = session.shop;
  const formData = await request.formData();

  const targetPlan = formData.get("plan") as PlanTier;

  if (!targetPlan || !Object.values(PlanTier).includes(targetPlan)) {
    return json<ActionResponse>({ error: "Invalid subscription plan selected." }, { status: 400 });
  }

  const url = new URL(request.url);
  const returnUrl = `${url.origin}/app/pricing`;

  if (targetPlan === PlanTier.FREE) {
    await cancelSubscriptionPlan({ admin, shop });
    return redirect("/app/pricing");
  }

  const { confirmationUrl, error } = await createSubscriptionPlan({
    admin,
    shop,
    plan: targetPlan,
    returnUrl,
  });

  if (error || !confirmationUrl) {
    return json<ActionResponse>({ error: error || "Unable to initiate subscription charge." }, { status: 400 });
  }

  // Redirect merchant outside the iframe to Shopify's subscription confirmation screen
  return redirect(confirmationUrl, { target: "_top" } as never);
};

export default function PricingPage() {
  const { activePlan, alertCountThisMonth, maxFreeAlerts, plans } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResponse>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const isSubmitting = navigation.state === "submitting";

  const handlePlanSelect = (plan: PlanTier) => {
    const formData = new FormData();
    formData.append("plan", plan);
    submit(formData, { method: "POST" });
  };

  const planOrder: PlanTier[] = [PlanTier.FREE, PlanTier.STARTER, PlanTier.PRO];

  return (
    <Page
      title="Plans & Billing"
      subtitle="Select the tier that fits your store's inventory scale and vendor automation requirements."
    >
      <BlockStack gap="500">
        {actionData?.error && (
          <Banner title="Subscription error" tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        )}

        {activePlan === PlanTier.FREE && (
          <Banner title="Free Tier Usage Status" tone="info">
            <BlockStack gap="200">
              <Text as="p">
                You have used <strong>{alertCountThisMonth}</strong> of your{" "}
                <strong>{maxFreeAlerts}</strong> free alert quota for this billing cycle.
              </Text>
              <ProgressBar
                progress={Math.min(100, Math.round((alertCountThisMonth / maxFreeAlerts) * 100))}
                tone={alertCountThisMonth >= 45 ? "critical" : "primary"}
                size="small"
              />
            </BlockStack>
          </Banner>
        )}

        <Layout>
          {planOrder.map((tierKey) => {
            const plan = plans[tierKey];
            const isCurrent = activePlan === tierKey;
            const isPro = tierKey === PlanTier.PRO;
            const isStarter = tierKey === PlanTier.STARTER;

            return (
              <Layout.Section variant="oneThird" key={tierKey}>
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        {plan.title}
                      </Text>
                      {isCurrent ? (
                        <Badge tone="success">Current Plan</Badge>
                      ) : isStarter ? (
                        <Badge tone="attention">Most Popular</Badge>
                      ) : isPro ? (
                        <Badge tone="info">Enterprise</Badge>
                      ) : null}
                    </InlineStack>

                    <div>
                      <Text as="span" variant="heading2xl" fontWeight="bold">
                        ${plan.price}
                      </Text>
                      <Text as="span" variant="bodyMd" tone="subdued">
                        {" "}/ month
                      </Text>
                    </div>

                    <Text as="p" tone="subdued">
                      {plan.description}
                    </Text>

                    <Divider />

                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">
                        Included Features:
                      </Text>
                      <List type="bullet">
                        {plan.features.map((feature, idx) => (
                          <List.Item key={idx}>{feature}</List.Item>
                        ))}
                      </List>
                    </BlockStack>

                    <Box paddingBlockStart="300">
                      {isCurrent ? (
                        <Button fullWidth disabled>
                          Active Plan
                        </Button>
                      ) : (
                        <Button
                          fullWidth
                          variant={tierKey !== PlanTier.FREE ? "primary" : "secondary"}
                          tone={tierKey === PlanTier.FREE ? "critical" : undefined}
                          loading={isSubmitting}
                          onClick={() => handlePlanSelect(tierKey)}
                        >
                          {tierKey === PlanTier.FREE
                            ? "Downgrade to Free"
                            : `Upgrade to ${plan.title}`}
                        </Button>
                      )}
                    </Box>
                  </BlockStack>
                </Card>
              </Layout.Section>
            );
          })}
        </Layout>
      </BlockStack>
    </Page>
  );
}
