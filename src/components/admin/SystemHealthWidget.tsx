"use client";
// src/components/admin/SystemHealthWidget.tsx
// ─── System Health Widget ─────────────────────────────────────────────────────
// Client component that calls /api/admin/health and auto-refreshes every 60 seconds.

import { useEffect, useState, useCallback } from "react";

interface ServiceCheck {
  name: string;
  status: "ok" | "error";
  latencyMs?: number;
  error?: string;
}

interface HealthResponse {
  status: "ok" | "degraded";
  totalLatencyMs: number;
  services: ServiceCheck[];
}

export default function SystemHealthWidget() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/health");
      if (!res.ok) {
        setHealth(null);
        return;
      }
      const data: HealthResponse = await res.json();
      // Guard against malformed responses missing services array
      if (!data.services || !Array.isArray(data.services)) {
        setHealth(null);
        return;
      }
      setHealth(data);
      setLastChecked(new Date());
    } catch {
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 60_000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const serviceLabel: Record<string, string> = {
    database: "Database",
    redis: "Redis",
    stripe: "Stripe",
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E3E0D9] p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-[family-name:var(--font-playfair)] text-[1.1rem] font-semibold text-[#141414]">
          System Health
        </h2>
        {lastChecked && (
          <span className="text-[11px] text-[#9E9A91]">
            Updated {lastChecked.toLocaleTimeString("en-NZ")}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-[#9E9A91]">
          <svg
            className="animate-spin"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          Checking services…
        </div>
      ) : !health ? (
        <p className="text-[13px] text-red-600">Health check unavailable</p>
      ) : (
        <div className="space-y-3">
          {(health.services ?? []).map((service) => (
            <div
              key={service.name}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full ${
                    service.status === "ok" ? "bg-emerald-500" : "bg-red-500"
                  }`}
                  aria-label={service.status}
                />
                <span className="text-[13.5px] font-medium text-[#141414]">
                  {serviceLabel[service.name] ?? service.name}
                </span>
              </div>
              <div className="text-right">
                {service.status === "ok" ? (
                  <span className="text-[12px] text-[#9E9A91]">
                    Connected
                    {service.latencyMs !== undefined
                      ? ` (${service.latencyMs}ms)`
                      : ""}
                  </span>
                ) : (
                  <span className="text-[12px] text-red-600 truncate max-w-[200px]">
                    {service.error ?? "Error"}
                  </span>
                )}
              </div>
            </div>
          ))}

          <div className="pt-2 border-t border-[#F0EDE6] flex items-center justify-between">
            <span className="text-[12px] text-[#9E9A91]">Overall status</span>
            <span
              className={`text-[12px] font-semibold ${
                health.status === "ok" ? "text-emerald-600" : "text-red-600"
              }`}
            >
              {health.status === "ok"
                ? "● All systems operational"
                : "● Degraded"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
