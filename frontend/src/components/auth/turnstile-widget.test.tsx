import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnstileWidget } from "./turnstile-widget";

vi.mock("next/script", () => ({
  default: () => null,
}));

vi.mock("@/lib/env", () => ({
  publicEnv: {
    turnstileSiteKey: "test-site-key",
  },
}));

describe("TurnstileWidget", () => {
  const renderMock = vi.fn();
  const resetMock = vi.fn();
  const removeMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    window.turnstile = {
      render: renderMock.mockReturnValue("widget-1"),
      reset: resetMock,
      remove: removeMock,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not rerender the widget when the parent passes a new onChange callback", () => {
    const { rerender } = render(
      <TurnstileWidget value="" onChange={vi.fn()} />,
    );

    rerender(<TurnstileWidget value="" onChange={vi.fn()} />);

    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("does not reset the widget on the initial empty state", () => {
    const onChange = vi.fn();

    render(<TurnstileWidget value="" onChange={onChange} />);

    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(resetMock).not.toHaveBeenCalled();
  });

  it("retries a cleared token with backoff instead of resetting immediately", () => {
    vi.useFakeTimers();

    const onChange = vi.fn();
    const { rerender } = render(
      <TurnstileWidget value="captcha-token" onChange={onChange} />,
    );

    rerender(<TurnstileWidget value="" onChange={onChange} />);

    expect(resetMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(999);
    expect(resetMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(resetMock).toHaveBeenCalledTimes(1);
    expect(resetMock).toHaveBeenCalledWith("widget-1");
  });

  it("stops retrying after the widget recovers", () => {
    vi.useFakeTimers();

    const onChange = vi.fn();
    render(<TurnstileWidget value="" onChange={onChange} />);

    const options = renderMock.mock.calls[0]?.[1] as
      | {
          callback?: (token: string) => void;
          "error-callback"?: () => void;
        }
      | undefined;

    options?.["error-callback"]?.();
    options?.callback?.("fresh-token");
    vi.runOnlyPendingTimers();

    expect(resetMock).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("fresh-token");
  });

  it("falls back only after exhausting the retry budget", () => {
    vi.useFakeTimers();

    const onChange = vi.fn();
    render(<TurnstileWidget value="" onChange={onChange} />);

    const options = renderMock.mock.calls[0]?.[1] as
      | {
          "error-callback"?: () => void;
        }
      | undefined;

    options?.["error-callback"]?.();
    vi.advanceTimersByTime(1000);
    expect(resetMock).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();

    options?.["error-callback"]?.();
    vi.advanceTimersByTime(3000);
    expect(resetMock).toHaveBeenCalledTimes(2);
    expect(onChange).not.toHaveBeenCalled();

    options?.["error-callback"]?.();
    vi.advanceTimersByTime(10000);
    expect(resetMock).toHaveBeenCalledTimes(3);
    expect(onChange).not.toHaveBeenCalled();

    options?.["error-callback"]?.();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("local-dev-bypass");
  });
});
