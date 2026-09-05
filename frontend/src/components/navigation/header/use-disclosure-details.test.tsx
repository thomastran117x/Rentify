import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDisclosureDetails } from "./use-disclosure-details";

const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn(() => "/"),
}));

vi.mock("next/navigation", () => ({ usePathname: usePathnameMock }));

function Disclosure() {
  const { ref, open, onToggle } = useDisclosureDetails();

  return (
    <div>
      <details ref={ref} onToggle={onToggle}>
        <summary aria-label="Person account menu" aria-expanded={open}>
          Trigger
        </summary>
        <a href="/account">Manage account</a>
        <span>Theme</span>
      </details>
      <button type="button">Outside</button>
    </div>
  );
}

function openDisclosure() {
  const disclosure = document.querySelector("details") as HTMLDetailsElement;
  disclosure.open = true;
  fireEvent(disclosure, new Event("toggle"));
  return disclosure;
}

describe("useDisclosureDetails", () => {
  it("mirrors the open state onto aria-expanded", () => {
    render(<Disclosure />);
    const trigger = screen.getByLabelText("Person account menu");

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    openDisclosure();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("closes on Escape and returns focus to the trigger", () => {
    render(<Disclosure />);
    const disclosure = openDisclosure();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(disclosure.open).toBe(false);
    expect(screen.getByLabelText("Person account menu")).toHaveFocus();
  });

  it("closes on a pointer press outside the disclosure", () => {
    render(<Disclosure />);
    const disclosure = openDisclosure();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));

    expect(disclosure.open).toBe(false);
  });

  it("stays open for a pointer press inside the disclosure", () => {
    render(<Disclosure />);
    const disclosure = openDisclosure();

    fireEvent.pointerDown(screen.getByRole("link", { name: "Manage account" }));

    expect(disclosure.open).toBe(true);
  });

  // usePathname() cannot see a query-only move (/postings?q=chair -> /postings),
  // so activation has to close the panel on its own.
  it("closes when a link inside it is activated", () => {
    render(<Disclosure />);
    const disclosure = openDisclosure();

    fireEvent.click(screen.getByRole("link", { name: "Manage account" }));

    expect(disclosure.open).toBe(false);
  });

  it("stays open for a click inside it that is not on a link", () => {
    render(<Disclosure />);
    const disclosure = openDisclosure();

    fireEvent.click(screen.getByText("Theme"));

    expect(disclosure.open).toBe(true);
  });

  it("closes when the route changes underneath it", () => {
    const { rerender } = render(<Disclosure />);
    const disclosure = openDisclosure();
    expect(disclosure.open).toBe(true);

    usePathnameMock.mockReturnValue("/account");
    rerender(<Disclosure />);

    expect(disclosure.open).toBe(false);
  });
});
