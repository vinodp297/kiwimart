// src/app/(protected)/admin/system/page.tsx
// ─── System Status Page ──────────────────────────────────────────────────────
import Link from "next/link";
import { requirePermission } from "@/shared/auth/requirePermission";
// eslint-disable-next-line no-restricted-imports -- pre-existing page-level DB access, migrate to repository in a dedicated sprint
import db from "@/lib/db";
import { getRedisClient } from "@/infrastructure/redis/client";
import { logger } from "@/shared/logger";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "System — Admin" };
export const dynamic = "force-dynamic";

const APP_VERSION = process.env.npm_package_version ?? "0.1.0";

const CRON_JOBS: { name: string; schedule: string; scheduleLabel: string }[] = [
  {
    name: "auto-release",
    schedule: "0 2 * * *",
    scheduleLabel: "Daily 2:00 AM UTC",
  },
  {
    name: "dispute-auto-resolve",
    schedule: "0 3 * * *",
    scheduleLabel: "Daily 3:00 AM UTC",
  },
  {
    name: "expire-listings",
    schedule: "30 3 * * *",
    scheduleLabel: "Daily 3:30 AM UTC",
  },
  {
    name: "delivery-reminders",
    schedule: "0 4 * * *",
    scheduleLabel: "Daily 4:00 AM UTC",
  },
  {
    name: "seller-downgrade",
    schedule: "0 6 * * *",
    scheduleLabel: "Daily 6:00 AM UTC",
  },
  {
    name: "daily-digest",
    schedule: "0 7 * * *",
    scheduleLabel: "Daily 7:00 AM UTC",
  },
  {
    name: "price-drop-alerts",
    schedule: "0 9 * * *",
    scheduleLabel: "Daily 9:00 AM UTC",
  },
  {
    name: "stripe-reconciliation",
    schedule: "0 14 * * *",
    scheduleLabel: "Daily 2:00 PM UTC",
  },
];

interface CronJobRow {
  name: string;
  scheduleLabel: string;
  lastRunAt: Date | null;
  lastStatus: "success" | "error" | null;
}

async function getCronJobStatuses(): Promise<CronJobRow[]> {
  try {
    const latestRuns = await db.cronLog.findMany({
      where: { jobName: { in: CRON_JOBS.map((j) => j.name) } },
      orderBy: { startedAt: "desc" },
      take: 200,
    });
    const byJob = new Map<string, { startedAt: Date; status: string }>();
    for (const row of latestRuns) {
      if (!byJob.has(row.jobName)) {
        byJob.set(row.jobName, {
          startedAt: row.startedAt,
          status: row.status,
        });
      }
    }
    return CRON_JOBS.map((job) => {
      const last = byJob.get(job.name);
      return {
        name: job.name,
        scheduleLabel: job.scheduleLabel,
        lastRunAt: last ? last.startedAt : null,
        lastStatus: last ? (last.status as "success" | "error") : null,
      };
    });
  } catch (err) {
    logger.warn("system.cron_jobs.query_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return CRON_JOBS.map((job) => ({
      name: job.name,
      scheduleLabel: job.scheduleLabel,
      lastRunAt: null,
      lastStatus: null,
    }));
  }
}

