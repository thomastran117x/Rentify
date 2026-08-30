import type { Uuid } from "@/configuration/validation/uuid";

export interface PostingThumbnailJobPayload {
  jobId: string;
  postingId: Uuid;
  attempt: number;
  occurredAt: string;
}
