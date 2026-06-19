export {};

declare global {
  type ConvesioPayEnvironment = "test" | "live";
  type ConvesioPayTheme = "light" | "dark";

  interface ConvesioPayComponentOptions {
    environment: ConvesioPayEnvironment;
    customerEmail?: string;
    integration?: string;
    theme?: ConvesioPayTheme;
    amount?: number;
    currency?: string;
  }

  /** Payload fired by the `change` event for the card fields flow. */
  interface ConvesioPayCardChangeEvent {
    type: string;
    isValid: boolean;
    valid: Record<string, boolean>;
    errors: Record<string, string | null>;
  }

  /** Payload fired by the `change` event for accelerated payment methods
   *  (ApplePay, GooglePay, BTCPay, …). */
  interface ConvesioPayAcceleratedChangeEvent {
    type: string;
    isSuccessful: boolean;
    token?: string;
    email?: string;
    billingContact?: Record<string, unknown>;
    shippingContact?: Record<string, unknown>;
    shippingMethod?: Record<string, unknown>;
    errors?: string[];
  }

  type ConvesioPayChangeEvent =
    | ConvesioPayCardChangeEvent
    | ConvesioPayAcceleratedChangeEvent;

  interface ConvesioPayComponentEventMap {
    change: ConvesioPayChangeEvent;
  }

  interface ConvesioPayComponent {
    mount: (selector: string) => void;
    updateEmail: (email: string) => void;
    updateAmount: (amount: number, currency?: string) => void;
    createToken: () => Promise<string>;
    on: <K extends keyof ConvesioPayComponentEventMap>(
      event: K,
      handler: (payload: ConvesioPayComponentEventMap[K]) => void,
    ) => void;
    off?: <K extends keyof ConvesioPayComponentEventMap>(
      event: K,
      handler: (payload: ConvesioPayComponentEventMap[K]) => void,
    ) => void;
  }

  interface ConvesioPayInstance {
    component: (options: ConvesioPayComponentOptions) => ConvesioPayComponent;
  }

  function ConvesioPay(apiKey: string): ConvesioPayInstance;

  interface Window {
    ConvesioPay: typeof ConvesioPay;
  }
}
