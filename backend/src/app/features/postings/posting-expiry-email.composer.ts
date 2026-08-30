import type { UsersRepository } from "@/features/auth/users/users.repository";
import type { OrganizationAccessService } from "@/features/organizations/organization-access.service";
import type { PostingsRepository } from "@/features/postings/postings.repository";
import { asUuid, type Uuid } from "@/configuration/validation/uuid";

export interface ComposePostingExpiryEmailInput {
  postingId: Uuid;
  recipientId: Uuid;
  expiresAt: string;
}

export interface PostingExpiryEmailContent {
  to: string;
  firstName?: string;
  postingId: Uuid;
  postingName: string;
  expiresAt: string;
}

/**
 * Hydrates the "expiring soon" reminder from the ids carried on the queue job.
 *
 * Returns `null` whenever the reminder has stopped being true, so the worker
 * acknowledges the job instead of retrying it to the dead-letter queue. That
 * matters more for this email than for most: the job is enqueued days ahead of
 * the deadline it describes, and the owner may well have acted on it — or been
 * removed from the organization — before the worker gets to it. Sending a
 * reminder that no longer applies is worse than sending nothing.
 */
export class PostingExpiryEmailComposer {
  constructor(
    private readonly postingsRepository: PostingsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly organizationAccessService: OrganizationAccessService,
  ) {}

  async compose(
    input: ComposePostingExpiryEmailInput,
  ): Promise<PostingExpiryEmailContent | null> {
    const posting = await this.postingsRepository.findById(input.postingId);

    if (!posting) {
      return null;
    }

    // Only a live listing can be "expiring soon". If it has since been paused,
    // archived or rolled back to a draft, the deadline is no longer news.
    if (posting.status !== "published" || posting.archivedAt) {
      return null;
    }

    // The owner may have cleared or moved the date while the job waited. The
    // reminder describes a specific deadline, so it is only worth sending if
    // the posting still carries the one the job was enqueued for.
    if (
      !posting.expiresAt ||
      !this.isSameInstant(posting.expiresAt, input.expiresAt)
    ) {
      return null;
    }

    // The deadline itself must still be ahead. Matching the instant is not
    // enough: the sweeper that pauses expired postings runs in its own worker,
    // so if it is stopped or lagging the posting stays `published` past its
    // date and every check above still passes. Sending then would announce
    // that a listing is "about to expire" on a day that has already gone.
    if (Date.parse(posting.expiresAt) <= Date.now()) {
      return null;
    }

    // Re-checked at send time, never trusted from the job. The recipient was
    // the organization's primary manager when the reminder was claimed; by now
    // they may have been removed or replaced, and this email names a listing
    // and links into the owner dashboard.
    const membership = await this.organizationAccessService.findMembership(
      input.recipientId,
      posting.organizationId,
    );

    if (!membership) {
      return null;
    }

    const recipient = await this.usersRepository.findUserById(
      input.recipientId,
    );

    if (!recipient?.email) {
      return null;
    }

    return {
      to: recipient.email,
      ...(recipient.firstName ? { firstName: recipient.firstName } : {}),
      postingId: asUuid(posting.id),
      postingName: posting.name,
      expiresAt: posting.expiresAt,
    };
  }

  private isSameInstant(left: string, right: string): boolean {
    const parsedLeft = Date.parse(left);
    const parsedRight = Date.parse(right);

    return (
      !Number.isNaN(parsedLeft) &&
      !Number.isNaN(parsedRight) &&
      parsedLeft === parsedRight
    );
  }
}
