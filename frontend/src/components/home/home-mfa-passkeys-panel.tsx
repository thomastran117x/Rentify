"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Fingerprint } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { RecoveryCodesDisplay } from "@/components/auth/recovery-codes-display";
import { useMfaStepUp } from "@/components/auth/use-mfa-step-up";
import { getApiErrorMessage } from "@/lib/api/user-messages";
import { mfaTotpApi } from "@/lib/auth/mfa-totp-api";
import {
  passkeysApi,
  suggestPasskeyName,
  type PasskeySummary,
} from "@/lib/auth/passkeys-api";
import {
  createPasskey,
  PasskeyCeremonyError,
  supportsPasskeys,
} from "@/lib/auth/webauthn";

interface HomeMfaPasskeysPanelProps {
  /** Changes when another panel changed the account's factors. */
  refreshKey?: number;
  /** Called after a passkey is added or removed. */
  onFactorsChanged?: () => void;
}

type Notice = { tone: "success" | "error" | "info"; text: string } | null;

interface LoadedState {
  passkeys: PasskeySummary[] | null;
  error: string | null;
  totpEnabled: boolean;
}

const NAME_MAX_LENGTH = 64;

const NOTICE_TONES: Record<NonNullable<Notice>["tone"], string> = {
  success:
    "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200",
  error:
    "border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300",
  info: "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200",
};

const SECONDARY_BUTTON =
  "inline-flex h-9 items-center justify-center rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-sm font-semibold text-slate-700 dark:text-slate-200 transition hover:bg-slate-50 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY_BUTTON =
  "inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200";
const DANGER_BUTTON =
  "inline-flex h-9 items-center justify-center rounded-xl bg-rose-600 px-3 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60";
const INPUT =
  "h-10 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-slate-900 dark:text-white outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100 dark:focus:ring-violet-950";

const CANCELLED_MESSAGE =
  "The passkey prompt closed before it finished. Nothing was added.";

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

/** Only used to warn before the last strong factor goes. */
function readTotpEnabled(): Promise<boolean> {
  return mfaTotpApi
    .getStatus()
    .then((result) => result.enabled)
    .catch(() => false);
}

function subscribeNever() {
  return () => undefined;
}

function describeError(error: unknown, action: string, fallback: string) {
  if (error instanceof PasskeyCeremonyError) {
    return error.message;
  }

  return getApiErrorMessage(error, {
    action,
    fallback,
    preserveClientMessage: true,
  });
}

/**
 * The account's passkeys: adding one, renaming and removing them. Every
 * request goes through step-up. A passkey is added with a name the user can
 * edit first; the browser prompt does the rest.
 *
 * The list is kept in step with each response rather than read again, since
 * adding the first passkey changes the account's factors and would otherwise
 * ask for a step-up straight away just to show it.
 */
