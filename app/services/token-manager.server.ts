import prisma from "../db.server";

const CLIENT_ID = process.env.SHOPIFY_API_KEY || "35783ffed69ae8e466d44b2ea63e7144";
const CLIENT_SECRET = process.env.SHOPIFY_API_SECRET || "";

// Mutex to prevent simultaneous refresh requests for the same shop
const refreshLocks = new Map<string, Promise<string | null>>();

/**
 * Ensures that the offline session token for the given shop is valid and not expired.
 * Automatically exchanges refresh tokens or migrates legacy non-expiring tokens.
 */
export async function ensureValidShopToken(
  shop: string,
  options: { forceRefresh?: boolean } = {}
): Promise<string | null> {
  // If a refresh is already in-flight for this shop, reuse the existing promise
  if (refreshLocks.has(shop)) {
    return refreshLocks.get(shop)!;
  }

  const refreshPromise = (async () => {
    try {
      return await performTokenCheckAndRefresh(shop, options);
    } finally {
      refreshLocks.delete(shop);
    }
  })();

  refreshLocks.set(shop, refreshPromise);
  return refreshPromise;
}

async function performTokenCheckAndRefresh(
  shop: string,
  options: { forceRefresh?: boolean }
): Promise<string | null> {
  const offlineSessionId = `offline_${shop}`;

  const session = await prisma.session.findFirst({
    where: {
      OR: [
        { id: offlineSessionId },
        { shop, isOnline: false },
      ],
    },
  });

  if (!session || !session.accessToken) {
    console.warn(`[TokenManager] No offline session found in DB for shop: ${shop}`);
    return null;
  }

  const storeSettings = await prisma.storeSettings.findUnique({
    where: { shop },
    select: { refreshToken: true },
  });

  const now = Date.now();
  const fiveMinutesFromNow = now + 5 * 60 * 1000;
  const isExpiringSoon = session.expires ? session.expires.getTime() <= fiveMinutesFromNow : false;
  // If expires is null and no refreshToken, it's a legacy non-expiring token which Shopify rejects with 403
  const isLegacyNonExpiring = session.expires === null;

  const needsRefresh = Boolean(options.forceRefresh || isExpiringSoon || isLegacyNonExpiring);

  if (!needsRefresh) {
    return session.accessToken;
  }

  console.info(`[TokenManager] Refreshing token for ${shop} (force=${Boolean(options.forceRefresh)}, isExpiringSoon=${isExpiringSoon}, isLegacy=${isLegacyNonExpiring})`);

  let responseData: any = null;

  // Option 1: Use stored refresh token if available
  if (storeSettings?.refreshToken) {
    try {
      const body = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: storeSettings.refreshToken,
      });

      const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (res.ok) {
        responseData = await res.json();
        console.info(`[TokenManager] Successfully refreshed token via refresh_token for ${shop}`);
      } else {
        const errorText = await res.text();
        console.warn(`[TokenManager] refresh_token grant failed (${res.status}): ${errorText}`);
      }
    } catch (err) {
      console.error(`[TokenManager] Network error during refresh_token grant:`, err);
    }
  }

  // Option 2: Fallback to token-exchange migration using the existing access token
  if (!responseData?.access_token && session.accessToken) {
    try {
      const body = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        subject_token: session.accessToken,
        subject_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
        requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
        expiring: "1",
      });

      const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (res.ok) {
        responseData = await res.json();
        console.info(`[TokenManager] Successfully migrated token via token-exchange for ${shop}`);
      } else {
        const errorText = await res.text();
        console.warn(`[TokenManager] token-exchange migration failed (${res.status}): ${errorText}`);
      }
    } catch (err) {
      console.error(`[TokenManager] Network error during token-exchange migration:`, err);
    }
  }

  // If a new access token was acquired, update DB atomically
  if (responseData?.access_token) {
    const expiresInSeconds = responseData.expires_in || 3600;
    const newExpires = new Date(Date.now() + expiresInSeconds * 1000);

    await prisma.session.update({
      where: { id: session.id },
      data: {
        accessToken: responseData.access_token,
        expires: newExpires,
      },
    });

    if (responseData.refresh_token) {
      await prisma.storeSettings.upsert({
        where: { shop },
        update: { refreshToken: responseData.refresh_token },
        create: { shop, refreshToken: responseData.refresh_token },
      });
    }

    return responseData.access_token;
  }

  // Return the existing access token as fallback
  return session.accessToken;
}
