import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/types";
import type { PasskeySummary } from "@/lib/auth/passkeys-api";
import { HomeMfaPasskeysPanel } from "./home-mfa-passkeys-panel";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  list: vi.fn(),
  getRegistrationOptions: vi.fn(),
  verifyRegistration: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  getTotpStatus: vi.fn(),
  supportsPasskeys: vi.fn(() => true),
  createPasskey: vi.fn(),
}));

vi.mock("@/components/auth/auth-context", () => ({ useAuth: mocks.useAuth }));
vi.mock("@/lib/auth/passkeys-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/passkeys-api")>()),
  passkeysApi: {
    list: mocks.list,
    getRegistrationOptions: mocks.getRegistrationOptions,
    verifyRegistration: mocks.verifyRegistration,
    rename: mocks.rename,
    remove: mocks.remove,
  },
}));
vi.mock("@/lib/auth/mfa-totp-api", () => ({
  mfaTotpApi: { getStatus: mocks.getTotpStatus },
}));
vi.mock("@/lib/auth/webauthn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/webauthn")>()),
  supportsPasskeys: mocks.supportsPasskeys,
  createPasskey: mocks.createPasskey,
}));
vi.mock("@/components/auth/mfa-verification-dialog", () => ({
  MfaVerificationDialog: ({
    onVerified,
    onCancel,
  }: {
    onVerified: () => void;
    onCancel: () => void;
  }) => (
    <div>
      <button type="button" onClick={onVerified}>
        Approve verification
      </button>
      <button type="button" onClick={onCancel}>
        Cancel verification
      </button>
    </div>
  ),
}));

function passkey(overrides: Partial<PasskeySummary> = {}): PasskeySummary {
  return {
    id: "passkey-1",
    name: "Work laptop",
    createdAt: "2026-11-01T09:00:00.000Z",
    lastUsedAt: null,
    backedUp: false,
    deviceType: "single_device",
    transports: ["internal"],
    ...overrides,
  };
}

function stepUpRequired() {
  return new ApiClientError("Recent MFA verification is required.", {
    code: "MFA_VERIFICATION_REQUIRED",
    status: 401,
    details: {
      scope: "mfa-management",
      availableFactors: ["email"],
      recommendedFactor: "email",
      verifiedUntil: null,
    },
    request: {
      method: "GET",
      path: "/auth/mfa/passkeys",
      requestUrl: "http://localhost:8040/api/v1/auth/mfa/passkeys",
    },
  });
}

function renderPanel(passkeys: PasskeySummary[] = [passkey()]) {
  mocks.list.mockResolvedValue({ passkeys });
  const onFactorsChanged = vi.fn();
  render(<HomeMfaPasskeysPanel onFactorsChanged={onFactorsChanged} />);
  return { onFactorsChanged };
}

