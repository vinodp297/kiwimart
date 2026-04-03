import "server-only";
// src/lib/platform-config/index.ts
// ─── Barrel Export ──────────────────────────────────────────────────────────

export { CONFIG_KEYS, type ConfigKey } from "./config-keys";
export {
  getConfigInt,
  getConfigFloat,
  getConfigBool,
  getConfigString,
  getConfigJson,
  getConfigMany,
  invalidateConfig,
  invalidateAllConfig,
} from "./config.service";
