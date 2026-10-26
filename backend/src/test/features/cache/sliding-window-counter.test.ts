import {
  SLIDING_WINDOW_COUNT_SCRIPT,
  SLIDING_WINDOW_PEEK_SCRIPT,
  countInSlidingWindow,
  recordInSlidingWindow,
} from "@/features/cache/sliding-window-counter";

describe("sliding-window counter", () => {
  it("records a member and returns the window's count", async () => {
    const cache = { eval: jest.fn().mockResolvedValue(3) };

    await expect(
      recordInSlidingWindow(cache, "auth:detection:x:1", "event-1", 600, 1_000),
    ).resolves.toBe(3);
    expect(cache.eval).toHaveBeenCalledWith(
      SLIDING_WINDOW_COUNT_SCRIPT,
      ["auth:detection:x:1"],
      ["1000", "600000", "event-1"],
    );
  });

  it("peeks at the count without recording", async () => {
    const cache = { eval: jest.fn().mockResolvedValue("2") };

    await expect(
      countInSlidingWindow(cache, "auth:detection:x:1", 60, 5_000),
    ).resolves.toBe(2);
    expect(cache.eval).toHaveBeenCalledWith(
      SLIDING_WINDOW_PEEK_SCRIPT,
      ["auth:detection:x:1"],
      ["5000", "60000"],
    );
  });

  it("defaults to the current time", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-26T12:00:00.000Z"));
    const cache = { eval: jest.fn().mockResolvedValue(1) };

    try {
      await recordInSlidingWindow(cache, "key", "member", 1);
      await countInSlidingWindow(cache, "key", 1);
    } finally {
      jest.useRealTimers();
    }

    const now = String(Date.parse("2026-10-26T12:00:00.000Z"));
    expect(cache.eval.mock.calls[0]![2][0]).toBe(now);
    expect(cache.eval.mock.calls[1]![2][0]).toBe(now);
  });
});
