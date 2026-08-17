import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BlogPanel, emptyBlogForm } from "./blog-panel";
vi.mock("@/components/organizations/rich-text-editor", () => ({
  RichTextEditor: ({ onChange }: { onChange: (value: string) => void }) => (
    <button onClick={() => onChange("<p>Body</p>")}>Edit body</button>
  ),
}));
vi.mock("@/components/organizations/shared/format", () => ({
  formatDate: () => "Today",
}));
vi.mock("@/lib/organizations/urls", () => ({
  organizationHref: (...parts: string[]) => `/organizations/${parts.join("/")}`,
}));
const { createUploadUrlMock } = vi.hoisted(() => ({
  createUploadUrlMock: vi.fn(),
}));
vi.mock("@/lib/blob/api", () => ({
  blobApi: { createUploadUrl: createUploadUrlMock },
}));
const post = {
  id: "post-1",
  organizationId: "org-1",
  title: "News",
  slug: "news",
  body: "Body",
  tags: ["release"],
  status: "published" as const,
  commentsEnabled: true,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
function props(
  overrides: Partial<ComponentProps<typeof BlogPanel>> = {},
): ComponentProps<typeof BlogPanel> {
  return {
    organizationId: "org-1",
    organizationSlug: "studio",
    posts: [post],
    loading: false,
    error: null,
    canManage: true,
    form: emptyBlogForm(),
    editingId: null,
    savingId: null,
    onFormChange: vi.fn(),
    onSubmit: vi.fn(),
    onCancelEdit: vi.fn(),
    onEdit: vi.fn(),
    onToggleStatus: vi.fn(),
    onDelete: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}
describe("BlogPanel", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("edits form fields and invokes post actions", () => {
    const p = props();
    render(<BlogPanel {...p} />);
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Launch" },
    });
    expect(p.onFormChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Launch" }),
    );
    fireEvent.change(screen.getByPlaceholderText("Add a tag and press Enter"), {
      target: { value: "news" },
    });
    fireEvent.keyDown(
      screen.getByPlaceholderText("Add a tag and press Enter"),
      { key: "Enter" },
    );
    expect(p.onFormChange).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["news"] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit body" }));
    expect(p.onFormChange).toHaveBeenCalledWith(
      expect.objectContaining({ body: "<p>Body</p>" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(p.onToggleStatus).toHaveBeenCalledWith(post);
    expect(p.onEdit).toHaveBeenCalledWith(post);
    expect(p.onDelete).toHaveBeenCalledWith("post-1");
    expect(
      screen.getByRole("link", { name: "View public post" }),
    ).toHaveAttribute("href", "/organizations/studio/blog/news");
  });
  it("renders loading, errors, and read-only empty content", () => {
    const { rerender } = render(
      <BlogPanel {...props({ posts: [], loading: true })} />,
    );
    expect(screen.getByText("0 total")).toBeInTheDocument();
    rerender(
      <BlogPanel
        {...props({ posts: [], loading: false, error: "Unavailable" })}
      />,
    );
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    rerender(
      <BlogPanel {...props({ posts: [], loading: false, canManage: false })} />,
    );
    expect(screen.getByText("No blog posts yet.")).toBeInTheDocument();
  });

  it("covers editing, tag removal, draft publishing, and saving states", () => {
    const draft = {
      ...post,
      status: "draft" as const,
      excerpt: "Draft summary",
      author: { id: "user-1", email: "author@example.com", username: "Author" },
    };
    const p = props({
      posts: [draft],
      editingId: "post-1",
      savingId: "post-1",
      form: {
        ...emptyBlogForm(),
        title: "Draft",
        tags: ["release"],
        coverImageUrl: "https://example.com/cover.jpg",
        coverImageBlobName: "cover.jpg",
      },
    });
    const { rerender } = render(<BlogPanel {...p} />);
    expect(screen.getByText("Edit blog post")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Working..." })).toBeDisabled();
    expect(
      screen.queryByRole("link", { name: "View public post" }),
    ).not.toBeInTheDocument();
    rerender(<BlogPanel {...p} savingId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove tag release" }));
    expect(p.onFormChange).toHaveBeenCalledWith(
      expect.objectContaining({ tags: [] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(p.onFormChange).toHaveBeenCalledWith(
      expect.objectContaining({ coverImageUrl: "", coverImageBlobName: "" }),
    );
    fireEvent.change(screen.getByLabelText("Excerpt (optional)"), {
      target: { value: "New summary" },
    });
    fireEvent.change(screen.getByLabelText("Visibility"), {
      target: { value: "published" },
    });
    expect(p.onFormChange).toHaveBeenCalledWith(
      expect.objectContaining({ excerpt: "New summary" }),
    );
    expect(p.onFormChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: "published" }),
    );
  });

  it("toggles comments on a post", () => {
    const p = props({ form: { ...emptyBlogForm(), commentsEnabled: true } });
    render(<BlogPanel {...p} />);

    fireEvent.click(screen.getByLabelText(/allow comments/i));

    expect(p.onFormChange).toHaveBeenCalledWith(
      expect.objectContaining({ commentsEnabled: false }),
    );
  });

  it("defaults a new post to accepting comments", () => {
    const p = props();
    render(<BlogPanel {...p} />);

    expect(screen.getByLabelText(/allow comments/i)).toBeChecked();
  });

  it("handles tag separators, blanks, duplicates, and the tag limit", () => {
    const p = props({ form: { ...emptyBlogForm(), tags: ["news"] } });
    const { rerender } = render(<BlogPanel {...p} />);
    const input = screen.getByPlaceholderText("Add a tag and press Enter");
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "news" } });
    fireEvent.keyDown(input, { key: "," });
    expect(p.onFormChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "launch" } });
    fireEvent.keyDown(input, { key: "," });
    expect(p.onFormChange).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["news", "launch"] }),
    );

    rerender(
      <BlogPanel
        {...props({
          form: {
            ...emptyBlogForm(),
            tags: Array.from({ length: 10 }, (_, index) => `tag-${index}`),
          },
        })}
      />,
    );
    expect(
      screen.getByPlaceholderText("Add a tag and press Enter"),
    ).toBeDisabled();
  });

  it("uploads, rejects, and reports cover-image uploads", async () => {
    const p = props();
    createUploadUrlMock.mockResolvedValue({
      uploadUrl: "https://uploads.example.com/cover",
      method: "PUT",
      headers: { "x-upload": "yes" },
      blobUrl: "https://cdn.example.com/cover.jpg",
      blobName: "cover.jpg",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const { rerender } = render(<BlogPanel {...p} />);
    const input = screen.getByLabelText("Upload blog cover image");
    const file = new File(["image"], "cover.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    await vi.waitFor(() =>
      expect(p.onFormChange).toHaveBeenCalledWith(
        expect.objectContaining({
          coverImageUrl: "https://cdn.example.com/cover.jpg",
          coverImageBlobName: "cover.jpg",
        }),
      ),
    );

    const failed = props();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    rerender(<BlogPanel {...failed} />);
    fireEvent.change(screen.getByLabelText("Upload blog cover image"), {
      target: { files: [file] },
    });
    await vi.waitFor(() =>
      expect(failed.onError).toHaveBeenCalledWith(
        expect.stringMatching(/couldn't upload/i),
      ),
    );

    fireEvent.change(screen.getByLabelText("Upload blog cover image"), {
      target: { files: [] },
    });
  });
});
