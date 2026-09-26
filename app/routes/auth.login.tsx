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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = await login(request);
  return json({ errors: errors as Record<string, string> | undefined });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = await login(request);
  return json({ errors: errors as Record<string, string> | undefined });
};

export default function AuthLogin() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");

  const errorMessage = actionData?.errors?.shop || loaderData?.errors?.shop;

  return (
    <AppProvider i18n={polarisTranslations}>
      <Page>
        <Card>
          <Form method="post">
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
