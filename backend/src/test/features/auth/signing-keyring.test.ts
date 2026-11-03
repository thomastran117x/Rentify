import { SigningKeyring } from "@/features/auth/token/signing-keyring";

describe("SigningKeyring", () => {
  const current = { kid: "k2", status: "current" as const };
  const legacy = { kid: "default", status: "previous" as const };

  it("signs with the current key and finds any key by kid", () => {
    const keyring = new SigningKeyring([legacy, current]);

    expect(keyring.current).toBe(current);
    expect(keyring.find("k2")).toBe(current);
    expect(keyring.find("missing")).toBeUndefined();
  });

  it("resolves a missing kid to the default key", () => {
    expect(new SigningKeyring([current, legacy]).find()).toBe(legacy);
    expect(new SigningKeyring([current]).find()).toBeUndefined();
  });

  it("refuses a keyset without exactly one current key", () => {
    expect(() => new SigningKeyring([legacy])).toThrow(
      "A signing keyset needs exactly one current key.",
    );
    expect(
      () =>
        new SigningKeyring([
          current,
          { kid: "k3", status: "current" as const },
        ]),
    ).toThrow("A signing keyset needs exactly one current key.");
  });

  it("refuses a keyset that repeats a kid", () => {
    expect(
      () =>
        new SigningKeyring([
          current,
          { kid: "k2", status: "previous" as const },
        ]),
    ).toThrow("A signing keyset lists kid k2 more than once.");
  });
});
