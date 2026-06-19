/**
 * convesiopay.ts
 * -----------------------------------------------------------------------------
 * Thin wrapper around the ConvesioPay.js browser SDK:
 *
 *   1. `fetchConvesioPayConfig()` — GETs /config from the Cloudflare worker
 *      exactly once per page load. The in-flight promise is cached at module
 *      scope so every caller (across renders, components, or StrictMode double
 *      mounts) awaits the same request. A failed request is not cached, so a
 *      subsequent call will retry.
 *
 *   2. `getConvesioPayInstance(apiKey)` — lazily calls `ConvesioPay(apiKey)`
 *      exactly once per page load. Per the ConvesioPay docs, "You need only
 *      create one instance of the ConvesioPay object in your code."
 *
 * The ConvesioPay.js script itself is loaded synchronously from
 * `<script src="https://js.convesiopay.com/v1/">` in `index.html`, so
 * `window.ConvesioPay` is expected to be defined by the time React renders.
 * -----------------------------------------------------------------------------
 */

export interface ConvesioPayConfig {
  apiKey: string;
  environment: ConvesioPayEnvironment;
}

const CONFIG_ENDPOINT = "/config";

let configPromise: Promise<ConvesioPayConfig> | null = null;

export function fetchConvesioPayConfig(): Promise<ConvesioPayConfig> {
  if (configPromise) return configPromise;

  configPromise = (async () => {
    const response = await fetch(CONFIG_ENDPOINT, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to load ConvesioPay config: ${response.status} ${response.statusText}`,
      );
    }
    return (await response.json()) as ConvesioPayConfig;
  })().catch((err) => {
    configPromise = null;
    throw err;
  });

  return configPromise;
}

let cpayInstance: ConvesioPayInstance | null = null;

export function getConvesioPayInstance(apiKey: string): ConvesioPayInstance {
  if (cpayInstance) return cpayInstance;

  if (typeof window === "undefined" || typeof window.ConvesioPay !== "function") {
    throw new Error(
      "ConvesioPay.js is not available on window. Verify the <script src=\"https://js.convesiopay.com/v1/\"> tag in index.html.",
    );
  }

  cpayInstance = window.ConvesioPay(apiKey);
  return cpayInstance;
}
