import { SEED_USERS } from "@/seeds/fixtures/users";

describe("seeded user fixtures", () => {
  it("assigns a non-empty username to every seeded user", () => {
    const normalizedUsernames = new Set<string>();

    for (const user of SEED_USERS) {
      expect(user.username.trim()).not.toBe("");
      expect(normalizedUsernames.has(user.username.toLowerCase())).toBe(false);
      normalizedUsernames.add(user.username.toLowerCase());
    }
  });
});
