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
  const url = new URL(request.url);
  const isOnboarding = url.searchParams.get("onboarding") === "true";

  // Sync with Shopify to get verified active charge state
  const activePlan = await syncStoreSubscription({ admin, shop });

  // If a paid charge is confirmed, mark onboarding completed automatically
  if (activePlan !== PlanTier.FREE) {
    await prisma.storeSettings.updateMany({
      where: { shop },
      data: { hasCompletedOnboarding: true },
    });
  }

  const store = await prisma.storeSettings.findUnique({
    where: { shop },
  });

  return json({
    activePlan,
    alertCountThisMonth: store?.alertCountThisMonth ?? 0,
    maxFreeAlerts: 50,
    plans: PLANS,
    isOnboarding: isOnboarding || !store?.hasCompletedOnboarding,
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

  if (targetPlan === PlanTier.FREE) {
    await cancelSubscriptionPlan({ admin, shop });
    // Mark onboarding complete and set plan to FREE
    await prisma.storeSettings.updateMany({
      where: { shop },
      data: {
        activePlan: PlanTier.FREE,
        hasCompletedOnboarding: true,
      },
    });
    return redirect("/app?welcome=free");
  }

  // If selecting a paid plan, return to dashboard with upgraded celebration
  const returnUrl = `${url.origin}/app?welcome=upgraded&tier=${targetPlan}`;

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
  const { activePlan, alertCountThisMonth, maxFreeAlerts, plans, isOnboarding } =
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
      title={isOnboarding ? "Welcome! Choose Your Plan" : "Plans & Billing"}
      subtitle={
        isOnboarding
          ? "Activate your store by selecting a plan below. You can start completely free ($0/mo) or unlock automated vendor Purchase Orders & multi-location tracking."
          : "Select the tier that fits your store's inventory scale and vendor automation requirements."
      }
    >
      <BlockStack gap="500">
        {isOnboarding && (
          <Banner title="🎉 Step 1 of 1: Select Your App Plan" tone="success">
            <Text as="p">
              Pick your subscription tier below to activate Low Stock Alert for your store. You can start on the <strong>Free Plan ($0/mo)</strong> and upgrade or downgrade anytime!
            </Text>
          </Banner>
        )}

        {actionData?.error && (
          <Banner title="Subscription error" tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        )}

        {!isOnboarding && activePlan === PlanTier.FREE && (
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
            const isCurrent = !isOnboarding && activePlan === tierKey;
            const isPro = tierKey === PlanTier.PRO;
            const isStarter = tierKey === PlanTier.STARTER;

            let buttonLabel = `Upgrade to ${plan.title}`;
            if (isOnboarding) {
              buttonLabel = tierKey === PlanTier.FREE ? "Activate Free Plan ($0/mo)" : `Select ${plan.title} ($${plan.price}/mo)`;
            } else if (tierKey === PlanTier.FREE) {
              buttonLabel = "Downgrade to Free";
            }

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
                          variant={tierKey !== PlanTier.FREE ? "primary" : isOnboarding ? "primary" : "secondary"}
                          tone={!isOnboarding && tierKey === PlanTier.FREE ? "critical" : undefined}
                          loading={isSubmitting}
                          onClick={() => handlePlanSelect(tierKey)}
                        >
                          {buttonLabel}
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
