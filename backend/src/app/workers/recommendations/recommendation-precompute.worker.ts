import { containerTokens } from "@/configuration/bootstrap/container";
import { environment } from "@/configuration/environment/index";
import type { RecommendationPrecomputeService } from "@/features/recommendations/recommendation-precompute.service";
import {
  databaseWorkerResource,
  disconnectResources,
} from "@/workers/shared/resources";
import {
  bootstrapPollingWorker,
  startWorker,
} from "@/workers/shared/worker-runtime";

const workerName = "Recommendation precompute worker";
const workerResources = [databaseWorkerResource];

export async function bootstrapRecommendationPrecomputeWorker(): Promise<void> {
  await bootstrapPollingWorker({
    name: workerName,
    resources: workerResources,
    getPollIntervalMs: () =>
      environment.getRecommendationsPrecomputeWorkerConfig().pollIntervalMs,
    runOnce: async ({ scope }) => {
      const service = scope.resolve<RecommendationPrecomputeService>(
        containerTokens.recommendationPrecomputeService,
      );
      const { batchSize } =
        environment.getRecommendationsPrecomputeWorkerConfig();

      return service.processBatch(batchSize);
    },
  });
}

startWorker({
  name: workerName,
  bootstrap: bootstrapRecommendationPrecomputeWorker,
  cleanup: () => disconnectResources(workerResources),
});
