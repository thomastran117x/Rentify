import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, ApiServerError } from "@/lib/api/types";

const { listIpBlocksMock, unblockIpMock } = vi.hoisted(() => ({
  listIpBlocksMock: vi.fn(),
  unblockIpMock: vi.fn(),
}));

vi.mock("@/lib/admin-security/api", () => ({
  adminSecurityApi: {
    listIpBlocks: listIpBlocksMock,
    unblockIp: unblockIpMock,
  },
}));

const { AdminIpBlocksPanel } = await import(
  "@/components/admin/security/admin-ip-blocks-panel"
);

const REQUEST = {
  method: "DELETE",
  path: "/admin/auth/ip-blocks/198.51.100.41",
  requestUrl: "http://localhost:8040/api/v1/admin/auth/ip-blocks/198.51.100.41",
};

const BLOCK = {
  ipAddress: "198.51.100.41",
  expiresAt: "2026-10-26T13:00:00.000Z",
};

function clientError(status: number) {
  return new ApiClientError("Not found.", {
    code: "RESOURCE_NOT_FOUND",
    status,
    request: REQUEST,
  });
}

function serverError() {
  return new ApiServerError("Server error", {
    code: "INTERNAL",
    status: 500,
    request: REQUEST,
  });
}

describe("AdminIpBlocksPanel", () => {
  beforeEach(() => {
    listIpBlocksMock.mockReset();
    unblockIpMock.mockReset();
  });

  it("shows a loading state, then the blocked addresses", async () => {
    let resolve!: (value: unknown) => void;
    listIpBlocksMock.mockReturnValueOnce(
      new Promise((done) => (resolve = done)),
    );

    render(<AdminIpBlocksPanel refreshKey={0} onUnblocked={vi.fn()} />);

    expect(
      screen.getByRole("status", { name: "Loading blocked IP addresses" }),
    ).toBeInTheDocument();
    resolve({ items: [BLOCK] });

    expect(await screen.findByText("198.51.100.41")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Unblock 198.51.100.41" }),
    ).toBeEnabled();
  });

  it("says when nothing is blocked", async () => {
    listIpBlocksMock.mockResolvedValueOnce({ items: [] });

    render(<AdminIpBlocksPanel refreshKey={0} onUnblocked={vi.fn()} />);

    expect(
      await screen.findByText("No IP addresses are blocked."),
    ).toBeInTheDocument();
  });

  it("unblocks an address, confirms it and reloads the list", async () => {
    const user = userEvent.setup();
    const onUnblocked = vi.fn();
    let finish!: () => void;
    listIpBlocksMock
      .mockResolvedValueOnce({ items: [BLOCK] })
      .mockResolvedValueOnce({ items: [] });
    unblockIpMock.mockReturnValueOnce(
      new Promise<void>((done) => (finish = done)),
    );

    render(<AdminIpBlocksPanel refreshKey={0} onUnblocked={onUnblocked} />);
    await user.click(
      await screen.findByRole("button", { name: "Unblock 198.51.100.41" }),
    );

    const pending = screen.getByRole("button", {
      name: "Unblock 198.51.100.41",
    });
    expect(pending).toBeDisabled();
    expect(pending).toHaveTextContent("Unblocking...");
    finish();

    expect(
      await screen.findByText("198.51.100.41 is unblocked."),
    ).toBeInTheDocument();
    expect(unblockIpMock).toHaveBeenCalledWith("198.51.100.41");
    expect(onUnblocked).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("No IP addresses are blocked."),
    ).toBeInTheDocument();
    expect(listIpBlocksMock).toHaveBeenCalledTimes(2);
  });

  it("treats a block that already lifted as gone", async () => {
    const user = userEvent.setup();
    const onUnblocked = vi.fn();
    listIpBlocksMock
      .mockResolvedValueOnce({ items: [BLOCK] })
      .mockResolvedValueOnce({ items: [] });
    unblockIpMock.mockRejectedValueOnce(clientError(404));

    render(<AdminIpBlocksPanel refreshKey={0} onUnblocked={onUnblocked} />);
    await user.click(
      await screen.findByRole("button", { name: "Unblock 198.51.100.41" }),
    );

    expect(
      await screen.findByText("198.51.100.41 was no longer blocked."),
    ).toBeInTheDocument();
    expect(onUnblocked).not.toHaveBeenCalled();
    await waitFor(() => expect(listIpBlocksMock).toHaveBeenCalledTimes(2));
  });

  it("keeps the row and shows an error when the unblock fails", async () => {
    const user = userEvent.setup();
    listIpBlocksMock.mockResolvedValueOnce({ items: [BLOCK] });
    unblockIpMock.mockRejectedValueOnce(serverError());

    render(<AdminIpBlocksPanel refreshKey={0} onUnblocked={vi.fn()} />);
    await user.click(
      await screen.findByRole("button", { name: "Unblock 198.51.100.41" }),
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Unblock 198.51.100.41" }),
    ).toBeEnabled();
    expect(listIpBlocksMock).toHaveBeenCalledTimes(1);
  });

  it("recovers from a failed load with Try again", async () => {
    const user = userEvent.setup();
    listIpBlocksMock
      .mockRejectedValueOnce(serverError())
      .mockResolvedValueOnce({ items: [BLOCK] });

    render(<AdminIpBlocksPanel refreshKey={0} onUnblocked={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("198.51.100.41")).toBeInTheDocument();
  });

  it("reloads when the page refreshes", async () => {
    listIpBlocksMock.mockResolvedValue({ items: [] });

    const { rerender } = render(
      <AdminIpBlocksPanel refreshKey={0} onUnblocked={vi.fn()} />,
    );
    await screen.findByText("No IP addresses are blocked.");
    rerender(<AdminIpBlocksPanel refreshKey={1} onUnblocked={vi.fn()} />);

    await waitFor(() => expect(listIpBlocksMock).toHaveBeenCalledTimes(2));
  });
});
