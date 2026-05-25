export interface AutoSeedPolicyInput {
  autoSeedEnabled: boolean;
  autoSeedRefresh: boolean;
  nodeEnv: "development" | "test" | "production";
  userCount: number;
}

export interface AutoSeedPolicy {
  reason: string;
  refresh: boolean;
  shouldRun: boolean;
}

export function resolveAutoSeedPolicy(
  input: AutoSeedPolicyInput,
): AutoSeedPolicy {
  if (input.nodeEnv === "production") {
    return {
      shouldRun: false,
      refresh: false,
      reason: "production-environment",
    };
  }

  if (!input.autoSeedEnabled) {
    return {
      shouldRun: false,
      refresh: false,
      reason: "disabled",
    };
  }

  if (input.autoSeedRefresh) {
    return {
      shouldRun: true,
      refresh: true,
      reason: "refresh-requested",
    };
  }

  if (input.userCount > 0) {
    return {
      shouldRun: false,
      refresh: false,
      reason: "database-not-empty",
    };
  }

  return {
    shouldRun: true,
    refresh: false,
    reason: "empty-database",
  };
}
