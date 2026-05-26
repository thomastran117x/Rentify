import { getOptionalEnvironmentVariable } from "@/configuration/environment";
import {
  ElasticsearchRequestError,
  ElasticsearchUnavailableError,
  getElasticsearchClient,
  type ElasticsearchClient,
} from "@/configuration/resources/elasticsearch";
import { loggerFactory, type Logger } from "@/configuration/logging";
import type {
  ContentReportSearchDocument,
  ListContentReportsInput,
  ReportSubjectType,
} from "@/features/reports/reports.model";

interface ElasticsearchBulkResponseItem {
  index?: {
    status: number;
    error?: {
      reason?: string;
      type?: string;
    };
  };
  delete?: {
    status: number;
    error?: {
      reason?: string;
      type?: string;
    };
  };
}

interface ElasticsearchBulkResponse {
  errors?: boolean;
  items?: ElasticsearchBulkResponseItem[];
}

interface ElasticsearchSearchHit {
  _id: string;
}

interface ElasticsearchSearchResponse {
  hits?: {
    total?: {
      value: number;
    };
    hits?: ElasticsearchSearchHit[];
  };
}

export class ReportsSearchIndexService {
  private readonly logger: Logger;
  private readonly indexName: string;

  constructor(
    private readonly elasticsearch: ElasticsearchClient = getElasticsearchClient(),
  ) {
    this.logger = loggerFactory.forClass(ReportsSearchIndexService, "service");
    this.indexName =
      getOptionalEnvironmentVariable("ELASTICSEARCH_REPORTS_INDEX") ??
      `${this.elasticsearch.getPostingsIndexName()}-reports`;
  }

  isElasticsearchEnabled(): boolean {
    return this.elasticsearch.isEnabled();
  }

  async ensureIndex(): Promise<void> {
    if (!this.isElasticsearchEnabled()) {
      return;
    }

    try {
      await this.elasticsearch.requestJson(
        `/${encodeURIComponent(this.indexName)}`,
        {
          method: "PUT",
          body: JSON.stringify(this.buildIndexConfiguration()),
        },
        {
          allowNotFound: true,
        },
      );
    } catch (error) {
      if (error instanceof ElasticsearchRequestError && error.status === 400) {
        return;
      }

      throw error;
    }
  }

  async upsertDocument(document: ContentReportSearchDocument): Promise<void> {
    await this.ensureIndex();
    await this.elasticsearch.requestJson(
      `/${encodeURIComponent(this.indexName)}/_doc/${encodeURIComponent(document.id)}`,
      {
        method: "PUT",
        body: JSON.stringify(document),
      },
    );
  }

