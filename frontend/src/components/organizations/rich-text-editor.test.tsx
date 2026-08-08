import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RichTextEditor } from "./rich-text-editor";

const { editor, chain, useEditorMock } = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  [
    "focus",
    "toggleBold",
    "toggleItalic",
    "toggleStrike",
    "toggleHeading",
    "toggleBulletList",
    "toggleOrderedList",
    "toggleBlockquote",
    "toggleCodeBlock",
    "extendMarkRange",
    "unsetLink",
    "setLink",
    "setImage",
    "undo",
    "redo",
  ].forEach((name) => {
    chain[name] = vi.fn(() => chain);
  });
  chain.run = vi.fn(() => true);
  const editor = {
    chain: vi.fn(() => chain),
    isActive: vi.fn(() => false),
    can: vi.fn(() => ({ undo: () => true, redo: () => false })),
    getAttributes: vi.fn(() => ({ href: "https://old.test" })),
    getHTML: vi.fn(() => "<p>old</p>"),
    commands: { setContent: vi.fn() },
    setEditable: vi.fn(),
  };
  return { editor, chain, useEditorMock: vi.fn(() => editor) };
});

vi.mock("@tiptap/react", () => ({
  useEditor: useEditorMock,
  useEditorState: ({
    selector,
  }: {
    selector: (value: { editor: typeof editor }) => unknown;
  }) => selector({ editor }),
  EditorContent: () => <div>Editor content</div>,
}));
vi.mock("@tiptap/starter-kit", () => ({ default: {} }));
vi.mock("@tiptap/extension-link", () => ({
  default: { configure: vi.fn(() => ({})) },
}));
vi.mock("@tiptap/extension-image", () => ({
  default: { configure: vi.fn(() => ({})) },
}));

describe("RichTextEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorMock.mockReturnValue(editor);
    editor.getHTML.mockReturnValue("<p>old</p>");
  });

  it("runs every toolbar formatting command", () => {
    render(<RichTextEditor value="<p>old</p>" onChange={vi.fn()} />);
    [
      "Bold",
      "Italic",
      "Strikethrough",
      "Heading 2",
      "Heading 3",
      "Bullet list",
      "Numbered list",
      "Quote",
      "Code block",
      "Undo",
    ].forEach((name) => fireEvent.click(screen.getByRole("button", { name })));
    expect(chain.toggleBold).toHaveBeenCalled();
    expect(chain.toggleHeading).toHaveBeenCalledWith({ level: 2 });
    expect(chain.toggleHeading).toHaveBeenCalledWith({ level: 3 });
    expect(chain.undo).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  });

  it("sets, removes, and cancels links and images from prompts", () => {
    const prompt = vi.spyOn(window, "prompt");
    render(<RichTextEditor value="" onChange={vi.fn()} />);
    prompt.mockReturnValueOnce(" https://new.test ");
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(chain.setLink).toHaveBeenCalledWith({ href: "https://new.test" });
    prompt.mockReturnValueOnce("  ");
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(chain.unsetLink).toHaveBeenCalled();
    prompt.mockReturnValueOnce(null);
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    prompt.mockReturnValueOnce(" https://img.test/a.png ");
    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    expect(chain.setImage).toHaveBeenCalledWith({
      src: "https://img.test/a.png",
    });
    prompt.mockReturnValueOnce("");
    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
  });

  it("syncs changed values/editability and renders a placeholder without an editor", () => {
    const { rerender } = render(
      <RichTextEditor value="<p>new</p>" editable={false} onChange={vi.fn()} />,
    );
    expect(editor.commands.setContent).toHaveBeenCalledWith("<p>new</p>", {
      emitUpdate: false,
    });
    expect(editor.setEditable).toHaveBeenCalledWith(false);
    useEditorMock.mockReturnValue(null as never);
    rerender(<RichTextEditor value="" onChange={vi.fn()} />);
    expect(screen.queryByText("Editor content")).not.toBeInTheDocument();
  });
});
