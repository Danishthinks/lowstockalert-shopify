import prisma from "../app/db.server";
import { processInventoryLevelUpdate } from "../app/services/inventory-webhook.server";
import { createMockAdmin } from "../app/mock-shopify.server";
import { sendLowStockAlert, buildEmailHtml } from "../app/services/email.server";
import { PLANS, hasTierPrivilege } from "../app/services/billing.server";
import { PlanTier, AlertStatus } from "../app/types";

async function runVerification() {
  console.log("=================================================");
  console.log("🚀 STARTING FULL PLUGIN VERIFICATION SUITE");
  console.log("=================================================\n");

  const testShop = "test-store.myshopify.com";
  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      process.exitCode = 1;
    }
  }

  try {
    // -------------------------------------------------------------
    // TEST SUITE 1: DATABASE PERSISTENCE & SCHEMA INTEGRITY
    // -------------------------------------------------------------
    console.log("📦 1. Testing Database Models & Schema Integrity...");

    // Clean up any previous test artifacts
    await prisma.alertHistory.deleteMany({ where: { shop: testShop } });
    await prisma.productThreshold.deleteMany({ where: { shop: testShop } });
    await prisma.storeSettings.deleteMany({ where: { shop: testShop } });

    // 1.1 Create StoreSettings
    const store = await prisma.storeSettings.create({
      data: {
        shop: testShop,
        ownerEmail: "owner@teststore.com",
        globalThreshold: 5,
        activePlan: PlanTier.FREE,
        alertCountThisMonth: 0,
      },
    });
    assert(store.shop === testShop && store.globalThreshold === 5, "StoreSettings creation and field defaults");

    // 1.2 Create ProductThreshold override
    const threshold = await prisma.productThreshold.create({
      data: {
        shop: testShop,
        productId: "gid://shopify/Product/1001",
        variantId: "gid://shopify/ProductVariant/2001",
        inventoryItemId: "gid://shopify/InventoryItem/3001",
        customThreshold: 10,
        vendorEmail: "supplier@acme.com",
      },
    });
    assert(threshold.customThreshold === 10 && threshold.vendorEmail === "supplier@acme.com", "ProductThreshold override creation");

    // 1.3 Create AlertHistory audit log
    const alert = await prisma.alertHistory.create({
      data: {
        shop: testShop,
        productId: "gid://shopify/Product/1001",
        variantId: "gid://shopify/ProductVariant/2001",
        stockLevel: 2,
        threshold: 5,
        recipientEmails: "owner@teststore.com",
        tier: PlanTier.FREE,
        status: AlertStatus.SENT,
      },
    });
    assert(alert.status === AlertStatus.SENT && alert.stockLevel === 2, "AlertHistory creation and logging");

    // -------------------------------------------------------------
    // TEST SUITE 2: BILLING ENGINE & PRIVILEGE GUARDS
    // -------------------------------------------------------------
    console.log("\n💳 2. Testing Billing API & Tier Privilege Guards...");

    assert(PLANS.FREE.price === 0 && PLANS.FREE.maxAlertsPerMonth === 50, "Free tier configured for 50 alerts/month");
    assert(PLANS.STARTER.price === 9 && PLANS.STARTER.vendorRouting === true, "Starter tier configured at $9/mo with vendor routing");
    assert(PLANS.PRO.price === 29 && PLANS.PRO.multiLocation === true && PLANS.PRO.analytics === true, "Pro tier configured at $29/mo with multi-location & analytics");

    assert(hasTierPrivilege(PlanTier.FREE, PlanTier.FREE) === true, "Free tier has Free privilege");
    assert(hasTierPrivilege(PlanTier.FREE, PlanTier.STARTER) === false, "Free tier blocked from Starter privilege");
    assert(hasTierPrivilege(PlanTier.STARTER, PlanTier.STARTER) === true, "Starter tier has Starter privilege");
    assert(hasTierPrivilege(PlanTier.STARTER, PlanTier.PRO) === false, "Starter tier blocked from Pro privilege");
    assert(hasTierPrivilege(PlanTier.PRO, PlanTier.STARTER) === true, "Pro tier inherits Starter privileges");

    // -------------------------------------------------------------
    // TEST SUITE 3: WEBHOOK ENGINE & QUOTA ENFORCEMENT
    // -------------------------------------------------------------
    console.log("\n⚡ 3. Testing Event-Driven Webhook Engine (inventory_levels/update)...");

    const mockAdmin = createMockAdmin(testShop);

    // 3.1 Stock ABOVE threshold (available = 15, threshold = 5) -> Should abort
    const resAbove = await processInventoryLevelUpdate({
      shop: testShop,
      admin: mockAdmin,
      payload: {
        inventory_item_id: 3001,
        location_id: 501,
        available: 15,
        updated_at: new Date().toISOString(),
      },
    });
    assert(resAbove.actionTaken === "ABORTED_ABOVE_THRESHOLD", "Webhook ignores stock when inventory is above threshold");

    // 3.2 Stock BELOW threshold on Free Tier (available = 3, globalThreshold = 5)
    // Note: Free tier does NOT use custom variant threshold overrides
    const resTrigger = await processInventoryLevelUpdate({
      shop: testShop,
      admin: mockAdmin,
      payload: {
        inventory_item_id: 3001,
        location_id: 501,
        available: 3,
        updated_at: new Date().toISOString(),
      },
    });
    assert(resTrigger.success === true && resTrigger.actionTaken === "ALERT_SENT", "Webhook dispatches alert when stock drops <= threshold");

    // Verify counter incremented in DB
    const storeAfterAlert = await prisma.storeSettings.findUnique({ where: { shop: testShop } });
    assert(storeAfterAlert?.alertCountThisMonth === 1, "alertCountThisMonth atomically incremented in database");

    // 3.3 Free Tier Quota Cap Enforcement: Set alerts to 50
    await prisma.storeSettings.update({
      where: { shop: testShop },
      data: { alertCountThisMonth: 50 },
    });

    const resQuota = await processInventoryLevelUpdate({
      shop: testShop,
      admin: mockAdmin,
      payload: {
        inventory_item_id: 3001,
        location_id: 501,
        available: 2,
        updated_at: new Date().toISOString(),
      },
    });
    assert(resQuota.actionTaken === "ABORTED_QUOTA_EXCEEDED", "Free tier strictly blocks alerts after 50 monthly limit reached");

    // 3.4 Upgrade to Starter Plan and Test Vendor Routing
    await prisma.storeSettings.update({
      where: { shop: testShop },
      data: { activePlan: PlanTier.STARTER },
    });

    // Custom threshold for 3001 is 10. Stock is 8 -> Below custom threshold!
    const resStarter = await processInventoryLevelUpdate({
      shop: testShop,
      admin: mockAdmin,
      payload: {
        inventory_item_id: 3001,
        location_id: 501,
        available: 8,
        updated_at: new Date().toISOString(),
      },
    });
    assert(resStarter.actionTaken === "ALERT_SENT", "Starter tier unlocks custom per-variant threshold overrides");
    assert(
      Boolean(
        resStarter.details?.recipients?.includes("owner@teststore.com") &&
        resStarter.details?.recipients?.includes("supplier@acme.com")
      ),
      "Starter tier dual-routes to both Store Owner AND Vendor"
    );

    // -------------------------------------------------------------
    // TEST SUITE 4: EMAIL TEMPLATES & DISPATCH
    // -------------------------------------------------------------
    console.log("\n📧 4. Testing Email Dispatch Service & Templates...");

    // 4.1 Free tier template verification
    const freeHtml = buildEmailHtml(
      {
        productName: "Heavyweight Hoodie",
        variantName: "Medium",
        remainingStock: 2,
        threshold: 5,
        ownerEmail: "owner@teststore.com",
        tier: PlanTier.FREE,
      },
      false
    );
    assert(freeHtml.includes("Powered by <strong>Low-Stock Alert App</strong>"), "Free tier HTML contains required watermark");

    // 4.2 Paid tier template verification
    const paidHtml = buildEmailHtml(
      {
        productName: "Heavyweight Hoodie",
        variantName: "Medium",
        remainingStock: 2,
        threshold: 5,
        ownerEmail: "owner@teststore.com",
        vendorName: "Acme Apparel",
        vendorEmail: "supplier@acme.com",
        tier: PlanTier.STARTER,
      },
      true
    );
    assert(!paidHtml.includes("Powered by <strong>Low-Stock Alert App</strong>") && paidHtml.includes("Acme Apparel"), "Paid tier HTML is white-label and greets vendor partner");

    // 4.3 Live Dispatch Test via Nodemailer / Ethereal
    console.log("  🚀 Dispatching test email via Ethereal test inbox...");
    const emailResult = await sendLowStockAlert({
      productName: "Verification Test Item",
      variantName: "Size L",
      remainingStock: 1,
      threshold: 5,
      ownerEmail: "verified@example.com",
      tier: PlanTier.FREE,
    });

    assert(emailResult.success === true, "Email dispatcher successfully delivers message");
    if (emailResult.previewUrl) {
      console.log(`\n  📬 [LIVE EMAIL PREVIEW]: ${emailResult.previewUrl}\n`);
    }

    // -------------------------------------------------------------
    // CLEANUP
    // -------------------------------------------------------------
    await prisma.alertHistory.deleteMany({ where: { shop: testShop } });
    await prisma.productThreshold.deleteMany({ where: { shop: testShop } });
    await prisma.storeSettings.deleteMany({ where: { shop: testShop } });

    console.log("\n=================================================");
    console.log(`🏁 VERIFICATION COMPLETE: ${passedTests} / ${totalTests} TESTS PASSED`);
    console.log("=================================================\n");
  } catch (error) {
    console.error("Verification suite failed with unexpected error:", error);
    process.exit(1);
  }
}

runVerification();