  async deleteDocument(id: string): Promise<void> {
    await this.elasticsearch.requestJson(
      `/${encodeURIComponent(this.indexName)}/_doc/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      },
      {
        allowNotFound: true,
      },
    );
  }

  async bulkUpsertDocuments(
    documents: ContentReportSearchDocument[],
  ): Promise<void> {
    if (documents.length === 0) {
      return;
    }

    await this.ensureIndex();

    const payload = documents
      .flatMap((document) => [
        JSON.stringify({
          index: {
            _index: this.indexName,
            _id: document.id,
          },
        }),
        JSON.stringify(document),
      ])
      .join("\n")
      .concat("\n");

    const response =
      await this.elasticsearch.requestJson<ElasticsearchBulkResponse>(
        "/_bulk",
        {
          method: "POST",
          body: payload,
        },
        {
          contentType: "application/x-ndjson",
        },
      );

    this.throwOnBulkErrors(response, "index");
  }

  async search(
    input: ListContentReportsInput,
  ): Promise<{ ids: string[]; total: number }> {
    await this.ensureIndex();

    const filters: Array<Record<string, unknown>> = [];

    if (input.status) {
      filters.push({
        term: {
          status: input.status,
        },
      });
    }

    if (input.subjectType) {
      filters.push({
        term: {
          subjectType: input.subjectType,
        },
      });
    }

    if (input.reasonCode) {
      filters.push({
        term: {
          reasonCode: input.reasonCode,
        },
      });
    }

    if (input.assignedTo) {
      if (input.assignedTo === "unassigned") {
        filters.push({
          bool: {
            must_not: {
              exists: {
                field: "assignedModeratorId",
              },
            },
          },
        });
      } else {
        filters.push({
          term: {
            assignedModeratorId: input.assignedTo,
          },
        });
      }
    }

    if (input.reporterId) {
      filters.push({
        term: {
          reporterId: input.reporterId,
        },
      });
    }

    const response =
      await this.elasticsearch.requestJson<ElasticsearchSearchResponse>(
        `/${encodeURIComponent(this.indexName)}/_search`,
        {
          method: "POST",
          body: JSON.stringify({
            from: (input.page - 1) * input.pageSize,
            size: input.pageSize,
            query: this.buildQuery(input.query, filters),
            sort: this.buildSort(input.sort),
          }),
        },
      );

    return {
      ids: response.hits?.hits?.map((hit) => hit._id) ?? [],
      total: response.hits?.total?.value ?? 0,
    };
  }

  private buildQuery(
    query: string | undefined,
    filters: Array<Record<string, unknown>>,
  ): Record<string, unknown> {
    if (!query) {
      return filters.length > 0
        ? {
            bool: {
              filter: filters,
            },
          }
        : {
            match_all: {},
          };
    }

    return {
      bool: {
        ...(filters.length > 0 ? { filter: filters } : {}),
        must: [
          {
            multi_match: {
              query,
              fields: [
                "title^5",
                "description^3",
                "subjectSnapshotText^2",
                "reporterUsername^2",
                "reporterEmail",
                "assignedModeratorUsername",
                "assignedModeratorEmail",
              ],
            },
          },
        ],
      },
    };
  }

  private buildSort(
    sort: ListContentReportsInput["sort"],
  ): Array<Record<string, unknown>> {
    switch (sort) {
      case "oldest":
        return [{ createdAt: { order: "asc" } }];
      case "recentlyReviewed":
        return [
          { reviewedAt: { order: "desc", missing: "_last" } },
          { createdAt: { order: "desc" } },
        ];
      case "newest":
      default:
        return [{ createdAt: { order: "desc" } }];
    }
  }

  private buildIndexConfiguration(): Record<string, unknown> {
    return {
      mappings: {
        dynamic: false,
        properties: {
          id: { type: "keyword" },
          subjectType: { type: "keyword" },
          subjectId: { type: "keyword" },
          reasonCode: { type: "keyword" },
          status: { type: "keyword" },
          title: { type: "text" },
          description: { type: "text" },
          subjectSnapshotText: { type: "text" },
          reporterId: { type: "keyword" },
          reporterEmail: { type: "keyword" },
          reporterUsername: { type: "text" },
          reporterRole: { type: "keyword" },
          assignedModeratorId: { type: "keyword" },
          assignedModeratorEmail: { type: "keyword" },
          assignedModeratorUsername: { type: "text" },
          assignedModeratorRole: { type: "keyword" },
          createdAt: { type: "date" },
          updatedAt: { type: "date" },
          reviewedAt: { type: "date" },
        },
      },
    };
  }

  private throwOnBulkErrors(
    response: ElasticsearchBulkResponse,
    operation: "index" | "delete",
  ): void {
    if (!response.errors) {
      return;
    }

    const firstFailure = response.items?.find((item) => {
      const result = operation === "index" ? item.index : item.delete;
      return Boolean(result?.error);
    });
    const firstError =
      operation === "index" ? firstFailure?.index : firstFailure?.delete;

    if (!firstError?.error) {
      return;
    }

    const message =
      `Bulk ${operation} failed with status ${firstError.status}: ${firstError.error.type ?? "unknown"} ${firstError.error.reason ?? ""}`.trim();

    if (firstError.status >= 500) {
      throw new ElasticsearchUnavailableError(message);
    }

    throw new ElasticsearchRequestError(firstError.status, message);
  }
}
