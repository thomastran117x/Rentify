import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listMock,
  createMock,
  updateMock,
  removeMock,
  openStreamMock,
  closeMock,
  sendTypingMock,
  authState,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  removeMock: vi.fn(),
  openStreamMock: vi.fn(),
  closeMock: vi.fn(),
  sendTypingMock: vi.fn(),
  authState: { status: "authenticated" as string },
}));

vi.mock("@/lib/blog-comments/api", () => ({
  blogCommentsApi: {
    list: listMock,
    create: createMock,
    update: updateMock,
    remove: removeMock,
  },
}));

vi.mock("@/lib/blog-comments/socket", () => ({
  openBlogCommentSocket: openStreamMock,
}));

vi.mock("@/components/auth/auth-context", () => ({
  useAuth: () => authState,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/organizations/org-1/blog/my-post",
}));

vi.mock("@/components/reports/report-dialog", () => ({
  ReportDialog: ({ subjectId }: { subjectId: string }) => (
    <button type="button" data-testid="report-trigger" data-subject={subjectId}>
      Report
    </button>
  ),
}));

const { BlogCommentsPanel } = await import(
  "@/components/organizations/blog-comments-panel"
);

const VIEWER_ID = "user-2";

function buildComment(overrides: Record<string, unknown> = {}) {
  return {
    id: "comment-1",
    blogPostId: "blog-1",
    organizationId: "org-1",
    author: { id: VIEWER_ID, username: "renter-one" },
    body: "Great post.",
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

function buildList(overrides: Record<string, unknown> = {}) {
  return {
    comments: [buildComment()],
    pagination: {
      page: 1,
      pageSize: 50,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
    commentsEnabled: true,
    viewerCanComment: true,
    viewerCanModerate: false,
    viewerUserId: VIEWER_ID,
    ...overrides,
  };
}

function renderPanel(props: Record<string, unknown> = {}) {
  return render(
    <BlogCommentsPanel
      organizationId="org-1"
      slug="my-post"
      blogPostId="blog-1"
      commentsEnabled
      {...props}
    />,
  );
}

/** The `onEvent` callback the component handed to the socket module. */
function streamEvent(event: Record<string, unknown>): void {
  const options = openStreamMock.mock.calls.at(-1)?.[0];
  options.onEvent(event);
}

function streamStatus(status: string): void {
  const options = openStreamMock.mock.calls.at(-1)?.[0];
  options.onStatus(status);
}

describe("BlogCommentsPanel", () => {
  beforeEach(() => {
    listMock.mockReset();
    createMock.mockReset();
    updateMock.mockReset();
    removeMock.mockReset();
    openStreamMock.mockReset();
    closeMock.mockReset();
    sendTypingMock.mockReset();
    authState.status = "authenticated";

    listMock.mockResolvedValue(buildList());
    openStreamMock.mockImplementation(() => ({
      sendTyping: sendTypingMock,
      close: closeMock,
    }));
  });

  it("renders seeded comments", async () => {
    renderPanel();

    expect(await screen.findByText("Great post.")).toBeInTheDocument();
    expect(screen.getByText("renter-one")).toBeInTheDocument();
  });

  it("renders a comment body as text, never as markup", async () => {
    listMock.mockResolvedValue(
      buildList({
        comments: [buildComment({ body: "<img src=x onerror=alert(1)>" })],
      }),
    );

    const { container } = renderPanel();

    expect(
      await screen.findByText("<img src=x onerror=alert(1)>"),
    ).toBeInTheDocument();
    // Unlike the post body above it, this is untrusted input from any
    // signed-in user.
    expect(container.querySelector("img")).toBeNull();
  });

  it("offers a sign-in link instead of a composer to a guest", async () => {
    authState.status = "unauthenticated";
    listMock.mockResolvedValue(
      buildList({ viewerCanComment: false, viewerUserId: null }),
    );

    renderPanel();

    expect(
      await screen.findByTestId("blog-comments-signin"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("blog-comment-composer")).toBeNull();
    expect(
      screen.getByRole("link", { name: /sign in to comment/i }),
    ).toHaveAttribute(
      "href",
      "/login?next=%2Forganizations%2Forg-1%2Fblog%2Fmy-post",
    );
  });

  it("shows a closed notice while still rendering comments", async () => {
    listMock.mockResolvedValue(
      buildList({ commentsEnabled: false, viewerCanComment: false }),
    );

    renderPanel({ commentsEnabled: false });

    expect(
      await screen.findByTestId("blog-comments-closed"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("blog-comment-composer")).toBeNull();
    expect(screen.getByText("Great post.")).toBeInTheDocument();
  });

  it("shows an empty state when there are no comments", async () => {
    listMock.mockResolvedValue(buildList({ comments: [] }));

    renderPanel();

    expect(
      await screen.findByText("Be the first to comment on this post."),
    ).toBeInTheDocument();
  });

  it("surfaces a load failure with a retry", async () => {
    listMock.mockRejectedValueOnce(new Error("boom"));

    renderPanel();

    const retry = await screen.findByRole("button", { name: /try again/i });
    listMock.mockResolvedValue(buildList());
    await userEvent.click(retry);

    expect(await screen.findByText("Great post.")).toBeInTheDocument();
  });

  it("posts a comment and shows it without waiting for the echo", async () => {
    createMock.mockResolvedValue(
      buildComment({ id: "comment-2", body: "Brand new." }),
    );

    renderPanel();
    await screen.findByText("Great post.");

    await userEvent.type(
      screen.getByTestId("blog-comment-composer"),
      "Brand new.",
    );
    await userEvent.click(screen.getByTestId("blog-comment-submit"));

    expect(createMock).toHaveBeenCalledWith("org-1", "my-post", "Brand new.");
    expect(await screen.findByText("Brand new.")).toBeInTheDocument();
  });

  it("dedupes the socket echo of its own comment", async () => {
    createMock.mockResolvedValue(
      buildComment({ id: "comment-2", body: "Only once." }),
    );

    renderPanel();
    await screen.findByText("Great post.");

    await userEvent.type(
      screen.getByTestId("blog-comment-composer"),
      "Only once.",
    );
    await userEvent.click(screen.getByTestId("blog-comment-submit"));
    await screen.findByText("Only once.");

    streamEvent({
      type: "comment.created",
      blogPostId: "blog-1",
      comment: buildComment({ id: "comment-2", body: "Only once." }),
    });

    await waitFor(() => {
      expect(screen.getAllByText("Only once.")).toHaveLength(1);
    });
  });

  it("surfaces a rejected post without clearing the draft", async () => {
    createMock.mockRejectedValue(new Error("closed"));

    renderPanel();
    await screen.findByText("Great post.");

    await userEvent.type(
      screen.getByTestId("blog-comment-composer"),
      "Refused.",
    );
    await userEvent.click(screen.getByTestId("blog-comment-submit"));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("blog-comment-composer")).toHaveValue("Refused.");
  });

  it("renders a comment that arrives over the socket", async () => {
    renderPanel();
    await screen.findByText("Great post.");

    streamEvent({
      type: "comment.created",
      blogPostId: "blog-1",
      comment: buildComment({
        id: "comment-3",
        body: "Live arrival.",
        author: { id: "user-9", username: "renter-two" },
      }),
    });

    expect(await screen.findByText("Live arrival.")).toBeInTheDocument();
  });

  it("replaces a comment in place on an update", async () => {
    renderPanel();
    await screen.findByText("Great post.");

    streamEvent({
      type: "comment.updated",
      blogPostId: "blog-1",
      comment: buildComment({ body: "Edited elsewhere.", editedAt: "now" }),
    });

    expect(await screen.findByText("Edited elsewhere.")).toBeInTheDocument();
    expect(screen.queryByText("Great post.")).toBeNull();
  });

  it("labels an author tombstone", async () => {
    renderPanel();
    await screen.findByText("Great post.");

    streamEvent({
      type: "comment.deleted",
      blogPostId: "blog-1",
      comment: buildComment({
        body: "",
        deletedAt: "now",
        deletedBy: "author",
      }),
    });

    expect(
      await screen.findByText("This comment was deleted."),
    ).toBeInTheDocument();
  });

  it("labels a moderator tombstone differently", async () => {
    renderPanel();
    await screen.findByText("Great post.");

    streamEvent({
      type: "comment.deleted",
      blogPostId: "blog-1",
      comment: buildComment({
        body: "",
        deletedAt: "now",
        deletedBy: "moderator",
      }),
    });

    expect(
      await screen.findByText("Removed by the organization."),
    ).toBeInTheDocument();
  });

  it("offers edit and delete on a viewer's own recent comment", async () => {
    renderPanel();
    await screen.findByText("Great post.");

    expect(screen.getByTestId("blog-comment-edit")).toBeInTheDocument();
    expect(screen.getByTestId("blog-comment-remove")).toBeInTheDocument();
    // No self-reporting.
    expect(screen.queryByTestId("report-trigger")).toBeNull();
  });

  it("withdraws edit once the window has closed", async () => {
    listMock.mockResolvedValue(
      buildList({
        comments: [
          buildComment({
            createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          }),
        ],
      }),
    );

    renderPanel();
    await screen.findByText("Great post.");

    expect(screen.queryByTestId("blog-comment-edit")).toBeNull();
    // Withdrawing your own words stays possible with no time limit.
    expect(screen.getByTestId("blog-comment-remove")).toBeInTheDocument();
  });

  it("edits a comment", async () => {
    updateMock.mockResolvedValue(
      buildComment({ body: "Reworded.", editedAt: "now" }),
    );

    renderPanel();
    await screen.findByText("Great post.");

    await userEvent.click(screen.getByTestId("blog-comment-edit"));
    const input = screen.getByTestId("blog-comment-edit-input");
    await userEvent.clear(input);
    await userEvent.type(input, "Reworded.");
    await userEvent.click(screen.getByTestId("blog-comment-edit-save"));

    expect(updateMock).toHaveBeenCalledWith(
      "org-1",
      "my-post",
      "comment-1",
      "Reworded.",
    );
    expect(await screen.findByText("Reworded.")).toBeInTheDocument();
  });

  it("removes a comment", async () => {
    removeMock.mockResolvedValue(
      buildComment({ body: "", deletedAt: "now", deletedBy: "author" }),
    );

    renderPanel();
    await screen.findByText("Great post.");

    await userEvent.click(screen.getByTestId("blog-comment-remove"));

    expect(removeMock).toHaveBeenCalledWith("org-1", "my-post", "comment-1");
    expect(
      await screen.findByText("This comment was deleted."),
    ).toBeInTheDocument();
  });

  it("offers report but not edit on someone else's comment", async () => {
    listMock.mockResolvedValue(
      buildList({
        comments: [
          buildComment({
            id: "comment-4",
            author: { id: "user-9", username: "renter-two" },
          }),
        ],
      }),
    );

    renderPanel();
    await screen.findByText("Great post.");

    expect(screen.queryByTestId("blog-comment-edit")).toBeNull();
    expect(screen.queryByTestId("blog-comment-remove")).toBeNull();
    expect(screen.getByTestId("report-trigger")).toHaveAttribute(
      "data-subject",
      "comment-4",
    );
  });

  it("offers removal to a manager on someone else's comment", async () => {
    listMock.mockResolvedValue(
      buildList({
        viewerCanModerate: true,
        comments: [
          buildComment({ author: { id: "user-9", username: "renter-two" } }),
        ],
      }),
    );

    renderPanel();
    await screen.findByText("Great post.");

    expect(screen.getByTestId("blog-comment-remove")).toHaveTextContent(
      "Remove",
    );
    expect(screen.queryByTestId("blog-comment-edit")).toBeNull();
  });

  it("shows and then clears a typing indicator", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPanel();
    await screen.findByText("Great post.");

    streamEvent({
      type: "typing",
      blogPostId: "blog-1",
      username: "renter-two",
      expiresAt: new Date(Date.now() + 500).toISOString(),
    });

    expect(
      await screen.findByText("renter-two is typing…"),
    ).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(800);

    await waitFor(() => {
      expect(screen.getByTestId("blog-comments-typing")).toHaveTextContent("");
    });
    vi.useRealTimers();
  });

  it("shows a reader count only once someone else is present", async () => {
    renderPanel();
    await screen.findByText("Great post.");

    streamEvent({ type: "presence", blogPostId: "blog-1", readerCount: 1 });
    expect(screen.queryByTestId("blog-comments-presence")).toBeNull();

    streamEvent({ type: "presence", blogPostId: "blog-1", readerCount: 4 });

    expect(
      await screen.findByTestId("blog-comments-presence"),
    ).toHaveTextContent("4 people reading");
  });

  it("clamps a very large reader count", async () => {
    renderPanel();
    await screen.findByText("Great post.");

    streamEvent({ type: "presence", blogPostId: "blog-1", readerCount: 5_000 });

    expect(
      await screen.findByTestId("blog-comments-presence"),
    ).toHaveTextContent("99+ people reading");
  });

  it("closes the composer live when a manager closes comments", async () => {
    renderPanel();
    await screen.findByTestId("blog-comment-composer");

    listMock.mockResolvedValue(
      buildList({ commentsEnabled: false, viewerCanComment: false }),
    );
    streamEvent({
      type: "comments.closed",
      blogPostId: "blog-1",
      commentsEnabled: false,
    });

    expect(
      await screen.findByTestId("blog-comments-closed"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("blog-comment-composer")).toBeNull();
  });

  it("refetches on resync", async () => {
    renderPanel();
    await screen.findByText("Great post.");
    const before = listMock.mock.calls.length;

    streamEvent({ type: "resync", blogPostId: "blog-1" });

    await waitFor(() => {
      expect(listMock.mock.calls.length).toBeGreaterThan(before);
    });
  });

  it("refetches whenever the stream reopens", async () => {
    renderPanel();
    await screen.findByText("Great post.");
    const before = listMock.mock.calls.length;

    // The stream is not a durable log, so a reconnect has to re-read history.
    streamStatus("open");

    await waitFor(() => {
      expect(listMock.mock.calls.length).toBeGreaterThan(before);
    });
  });

  it("keeps a live edit that lands while history is in flight", async () => {
    // The response resolves only once the test releases it, so the events
    // below are guaranteed to land inside the request window.
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    listMock.mockReturnValueOnce(pending.then(() => buildList()));

    renderPanel();

    // Created and then immediately edited, before the snapshot arrives — and
    // the snapshot predates both.
    streamEvent({
      type: "comment.created",
      blogPostId: "blog-1",
      comment: buildComment({ id: "comment-7", body: "First version." }),
    });
    streamEvent({
      type: "comment.updated",
      blogPostId: "blog-1",
      comment: buildComment({
        id: "comment-7",
        body: "Second version.",
        editedAt: "now",
      }),
    });

    release(null);

    // The newer edit must win; the stale creation must not be reinstated.
    expect(await screen.findByText("Second version.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("First version.")).toBeNull();
    });
  });

  it("keeps a live deletion that lands while history is in flight", async () => {
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    listMock.mockReturnValueOnce(pending.then(() => buildList()));

    renderPanel();

    streamEvent({
      type: "comment.created",
      blogPostId: "blog-1",
      comment: buildComment({ id: "comment-8", body: "Doomed." }),
    });
    streamEvent({
      type: "comment.deleted",
      blogPostId: "blog-1",
      comment: buildComment({
        id: "comment-8",
        body: "",
        deletedAt: "now",
        deletedBy: "moderator",
      }),
    });

    release(null);

    // A deleted comment must not reappear because the snapshot predated it.
    expect(
      await screen.findByText("Removed by the organization."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Doomed.")).toBeNull();
    });
  });

  it("renders comments oldest-first regardless of response order", async () => {
    listMock.mockResolvedValue(
      buildList({
        // The API pages newest-first, so a response arrives in that order.
        comments: [
          buildComment({
            id: "b",
            body: "Second.",
            createdAt: "2026-07-16T00:00:02.000Z",
          }),
          buildComment({
            id: "a",
            body: "First.",
            createdAt: "2026-07-16T00:00:01.000Z",
          }),
        ],
      }),
    );

    renderPanel();
    await screen.findByText("First.");

    const rendered = screen
      .getAllByTestId("blog-comment")
      .map((node) => node.getAttribute("data-comment-id"));
    expect(rendered).toEqual(["a", "b"]);
  });

  it("offers to load earlier comments when more history exists", async () => {
    listMock.mockResolvedValueOnce(
      buildList({
        comments: [buildComment({ id: "recent", body: "Recent." })],
        pagination: {
          page: 1,
          pageSize: 50,
          total: 60,
          totalPages: 2,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      }),
    );

    renderPanel();
    await screen.findByText("Recent.");

    const loadEarlier = await screen.findByTestId("blog-comments-load-earlier");

    listMock.mockResolvedValueOnce(
      buildList({
        comments: [
          buildComment({
            id: "old",
            body: "Older.",
            createdAt: "2020-01-01T00:00:00.000Z",
          }),
        ],
        pagination: {
          page: 2,
          pageSize: 50,
          total: 60,
          totalPages: 2,
          hasNextPage: false,
          hasPreviousPage: true,
        },
      }),
    );
    await userEvent.click(loadEarlier);

    // The older page is requested and merged in, not swapped for the newer one.
    expect(listMock).toHaveBeenLastCalledWith("org-1", "my-post", {
      page: 2,
      pageSize: 50,
    });
    expect(await screen.findByText("Older.")).toBeInTheDocument();
    expect(screen.getByText("Recent.")).toBeInTheDocument();

    // Nothing older remains, so the control retires.
    await waitFor(() => {
      expect(screen.queryByTestId("blog-comments-load-earlier")).toBeNull();
    });
  });

  it("hides the control when a single page holds every comment", async () => {
    renderPanel();
    await screen.findByText("Great post.");

    expect(screen.queryByTestId("blog-comments-load-earlier")).toBeNull();
  });

  it("reconciles every loaded page when the stream reconnects", async () => {
    // A page-aware mock, so a reconnect that re-reads several pages is
    // distinguishable from one that only re-reads the newest.
    const pageOne = (body: string) =>
      buildList({
        comments: [buildComment({ id: "recent", body })],
        pagination: {
          page: 1,
          pageSize: 50,
          total: 60,
          totalPages: 2,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      });
    const pageTwo = (comment: Record<string, unknown>) =>
      buildList({
        comments: [comment],
        pagination: {
          page: 2,
          pageSize: 50,
          total: 60,
          totalPages: 2,
          hasNextPage: false,
          hasPreviousPage: true,
        },
      });

    const older = {
      id: "old",
      body: "Older.",
      createdAt: "2020-01-01T00:00:00.000Z",
    };
    listMock.mockImplementation(
      (_org: string, _slug: string, input: { page: number }) =>
        Promise.resolve(
          input.page === 1 ? pageOne("Recent.") : pageTwo(buildComment(older)),
        ),
    );

    renderPanel();
    await screen.findByText("Recent.");
    await userEvent.click(
      await screen.findByTestId("blog-comments-load-earlier"),
    );
    await screen.findByText("Older.");

    // While the socket was down the older comment was moderated away. A
    // reconnect that only re-read page 1 would never learn that.
    listMock.mockImplementation(
      (_org: string, _slug: string, input: { page: number }) =>
        Promise.resolve(
          input.page === 1
            ? pageOne("Recent.")
            : pageTwo(
                buildComment({
                  ...older,
                  body: "",
                  deletedAt: "now",
                  deletedBy: "moderator",
                }),
              ),
        ),
    );
    listMock.mockClear();
    streamStatus("open");

    // Both loaded pages are re-read, not just the newest.
    await waitFor(() => {
      expect(listMock.mock.calls.map((call) => call[2].page).sort()).toEqual([
        1, 2,
      ]);
    });

    expect(
      await screen.findByText("Removed by the organization."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Older.")).toBeNull();
    });
    // Still one contiguous window, and the boundary still comes from the
    // deepest page rather than page 1's "there is more".
    expect(screen.getByText("Recent.")).toBeInTheDocument();
    expect(screen.queryByTestId("blog-comments-load-earlier")).toBeNull();
  });

  it("closes the socket on unmount", async () => {
    const { unmount } = renderPanel();
    await screen.findByText("Great post.");

    unmount();

    expect(closeMock).toHaveBeenCalled();
  });
});
