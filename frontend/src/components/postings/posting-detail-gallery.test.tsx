import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { PublicPostingPhoto } from "@/lib/postings/public";
import { PostingDetailGallery } from "./posting-detail-gallery";

function buildPhoto(
  overrides: Partial<PublicPostingPhoto> = {},
): PublicPostingPhoto {
  return {
    id: "photo-1",
    blobUrl: "https://cdn.rent.local/photo-1.jpg",
    blobName: "photo-1.jpg",
    thumbnailBlobUrl: "https://cdn.rent.local/photo-1-thumb.jpg",
    thumbnailBlobName: "photo-1-thumb.jpg",
    position: 1,
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-06-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("PostingDetailGallery", () => {
  it("shows a fallback when no renderable preview images are available", () => {
    render(
      <PostingDetailGallery
        name="Mountain Cabin"
        photos={[
          buildPhoto({
            blobUrl: "https://example.com/photo-1.jpg",
            thumbnailBlobUrl: "https://example.com/photo-1-thumb.jpg",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Preview Unavailable")).toBeInTheDocument();
    expect(screen.queryByAltText("Mountain Cabin")).not.toBeInTheDocument();
  });

  it("renders the first renderable photo by default and ignores example.com placeholders", () => {
    render(
      <PostingDetailGallery
        name="Mountain Cabin"
        photos={[
          buildPhoto({
            id: "placeholder-photo",
            blobUrl: "https://example.com/photo-1.jpg",
            thumbnailBlobUrl: "https://example.com/photo-1-thumb.jpg",
          }),
          buildPhoto({
            id: "renderable-photo",
            blobUrl: "https://cdn.rent.local/photo-2.jpg",
            thumbnailBlobUrl: "https://cdn.rent.local/photo-2-thumb.jpg",
          }),
        ]}
      />,
    );

    expect(screen.getByAltText("Mountain Cabin")).toHaveAttribute(
      "src",
      "https://cdn.rent.local/photo-2.jpg",
    );
    expect(
      screen.queryByRole("button", { name: "View photo 2 for Mountain Cabin" }),
    ).not.toBeInTheDocument();
  });

  it("offers each photo's renditions, sized for where it is drawn", () => {
    const variants = (name: string) => ({
      thumbnail: `https://cdn.rent.local/${name}.thumbnail.webp`,
      medium: `https://cdn.rent.local/${name}.medium.webp`,
      large: `https://cdn.rent.local/${name}.webp`,
    });
    render(
      <PostingDetailGallery
        name="Mountain Cabin"
        photos={[
          buildPhoto({
            id: "photo-a",
            blobUrl: "https://cdn.rent.local/a.webp",
            variants: variants("a"),
          }),
          buildPhoto({
            id: "photo-b",
            blobUrl: "https://cdn.rent.local/b.webp",
            thumbnailBlobUrl: undefined,
            variants: variants("b"),
          }),
        ]}
      />,
    );

    const main = screen.getByAltText("Mountain Cabin");
    expect(main).toHaveAttribute("src", "https://cdn.rent.local/a.webp");
    expect(main).toHaveAttribute(
      "srcset",
      expect.stringContaining("https://cdn.rent.local/a.medium.webp 800w"),
    );
    expect(main).toHaveAttribute(
      "sizes",
      "(min-width: 1280px) 610px, (min-width: 1024px) 50vw, 100vw",
    );

    const strip = screen
      .getByRole("button", { name: "View photo 1 for Mountain Cabin" })
      .querySelector("img");
    // Renditions are offered, with the card crop as the fallback.
    expect(strip).toHaveAttribute(
      "src",
      "https://cdn.rent.local/photo-1-thumb.jpg",
    );
    expect(strip).toHaveAttribute(
      "srcset",
      expect.stringContaining("https://cdn.rent.local/a.thumbnail.webp 300w"),
    );
    expect(strip).toHaveAttribute("sizes", "128px");
  });

  it("switches the main preview when a thumbnail is selected", async () => {
    const user = userEvent.setup();

    render(
      <PostingDetailGallery
        name="Mountain Cabin"
        photos={[
          buildPhoto({
            id: "photo-1",
            blobUrl: "https://cdn.rent.local/photo-1.jpg",
            thumbnailBlobUrl: "https://cdn.rent.local/photo-1-thumb.jpg",
          }),
          buildPhoto({
            id: "photo-2",
            blobUrl: "https://cdn.rent.local/photo-2.jpg",
            thumbnailBlobUrl: "https://cdn.rent.local/photo-2-thumb.jpg",
            position: 2,
          }),
        ]}
      />,
    );

    expect(screen.getByAltText("Mountain Cabin")).toHaveAttribute(
      "src",
      "https://cdn.rent.local/photo-1.jpg",
    );

    await user.click(
      screen.getByRole("button", { name: "View photo 2 for Mountain Cabin" }),
    );

    expect(screen.getByAltText("Mountain Cabin")).toHaveAttribute(
      "src",
      "https://cdn.rent.local/photo-2.jpg",
    );
  });
});
