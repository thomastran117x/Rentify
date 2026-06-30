import { randomUUID } from "node:crypto";
import { BaseRepository } from "@/features/base/base.repository";
import type {
  SeasonalPricingRecord,
  UpsertSeasonalPricingInput,
} from "@/features/postings/seasonal-pricing/seasonal-pricing.model";

export class SeasonalPricingRepository extends BaseRepository {
  async listByPosting(postingId: string): Promise<SeasonalPricingRecord[]> {
    const rows = await this.database.postingSeasonalPricing.findMany({
      where: { postingId },
      orderBy: { startDate: "asc" },
    });
    return rows.map(this.toRecord);
  }

  async countByPosting(postingId: string): Promise<number> {
    return this.database.postingSeasonalPricing.count({ where: { postingId } });
  }

  async findById(
    id: string,
    postingId: string,
  ): Promise<SeasonalPricingRecord | null> {
    const row = await this.database.postingSeasonalPricing.findFirst({
      where: { id, postingId },
    });
    return row ? this.toRecord(row) : null;
  }

  async create(
    input: UpsertSeasonalPricingInput,
  ): Promise<SeasonalPricingRecord> {
    const row = await this.database.postingSeasonalPricing.create({
      data: {
        id: randomUUID(),
        postingId: input.postingId,
        name: input.name,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        dailyAmount: input.dailyAmount,
      },
    });
    return this.toRecord(row);
  }

  async update(
    id: string,
    postingId: string,
    input: Omit<UpsertSeasonalPricingInput, "postingId">,
  ): Promise<SeasonalPricingRecord | null> {
    const result = await this.database.postingSeasonalPricing.updateMany({
      where: { id, postingId },
      data: {
        name: input.name,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        dailyAmount: input.dailyAmount,
      },
    });
    if (result.count === 0) return null;

    const row = await this.database.postingSeasonalPricing.findFirst({
      where: { id, postingId },
    });
    return row ? this.toRecord(row) : null;
  }

  async delete(id: string, postingId: string): Promise<boolean> {
    const result = await this.database.postingSeasonalPricing.deleteMany({
      where: { id, postingId },
    });
    return result.count > 0;
  }

  async findOverlappingForBooking(
    postingId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<SeasonalPricingRecord[]> {
    // booking days: startAt (inclusive) to endAt (exclusive), i.e. dates [startDate, endDate)
    // a rule overlaps if rule.startDate <= last booking day AND rule.endDate >= first booking day
    const firstDay = new Date(startAt);
    firstDay.setUTCHours(0, 0, 0, 0);
    const lastDay = new Date(endAt.getTime() - 86400000);
    lastDay.setUTCHours(0, 0, 0, 0);

    const rows = await this.database.postingSeasonalPricing.findMany({
      where: {
        postingId,
        startDate: { lte: lastDay },
        endDate: { gte: firstDay },
      },
    });
    return rows.map(this.toRecord);
  }

  private toRecord(row: {
    id: string;
    postingId: string;
    name: string;
    startDate: Date;
    endDate: Date;
    dailyAmount: { toString(): string };
    createdAt: Date;
    updatedAt: Date;
  }): SeasonalPricingRecord {
    return {
      id: row.id,
      postingId: row.postingId,
      name: row.name,
      startDate: row.startDate.toISOString().slice(0, 10),
      endDate: row.endDate.toISOString().slice(0, 10),
      dailyAmount: Number(row.dailyAmount),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
