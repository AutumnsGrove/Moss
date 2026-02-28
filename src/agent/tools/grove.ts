/**
 * Grove status tool — ping Grove service health endpoints.
 */

import type { Env } from "../../shared/env";
import type { ToolResult } from "../../shared/types";

const GROVE_SERVICES: Record<string, string> = {
  heartwood: "https://heartwood.grove.place/health",
  grove: "https://grove.place/health",
};

/** Check health of Grove services */
export async function groveStatus(
  env: Env,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const service = (args.service as string) ?? "all";

  const servicesToCheck =
    service === "all"
      ? Object.entries(GROVE_SERVICES)
      : Object.entries(GROVE_SERVICES).filter(([name]) => name === service);

  if (servicesToCheck.length === 0) {
    return {
      success: false,
      error: `Unknown service: ${service}. Available: ${Object.keys(GROVE_SERVICES).join(", ")}`,
    };
  }

  const results = await Promise.all(
    servicesToCheck.map(async ([name, url]) => {
      try {
        const start = Date.now();
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${env.HEARTWOOD_SERVICE_TOKEN}`,
            "User-Agent": "Moss/1.0",
          },
          signal: AbortSignal.timeout(5000),
        });
        const latency = Date.now() - start;

        return {
          service: name,
          status: res.ok ? "healthy" : "unhealthy",
          http_status: res.status,
          latency_ms: latency,
        };
      } catch {
        return {
          service: name,
          status: "unreachable",
          http_status: 0,
          latency_ms: -1,
        };
      }
    })
  );

  return { success: true, data: results };
}