function formatRelative(date: Date | null): string {
  if (!date) return "Never";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface ServiceStatus {
  name: string;
  status: "ok" | "error";
  latencyMs: number;
  detail?: string;
}

async function checkDatabase(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return {
      name: "Database",
      status: "ok",
      latencyMs: Date.now() - start,
      detail: "PostgreSQL (Neon)",
    };
  } catch (err) {
    return {
      name: "Database",
      status: "error",
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

async function checkRedis(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const redis = getRedisClient();
    await redis.ping();
    return {
      name: "Redis",
      status: "ok",
      latencyMs: Date.now() - start,
      detail: "Upstash Redis",
    };
  } catch (err) {
    return {
      name: "Redis",
      status: "error",
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

export default async function SystemPage() {
  await requirePermission("VIEW_SYSTEM_HEALTH");

  const env = process.env.NODE_ENV ?? "unknown";
  const vercelEnv = process.env.VERCEL_ENV ?? null;
  const region = process.env.VERCEL_REGION ?? null;
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;

  // Run health checks in parallel
  const [dbStatus, redisStatus, cronJobs] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    getCronJobStatuses(),
  ]);

  const services = [dbStatus, redisStatus];
  const allHealthy = services.every((s) => s.status === "ok");

  if (!allHealthy) {
    logger.warn("system.page.degraded", {
      services: services.filter((s) => s.status === "error"),
    });
  }

  const envInfo = [
    { label: "Environment", value: vercelEnv ?? env },
    { label: "App Version", value: APP_VERSION },
    ...(commitSha ? [{ label: "Commit", value: commitSha }] : []),
    ...(region ? [{ label: "Region", value: region }] : []),
    { label: "Node.js", value: process.version },
  ];

  const endpoints = [
    {
      label: "Admin Health Check",
      href: "/api/admin/health",
      description: "Detailed service health (authenticated)",
    },
    {
      label: "Worker Health",
      href: "/api/workers/health",
      description: "Background job queue status",
    },
  ];

  return (
    <div className="bg-[#FAFAF8] min-h-screen">
      <div className="bg-[#141414] text-white">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-center gap-2 text-[12px] text-white/40 mb-2">
            <Link href="/admin" className="hover:text-white">
              Admin
            </Link>
            <span>/</span>
            <span className="text-white">System</span>
          </div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-[#D4A843] text-xl">&#9881;&#65039;</span>
            <h1 className="font-[family-name:var(--font-playfair)] text-[1.75rem] font-semibold">
              System Status
            </h1>
          </div>
          <p className="text-white/50 text-[13.5px]">
            {allHealthy
              ? "All systems operational"
              : "Some services are degraded"}
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Overall status banner */}
        <div
          className={`border rounded-2xl px-5 py-4 text-[13.5px] font-medium ${
            allHealthy
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {allHealthy
            ? "All systems operational"
            : "One or more services are degraded"}
        </div>

        {/* Service health */}
        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
          <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-4">
            Service Health
          </h2>
          <div className="space-y-3">
            {services.map((service) => (
              <div
                key={service.name}
                className="flex items-center justify-between py-3 border-b border-[#F0EDE8] last:border-0"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-block w-3 h-3 rounded-full ${
                      service.status === "ok" ? "bg-emerald-500" : "bg-red-500"
                    }`}
                  />
                  <div>
                    <p className="text-[13.5px] font-semibold text-[#141414]">
                      {service.name}
                    </p>
                    {service.detail && (
                      <p className="text-[12px] text-[#9E9A91]">
                        {service.detail}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <span
                    className={`text-[12px] font-semibold ${
                      service.status === "ok"
                        ? "text-emerald-600"
                        : "text-red-600"
                    }`}
                  >
                    {service.status === "ok" ? "Connected" : "Error"}
                  </span>
                  <p className="text-[11px] text-[#C9C5BC]">
                    {service.latencyMs}ms
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cron Jobs */}
        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
          <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-4">
            Cron Jobs
          </h2>
          <div className="space-y-3">
            {cronJobs.map((job) => (
              <div
                key={job.name}
                className="flex items-center justify-between py-3 border-b border-[#F0EDE8] last:border-0"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-block w-3 h-3 rounded-full bg-emerald-500" />
                  <div>
                    <p className="text-[13.5px] font-semibold text-[#141414] font-mono">
                      {job.name}
                    </p>
                    <p className="text-[12px] text-[#9E9A91]">
                      {job.scheduleLabel} · Scheduled
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  {job.lastStatus ? (
                    <span
                      className={`text-[12px] font-semibold ${
                        job.lastStatus === "success"
                          ? "text-emerald-600"
                          : "text-red-600"
                      }`}
                    >
                      {job.lastStatus === "success" ? "Success" : "Failed"}
                    </span>
                  ) : (
                    <span className="text-[12px] font-semibold text-[#C9C5BC]">
                      No runs yet
                    </span>
                  )}
                  <p className="text-[11px] text-[#C9C5BC]">
                    {formatRelative(job.lastRunAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Environment info */}
        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
          <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-4">
            Environment
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {envInfo.map(({ label, value }) => (
              <div
                key={label}
                className="bg-[#F8F7F4] rounded-xl p-3 border border-[#E3E0D9]"
              >
                <p className="text-[10px] font-semibold text-[#9E9A91] uppercase tracking-wider mb-1">
                  {label}
                </p>
                <p className="text-[13.5px] font-semibold text-[#141414] font-mono">
                  {value}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Health endpoints */}
        <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
          <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414] mb-4">
            Health Endpoints
          </h2>
          <div className="space-y-3">
            {endpoints.map(({ label, href, description }) => (
              <Link
                key={href}
                href={href}
                target="_blank"
                className="flex items-center justify-between p-4 rounded-xl border border-[#E3E0D9] hover:border-[#D4A843] hover:bg-[#F5ECD4]/30 transition-all duration-150"
              >
                <div>
                  <p className="text-[13.5px] font-semibold text-[#141414]">
                    {label}
                  </p>
                  <p className="text-[12px] text-[#9E9A91]">{description}</p>
                </div>
                <code className="text-[11.5px] text-[#73706A] bg-[#F8F7F4] px-2.5 py-1 rounded-lg border border-[#E3E0D9] font-mono">
                  {href}
                </code>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
