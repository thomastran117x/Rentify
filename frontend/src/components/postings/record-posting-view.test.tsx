import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordPostingView } from "./record-posting-view";

const { recordViewMock } = vi.hoisted(() => ({
  recordViewMock: vi.fn(),
}));

vi.mock("./recently-viewed-context", () => ({
  useRecentlyViewed: () => ({ recordView: recordViewMock }),
}));

describe("RecordPostingView", () => {
  beforeEach(() => {
    recordViewMock.mockReset();
  });

  it("renders nothing", () => {
    const { container } = render(<RecordPostingView postingId="posting-1" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("records the posting once", () => {
    render(<RecordPostingView postingId="posting-1" />);

    expect(recordViewMock).toHaveBeenCalledTimes(1);
    expect(recordViewMock).toHaveBeenCalledWith("posting-1");
  });

  // Guards the strict-mode double-effect, and any re-render of the page.
  it("does not record again when re-rendered with the same posting", () => {
    const { rerender } = render(<RecordPostingView postingId="posting-1" />);

    rerender(<RecordPostingView postingId="posting-1" />);
    rerender(<RecordPostingView postingId="posting-1" />);

    expect(recordViewMock).toHaveBeenCalledTimes(1);
  });

  it("records again when the posting changes", () => {
    const { rerender } = render(<RecordPostingView postingId="posting-1" />);

    rerender(<RecordPostingView postingId="posting-2" />);

    expect(recordViewMock).toHaveBeenCalledTimes(2);
    expect(recordViewMock).toHaveBeenLastCalledWith("posting-2");
  });
});
