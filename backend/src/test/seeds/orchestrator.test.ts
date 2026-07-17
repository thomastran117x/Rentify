import { runSeedOrchestrator } from "@/seeds/orchestrator";
import type { SeedModule } from "@/seeds/types";

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
  };
}

describe("runSeedOrchestrator", () => {
  it("runs modules in order and shares mutable state", async () => {
    const execution: string[] = [];
    const firstModule: SeedModule = {
      name: "first",
      async run(context) {
        execution.push("first");
        context.state.userIdsByEmail.set("owner@example.com", "user-1");
      },
    };
    const secondModule: SeedModule = {
      name: "second",
      async run(context) {
        execution.push(
          `second:${context.state.userIdsByEmail.get("owner@example.com")}`,
        );
      },
    };
    const prisma = {
      user: {
        count: jest.fn(async () => 0),
      },
    };

    const result = await runSeedOrchestrator({
      logger: createLogger(),
      modules: [firstModule, secondModule],
      onlyIfEmpty: false,
      prisma: prisma as any,
      refresh: true,
      source: "test",
    });

    expect(execution).toEqual(["first", "second:user-1"]);
    expect(result).toMatchObject({
      executed: true,
      moduleNames: ["first", "second"],
      refresh: true,
      source: "test",
    });
  });

  it("skips when onlyIfEmpty is set and users already exist", async () => {
    const moduleRun = jest.fn();
    const prisma = {
      user: {
        count: jest.fn(async () => 3),
      },
    };

    const result = await runSeedOrchestrator({
      logger: createLogger(),
      modules: [
        {
          name: "noop",
          run: moduleRun,
        },
      ],
      onlyIfEmpty: true,
      prisma: prisma as any,
      source: "startup",
    });

    expect(moduleRun).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      executed: false,
      reason: "database-not-empty",
    });
  });
});
