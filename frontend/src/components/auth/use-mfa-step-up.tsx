"use client";

import { useCallback, useRef, useState } from "react";
import { MfaVerificationDialog } from "@/components/auth/mfa-verification-dialog";
import { type ApiClientError, isApiClientError } from "@/lib/api/types";
import {
  type MfaVerificationOptionsResult,
  mfaVerificationApi,
} from "@/lib/auth/mfa-verification-api";

const STEP_UP_SCOPE = "mfa-management";

export type StepUpOutcome<T> =
  | { completed: true; result: T }
  | { completed: false };

export type RunWithStepUp = <T>(
  action: () => Promise<T>,
) => Promise<StepUpOutcome<T>>;

type StepUpErrorDetails = Omit<MfaVerificationOptionsResult, "verified">;

function isStepUpRequired(error: unknown): error is ApiClientError {
  return isApiClientError(error) && error.code === "MFA_VERIFICATION_REQUIRED";
}

function readErrorOptions(
  error: ApiClientError,
): MfaVerificationOptionsResult | null {
  const details = error.details as Partial<StepUpErrorDetails> | undefined;

  return details?.availableFactors?.length
    ? { ...(details as StepUpErrorDetails), verified: false }
    : null;
}

/**
 * Lets a sensitive action run first and only asks for a second factor when the
 * backend says the session needs one, so a recent proof costs no extra prompt.
 *
 * `runWithStepUp` retries the action once after the dialog succeeds, and
 * resolves `{ completed: false }` when it is dismissed. Any other failure is
 * thrown as usual, so the caller keeps its own error handling. Render
 * `stepUpDialog` somewhere in the component.
 */
export function useMfaStepUp() {
  const [dialogOptions, setDialogOptions] =
    useState<MfaVerificationOptionsResult | null>(null);
  const resolverRef = useRef<((verified: boolean) => void) | null>(null);

  const settle = useCallback((verified: boolean) => {
    setDialogOptions(null);
    resolverRef.current?.(verified);
    resolverRef.current = null;
  }, []);

  const runWithStepUp = useCallback(
    async <T,>(action: () => Promise<T>): Promise<StepUpOutcome<T>> => {
      try {
        return { completed: true, result: await action() };
      } catch (error) {
        if (!isStepUpRequired(error)) {
          throw error;
        }

        const options =
          readErrorOptions(error) ??
          (await mfaVerificationApi.getOptions(STEP_UP_SCOPE));

        const verified =
          options.verified ||
          (await new Promise<boolean>((resolve) => {
            resolverRef.current = resolve;
            setDialogOptions(options);
          }));

        return verified
          ? { completed: true, result: await action() }
          : { completed: false };
      }
    },
    [],
  );

  const stepUpDialog = dialogOptions ? (
    <MfaVerificationDialog
      open
      initialOptions={dialogOptions}
      scope={STEP_UP_SCOPE}
      onVerified={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { runWithStepUp, stepUpDialog };
}
