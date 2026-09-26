import { PlanTier } from "../types";
import nodemailer, { type Transporter } from "nodemailer";

export interface SendLowStockAlertOptions {
  productName: string;
  variantName?: string;
  remainingStock: number;
  threshold: number;
  ownerEmail: string;
  vendorEmail?: string | null;
  vendorName?: string;
  tier: PlanTier;
  locationId?: string;
  locationName?: string;
  storeName?: string;
}

export interface EmailDispatchResult {
  success: boolean;
  messageId?: string;
  previewUrl?: string | null;
  vendorPreviewUrl?: string | null;
  recipients: string[];
  provider: "resend" | "smtp" | "ethereal" | "console";
  notice?: string;
}

/**
 * Builds the HTML template tailored to the merchant's subscription tier.
 */
export function buildEmailHtml(options: SendLowStockAlertOptions, isVendorRecipient: boolean): string {
  const {
    productName,
    variantName,
    remainingStock,
    threshold,
    tier,
    locationName,
    locationId,
    vendorName,
  } = options;

  const itemTitle = variantName ? `${productName} — ${variantName}` : productName;
  const isPaid = tier === PlanTier.STARTER || tier === PlanTier.PRO;
  const isUrgent = remainingStock <= 0;

  const statusColor = isUrgent ? "#dc2626" : "#f59e0b";
  const statusLabel = isUrgent ? "OUT OF STOCK" : "LOW STOCK WARNING";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Low Stock Alert</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f6f6f7; margin: 0; padding: 24px; color: #202223; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e1e3e5; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .header { background: #008060; padding: 20px 24px; color: #ffffff; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 700; color: #ffffff; background: ${statusColor}; margin-bottom: 12px; text-transform: uppercase; }
    .content { padding: 24px; }
    .stock-box { background: #fafafa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .stock-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #e5e7eb; font-size: 14px; }
    .stock-row:last-child { border-bottom: none; }
    .label { color: #6d7175; }
    .value { font-weight: 600; color: #202223; }
    .urgent-value { font-weight: 700; color: ${statusColor}; font-size: 16px; }
    .footer { padding: 16px 24px; background: #fafbfc; border-top: 1px solid #e1e3e5; font-size: 12px; color: #6d7175; text-align: center; }
    .watermark { margin-top: 8px; color: #8c9196; font-size: 11px; }
    .watermark a { color: #008060; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>Inventory Notice</h1>
    </div>
    <div class="content">
      <div class="badge">${statusLabel}</div>
      <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5;">
        ${
          isVendorRecipient
            ? `Hello <strong>${vendorName || "Vendor Partner"}</strong>, an automated re-order alert has been triggered for your catalog item.`
            : `Attention: The following item has fallen to or below its minimum configured stock threshold.`
        }
      </p>

      <div class="stock-box">
        <div class="stock-row">
          <span class="label">Product Item</span>
          <span class="value">${itemTitle}</span>
        </div>
        ${
          vendorName
            ? `<div class="stock-row">
                <span class="label">Vendor</span>
                <span class="value">${vendorName}</span>
              </div>`
            : ""
        }
        <div class="stock-row">
          <span class="label">Remaining Available Stock</span>
          <span class="urgent-value">${remainingStock}</span>
        </div>
        <div class="stock-row">
          <span class="label">Configured Threshold</span>
          <span class="value">&le; ${threshold}</span>
        </div>
        ${
          tier === PlanTier.PRO && (locationName || locationId)
            ? `<div class="stock-row">
                <span class="label">Fulfillment Location</span>
                <span class="value">${locationName || `Location #${locationId}`}</span>
              </div>`
            : ""
        }
      </div>

      <p style="font-size: 13px; color: #6d7175; margin: 16px 0 0;">
        Please initiate a purchase order or restock to prevent stockouts and backorders.
      </p>
    </div>

    <div class="footer">
      <div>Automated inventory alert dispatched via Shopify Webhooks.</div>
      ${
        !isPaid
          ? `<div class="watermark">
              Powered by <strong>Low-Stock Alert App</strong>. 
              <a href="#">Upgrade to Starter or Pro</a> for automated vendor routing & custom templates.
             </div>`
          : ""
      }
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Builds plain-text fallback for email clients without HTML support.
 */
export function buildEmailPlainText(options: SendLowStockAlertOptions, isVendorRecipient: boolean): string {
  const { productName, variantName, remainingStock, threshold, tier, locationName, locationId, vendorName } = options;
  const itemTitle = variantName ? `${productName} - ${variantName}` : productName;

  let text = `[LOW STOCK ALERT]\n\n`;
  if (isVendorRecipient) {
    text += `Hello ${vendorName || "Vendor Partner"},\nAn automated re-order notification has been triggered for your catalog item.\n\n`;
  } else {
    text += `Attention: An inventory item has dropped to or below the minimum stock threshold.\n\n`;
  }

  text += `Item: ${itemTitle}\n`;
  if (vendorName) text += `Vendor: ${vendorName}\n`;
  text += `Available Stock: ${remainingStock}\n`;
  text += `Configured Threshold: <= ${threshold}\n`;

  if (tier === PlanTier.PRO && (locationName || locationId)) {
    text += `Location: ${locationName || `Location #${locationId}`}\n`;
  }

  if (tier === PlanTier.FREE) {
    text += `\n---\nPowered by Low-Stock Alert App for Shopify. Upgrade to unlock multi-location alerts & vendor routing.`;
  }

  return text;
}

/**
 * Sends an email via the Resend REST API (Zero-runtime bloat, ultra-low latency).
 */
async function sendViaResend({
  apiKey,
  from,
  to,
  subject,
  html,
  text,
}: {
  apiKey: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}): Promise<string> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Resend API Error (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as { id?: string };
  return data.id || "resend-ok";
}

/**
 * Sends via standard SMTP or auto-creates an Ethereal test account with an instant preview URL.
 */
async function sendViaNodemailer({
  from,
  to,
  subject,
  html,
  text,
}: {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}): Promise<{ messageId: string; previewUrl: string | null; provider: "smtp" | "ethereal" }> {
  let transporter: Transporter;
  let isEthereal = false;

  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    // Generate a test Ethereal inbox on the fly
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    isEthereal = true;
  }

  const info = await transporter.sendMail({
    from,
    to: to.join(", "),
    subject,
    text,
    html,
  });

  const previewUrl = isEthereal ? nodemailer.getTestMessageUrl(info) || null : null;
  if (previewUrl) {
    console.info(`\n📬 [Email Preview Link]: ${previewUrl}\n`);
  }

  return {
    messageId: info.messageId,
    previewUrl: previewUrl ? String(previewUrl) : null,
    provider: isEthereal ? "ethereal" : "smtp",
  };
}

/**
 * Universal Email Dispatcher Service.
 * 
 * Supports:
 * 1. Resend API (via RESEND_API_KEY)
 * 2. Custom SMTP (via SMTP_HOST, SMTP_USER, SMTP_PASS)
 * 3. Ethereal Email (Auto-generates live preview URL with zero configuration)
 */
export async function sendLowStockAlert(
  options: SendLowStockAlertOptions
): Promise<EmailDispatchResult> {
  const {
    ownerEmail,
    vendorEmail,
    productName,
    variantName,
    remainingStock,
    tier,
  } = options;

  const isPaid = tier === PlanTier.STARTER || tier === PlanTier.PRO;
  const itemTitle = variantName ? `${productName} (${variantName})` : productName;
  const subject = `[Low Stock Alert] ${itemTitle} - Only ${remainingStock} left in stock`;

  // Determine recipients according to plan tier
  const recipients: string[] = [ownerEmail];
  const shouldRouteToVendor = isPaid && Boolean(vendorEmail);

  if (shouldRouteToVendor && vendorEmail) {
    recipients.push(vendorEmail);
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const senderEmail = process.env.EMAIL_FROM || "Inventory Alerts <alerts@resend.dev>";

  // 1. Resend Provider (if configured)
  if (resendApiKey) {
    let ownerMsgId: string | undefined;
    let ownerPreviewUrl: string | null = null;
    let vendorPreviewUrl: string | null = null;
    let dispatchNotice: string | undefined;

    // Send owner email via Resend
    try {
      ownerMsgId = await sendViaResend({
        apiKey: resendApiKey,
        from: senderEmail,
        to: [ownerEmail],
        subject,
        html: buildEmailHtml(options, false),
        text: buildEmailPlainText(options, false),
      });
    } catch (ownerErr: unknown) {
      const msg = ownerErr instanceof Error ? ownerErr.message : String(ownerErr);
      if (
        msg.includes("403") ||
        msg.includes("422") ||
        msg.includes("testing emails to your own email address") ||
        msg.includes("Invalid `to` field") ||
        msg.includes("validation_error")
      ) {
        // Fallback to preview so tests and non-registered emails don't crash the app
        const ethRes = await sendViaNodemailer({
          from: senderEmail,
          to: [ownerEmail],
          subject,
          html: buildEmailHtml(options, false),
          text: buildEmailPlainText(options, false),
        });
        ownerPreviewUrl = ethRes.previewUrl;
        dispatchNotice = `Resend sandbox restriction: Resend's free test domain (${senderEmail}) can only deliver live emails to your registered account (smartstock779@gmail.com). We generated a live web preview for ${ownerEmail}. To send live emails to any address, verify a custom domain at resend.com/domains.`;
      } else {
        throw ownerErr;
      }
    }

    if (shouldRouteToVendor && vendorEmail) {
      try {
        await sendViaResend({
          apiKey: resendApiKey,
          from: senderEmail,
          to: [vendorEmail],
          subject: `[PO Request: Low Stock] ${itemTitle} requires replenishment`,
          html: buildEmailHtml(options, true),
          text: buildEmailPlainText(options, true),
        });
      } catch (vendorErr: unknown) {
        const msg = vendorErr instanceof Error ? vendorErr.message : String(vendorErr);
        if (
          msg.includes("403") ||
          msg.includes("422") ||
          msg.includes("testing emails to your own email address") ||
          msg.includes("Invalid `to` field") ||
          msg.includes("validation_error")
        ) {
          // Graceful fallback: generate a web preview for the vendor copy
          const etherealRes = await sendViaNodemailer({
            from: senderEmail,
            to: [vendorEmail],
            subject: `[PO Request: Low Stock] ${itemTitle} requires replenishment`,
            html: buildEmailHtml(options, true),
            text: buildEmailPlainText(options, true),
          });
          vendorPreviewUrl = etherealRes.previewUrl;
          if (!dispatchNotice) {
            dispatchNotice = `Store owner email was sent via Resend. Vendor alert preview was generated below (Resend free testing domain only delivers live to smartstock779@gmail.com until you add a domain at resend.com/domains).`;
          }
        } else {
          throw vendorErr;
        }
      }

      return {
        success: true,
        messageId: ownerMsgId,
        previewUrl: ownerPreviewUrl,
        vendorPreviewUrl,
        recipients: [ownerEmail, vendorEmail],
        provider: "resend",
        notice: dispatchNotice,
      };
    }

    return {
      success: true,
      messageId: ownerMsgId,
      previewUrl: ownerPreviewUrl,
      recipients: [ownerEmail],
      provider: "resend",
      notice: dispatchNotice,
    };
  }

  // 2. Nodemailer (SMTP or Ethereal with live preview URL)
  try {
    if (shouldRouteToVendor && vendorEmail) {
      const ownerHtml = buildEmailHtml(options, false);
      const ownerText = buildEmailPlainText(options, false);
      const ownerResult = await sendViaNodemailer({
        from: senderEmail,
        to: [ownerEmail],
        subject,
        html: ownerHtml,
        text: ownerText,
      });

      const vendorHtml = buildEmailHtml(options, true);
      const vendorText = buildEmailPlainText(options, true);
      const vendorResult = await sendViaNodemailer({
        from: senderEmail,
        to: [vendorEmail],
        subject: `[PO Request: Low Stock] ${itemTitle} requires replenishment`,
        html: vendorHtml,
        text: vendorText,
      });

      return {
        success: true,
        messageId: ownerResult.messageId,
        previewUrl: ownerResult.previewUrl,
        vendorPreviewUrl: vendorResult.previewUrl,
        recipients: [ownerEmail, vendorEmail],
        provider: ownerResult.provider,
      };
    }

    const html = buildEmailHtml(options, false);
    const text = buildEmailPlainText(options, false);

    const result = await sendViaNodemailer({
      from: senderEmail,
      to: recipients,
      subject,
      html,
      text,
    });

    return {
      success: true,
      messageId: result.messageId,
      previewUrl: result.previewUrl,
      recipients,
      provider: result.provider,
    };
  } catch (err) {
    console.error("[EmailService] Failed to dispatch via Nodemailer:", err);
    return {
      success: false,
      recipients,
      provider: "console",
    };
  }
}
