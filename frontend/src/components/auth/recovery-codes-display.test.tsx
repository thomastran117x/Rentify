import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecoveryCodesDisplay } from "./recovery-codes-display";

const CODES = ["ABCDE-FGH23", "JKLMN-PQR45"];

describe("RecoveryCodesDisplay", () => {
  const createObjectUrl = vi.fn((blob: Blob) => {
    void blob;
    return "blob:recovery-codes";
  });
  const revokeObjectUrl = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists every code and warns they will not be shown again", () => {
    render(<RecoveryCodesDisplay codes={CODES} onDone={vi.fn()} />);

    expect(
      screen.getByRole("list", { name: "Recovery codes" }),
    ).toHaveTextContent("ABCDE-FGH23JKLMN-PQR45");
    expect(screen.getByText(/only time you'll see them/i)).toBeInTheDocument();
  });

  it("copies the codes, one per line", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    render(<RecoveryCodesDisplay codes={CODES} onDone={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith("ABCDE-FGH23\nJKLMN-PQR45");
    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
  });

  it("points to another way when the clipboard is refused", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("denied"),
    );
    render(<RecoveryCodesDisplay codes={CODES} onDone={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /download the codes instead/i,
    );
  });

  it("downloads the codes as a text file", async () => {
    const user = userEvent.setup();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("rentify-recovery-codes.txt");
        expect(this.href).toContain("blob:recovery-codes");
      });
    render(<RecoveryCodesDisplay codes={CODES} onDone={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(click).toHaveBeenCalledTimes(1);
    const blob = createObjectUrl.mock.calls[0]![0];
    await expect(blob.text()).resolves.toContain("ABCDE-FGH23\nJKLMN-PQR45");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:recovery-codes");
  });

  it("moves on only when the user says the codes are saved", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<RecoveryCodesDisplay codes={CODES} onDone={onDone} />);

    expect(onDone).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "I've saved these codes" }),
    );

    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
