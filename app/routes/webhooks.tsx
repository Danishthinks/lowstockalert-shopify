import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  processInventoryLevelUpdate,
  type InventoryLevelUpdateWebhookPayload,
} from "../services/inventory-webhook.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, admin, payload } = await authenticate.webhook(request);

  switch (topic) {
    case "INVENTORY_LEVELS_UPDATE": {
      if (!admin) {
        console.error(`[Webhook] Missing offline session for shop: ${shop}`);
        return new Response("Unauthorized or missing session", { status: 401 });
      }

      const result = await processInventoryLevelUpdate({
        shop,
        admin,
        payload: payload as InventoryLevelUpdateWebhookPayload,
      });

      console.info(`[Webhook] INVENTORY_LEVELS_UPDATE result for ${shop}:`, result);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    case "APP_UNINSTALLED": {
      if (session) {
        await prisma.session.deleteMany({ where: { shop } });
      }
      return new Response(null, { status: 200 });
    }

    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
    case "SHOP_REDACT": {
      // Mandatory Shopify compliance webhooks
      return new Response(null, { status: 200 });
    }

    default:
      console.warn(`[Webhook] Unhandled webhook topic: ${topic}`);
      return new Response("Unhandled webhook topic", { status: 404 });
  }
};
