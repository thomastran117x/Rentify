import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { buildImageSrcSet, ResponsiveImage } from "./responsive-image";

const VARIANTS = {
  thumbnail: "https://cdn.test/media/images/u/m.thumbnail.webp",
  medium: "https://cdn.test/media/images/u/m.medium.webp",
  large: "https://cdn.test/media/images/u/m.webp",
};

describe("buildImageSrcSet", () => {
  it("lists every rendition with its width, smallest first", () => {
    expect(buildImageSrcSet(VARIANTS)).toBe(
      "https://cdn.test/media/images/u/m.thumbnail.webp 300w, " +
        "https://cdn.test/media/images/u/m.medium.webp 800w, " +
        "https://cdn.test/media/images/u/m.webp 2560w",
    );
  });
});

describe("ResponsiveImage", () => {
  it("offers the renditions with the drawn size", () => {
    render(
      <ResponsiveImage
        src={VARIANTS.large}
        variants={VARIANTS}
        sizes="40px"
        alt="Avatar"
        className="h-10 w-10"
      />,
    );

    const image = screen.getByRole("img", { name: "Avatar" });
    expect(image).toHaveAttribute("src", VARIANTS.large);
    expect(image).toHaveAttribute("srcset", buildImageSrcSet(VARIANTS));
    expect(image).toHaveAttribute("sizes", "40px");
    expect(image).toHaveClass("h-10", "w-10");
  });

  it.each([null, undefined])(
    "renders the URL alone when the image has no renditions (%s)",
    (variants) => {
      render(
        <ResponsiveImage
          src="https://example.com/seeded.jpg"
          variants={variants}
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
        src={VARIANTS.large}
        variants={VARIANTS}
        sizes="240px"
        alt="Card"
        onError={onError}
      />,
    );
    const image = screen.getByRole("img", { name: "Card" });

    fireEvent.error(image);

    expect(image).not.toHaveAttribute("srcset");
    expect(image).toHaveAttribute("src", VARIANTS.large);
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
          src={VARIANTS.large}
          variants={VARIANTS}
          sizes="240px"
          alt="Card"
        />,
      );

      const image = screen.getByRole("img", { name: "Card" });
      expect(image).not.toHaveAttribute("srcset");
      expect(image).toHaveAttribute("src", VARIANTS.large);
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
          src={VARIANTS.large}
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
        src={VARIANTS.large}
        variants={VARIANTS}
        sizes="240px"
        alt="Card"
      />,
    );
    fireEvent.error(screen.getByRole("img", { name: "Card" }));

    const next = {
      thumbnail: "https://cdn.test/media/images/u/n.thumbnail.webp",
      medium: "https://cdn.test/media/images/u/n.medium.webp",
      large: "https://cdn.test/media/images/u/n.webp",
    };
    rerender(
      <ResponsiveImage
        src={next.large}
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
