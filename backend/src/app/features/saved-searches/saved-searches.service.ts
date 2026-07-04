import ConflictError from "@/errors/http/conflict.error";
import ForbiddenError from "@/errors/http/forbidden.error";
import ResourceNotFoundError from "@/errors/http/resource-not-found.error";
import type {
  CreateSavedSearchRequestBody,
  SavedSearchRecord,
  UpdateSavedSearchRequestBody,
} from "@/features/saved-searches/saved-searches.model";
import { MAX_SAVED_SEARCHES_PER_USER } from "@/features/saved-searches/saved-searches.model";
import type { SavedSearchesRepository } from "@/features/saved-searches/saved-searches.repository";

export class SavedSearchesService {
  constructor(
    private readonly savedSearchesRepository: SavedSearchesRepository,
  ) {}

  async create(
    userId: string,
    input: CreateSavedSearchRequestBody,
  ): Promise<SavedSearchRecord> {
    const count = await this.savedSearchesRepository.countByUser(userId);

    if (count >= MAX_SAVED_SEARCHES_PER_USER) {
      throw new ConflictError(
        `Saved search limit reached. A maximum of ${MAX_SAVED_SEARCHES_PER_USER} saved searches are allowed per user.`,
      );
    }

    return this.savedSearchesRepository.create(userId, {
      name: input.name,
      searchParams: input.searchParams,
      alertEnabled: input.alertEnabled,
    });
  }

  async list(userId: string): Promise<SavedSearchRecord[]> {
    return this.savedSearchesRepository.findByUser(userId);
  }

  async update(
    userId: string,
    id: string,
    input: UpdateSavedSearchRequestBody,
  ): Promise<SavedSearchRecord> {
    const existing = await this.savedSearchesRepository.findById(id);

    if (!existing) {
      throw new ResourceNotFoundError("Saved search not found.");
    }

    if (existing.userId !== userId) {
      throw new ForbiddenError(
        "You do not have permission to update this saved search.",
      );
    }

    return this.savedSearchesRepository.update(id, {
      name: input.name,
      searchParams: input.searchParams,
      alertEnabled: input.alertEnabled,
    });
  }

  async delete(userId: string, id: string): Promise<void> {
    const existing = await this.savedSearchesRepository.findById(id);

    if (!existing) {
      throw new ResourceNotFoundError("Saved search not found.");
    }

    if (existing.userId !== userId) {
      throw new ForbiddenError(
        "You do not have permission to delete this saved search.",
      );
    }

    await this.savedSearchesRepository.delete(id);
  }
}
