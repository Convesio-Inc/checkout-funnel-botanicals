/**
 * PaymentStatusDialog
 * -----------------------------------------------------------------------------
 * Modal driven by `useCheckoutPayment`'s status:
 *
 *   - "processing"  Spinner + "Processing payment". Non-dismissable (blocks
 *                   outside clicks + escape + hides the close `X`).
 *   - "success"     Check icon + "Payment complete" with order details.
 *                   Dismissable via the "Close" button.
 *   - "pending"     Clock icon + "Payment is being processed" with order
 *                   details. Used when ConvesioPay returns `status: "Pending"`,
 *                   i.e. the transaction passed initial checks but still needs
 *                   to be accepted/denied via an async webhook the worker
 *                   can't observe. Dismissable via the "Close" button.
 *   - "failed"      Alert icon + "Payment failed" with the error message.
 *                   Dismissable via the "Try again" button, which calls
 *                   `onClose` so the parent can reset back to `"idle"`.
 *
 * The dialog is open whenever `status !== "idle"`.
 *
 * Markers:
 *   - root               data-slot="payment-status-dialog"
 *   - status icon        data-slot="payment-status-icon"
 *   - error details      data-slot="payment-status-error"
 * -----------------------------------------------------------------------------
 */

import { CheckCircle2Icon, ClockIcon, XCircleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type {
  CheckoutPaymentStatus,
  PaymentResponse,
} from "@/hooks/useCheckoutPayment";

function PaymentResultDetails({ result }: { result: PaymentResponse | null }) {
  if (!result?.id) return null;
  return (
    <dl className="mx-auto grid max-w-full grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 text-xs">
      {result?.id && (
        <>
          <dt className="text-muted-foreground">Payment ID</dt>
          <dd className="font-mono break-all">{result.id}</dd>
        </>
      )}
    </dl>
  );
}

export interface PaymentStatusDialogProps {
  status: CheckoutPaymentStatus;
  error: Error | null;
  result: PaymentResponse | null;
  /** Called when the user closes a success or failure dialog. Parent should
   *  reset the hook to `"idle"` (and in failure, make the form editable). */
  onClose: () => void;
}

export function PaymentStatusDialog({
  status,
  error,
  result,
  onClose,
}: PaymentStatusDialogProps) {
  const open = status !== "idle";
  const isProcessing = status === "processing";

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !isProcessing) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-slot="payment-status-dialog"
        className="max-w-2xl!"
        showCloseButton={!isProcessing}
        onInteractOutside={(event) => {
          if (isProcessing) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (isProcessing) event.preventDefault();
        }}
      >
        {status === "processing" && (
          <>
            <div
              data-slot="payment-status-icon"
              className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted"
            >
              <Spinner className="size-6" />
            </div>
            <DialogHeader className="items-center text-center">
              <DialogTitle>Processing payment</DialogTitle>
              <DialogDescription>
                Please don't close this window — we're securely charging your
                card.
              </DialogDescription>
            </DialogHeader>
          </>
        )}

        {status === "success" && (
          <>
            <div
              data-slot="payment-status-icon"
              className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500"
            >
              <CheckCircle2Icon className="size-6" />
            </div>
            <DialogHeader className="items-center text-center">
              <DialogTitle>Payment complete</DialogTitle>
              <DialogDescription>
                Thanks! Your payment went through successfully.
              </DialogDescription>
            </DialogHeader>
            <PaymentResultDetails result={result} />
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}

        {status === "pending" && (
          <>
            <div
              data-slot="payment-status-icon"
              className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-500"
            >
              <ClockIcon className="size-6" />
            </div>
            <DialogHeader className="items-center text-center">
              <DialogTitle>Payment is being processed</DialogTitle>
              <DialogDescription>
                We've received your payment and it's going through a final
                review. You'll get a confirmation as soon as it's
                approved — you don't need to pay again.
              </DialogDescription>
            </DialogHeader>
            <PaymentResultDetails result={result} />
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}

        {status === "failed" && (
          <>
            <div
              data-slot="payment-status-icon"
              className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"
            >
              <XCircleIcon className="size-6" />
            </div>
            <DialogHeader className="items-center text-center">
              <DialogTitle>Payment failed</DialogTitle>
              <DialogDescription data-slot="payment-status-error">
                {error?.message ??
                  "Something went wrong while processing your payment."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Try again
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
