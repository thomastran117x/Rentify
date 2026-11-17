"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { authApi } from "@/lib/auth/api";
import type { AuthResponseBody } from "@/lib/auth/types";
import {
  cancelPasskeyCeremony,
  getPasskeyAssertion,
  supportsPasskeyAutofill,
  supportsPasskeys,
  type AuthenticationResponseJSON,
} from "@/lib/auth/webauthn";

/**
 * A sign-in challenge lasts five minutes, so a waiting autofill request is
 * started again with a fresh one a little before its challenge expires.
 */
export const PASSKEY_AUTOFILL_RESTART_MS = 270_000;

/** WebAuthn support does not change while the page is open. */
function subscribeToNothing(): () => void {
  return () => {};
}

export const PASSKEY_SIGN_IN_CANCELLED_MESSAGE =
  "The passkey prompt was closed. Try again when you're ready.";

interface UsePasskeySignInOptions {
  /**
   * Whether the sign-in form is showing and nobody is signed in. Passkey
   * autofill runs only while it is, and stops when it no longer is.
   */
  enabled: boolean;
  onSession: (session: AuthResponseBody) => Promise<void> | void;
  /** A refused sign-in, or a browser failure the user should be told about. */
  onFailure: (error: unknown) => void;
}

export interface PasskeySignIn {
  /** False until mounted, and in a browser without WebAuthn. */
  supported: boolean;
  /** A passkey sign-in is being verified, or the button's prompt is open. */
  pending: boolean;
  /** Set when the button's prompt was closed without a passkey. */
  notice: string | null;
  /** Runs the browser's passkey prompt and signs in with what it returns. */
  signIn: () => Promise<void>;
}

/**
 * Signing in with a passkey alone (#466), two ways: the **Sign in with a
 * passkey** button, which opens the browser's prompt, and passkey autofill on
 * the username field, which waits in the background for the user to pick a
 * passkey there. Both end the same way, with `onSession` or `onFailure`.
 *
 * The browser runs one prompt at a time: opening the button's prompt cancels
 * the waiting autofill request, which starts again once the prompt is done
 * with, unless it signed in.
 */
export function usePasskeySignIn({
  enabled,
  onSession,
  onFailure,
}: UsePasskeySignInOptions): PasskeySignIn {
  // False on the server and in the first client render, so the two agree.
  const supported = useSyncExternalStore(
    subscribeToNothing,
    supportsPasskeys,
    () => false,
  );
  const [autofillSupported, setAutofillSupported] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped to start the autofill request again with a fresh challenge.
  const [autofillRun, setAutofillRun] = useState(0);
  const busyRef = useRef(false);
  const autofillActiveRef = useRef(false);
  const callbacksRef = useRef({ onSession, onFailure });

  useEffect(() => {
    callbacksRef.current = { onSession, onFailure };
  }, [onSession, onFailure]);

  useEffect(() => {
    let cancelled = false;
    void supportsPasskeyAutofill().then((value) => {
      if (!cancelled) {
        setAutofillSupported(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Sends the assertion; true when it signed in. */
  const finish = useCallback(
    async (credential: AuthenticationResponseJSON): Promise<boolean> => {
      try {
        const session = await authApi.loginWithPasskey({ credential });
        await callbacksRef.current.onSession(session);
        return true;
      } catch (error) {
        callbacksRef.current.onFailure(error);
        return false;
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled || !autofillSupported) {
      return;
    }

    let stopped = false;
    const restart = window.setTimeout(
      () => setAutofillRun((run) => run + 1),
      PASSKEY_AUTOFILL_RESTART_MS,
    );

    void (async () => {
      try {
        const { options } = await authApi.getPasskeyLoginOptions();

        if (stopped || busyRef.current) {
          return;
        }

        autofillActiveRef.current = true;
        const result = await getPasskeyAssertion(options, { autofill: true });
        autofillActiveRef.current = false;

        // Cancelled: the button's prompt took over, or this run was replaced.
        if (stopped || result.status !== "completed") {
          return;
        }

        busyRef.current = true;
        setPending(true);
        setNotice(null);
        const signedIn = await finish(result.credential);
        busyRef.current = false;
        setPending(false);

        if (!signedIn) {
          setAutofillRun((run) => run + 1);
        }
      } catch {
        // Autofill is a convenience: if it cannot start, the button and the
        // password still work, so it stays quiet.
        autofillActiveRef.current = false;
      }
    })();

    return () => {
      stopped = true;
      window.clearTimeout(restart);
      if (autofillActiveRef.current) {
        autofillActiveRef.current = false;
        cancelPasskeyCeremony();
      }
    };
  }, [autofillRun, autofillSupported, enabled, finish]);

  const signIn = useCallback(async () => {
    if (busyRef.current) {
      return;
    }

    busyRef.current = true;
    // The prompt below cancels the waiting autofill request itself.
    autofillActiveRef.current = false;
    setPending(true);
    setNotice(null);
    let signedIn = false;

    try {
      const { options } = await authApi.getPasskeyLoginOptions();
      const result = await getPasskeyAssertion(options);

      if (result.status === "cancelled") {
        setNotice(PASSKEY_SIGN_IN_CANCELLED_MESSAGE);
        return;
      }

      signedIn = await finish(result.credential);
    } catch (error) {
      callbacksRef.current.onFailure(error);
    } finally {
      busyRef.current = false;
      setPending(false);
      if (!signedIn) {
        setAutofillRun((run) => run + 1);
      }
    }
  }, [finish]);

  return { supported, pending, notice, signIn };
}
