import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import { PostingExpiryEmailComposer } from "@/features/postings/posting-expiry-email.composer";
import type { PostingRecord } from "@/features/postings/postings.model";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import { testUuid } from "../../support/uuid";
const ORG_1_ID = testUuid(9200, 9234);
const POSTING_1_ID = testUuid(9200, 254272);
const USER_1_ID = testUuid(9200, 994257);

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Relative rather than a fixed date: the composer now refuses deadlines that
 * have already passed, so a hard-coded literal would quietly start failing the
 * happy-path cases once real time moved past it.
 */
const EXPIRES_AT = new Date(Date.now() + 3 * DAY_IN_MS).toISOString();
const ALREADY_PASSED = new Date(Date.now() - DAY_IN_MS).toISOString();

function buildPosting(overrides: Partial<PostingRecord> = {}): PostingRecord {
  return {
    id: POSTING_1_ID,
    organizationId: ORG_1_ID,
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
  } as unknown as UsersRepository;

  return new PostingExpiryEmailComposer(
    postingsRepository,
    authRepository,
    organizationAccessService,
  );
}

const input = {
  postingId: POSTING_1_ID,
  recipientId: USER_1_ID,
  expiresAt: EXPIRES_AT,
};

describe("PostingExpiryEmailComposer", () => {
  it("composes the reminder when the posting is still expiring on that date", async () => {
    const composer = createComposer();

    await expect(composer.compose(input)).resolves.toEqual({
      to: "owner@example.com",
      firstName: "Ada",
      postingId: POSTING_1_ID,
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
      posting: buildPosting({
        expiresAt: new Date(Date.now() + 30 * DAY_IN_MS).toISOString(),
      }),
    });

    await expect(composer.compose(input)).resolves.toBeNull();
  });

  it("skips when the deadline has already passed", async () => {
    // The sweeper that pauses expired postings runs in its own worker. If it is
    // stopped or lagging, the posting is still `published` on its original
    // instant and every other guard passes, so without this check the owner
    // gets an "about to expire" email naming a day that has already gone.
    const composer = createComposer({
      posting: buildPosting({ expiresAt: ALREADY_PASSED }),
    });

    await expect(
      composer.compose({ ...input, expiresAt: ALREADY_PASSED }),
    ).resolves.toBeNull();
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
