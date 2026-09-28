import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  AppProvider,
  Page,
  Card,
  TextField,
  Button,
  Text,
  BlockStack,
  Banner,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import { login } from "../shopify.server";

const CLIENT_ID =
  process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_KEY !== "development_api_key"
    ? process.env.SHOPIFY_API_KEY
    : "35783ffed69ae8e466d44b2ea63e7144";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");

  // If a shop is provided, break out of any embedded iframe cleanly to Shopify install URL
  if (shopParam) {
    const cleanShop = shopParam.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const adminDomain = cleanShop.includes(".") ? cleanShop.split(".")[0] : cleanShop;
    const installUrl = `https://admin.shopify.com/store/${adminDomain}/oauth/install?client_id=${CLIENT_ID}`;

    return new Response(
      `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authenticating...</title>
  <script>
    var target = "${installUrl}";
    if (window.top && window.top !== window.self) {
      window.top.location.href = target;
    } else {
      window.location.href = target;
    }
  </script>
</head>
<body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f6f6f7;">
  <p>Connecting to Shopify store authorization...</p>
</body>
</html>`,
      {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  }

  const errors = await login(request);
  return json({
    errors: errors as Record<string, string> | undefined,
    defaultShop: "",
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.clone().formData();
  const shop = formData.get("shop") as string;

  if (shop) {
    const cleanShop = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const adminDomain = cleanShop.includes(".") ? cleanShop.split(".")[0] : cleanShop;
    const installUrl = `https://admin.shopify.com/store/${adminDomain}/oauth/install?client_id=${CLIENT_ID}`;

    return new Response(
      `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script>
    var target = "${installUrl}";
    if (window.top && window.top !== window.self) {
      window.top.location.href = target;
    } else {
      window.location.href = target;
    }
  </script>
</head>
<body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f6f6f7;">
  <p>Redirecting to Shopify authorization...</p>
</body>
</html>`,
      {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  }

  const errors = await login(request);
  return json({ errors: errors as Record<string, string> | undefined });
};

export default function AuthLogin() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState(loaderData?.defaultShop || "");

  const errorMessage = actionData?.errors?.shop || loaderData?.errors?.shop;

  return (
    <AppProvider i18n={polarisTranslations}>
      <Page>
        <Card>
          <Form method="post" target="_top">
            <BlockStack gap="400">
              <Text as="h1" variant="headingMd">
                Log in to Shopify Store
              </Text>
              {errorMessage && (
                <Banner title="Login Error" tone="critical">
                  <p>{errorMessage}</p>
                </Banner>
              )}
              <TextField
                label="Shop domain"
                name="shop"
                value={shop}
                onChange={setShop}
                autoComplete="on"
                placeholder="example.myshopify.com"
              />
              <Button submit variant="primary">
                Log in
              </Button>
            </BlockStack>
          </Form>
        </Card>
      </Page>
    </AppProvider>
  );
}
