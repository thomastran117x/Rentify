import { BaseRepository } from "@/features/base/base.repository";

class TestRepository extends BaseRepository {
  run<T>(
    operation: () => Promise<T>,
    options?: Parameters<BaseRepository["executeAsync"]>[1],
  ): Promise<T> {
    return this.executeAsync(operation, options);
  }

  runTransaction<T>(
    operation: (tx: any) => Promise<T>,
    options?: Parameters<BaseRepository["executeTransaction"]>[1],
  ): Promise<T> {
    return this.executeTransaction<T>(operation as any, options);
  }
}

describe("BaseRepository", () => {
  const originalLogSilent = process.env.LOG_SILENT;

  beforeEach(() => {
    process.env.LOG_SILENT = "false";
  });

  afterEach(() => {
    process.env.LOG_SILENT = originalLogSilent;
    jest.restoreAllMocks();
  });

  it("logs retry attempts with operation labels for transient database errors", async () => {
    const writeSpy = jest.spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
      callback?: unknown,
    ) => {
      if (typeof callback === "function") {
        callback(null);
      }

      return true;
    }) as any);
    const repository = new TestRepository({} as any);
    const transientError = Object.assign(new Error("connection dropped"), {
      code: "ECONNRESET",
    });
    const operation = jest
      .fn()
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce("ok");

    await expect(
      repository.run(operation, {
        initialDelayMs: 1,
        jitterMs: 0,
        maxRetries: 1,
        operationName: "testOperation",
      }),
    ).resolves.toBe("ok");

    expect(operation).toHaveBeenCalledTimes(2);
    const output = writeSpy.mock.calls
      .map(([message]) => String(message))
      .join("\n");
    expect(output).toContain("Database operation retry scheduled.");
    expect(output).toContain("operation=TestRepository.testOperation");
    expect(output).toContain("errorCode=ECONNRESET");
  });

  it("wraps Prisma transactions in the shared execution helper", async () => {
    const transaction = { marker: "transaction" };
    const database = {
      $transaction: jest.fn(
        async (callback: (tx: typeof transaction) => Promise<string>) =>
          callback(transaction),
      ),
    };
    const repository = new TestRepository(database as any);

    await expect(
      repository.runTransaction(async (tx) => {
        expect(tx).toBe(transaction);
        return "committed";
      }),
    ).resolves.toBe("committed");

    expect(database.$transaction).toHaveBeenCalledTimes(1);
  });
});
