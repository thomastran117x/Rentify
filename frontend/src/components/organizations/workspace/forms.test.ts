import { describe, expect, it } from "vitest";
import { emptyProfileForm, profileFormToInput } from "./forms";

describe("profileFormToInput", () => {
  it("sends a newly uploaded logo by media id only", () => {
    const input = profileFormToInput({
      ...emptyProfileForm(),
      logoUrl: "https://cdn.test/media/images/user-1/media-1.webp",
      logoBlobName: "",
      logoMediaId: "media-1",
    });

    expect(input.logoMediaId).toBe("media-1");
    expect(input).not.toHaveProperty("logoUrl");
    expect(input).not.toHaveProperty("logoBlobName");
  });

  it("resends the stored logo, or clears it, as its blob reference", () => {
    const stored = profileFormToInput({
      ...emptyProfileForm(),
      logoUrl: "https://cdn.test/media/images/user-1/media-1.webp",
      logoBlobName: "media/images/user-1/media-1.webp",
    });
    const cleared = profileFormToInput(emptyProfileForm());

    expect(stored).toMatchObject({
      logoUrl: "https://cdn.test/media/images/user-1/media-1.webp",
      logoBlobName: "media/images/user-1/media-1.webp",
    });
    expect(stored).not.toHaveProperty("logoMediaId");
    expect(cleared).toMatchObject({ logoUrl: null, logoBlobName: null });
  });
});