describe("HomeMfaPasskeysPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAuth.mockReturnValue({ status: "authenticated" });
    mocks.getTotpStatus.mockResolvedValue({ enabled: false });
    mocks.supportsPasskeys.mockReturnValue(true);
    mocks.getRegistrationOptions.mockResolvedValue({
      options: { challenge: "c" },
    });
    mocks.createPasskey.mockResolvedValue({
      status: "completed",
      credential: { id: "attestation" },
    });
  });

  it("lists the passkeys with when they were added and used", async () => {
    renderPanel([
      passkey(),
      passkey({
        id: "passkey-2",
        name: "Phone",
        backedUp: true,
        deviceType: "multi_device",
        lastUsedAt: "2026-11-09T09:00:00.000Z",
      }),
    ]);

    const list = await screen.findByRole("list", { name: "Your passkeys" });
    const [laptop, phone] = within(list).getAllByRole("listitem");
    expect(laptop).toHaveTextContent("Work laptop");
    expect(laptop).toHaveTextContent("Added Nov 1, 2026 · Not used yet");
    expect(laptop).not.toHaveTextContent("Synced");
    expect(phone).toHaveTextContent("Synced");
    expect(phone).toHaveTextContent("Last used Nov 9, 2026");
  });

  it("says so when there are none", async () => {
    renderPanel([]);

    expect(await screen.findByText(/no passkeys yet/i)).toBeInTheDocument();
  });

  it("renders nothing for a signed-out visitor", () => {
    mocks.useAuth.mockReturnValue({ status: "unauthenticated" });
    const { container } = render(<HomeMfaPasskeysPanel />);

    expect(container).toBeEmptyDOMElement();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("reports a failed load and tries again on request", async () => {
    const user = userEvent.setup();
    mocks.list
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ passkeys: [passkey()] });
    render(<HomeMfaPasskeysPanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load your passkeys/i,
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Work laptop")).toBeInTheDocument();
  });

  it("asks to verify when the step-up for the list is dismissed", async () => {
    const user = userEvent.setup();
    mocks.list.mockRejectedValue(stepUpRequired());
    render(<HomeMfaPasskeysPanel />);

    await user.click(
      await screen.findByRole("button", { name: "Cancel verification" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Verify it's you to see your passkeys.",
    );
  });

  it("reads only the authenticator again when another panel changes the factors", async () => {
    mocks.list.mockResolvedValue({ passkeys: [passkey()] });
    const { rerender } = render(<HomeMfaPasskeysPanel refreshKey={0} />);
    expect(await screen.findByText("Work laptop")).toBeInTheDocument();
    await waitFor(() => expect(mocks.getTotpStatus).toHaveBeenCalledTimes(1));

    rerender(<HomeMfaPasskeysPanel refreshKey={1} />);

    await waitFor(() => expect(mocks.getTotpStatus).toHaveBeenCalledTimes(2));
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  describe("adding", () => {
    it("names the passkey, runs the prompt and shows the first recovery codes", async () => {
      const user = userEvent.setup();
      mocks.verifyRegistration.mockResolvedValue({
        passkey: passkey({ id: "passkey-2", name: "Desk key" }),
        recoveryCodes: ["ABCDE-FGH23"],
      });
      const { onFactorsChanged } = renderPanel([]);

      await user.click(
        await screen.findByRole("button", { name: "Add a passkey" }),
      );
      const name = screen.getByLabelText("Name this passkey");
      expect(name).not.toHaveValue("");
      await user.clear(name);
      await user.type(name, "  Desk key ");
      await user.click(screen.getByRole("button", { name: "Continue" }));

      expect(await screen.findByText("ABCDE-FGH23")).toBeInTheDocument();
      expect(mocks.createPasskey).toHaveBeenCalledWith({ challenge: "c" });
      expect(mocks.verifyRegistration).toHaveBeenCalledWith(
        { id: "attestation" },
        "Desk key",
      );
      expect(screen.getByRole("status")).toHaveTextContent(
        '"Desk key" was added.',
      );
      expect(onFactorsChanged).toHaveBeenCalledTimes(1);

      await user.click(
        screen.getByRole("button", { name: "I've saved these codes" }),
      );
      expect(await screen.findByText("Desk key")).toBeInTheDocument();
      expect(onFactorsChanged).toHaveBeenCalledTimes(2);
    });

    it("adds to the list without codes when the account already had a set", async () => {
      const user = userEvent.setup();
      mocks.verifyRegistration.mockResolvedValue({
        passkey: passkey({ id: "passkey-2", name: "Desk key" }),
      });
      renderPanel();

      await user.click(
        await screen.findByRole("button", { name: "Add a passkey" }),
      );
      await user.click(screen.getByRole("button", { name: "Continue" }));

      expect(await screen.findByText("Desk key")).toBeInTheDocument();
      expect(screen.getByText("Work laptop")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "I've saved these codes" }),
      ).toBeNull();
    });

    it("steps up first when the session needs it, then retries", async () => {
      const user = userEvent.setup();
      mocks.getRegistrationOptions
        .mockRejectedValueOnce(stepUpRequired())
        .mockResolvedValueOnce({ options: { challenge: "c" } });
      mocks.verifyRegistration.mockResolvedValue({
        passkey: passkey({ id: "passkey-2", name: "Desk key" }),
      });
      renderPanel([]);

      await user.click(
        await screen.findByRole("button", { name: "Add a passkey" }),
      );
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.click(
        await screen.findByRole("button", { name: "Approve verification" }),
      );

      expect(await screen.findByText("Desk key")).toBeInTheDocument();
      expect(mocks.getRegistrationOptions).toHaveBeenCalledTimes(2);
    });

    it("adds nothing when the prompt is closed", async () => {
      const user = userEvent.setup();
      mocks.createPasskey.mockResolvedValue({ status: "cancelled" });
      const { onFactorsChanged } = renderPanel([]);

      await user.click(
        await screen.findByRole("button", { name: "Add a passkey" }),
      );
      await user.click(screen.getByRole("button", { name: "Continue" }));

      expect(await screen.findByRole("status")).toHaveTextContent(
        /nothing was added/i,
      );
      expect(mocks.verifyRegistration).not.toHaveBeenCalled();
      expect(onFactorsChanged).not.toHaveBeenCalled();
    });

    it("explains a browser that could not create the passkey", async () => {
      const user = userEvent.setup();
      const { PasskeyCeremonyError } = await import("@/lib/auth/webauthn");
      mocks.createPasskey.mockRejectedValue(
        new PasskeyCeremonyError("This passkey is already on your account."),
      );
      renderPanel();

      await user.click(
        await screen.findByRole("button", { name: "Add a passkey" }),
      );
      await user.click(screen.getByRole("button", { name: "Continue" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This passkey is already on your account.",
      );
    });

    it("reports a server that refused the passkey", async () => {
      const user = userEvent.setup();
      mocks.verifyRegistration.mockRejectedValue(new Error("offline"));
      renderPanel();

      await user.click(
        await screen.findByRole("button", { name: "Add a passkey" }),
      );
      await user.click(screen.getByRole("button", { name: "Continue" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /couldn't add your passkey/i,
      );
    });

    it("needs a name, and can be called off", async () => {
      const user = userEvent.setup();
      renderPanel([]);

      await user.click(
        await screen.findByRole("button", { name: "Add a passkey" }),
      );
      await user.clear(screen.getByLabelText("Name this passkey"));
      await user.click(screen.getByRole("button", { name: "Continue" }));
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Give the passkey a name.",
      );
      expect(mocks.getRegistrationOptions).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(
        screen.getByRole("button", { name: "Add a passkey" }),
      ).toBeInTheDocument();
    });

    it("cannot add one on a browser without passkeys", async () => {
      mocks.supportsPasskeys.mockReturnValue(false);
      renderPanel();

      expect(
        await screen.findByRole("button", { name: "Add a passkey" }),
      ).toBeDisabled();
      expect(
        screen.getByText(/this browser can't create passkeys/i),
      ).toBeInTheDocument();
    });
  });

  describe("renaming", () => {
    it("saves a new name", async () => {
      const user = userEvent.setup();
      mocks.rename.mockResolvedValue({
        passkey: passkey({ name: "Desk key" }),
      });
      renderPanel();

      await user.click(
        await screen.findByRole("button", { name: "Rename Work laptop" }),
      );
      const input = screen.getByLabelText("Passkey name");
      await user.clear(input);
      await user.type(input, "Desk key{Enter}");

      expect(await screen.findByText("Desk key")).toBeInTheDocument();
      expect(mocks.rename).toHaveBeenCalledWith("passkey-1", "Desk key");
      expect(screen.getByRole("status")).toHaveTextContent("Passkey renamed.");
    });

    it("leaves an unchanged name alone, and Escape cancels", async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(
        await screen.findByRole("button", { name: "Rename Work laptop" }),
      );
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(mocks.rename).not.toHaveBeenCalled();

      await user.click(
        screen.getByRole("button", { name: "Rename Work laptop" }),
      );
      await user.keyboard("{Escape}");
      expect(screen.queryByLabelText("Passkey name")).toBeNull();
    });

    it("needs a name, and reports a failed rename", async () => {
      const user = userEvent.setup();
      mocks.rename.mockRejectedValue(new Error("offline"));
      renderPanel();

      await user.click(
        await screen.findByRole("button", { name: "Rename Work laptop" }),
      );
      const input = screen.getByLabelText("Passkey name");
      await user.clear(input);
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Give the passkey a name.",
      );

      await user.type(input, "Desk key");
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        /couldn't rename your passkey/i,
      );
    });
  });

  describe("removing", () => {
    it("warns before the last strong factor goes, and says what happened", async () => {
      const user = userEvent.setup();
      mocks.remove.mockResolvedValue(undefined);
      const { onFactorsChanged } = renderPanel();

      await user.click(
        await screen.findByRole("button", { name: "Remove Work laptop" }),
      );
      const confirm = screen.getByRole("alertdialog", {
        name: "Remove Work laptop?",
      });
      expect(confirm).toHaveTextContent(/signs out your other sessions/i);
      expect(confirm).toHaveTextContent(/deletes your recovery codes/i);
      await user.click(
        within(confirm).getByRole("button", { name: "Remove passkey" }),
      );

      expect(await screen.findByRole("status")).toHaveTextContent(
        /your other sessions were signed out/i,
      );
      expect(mocks.remove).toHaveBeenCalledWith("passkey-1");
      expect(screen.queryByText("Work laptop")).toBeNull();
      expect(onFactorsChanged).toHaveBeenCalledTimes(1);
    });

    it("gives no such warning while another passkey remains", async () => {
      const user = userEvent.setup();
      mocks.remove.mockResolvedValue(undefined);
      renderPanel([passkey(), passkey({ id: "passkey-2", name: "Phone" })]);

      await user.click(
        await screen.findByRole("button", { name: "Remove Work laptop" }),
      );
      expect(screen.getByRole("alertdialog")).not.toHaveTextContent(
        /other sessions/i,
      );
      await user.click(screen.getByRole("button", { name: "Remove passkey" }));

      expect(await screen.findByRole("status")).toHaveTextContent(
        /^Passkey removed\.$/,
      );
    });

    it("gives no such warning while the authenticator app is on", async () => {
      const user = userEvent.setup();
      mocks.getTotpStatus.mockResolvedValue({ enabled: true });
      renderPanel();

      await waitFor(() => expect(mocks.getTotpStatus).toHaveBeenCalled());
      await user.click(
        await screen.findByRole("button", { name: "Remove Work laptop" }),
      );

      await waitFor(() =>
        expect(screen.getByRole("alertdialog")).not.toHaveTextContent(
          /other sessions/i,
        ),
      );
    });

    it("keeps the passkey when the user changes their mind", async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(
        await screen.findByRole("button", { name: "Remove Work laptop" }),
      );
      await user.click(screen.getByRole("button", { name: "Keep it" }));

      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(mocks.remove).not.toHaveBeenCalled();
    });

    it("reports a failed removal and keeps the passkey listed", async () => {
      const user = userEvent.setup();
      mocks.remove.mockRejectedValue(new Error("offline"));
      renderPanel();

      await user.click(
        await screen.findByRole("button", { name: "Remove Work laptop" }),
      );
      await user.click(screen.getByRole("button", { name: "Remove passkey" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /couldn't remove your passkey/i,
      );
      expect(screen.getByText("Work laptop")).toBeInTheDocument();
    });

    it("assumes no authenticator when its status cannot be read", async () => {
      const user = userEvent.setup();
      mocks.getTotpStatus.mockRejectedValue(new Error("offline"));
      renderPanel();

      await user.click(
        await screen.findByRole("button", { name: "Remove Work laptop" }),
      );

      expect(screen.getByRole("alertdialog")).toHaveTextContent(
        /signs out your other sessions/i,
      );
    });
  });
});
