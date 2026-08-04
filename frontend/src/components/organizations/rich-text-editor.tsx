"use client";

import { useEffect } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";
import type { Editor } from "@tiptap/react";

const toolbarButtonClass =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-transparent px-2 text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800";
const toolbarActiveClass =
  "border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white";

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  editable?: boolean;
  ariaLabel?: string;
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active ?? false}
      title={label}
      className={`${toolbarButtonClass} ${active ? toolbarActiveClass : ""}`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  // Tiptap v3 no longer re-renders the component on every transaction
  // (`shouldRerenderOnTransaction` defaults to false, and the legacy flag is
  // slated for removal), so reading `editor.isActive(...)` during render would
  // leave these buttons frozen at their initial state. `useEditorState`
  // subscribes to just the flags the toolbar draws.
  const state = useEditorState({
    editor,
    selector: ({ editor: instance }) => ({
      bold: instance.isActive("bold"),
      italic: instance.isActive("italic"),
      strike: instance.isActive("strike"),
      heading2: instance.isActive("heading", { level: 2 }),
      heading3: instance.isActive("heading", { level: 3 }),
      bulletList: instance.isActive("bulletList"),
      orderedList: instance.isActive("orderedList"),
      blockquote: instance.isActive("blockquote"),
      codeBlock: instance.isActive("codeBlock"),
      link: instance.isActive("link"),
      canUndo: instance.can().undo(),
      canRedo: instance.can().redo(),
    }),
  });

  const addLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");

    if (url === null) {
      return;
    }

    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url.trim() })
      .run();
  };

  const addImage = () => {
    const url = window.prompt("Image URL", "https://");

    if (!url || url.trim() === "") {
      return;
    }

    editor.chain().focus().setImage({ src: url.trim() }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900/60">
      <ToolbarButton
        label="Bold"
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={state.bold}
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={state.italic}
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={state.strike}
      >
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-700" />
      <ToolbarButton
        label="Heading 2"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={state.heading2}
      >
        <Heading2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Heading 3"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={state.heading3}
      >
        <Heading3 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Bullet list"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={state.bulletList}
      >
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={state.orderedList}
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Quote"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={state.blockquote}
      >
        <Quote className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Code block"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={state.codeBlock}
      >
        <Code className="h-4 w-4" />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-700" />
      <ToolbarButton label="Add link" onClick={addLink} active={state.link}>
        <Link2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton label="Add image" onClick={addImage}>
        <ImagePlus className="h-4 w-4" />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-700" />
      <ToolbarButton
        label="Undo"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!state.canUndo}
      >
        <Undo2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Redo"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!state.canRedo}
      >
        <Redo2 className="h-4 w-4" />
      </ToolbarButton>
    </div>
  );
}

export function RichTextEditor({
  value,
  onChange,
  editable = true,
  ariaLabel = "Blog post body",
}: RichTextEditorProps) {
  const editor = useEditor({
    // Next.js SSR: defer first render to the client to avoid hydration mismatch.
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
      }),
      Image.configure({ inline: false }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "rich-text min-h-[220px] px-4 py-3 focus:outline-none",
        "aria-label": ariaLabel,
      },
    },
    onUpdate: ({ editor: current }) => {
      const html = current.getHTML();
      onChange(html === "<p></p>" ? "" : html);
    },
  });

  // Keep the editor in sync when the form is reset or an edit target changes.
  useEffect(() => {
    if (!editor) {
      return;
    }
    const current = editor.getHTML();
    const next = value || "";
    if (next !== current && !(next === "" && current === "<p></p>")) {
      // Tiptap v3 moved the emitUpdate flag into an options object.
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  if (!editor) {
    return (
      <div className="min-h-[260px] animate-pulse rounded-xl border border-slate-200 bg-slate-100/60 dark:border-slate-700 dark:bg-slate-800/40" />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-sky-400 focus-within:ring-4 focus-within:ring-sky-100 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-sky-400 dark:focus-within:ring-sky-500/20">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
