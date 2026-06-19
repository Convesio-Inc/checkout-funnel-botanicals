/**
 * useConvesioPayCheckout
 * -----------------------------------------------------------------------------
 * React hook that wires up a ConvesioPay checkout component lifecycle:
 *
 *   1. Fetches the public-safe credentials from `/config` (deduplicated across
 *      the whole app — see `fetchConvesioPayConfig`).
 *   2. Lazily initializes the ConvesioPay SDK instance (once per page load).
 *   3. Creates + mounts a component inside the provided container `ref`.
 *   4. Subscribes to the component's `change` event and derives `isValid`,
 *      so callers can gate a Pay Now button behind it.
 *
 * Returned shape:
 *
 *   {
 *     status,            // "loading" | "ready" | "error"
 *     component,         // mounted ConvesioPayComponent (or null)
 *     config,            // fetched /config payload (or null)
 *     error,             // any config / init / mount failure
 *     isValid,           // true when the last change event reports a
 *                        // submittable state (card: isValid, accelerated:
 *                        // isSuccessful). Starts at false.
 *     lastChangeEvent,   // raw payload from the most recent change event
 *                        // for callers that need `errors` / `valid` fields.
 *   }
 *
 * The mount runs only when the container ref resolves and is guarded against
 * React 18 StrictMode's effect double-invocation via a ref latch.
 * -----------------------------------------------------------------------------
 */

import { useEffect, useRef, useState, type RefObject } from "react";

import {
  fetchConvesioPayConfig,
  getConvesioPayInstance,
  type ConvesioPayConfig,
} from "@/lib/convesiopay";

export type ConvesioPayCheckoutStatus = "loading" | "ready" | "error";

/**
 * The ConvesioPay SDK's `component.mount(...)` runs `document.querySelector`
 * on whatever it receives, so it really needs a CSS selector string (the
 * docs' `domElement` parameter name is a red herring). If the caller's
 * container element doesn't already have an `id`, we stamp a unique one on
 * it so we can feed `"#that-id"` to the SDK.
 */
let autoIdCounter = 0;
function ensureSelector(el: HTMLElement): string {
  if (!el.id) {
    autoIdCounter += 1;
    el.id = `cpay-mount-${autoIdCounter}`;
  }
  return `#${el.id}`;
}

/** Component options the caller may customize. `environment` is
 *  injected from `/config`, so it is omitted here. */
export type ConvesioPayCheckoutOptions = Omit<
  ConvesioPayComponentOptions,
  "environment"
>;

export interface UseConvesioPayCheckoutResult {
  status: ConvesioPayCheckoutStatus;
  component: ConvesioPayComponent | null;
  config: ConvesioPayConfig | null;
  error: Error | null;
  isValid: boolean;
  lastChangeEvent: ConvesioPayChangeEvent | null;
}

function deriveIsValid(event: ConvesioPayChangeEvent): boolean {
  if ("isValid" in event) return event.isValid === true;
  if ("isSuccessful" in event) return event.isSuccessful === true;
  return false;
}

export function useConvesioPayCheckout(
  containerRef: RefObject<HTMLElement | null>,
  options: ConvesioPayCheckoutOptions = {},
): UseConvesioPayCheckoutResult {
  const [config, setConfig] = useState<ConvesioPayConfig | null>(null);
  const [component, setComponent] = useState<ConvesioPayComponent | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isValid, setIsValid] = useState(false);
  const [lastChangeEvent, setLastChangeEvent] =
    useState<ConvesioPayChangeEvent | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchConvesioPayConfig()
      .then((next) => {
        if (!cancelled) setConfig(next);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!config || !containerRef.current || mountedRef.current) return;

    try {
      const cpay = getConvesioPayInstance(config.apiKey);
      const instance = cpay.component({
        environment: config.environment,
        ...options,
      });
      instance.mount(ensureSelector(containerRef.current));
      mountedRef.current = true;
      // One-shot status flip after the SDK mounts its iframe — guarded by
      // mountedRef, so there's no cascading-render risk.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setComponent(instance);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
    // Intentionally ignoring `options`: the component is mounted once, and
    // callers should drive updates via component.updateEmail /
    // component.updateAmount. Re-running this effect would create a duplicate
    // component in the same container.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, containerRef]);

  useEffect(() => {
    if (!component) return;

    const handleChange = (event: ConvesioPayChangeEvent) => {
      setLastChangeEvent(event);
      setIsValid(deriveIsValid(event));
    };

    component.on("change", handleChange);

    return () => {
      // `off` is not documented as guaranteed; call it defensively.
      component.off?.("change", handleChange);
    };
  }, [component]);

  const status: ConvesioPayCheckoutStatus = error
    ? "error"
    : component
      ? "ready"
      : "loading";

  return {
    status,
    component,
    config,
    error,
    isValid,
    lastChangeEvent,
  };
}
