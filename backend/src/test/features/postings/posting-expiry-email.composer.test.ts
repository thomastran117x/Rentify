import type { AuthRepository } from "@/features/auth/auth.repository";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import { PostingExpiryEmailComposer } from "@/features/postings/posting-expiry-email.composer";
import type { PostingRecord } from "@/features/postings/postings.model";
import type { PostingsRepository } from "@/features/postings/postings.repository";

const EXPIRES_AT = "2026-08-24T23:59:59.999Z";

function buildPosting(overrides: Partial<PostingRecord> = {}): PostingRecord {
  return {
    id: "posting-1",
    organizationId: "org-1",
    status: "published",
    name: "Lakeside cabin",
    expiresAt: EXPIRES_AT,
    ...overrides,
  } as PostingRecord;
}

function createComposer(
  options: {
    posting?: PostingRecord | null;
    membership?: Record<string, unknown> | null;
    user?: Record<string, unknown> | null;
  } = {},
) {
  const postingsRepository = {
    findById: async () =>
      options.posting === undefined ? buildPosting() : options.posting,
  } as unknown as PostingsRepository;

  const organizationAccessService = {
    findMembership: async () =>
      options.membership === undefined
        ? { role: "primary_manager" }
        : options.membership,
  } as unknown as OrganizationAccessService;

  const authRepository = {
    findUserById: async () =>
      options.user === undefined
        ? { email: "owner@example.com", firstName: "Ada" }
        : options.user,
  } as unknown as AuthRepository;

  return new PostingExpiryEmailComposer(
    postingsRepository,
    authRepository,
    organizationAccessService,
  );
}

const input = {
  postingId: "posting-1",
  recipientId: "user-1",
  expiresAt: EXPIRES_AT,
};

describe("PostingExpiryEmailComposer", () => {
  it("composes the reminder when the posting is still expiring on that date", async () => {
    const composer = createComposer();

    await expect(composer.compose(input)).resolves.toEqual({
      to: "owner@example.com",
      firstName: "Ada",
      postingId: "posting-1",
      postingName: "Lakeside cabin",
      expiresAt: EXPIRES_AT,
    });
  });

  it("omits the greeting name when the recipient has none", async () => {
    const composer = createComposer({ user: { email: "owner@example.com" } });

    const content = await composer.compose(input);

    expect(content).not.toBeNull();
    expect(content).not.toHaveProperty("firstName");
  });

  it("skips a posting that no longer exists", async () => {
    const composer = createComposer({ posting: null });

    await expect(composer.compose(input)).resolves.toBeNull();
  });

  it.each(["paused", "archived", "draft"] as const)(
    "skips a posting that is no longer published (%s)",
    async (status) => {
      const composer = createComposer({ posting: buildPosting({ status }) });

      await expect(composer.compose(input)).resolves.toBeNull();
    },
  );

  it("skips an archived posting even if the status still reads published", async () => {
    const composer = createComposer({
      posting: buildPosting({ archivedAt: "2026-08-20T00:00:00.000Z" }),
    });

    await expect(composer.compose(input)).resolves.toBeNull();
  });

  it("skips when the owner cleared the expiry date while the job waited", async () => {
    const composer = createComposer({
      posting: buildPosting({ expiresAt: undefined }),
    });

    await expect(composer.compose(input)).resolves.toBeNull();
  });

  it("skips when the owner moved the expiry date while the job waited", async () => {
    const composer = createComposer({
      posting: buildPosting({ expiresAt: "2026-12-01T23:59:59.999Z" }),
    });

    await expect(composer.compose(input)).resolves.toBeNull();
  });

  it("skips when the recipient has lost their organization membership", async () => {
    const composer = createComposer({ membership: null });

    await expect(composer.compose(input)).resolves.toBeNull();
  });

  it("skips when the recipient has no email on file", async () => {
    const composer = createComposer({ user: { firstName: "Ada" } });

    await expect(composer.compose(input)).resolves.toBeNull();
  });

  it("skips when the recipient no longer exists", async () => {
    const composer = createComposer({ user: null });

    await expect(composer.compose(input)).resolves.toBeNull();
  });

  it("skips when either date is unparseable", async () => {
    const composer = createComposer({
      posting: buildPosting({ expiresAt: "not-a-date" }),
    });

    await expect(composer.compose(input)).resolves.toBeNull();
  });
});
