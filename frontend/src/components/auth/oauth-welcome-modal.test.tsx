import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OAuthWelcomeModal } from "./oauth-welcome-modal";
import { ApiClientError } from "@/lib/auth/types";

const { updateMineMock } = vi.hoisted(() => ({
  updateMineMock: vi.fn(),
}));

vi.mock("@/lib/profiles/api", () => ({
  profilesApi: {
    updateMine: updateMineMock,
  },
}));

function renderModal(overrides?: {
  username?: string;
  onUsernameSaved?: (username: string) => void;
  onClose?: () => void;
}) {
  const onUsernameSaved = overrides?.onUsernameSaved ?? vi.fn();
  const onClose = overrides?.onClose ?? vi.fn();

  render(
    <OAuthWelcomeModal
      open={true}
      username={overrides?.username ?? "jane.doe"}
      onUsernameSaved={onUsernameSaved}
      onClose={onClose}
    />,
  );

  return { onUsernameSaved, onClose };
}

describe("OAuthWelcomeModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <OAuthWelcomeModal
        open={false}
        username="jane.doe"
        onUsernameSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("surfaces the generated username to the user", () => {
    renderModal({ username: "jane.doe" });

    expect(screen.getByText("Welcome to Rentify")).toBeInTheDocument();
    expect(screen.getByLabelText("Your username")).toHaveValue("jane.doe");
  });

  it("keeps the generated username without calling the API", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.click(
      screen.getByRole("button", { name: "Keep this username" }),
    );

    expect(updateMineMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("saves a customized username and reports the saved value", async () => {
    const user = userEvent.setup();
    updateMineMock.mockResolvedValue({ username: "jane.custom" });
    const { onUsernameSaved, onClose } = renderModal({ username: "jane.doe" });

    const input = screen.getByLabelText("Your username");
    await user.clear(input);
    await user.type(input, "jane.custom");
    await user.click(screen.getByRole("button", { name: "Save username" }));

    await waitFor(() => {
      expect(updateMineMock).toHaveBeenCalledWith({ username: "jane.custom" });
    });
    expect(onUsernameSaved).toHaveBeenCalledWith("jane.custom");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call the API when the username is unchanged", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal({ username: "jane.doe" });

    await user.click(screen.getByRole("button", { name: "Looks good" }));

    expect(updateMineMock).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("validates the username before saving", async () => {
    const user = userEvent.setup();
    renderModal({ username: "jane.doe" });

    const input = screen.getByLabelText("Your username");
    await user.clear(input);
    await user.type(input, "no spaces here");
    await user.click(screen.getByRole("button", { name: "Save username" }));

    expect(
      screen.getByText(
        "Use 3-50 letters, numbers, periods, underscores, or hyphens.",
      ),
    ).toBeInTheDocument();
    expect(updateMineMock).not.toHaveBeenCalled();
  });

  it("shows an error and stays open when the update fails", async () => {
    const user = userEvent.setup();
    updateMineMock.mockRejectedValue(
      new ApiClientError("That username is already taken.", {
        code: "CONFLICT",
        request: {
          method: "PUT",
          path: "/profile/me",
          requestUrl: "http://localhost:8040/api/v1/profile/me",
        },
        status: 409,
      }),
    );
    const { onClose } = renderModal({ username: "jane.doe" });

    const input = screen.getByLabelText("Your username");
    await user.clear(input);
    await user.type(input, "taken.name");
    await user.click(screen.getByRole("button", { name: "Save username" }));

    expect(
      await screen.findByText("That username is already taken."),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
