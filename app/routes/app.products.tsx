import { useState, useMemo } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit, useRouteError, isRouteErrorResponse, useRevalidator } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Badge,
  Button,
  Modal,
  FormLayout,
  TextField,
  Banner,
  Box,
  InlineStack,
  BlockStack,
  Divider,
  useIndexResourceState,
} from "@shopify/polaris";
import { authenticateAdminWithDevFallback } from "../auth-helper.server";
import prisma from "../db.server";
import { PlanTier } from "../types";

interface VariantRow {
  id: string; // variantId
  productId: string;
  productTitle: string;
  variantTitle: string;
  vendor: string;
  inventoryItemId?: string;
  inventoryQuantity: number;
  customThreshold: number | null;
  effectiveThreshold: number;
  vendorEmail: string;
  isCustom: boolean;
}

interface ActionResponse {
  success?: boolean;
  error?: string;
}

const PRODUCTS_QUERY = `#graphql
  query getCatalogProducts($first: Int!) {
    products(first: $first) {
      nodes {
        id
        title
        vendor
        variants(first: 20) {
          nodes {
            id
            title
            inventoryQuantity
            inventoryItem {
              id
            }
          }
        }
      }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticateAdminWithDevFallback(request);
  const shop = session.shop;

  // 1. Fetch store settings and active plan
  const store = await prisma.storeSettings.findUnique({
    where: { shop },
  });

  const activePlan = store?.activePlan || PlanTier.FREE;
  const globalThreshold = store?.globalThreshold ?? 5;

  // 2. Fetch existing custom threshold overrides from database
  const overrides = await prisma.productThreshold.findMany({
    where: { shop },
  });

  const overridesMap = new Map(overrides.map((o) => [o.variantId, o]));

  // 3. Fetch products from Shopify GraphQL with defensive resilience
  const rows: VariantRow[] = [];
  let fetchError: string | null = null;

  try {
    const response = await admin.graphql(PRODUCTS_QUERY, { variables: { first: 50 } });
    const data = (await response.json()) as any;

    if (data.errors && data.errors.length > 0) {
      console.warn("[app.products] GraphQL errors returned:", data.errors);
      fetchError = data.errors[0]?.message || "Shopify API returned an error";
    } else {
      const products = data.data?.products?.nodes || [];
      for (const product of products) {
        const productTitle = product.title;
        const vendor = product.vendor || "No Vendor";
        const productId = product.id;

        for (const variant of product.variants?.nodes || []) {
          const variantId = variant.id;
          const override = overridesMap.get(variantId);
          const isCustom = Boolean(override);

          rows.push({
            id: variantId,
            productId,
            productTitle,
            variantTitle: variant.title === "Default Title" ? "" : variant.title,
            vendor,
            inventoryItemId: variant.inventoryItem?.id,
            inventoryQuantity: variant.inventoryQuantity ?? 0,
            customThreshold: override ? override.customThreshold : null,
            effectiveThreshold: override ? override.customThreshold : globalThreshold,
            vendorEmail: override?.vendorEmail || "",
            isCustom,
          });
        }
      }
    }
  } catch (err: any) {
    console.error("[app.products] Caught loader error fetching products:", err);
    fetchError = err?.message || "Failed to communicate with Shopify API";
  }

  return json({
    rows,
    fetchError,
    activePlan,
    ownerEmail: store?.ownerEmail || "smartstock779@gmail.com",
    globalThreshold,
    isFeatureLocked: activePlan === PlanTier.FREE,
    isDev: process.env.NODE_ENV !== "production",
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminWithDevFallback(request);
  const shop = session.shop;
  const formData = await request.formData();

  const intent = formData.get("intent");
  const variantId = String(formData.get("variantId") || "");

  // Development Tier Switcher (Instantly test Free, Starter, or Pro features in dev mode)
  if (intent === "DEV_SET_TIER") {
    const targetTier = (String(formData.get("tier") || PlanTier.FREE) as PlanTier);
    await prisma.storeSettings.upsert({
      where: { shop },
      update: { activePlan: targetTier },
      create: { shop, activePlan: targetTier, ownerEmail: "smartstock779@gmail.com" },
    });
    return json<ActionResponse>({ success: true });
  }

  // 1. Plan Verification Gate (Lock if on Free tier)
  const store = await prisma.storeSettings.findUnique({ where: { shop } });
  if (!store || store.activePlan === PlanTier.FREE) {
    return json<ActionResponse>(
      { error: "Custom per-product thresholds and vendor routing require a Starter or Pro subscription." },
      { status: 403 }
    );
  }

  if (intent === "DELETE_OVERRIDE") {
    await prisma.productThreshold.deleteMany({
      where: {
        shop,
        variantId,
      },
    });
    return json<ActionResponse>({ success: true });
  }

  // UPSERT OVERRIDE
  const productId = String(formData.get("productId") || "");
  const inventoryItemId = String(formData.get("inventoryItemId") || "");
  const productTitle = String(formData.get("productTitle") || "");
  const variantTitle = String(formData.get("variantTitle") || "");
  const vendorEmail = String(formData.get("vendorEmail") || "").trim();
  const rawThreshold = String(formData.get("customThreshold") || "").trim();
  const customThreshold = parseInt(rawThreshold, 10);

  if (isNaN(customThreshold) || customThreshold < 0) {
    return json<ActionResponse>({ error: "Custom threshold must be a valid number >= 0." }, { status: 400 });
  }

  await prisma.productThreshold.upsert({
    where: {
      shop_variantId: {
        shop,
        variantId,
      },
    },
    update: {
      customThreshold,
      vendorEmail: vendorEmail || null,
      productTitle,
      variantTitle,
      inventoryItemId: inventoryItemId || undefined,
    },
    create: {
      shop,
      productId,
      variantId,
      inventoryItemId: inventoryItemId || null,
      productTitle,
      variantTitle,
      customThreshold,
      vendorEmail: vendorEmail || null,
    },
  });

  return json<ActionResponse>({ success: true });
};

export default function ProductsPage() {
  const { rows, fetchError, activePlan, globalThreshold, isFeatureLocked, ownerEmail, isDev } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResponse>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const revalidator = useRevalidator();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVariant, setSelectedVariant] = useState<VariantRow | null>(null);
  const [modalThreshold, setModalThreshold] = useState("");
  const [modalVendorEmail, setModalVendorEmail] = useState("");

  const isSubmitting = navigation.state === "submitting";

  const handleSetTier = (tier: PlanTier) => {
    const formData = new FormData();
    formData.append("intent", "DEV_SET_TIER");
    formData.append("tier", tier);
    submit(formData, { method: "POST" });
  };

  const filteredRows = useMemo(() => {
    if (!searchQuery) return rows;
    const query = searchQuery.toLowerCase();
    return rows.filter(
      (r) =>
        r.productTitle.toLowerCase().includes(query) ||
        r.variantTitle.toLowerCase().includes(query) ||
        r.vendor.toLowerCase().includes(query)
    );
  }, [rows, searchQuery]);

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(filteredRows);

  const openEditModal = (variant: VariantRow) => {
    setSelectedVariant(variant);
    setModalThreshold(String(variant.customThreshold ?? globalThreshold));
    setModalVendorEmail(variant.vendorEmail || "");
  };

  const closeModal = () => {
    setSelectedVariant(null);
  };

  const handleSaveModal = () => {
    if (!selectedVariant) return;

    const formData = new FormData();
    formData.append("intent", "UPSERT_OVERRIDE");
    formData.append("variantId", selectedVariant.id);
    formData.append("productId", selectedVariant.productId);
    formData.append("inventoryItemId", selectedVariant.inventoryItemId || "");
    formData.append("productTitle", selectedVariant.productTitle);
    formData.append("variantTitle", selectedVariant.variantTitle);
    formData.append("customThreshold", modalThreshold);
    formData.append("vendorEmail", modalVendorEmail);

    submit(formData, { method: "POST" });
    closeModal();
  };

  const handleResetToGlobal = (variantId: string) => {
    const formData = new FormData();
    formData.append("intent", "DELETE_OVERRIDE");
    formData.append("variantId", variantId);
    submit(formData, { method: "POST" });
  };

  const rowMarkup = filteredRows.map((row, index) => {
    const isOutOfStock = row.inventoryQuantity <= 0;
    const isLowStock = row.inventoryQuantity <= row.effectiveThreshold;

    return (
      <IndexTable.Row
        id={row.id}
        key={row.id}
        selected={selectedResources.includes(row.id)}
        position={index}
      >
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text variant="bodyMd" fontWeight="bold" as="span">
              {row.productTitle}
            </Text>
            {row.variantTitle && (
              <Text variant="bodySm" tone="subdued" as="span">
                {row.variantTitle}
              </Text>
            )}
          </BlockStack>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Text variant="bodySm" as="span">
            {row.vendor}
          </Text>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <InlineStack gap="200" align="start">
            <Text variant="bodyMd" fontWeight="semibold" as="span">
              {row.inventoryQuantity}
            </Text>
            {isOutOfStock ? (
              <Badge tone="critical">Out of Stock</Badge>
            ) : isLowStock ? (
              <Badge tone="warning">Low Stock</Badge>
            ) : null}
          </InlineStack>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <InlineStack gap="150" align="start">
            <Text variant="bodyMd" as="span">
              &le; {row.effectiveThreshold}
            </Text>
            {row.isCustom ? (
              <Badge tone="success">Custom</Badge>
            ) : (
              <Badge tone="info">{`Global (${globalThreshold})`}</Badge>
            )}
          </InlineStack>
        </IndexTable.Cell>

        <IndexTable.Cell>
          {row.vendorEmail ? (
            <Text variant="bodySm" as="span">
              {row.vendorEmail}
            </Text>
          ) : (
            <Text variant="bodySm" tone="subdued" as="span">
              None (Store owner only)
            </Text>
          )}
        </IndexTable.Cell>

        <IndexTable.Cell>
          <InlineStack gap="200">
            <Button
              size="micro"
              disabled={isFeatureLocked}
              onClick={() => openEditModal(row)}
            >
              Configure
            </Button>
            {row.isCustom && (
              <Button
                size="micro"
                tone="critical"
                disabled={isFeatureLocked}
                onClick={() => handleResetToGlobal(row.id)}
              >
                Reset
              </Button>
            )}
          </InlineStack>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      title="Product Inventory Thresholds"
      subtitle="Define per-variant low-stock triggers and automated vendor alert dispatch."
    >
      <BlockStack gap="400">
        {fetchError && (
          <Banner title="Live Catalog Sync Notice" tone="warning">
            <p>{fetchError}</p>
            <div style={{ marginTop: "0.5rem" }}>
              <Button
                onClick={() => revalidator.revalidate()}
                loading={revalidator.state === "loading"}
                size="slim"
              >
                Retry Sync
              </Button>
            </div>
          </Banner>
        )}

        {actionData?.error && (
          <Banner title="Operation blocked" tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        )}

        {isFeatureLocked ? (
          <Banner
            title="Feature Locked: Per-Product Overrides & Vendor Routing"
            tone="warning"
            action={{ content: "Upgrade to Starter ($9/mo)", url: "/app/pricing" }}
          >
            <p>
              Your store is currently on the <strong>Free Tier</strong>. All catalog items use your global threshold of{" "}
              <strong>&le; {globalThreshold} units</strong> and notify the store owner only ({ownerEmail}). Upgrade to Starter ($9/mo) to set custom thresholds and automated vendor re-ordering.
            </p>
          </Banner>
        ) : activePlan === PlanTier.STARTER ? (
          <Banner
            title="Starter Tier Active: Custom Thresholds & Vendor Routing Unlocked"
            tone="success"
            action={{ content: "View Plans & Upgrades", url: "/app/pricing" }}
          >
            <p>
              Per-variant overrides are unlocked! Click <strong>Configure</strong> on any product below to set custom thresholds and vendor purchase order emails.
            </p>
          </Banner>
        ) : (
          <Banner
            title="Pro Tier Active: Multi-Location & Analytics Unlocked!"
            tone="success"
            action={{ content: "Open Pro Analytics on Dashboard", url: "/app" }}
          >
            <p>
              Pro Tier is active! Head to the <strong>Dashboard</strong> to view the <strong>Frequent Stockout Analytics</strong> table, or configure per-variant thresholds with multi-location fulfillment tracking below.
            </p>
          </Banner>
        )}

        <Card padding="0">
          <Box padding="400">
            <TextField
              label="Search catalog"
              labelHidden
              placeholder="Search by product, variant, or vendor..."
              value={searchQuery}
              onChange={setSearchQuery}
              clearButton
              onClearButtonClick={() => setSearchQuery("")}
              autoComplete="off"
            />
          </Box>

          <IndexTable
            resourceName={{ singular: "variant", plural: "variants" }}
            itemCount={filteredRows.length}
            selectedItemsCount={
              allResourcesSelected ? "All" : selectedResources.length
            }
            onSelectionChange={handleSelectionChange}
            headings={[
              { title: "Product / Variant" },
              { title: "Vendor" },
              { title: "Stock Available" },
              { title: "Active Threshold" },
              { title: "Vendor Notification" },
              { title: "Actions" },
            ]}
            selectable={false}
          >
            {rowMarkup}
          </IndexTable>
        </Card>
      </BlockStack>

      {/* Edit Threshold & Vendor Modal */}
      {selectedVariant && (
        <Modal
          open={Boolean(selectedVariant)}
          onClose={closeModal}
          title={`Configure: ${selectedVariant.productTitle}${
            selectedVariant.variantTitle ? ` (${selectedVariant.variantTitle})` : ""
          }`}
          primaryAction={{
            content: "Save Configuration",
            onAction: handleSaveModal,
            loading: isSubmitting,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: closeModal,
            },
          ]}
        >
          <Modal.Section>
            <FormLayout>
              <TextField
                label="Custom Alert Threshold"
                type="number"
                value={modalThreshold}
                onChange={setModalThreshold}
                helpText="Trigger alert when available inventory drops to or below this quantity."
                min={0}
                autoComplete="off"
              />

              <TextField
                label="Vendor Direct Email (Automated Routing)"
                type="email"
                value={modalVendorEmail}
                onChange={setModalVendorEmail}
                placeholder="supplier@vendor.com"
                helpText="When low stock triggers, a purchase order notice will be dispatched directly to this vendor inbox in addition to the store owner."
                autoComplete="email"
              />

              {activePlan === PlanTier.PRO ? (
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="100">
                    <InlineStack align="space-between">
                      <Text as="p" fontWeight="bold">
                        🏬 Multi-Location Fulfillment Tracking
                      </Text>
                      <Badge tone="magic">Pro Feature Active</Badge>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Pro Tier actively tracks inventory across individual locations. When low stock occurs, the re-order alert automatically pinpoints the exact warehouse location (e.g. <strong>Shop Location</strong>) so the vendor dispatches to the correct facility.
                    </Text>
                  </BlockStack>
                </Box>
              ) : (
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <InlineStack align="space-between">
                    <Text as="p" variant="bodySm" tone="subdued">
                      🏬 Location-specific fulfillment tagging is locked on {activePlan}.
                    </Text>
                    <Badge tone="info">Unlocks on Pro ($29)</Badge>
                  </InlineStack>
                </Box>
              )}
            </FormLayout>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  console.error("[ProductsPage ErrorBoundary Caught]:", error);

  let message = "Unable to load products at this moment.";
  if (isRouteErrorResponse(error)) {
    message = typeof error.data === "string" ? error.data : error.data?.message || "Communication error with store catalog";
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <Page title="Product Inventory Thresholds">
      <Banner title="Unable to load product list" tone="warning">
        <p>{message}</p>
        <div style={{ marginTop: "1rem" }}>
          <Button
            onClick={() => revalidator.revalidate()}
            loading={revalidator.state === "loading"}
            variant="primary"
          >
            Retry Loading
          </Button>
        </div>
      </Banner>
    </Page>
  );
}
