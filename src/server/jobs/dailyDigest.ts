// src/server/jobs/dailyDigest.ts
import { getEmailClient, EMAIL_FROM } from "@/infrastructure/email/client";
import { logger } from "@/shared/logger";
import { runWithRequestContext } from "@/lib/request-context";
import { acquireLock, releaseLock } from "@/server/lib/distributedLock";
import { adminRepository } from "@/modules/admin/admin.repository";
import { env } from "@/env";

const LOCK_KEY = "cron:daily-digest";
const LOCK_TTL_SECONDS = 300;

export async function sendDailyDigest() {
  const lock = await acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
  if (!lock) {
    logger.info("daily_digest.skipped_lock_held", {
      reason:
        "Another instance is already running — skipping to prevent duplicate digest emails.",
    });
    return;
  }

  try {
    return runWithRequestContext(
      { correlationId: `cron:sendDailyDigest:${Date.now()}` },
      async () => {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const {
          newUsers,
          newOrders,
          completedOrders,
          newDisputes,
          gmvTotalNzd,
          newSellers,
        } = await adminRepository.getDailyDigestMetrics(yesterday);

        const gmvFormatted = `$${(gmvTotalNzd / 100).toLocaleString("en-NZ", {
          minimumFractionDigits: 2,
        })}`;

        const superAdmins = await adminRepository.findSuperAdmins();

        const resend = getEmailClient();
        if (!resend || superAdmins.length === 0) {
          logger.warn("daily_digest.skipped", {
            reason: !resend ? "email_not_configured" : "no_super_admins",
          });
          return;
        }

        const date = new Date().toLocaleDateString("en-NZ", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });

        for (const admin of superAdmins) {
          await resend.emails.send({
            from: EMAIL_FROM,
            to: admin.email ?? "",
            subject: `${env.NEXT_PUBLIC_APP_NAME} Daily Summary — ${date}`,
            html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <div style="background:#141414;padding:20px;border-radius:12px;margin-bottom:24px;">
            <h1 style="color:#D4A843;margin:0;font-size:20px;">🥝 ${env.NEXT_PUBLIC_APP_NAME} Daily Summary</h1>
            <p style="color:#888;margin:4px 0 0;font-size:13px;">${date}</p>
          </div>

          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <tr>
              <td style="background:#F5ECD4;padding:16px;border-radius:8px;text-align:center;width:33%">
                <div style="font-size:28px;font-weight:bold;color:#141414;">${gmvFormatted}</div>
                <div style="font-size:12px;color:#73706A;margin-top:4px;">GMV Yesterday</div>
              </td>
              <td style="width:8px"></td>
              <td style="background:#F0FDF4;padding:16px;border-radius:8px;text-align:center;width:33%">
                <div style="font-size:28px;font-weight:bold;color:#141414;">${completedOrders}</div>
                <div style="font-size:12px;color:#73706A;margin-top:4px;">Orders Completed</div>
              </td>
              <td style="width:8px"></td>
              <td style="background:#EFF6FF;padding:16px;border-radius:8px;text-align:center;width:33%">
                <div style="font-size:28px;font-weight:bold;color:#141414;">${newUsers}</div>
                <div style="font-size:12px;color:#73706A;margin-top:4px;">New Users</div>
              </td>
            </tr>
          </table>

          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            ${[
              ["New Orders", newOrders],
              ["New Sellers", newSellers],
              ["New Disputes", newDisputes],
            ]
              .map(
                ([label, value], i) => `
              <tr style="background:${i % 2 === 0 ? "#FAFAF8" : "#fff"}">
                <td style="padding:10px 12px;color:#73706A;">${label}</td>
                <td style="padding:10px 12px;font-weight:600;color:#141414;text-align:right;">${value}</td>
              </tr>
            `,
              )
              .join("")}
          </table>

          <div style="margin-top:24px;text-align:center;">
            <a href="${env.NEXT_PUBLIC_APP_URL}/admin"
              style="background:#D4A843;color:#141414;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:600;font-size:14px;">
              View Full Dashboard →
            </a>
          </div>

          <p style="color:#C9C5BC;font-size:11px;margin-top:24px;text-align:center;">
            This is an automated daily summary sent to ${env.NEXT_PUBLIC_APP_NAME} Super Admins.
          </p>
        </div>
      `,
          });
        }

        logger.info("daily_digest.sent", {
          recipientCount: superAdmins.length,
          gmv: gmvTotalNzd,
          newOrders,
          completedOrders,
        });
      }, // end runWithRequestContext fn
    ); // end runWithRequestContext
  } finally {
    await releaseLock(LOCK_KEY, lock);
  }
}