export function HomeMfaPasskeysPanel({
  refreshKey = 0,
  onFactorsChanged,
}: HomeMfaPasskeysPanelProps) {
  const { status } = useAuth();
  const { runWithStepUp, stepUpDialog } = useMfaStepUp();
  const supported = useSyncExternalStore(
    subscribeNever,
    supportsPasskeys,
    () => true,
  );
  const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{
    id: string;
    draft: string;
  } | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const busy = pendingAction !== null;

  const fetchState = useCallback(async (): Promise<LoadedState> => {
    let loaded: Omit<LoadedState, "totpEnabled">;

    try {
      const outcome = await runWithStepUp(() => passkeysApi.list());
      loaded = outcome.completed
        ? { passkeys: outcome.result.passkeys, error: null }
        : { passkeys: null, error: "Verify it's you to see your passkeys." };
    } catch (error) {
      loaded = {
        passkeys: null,
        error: describeError(
          error,
          "load your passkeys",
          "We couldn't load your passkeys right now. Please refresh the page.",
        ),
      };
    }

    return { ...loaded, totpEnabled: await readTotpEnabled() };
  }, [runWithStepUp]);

  const applyState = useCallback((loaded: LoadedState) => {
    setTotpEnabled(loaded.totpEnabled);
    setLoadError(loaded.error);
    if (loaded.passkeys) {
      setPasskeys(loaded.passkeys);
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    let active = true;

    void fetchState().then((loaded) => {
      if (active) {
        applyState(loaded);
      }
    });

    return () => {
      active = false;
    };
  }, [applyState, fetchState, status]);

  // Another panel changed the factors: only the authenticator's state, which
  // decides the last-factor warning, can have moved. The list is this panel's
  // own, and reading it again here would ask for a step-up straight after
  // adding the first passkey.
  useEffect(() => {
    if (status !== "authenticated" || refreshKey === 0) {
      return;
    }

    let active = true;

    void readTotpEnabled().then((enabled) => {
      if (active) {
        setTotpEnabled(enabled);
      }
    });

    return () => {
      active = false;
    };
  }, [refreshKey, status]);

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = (newName ?? "").trim();

    if (!name) {
      setNotice({ tone: "error", text: "Give the passkey a name." });
      return;
    }

    setNotice(null);
    setPendingAction("add");
    let cancelled = false;

    try {
      const outcome = await runWithStepUp(async () => {
        const { options } = await passkeysApi.getRegistrationOptions();
        const ceremony = await createPasskey(options);

        if (ceremony.status === "cancelled") {
          cancelled = true;
          return null;
        }

        cancelled = false;
        return passkeysApi.verifyRegistration(ceremony.credential, name);
      });

      if (!outcome.completed || outcome.result === null) {
        if (cancelled) {
          setNotice({ tone: "info", text: CANCELLED_MESSAGE });
        }
        return;
      }

      const { passkey, recoveryCodes: codes } = outcome.result;
      setPasskeys((current) => [...(current ?? []), passkey]);
      setNewName(null);
      setNotice({
        tone: "success",
        text: `"${passkey.name}" was added. Use it to sign in and to confirm it's you.`,
      });
      if (codes?.length) {
        setRecoveryCodes(codes);
      }
      onFactorsChanged?.();
    } catch (error) {
      setNotice({
        tone: "error",
        text: describeError(
          error,
          "add your passkey",
          "We couldn't add your passkey right now. Please try again.",
        ),
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function handleRename(passkey: PasskeySummary) {
    const draft = (renaming?.draft ?? "").trim();

    if (!draft) {
      setNotice({ tone: "error", text: "Give the passkey a name." });
      return;
    }

    if (draft === passkey.name) {
      setRenaming(null);
      return;
    }

    setNotice(null);
    setPendingAction(`rename:${passkey.id}`);

    try {
      const outcome = await runWithStepUp(() =>
        passkeysApi.rename(passkey.id, draft),
      );

      if (!outcome.completed) {
        return;
      }

      const renamed = outcome.result.passkey;
      setPasskeys((current) =>
        (current ?? []).map((entry) =>
          entry.id === renamed.id ? renamed : entry,
        ),
      );
      setRenaming(null);
      setNotice({ tone: "success", text: "Passkey renamed." });
    } catch (error) {
      setNotice({
        tone: "error",
        text: describeError(
          error,
          "rename your passkey",
          "We couldn't rename your passkey right now. Please try again.",
        ),
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function handleRemove(passkey: PasskeySummary, wasLast: boolean) {
    setNotice(null);
    setPendingAction(`remove:${passkey.id}`);

    try {
      const outcome = await runWithStepUp(() => passkeysApi.remove(passkey.id));

      if (!outcome.completed) {
        return;
      }

      setPasskeys((current) =>
        (current ?? []).filter((entry) => entry.id !== passkey.id),
      );
      setConfirmRemoveId(null);
      setNotice({
        tone: "success",
        text: wasLast
          ? "Passkey removed. Your other sessions were signed out, your recovery codes stopped working, and identity checks now use email codes."
          : "Passkey removed.",
      });
      onFactorsChanged?.();
    } catch (error) {
      setNotice({
        tone: "error",
        text: describeError(
          error,
          "remove your passkey",
          "We couldn't remove your passkey right now. Please try again.",
        ),
      });
    } finally {
      setPendingAction(null);
    }
  }

  if (status !== "authenticated") {
    return null;
  }

  const isLastStrongFactor = (passkeys?.length ?? 0) === 1 && !totpEnabled;

  return (
    <section
      aria-labelledby="passkeys-heading"
      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300">
          <Fingerprint className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2
            id="passkeys-heading"
            className="text-2xl font-semibold text-slate-950 dark:text-white"
          >
            Passkeys
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Confirm it&apos;s you with your fingerprint, face, screen lock or a
            security key. Passkeys only work on Rentify, so they can&apos;t be
            phished.
          </p>
        </div>
      </div>

      {notice ? (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`mt-5 rounded-xl border px-4 py-3 text-sm ${NOTICE_TONES[notice.tone]}`}
        >
          {notice.text}
        </div>
      ) : null}

      {!supported ? (
        <p className="mt-5 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          This browser can&apos;t create passkeys. You can still rename or
          remove the ones you have.
        </p>
      ) : null}

      {recoveryCodes ? (
        <div className="mt-6">
          <RecoveryCodesDisplay
            codes={recoveryCodes}
            onDone={() => {
              setRecoveryCodes(null);
              onFactorsChanged?.();
            }}
          />
        </div>
      ) : passkeys === null ? (
        <div className="mt-6 text-sm text-slate-500 dark:text-slate-400">
          {loadError ? (
            <div
              role="alert"
              className={`flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${NOTICE_TONES.error}`}
            >
              <span>{loadError}</span>
              <button
                type="button"
                onClick={() => void fetchState().then(applyState)}
                className={SECONDARY_BUTTON}
              >
                Try again
              </button>
            </div>
          ) : (
            "Loading..."
          )}
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {passkeys.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
              No passkeys yet. Add one to sign in without typing a code.
            </p>
          ) : (
            <ul className="space-y-3" aria-label="Your passkeys">
              {passkeys.map((passkey) => {
                const isRenaming = renaming?.id === passkey.id;
                const isConfirmingRemove = confirmRemoveId === passkey.id;

                return (
                  <li
                    key={passkey.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-3"
                  >
                    {isRenaming ? (
                      <form
                        className="flex flex-col gap-2 sm:flex-row sm:items-center"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleRename(passkey);
                        }}
                      >
                        <label
                          className="sr-only"
                          htmlFor={`rename-${passkey.id}`}
                        >
                          Passkey name
                        </label>
                        <input
                          id={`rename-${passkey.id}`}
                          autoFocus
                          maxLength={NAME_MAX_LENGTH}
                          value={renaming.draft}
                          onChange={(event) =>
                            setRenaming({
                              id: passkey.id,
                              draft: event.target.value,
                            })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              setRenaming(null);
                            }
                          }}
                          className={INPUT}
                        />
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={busy}
                            className={PRIMARY_BUTTON}
                          >
                            {pendingAction === `rename:${passkey.id}`
                              ? "Saving..."
                              : "Save"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setRenaming(null)}
                            className={SECONDARY_BUTTON}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-950 dark:text-white">
                            <span className="break-all">{passkey.name}</span>
                            {passkey.backedUp ? (
                              <span className="rounded-full bg-violet-50 dark:bg-violet-950/40 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
                                Synced
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            Added {formatDate(passkey.createdAt)}
                            {" · "}
                            {passkey.lastUsedAt
                              ? `Last used ${formatDate(passkey.lastUsedAt)}`
                              : "Not used yet"}
                          </p>
                        </div>
                        {isConfirmingRemove ? null : (
                          <div className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setNotice(null);
                                setConfirmRemoveId(null);
                                setRenaming({
                                  id: passkey.id,
                                  draft: passkey.name,
                                });
                              }}
                              className={SECONDARY_BUTTON}
                              aria-label={`Rename ${passkey.name}`}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setNotice(null);
                                setRenaming(null);
                                setConfirmRemoveId(passkey.id);
                              }}
                              className={SECONDARY_BUTTON}
                              aria-label={`Remove ${passkey.name}`}
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {isConfirmingRemove ? (
                      <div
                        role="alertdialog"
                        aria-label={`Remove ${passkey.name}?`}
                        className="mt-3 rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/40 px-4 py-3"
                      >
                        <p className="text-sm font-medium text-rose-800 dark:text-rose-200">
                          Remove this passkey?
                        </p>
                        {isLastStrongFactor ? (
                          <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">
                            It&apos;s your last passkey and you have no
                            authenticator app, so removing it also signs out
                            your other sessions and deletes your recovery codes.
                            Identity checks will use email codes instead.
                          </p>
                        ) : (
                          <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">
                            It will stop working for signing in and for
                            confirming it&apos;s you.
                          </p>
                        )}
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void handleRemove(passkey, isLastStrongFactor)
                            }
                            className={DANGER_BUTTON}
                          >
                            {pendingAction === `remove:${passkey.id}`
                              ? "Removing..."
                              : "Remove passkey"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmRemoveId(null)}
                            className={SECONDARY_BUTTON}
                          >
                            Keep it
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {newName !== null ? (
            <form
              onSubmit={(event) => void handleAdd(event)}
              className="space-y-2 rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-3"
            >
              <label
                htmlFor="new-passkey-name"
                className="text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Name this passkey
              </label>
              <input
                id="new-passkey-name"
                autoFocus
                maxLength={NAME_MAX_LENGTH}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                className={INPUT}
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Your browser will then ask you to create the passkey.
              </p>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className={PRIMARY_BUTTON}
                >
                  {pendingAction === "add"
                    ? "Waiting for your passkey..."
                    : "Continue"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setNewName(null)}
                  className={SECONDARY_BUTTON}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              disabled={busy || !supported}
              onClick={() => {
                setNotice(null);
                setNewName(suggestPasskeyName(navigator.userAgent));
              }}
              className={PRIMARY_BUTTON}
            >
              Add a passkey
            </button>
          )}
        </div>
      )}

      {stepUpDialog}
    </section>
  );
}
