import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ImageVariants } from "@/lib/media/api";
import { buildImageSrcSet, ResponsiveImage } from "./responsive-image";

function renditionsOf(name: string, largeWidth = 1600): ImageVariants {
  const base = `https://cdn.test/media/images/u/${name}`;

  return {
    thumbnail: { url: `${base}.thumbnail.webp`, width: 300, height: 225 },
    medium: { url: `${base}.medium.webp`, width: 800, height: 600 },
    large: { url: `${base}.webp`, width: largeWidth, height: 1200 },
  };
}

const VARIANTS = renditionsOf("m");
const LARGE = VARIANTS.large.url;

describe("buildImageSrcSet", () => {
  it("lists every rendition with its real width, smallest first", () => {
    expect(buildImageSrcSet(renditionsOf("m", 1200))).toBe(
      "https://cdn.test/media/images/u/m.thumbnail.webp 300w, " +
        "https://cdn.test/media/images/u/m.medium.webp 800w, " +
        "https://cdn.test/media/images/u/m.webp 1200w",
    );
  });

  it("offers a rendition given as the large one only once", () => {
    const large = { url: LARGE, width: 600, height: 450 };

    expect(buildImageSrcSet({ ...VARIANTS, medium: large, large })).toBe(
      "https://cdn.test/media/images/u/m.thumbnail.webp 300w, " +
        "https://cdn.test/media/images/u/m.webp 600w",
    );
  });

  it("offers nothing when there is only one image to choose", () => {
    const large = { url: LARGE, width: 200, height: 150 };

    expect(
      buildImageSrcSet({ thumbnail: large, medium: large, large }),
    ).toBeUndefined();
  });

  it.each([
    ["no renditions", null],
    [
      "URLs without widths, as an older release cached them",
      {
        thumbnail: "https://cdn.test/m.thumbnail.webp",
        medium: "https://cdn.test/m.medium.webp",
        large: "https://cdn.test/m.webp",
      },
    ],
    [
      "an unresolved reference",
      { $imageVariants: { blobName: "media/images/u/m.webp", blobUrl: LARGE } },
    ],
    [
      "a rendition with no width",
      { ...VARIANTS, medium: { url: "https://cdn.test/m.medium.webp" } },
    ],
  ])("offers nothing for %s", (_label, variants) => {
    expect(
      buildImageSrcSet(variants as unknown as ImageVariants | null),
    ).toBeUndefined();
  });
});

describe("ResponsiveImage", () => {
  it("offers the renditions with the drawn size", () => {
    render(
      <ResponsiveImage
        src={LARGE}
        variants={VARIANTS}
        sizes="40px"
        alt="Avatar"
        className="h-10 w-10"
      />,
    );

    const image = screen.getByRole("img", { name: "Avatar" });
    expect(image).toHaveAttribute("src", LARGE);
    expect(image).toHaveAttribute("srcset", buildImageSrcSet(VARIANTS));
    expect(image).toHaveAttribute("sizes", "40px");
    expect(image).toHaveClass("h-10", "w-10");
  });

  it.each([null, undefined, { large: "https://cdn.test/m.webp" }])(
    "renders the URL alone when the image has no usable renditions (%s)",
    (variants) => {
      render(
        <ResponsiveImage
          src="https://example.com/seeded.jpg"
          variants={variants as ImageVariants | null | undefined}
          sizes="100vw"
          alt="Seeded"
        />,
      );

      const image = screen.getByRole("img", { name: "Seeded" });
      expect(image).toHaveAttribute("src", "https://example.com/seeded.jpg");
      expect(image).not.toHaveAttribute("srcset");
      expect(image).not.toHaveAttribute("sizes");
    },
  );

  it("falls back to the URL when a rendition fails to load", () => {
    const onError = vi.fn();
    render(
      <ResponsiveImage
        src={LARGE}
        variants={VARIANTS}
        sizes="240px"
        alt="Card"
        onError={onError}
      />,
    );
    const image = screen.getByRole("img", { name: "Card" });

    fireEvent.error(image);

    expect(image).not.toHaveAttribute("srcset");
    expect(image).toHaveAttribute("src", LARGE);
    // The fallback is handled here; only a failure of the URL itself is the
    // caller's to handle.
    expect(onError).not.toHaveBeenCalled();

    fireEvent.error(image);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("falls back when a rendition failed before the image was hydrated", () => {
    // Loaded to completion with no pixels: an error React never saw.
    const complete = vi
      .spyOn(HTMLImageElement.prototype, "complete", "get")
      .mockReturnValue(true);
    const naturalWidth = vi
      .spyOn(HTMLImageElement.prototype, "naturalWidth", "get")
      .mockReturnValue(0);

    try {
      render(
        <ResponsiveImage
          src={LARGE}
          variants={VARIANTS}
          sizes="240px"
          alt="Card"
        />,
      );

      const image = screen.getByRole("img", { name: "Card" });
      expect(image).not.toHaveAttribute("srcset");
      expect(image).toHaveAttribute("src", LARGE);
    } finally {
      complete.mockRestore();
      naturalWidth.mockRestore();
    }
  });

  it("keeps the renditions of an image that loaded before hydration", () => {
    const complete = vi
      .spyOn(HTMLImageElement.prototype, "complete", "get")
      .mockReturnValue(true);
    const naturalWidth = vi
      .spyOn(HTMLImageElement.prototype, "naturalWidth", "get")
      .mockReturnValue(300);

    try {
      render(
        <ResponsiveImage
          src={LARGE}
          variants={VARIANTS}
          sizes="240px"
          alt="Card"
        />,
      );

      expect(screen.getByRole("img", { name: "Card" })).toHaveAttribute(
        "srcset",
        buildImageSrcSet(VARIANTS),
      );
    } finally {
      complete.mockRestore();
      naturalWidth.mockRestore();
    }
  });

  it("tries new renditions again after an earlier one failed", () => {
    const { rerender } = render(
      <ResponsiveImage
        src={LARGE}
        variants={VARIANTS}
        sizes="240px"
        alt="Card"
      />,
    );
    fireEvent.error(screen.getByRole("img", { name: "Card" }));

    const next = renditionsOf("n");
    rerender(
      <ResponsiveImage
        src={next.large.url}
        variants={next}
        sizes="240px"
        alt="Card"
      />,
    );

    expect(screen.getByRole("img", { name: "Card" })).toHaveAttribute(
      "srcset",
      buildImageSrcSet(next),
    );
  });
});
