"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, mergeAttributes, Node, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { NodeSelection } from "@tiptap/pm/state";
import { EMAIL_CONTENT_WIDTH, uploadEmailImage } from "@/lib/emailImages";

/** Pictures can carry a link (so a Canva graphic can be clicked) and a display width. */
const EmailImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => el.getAttribute("width"),
        renderHTML: (a) => (a.width ? { width: a.width } : {}),
      },
      height: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
      href: {
        default: null,
        parseHTML: (el) => el.closest("a")?.getAttribute("href") ?? null,
        renderHTML: () => ({}),
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const img = ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)] as const;
    return node.attrs.href ? ["a", { href: node.attrs.href, target: "_blank", rel: "noopener" }, img] : img;
  },
  // Inside the editor, draw just the picture: a link wrapped around it confuses clicking.
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement("img");
      const paint = (n: typeof node) => {
        img.src = n.attrs.src;
        img.alt = n.attrs.alt ?? "";
        if (n.attrs.width) img.setAttribute("width", String(n.attrs.width));
        else img.removeAttribute("width");
        img.title = n.attrs.href ? `Clicking this picture opens ${n.attrs.href}` : "";
        img.classList.toggle("is-linked", !!n.attrs.href);
      };
      paint(node);
      return {
        dom: img,
        update: (n) => {
          if (n.type !== node.type) return false;
          paint(n);
          return true;
        },
      };
    };
  },
}).configure({ inline: false, allowBase64: true });

/** A colored, centered button that works in every email program. */
const EmailButton = Node.create({
  name: "emailButton",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { text: { default: "Donate now" }, href: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "p[data-email-button]",
        priority: 60,
        getAttrs: (el) => {
          const a = (el as HTMLElement).querySelector("a");
          return { text: a?.textContent ?? "", href: a?.getAttribute("href") ?? "" };
        },
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "p",
      { "data-email-button": "", style: "margin:8px 0 18px;text-align:center" },
      [
        "a",
        {
          href: node.attrs.href,
          target: "_blank",
          rel: "noopener",
          style:
            "display:inline-block;background:#1f6f8b;color:#ffffff;font-weight:bold;font-size:16px;padding:12px 28px;border-radius:6px;text-decoration:none;font-family:Arial,Helvetica,sans-serif",
        },
        node.attrs.text,
      ],
    ];
  },
});

const SIZES = [
  { label: "Full width", width: EMAIL_CONTENT_WIDTH },
  { label: "Large", width: 420 },
  { label: "Medium", width: 300 },
  { label: "Small", width: 160 },
];

function askUrl(message: string, current = ""): string | null {
  const v = prompt(message, current || "https://");
  if (v === null) return null;
  const t = v.trim();
  if (!t || t === "https://") return "";
  if (/^(https?:|mailto:|tel:)/i.test(t)) return t;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return `mailto:${t}`;
  return `https://${t}`;
}

type Props = {
  initialHtml: string;
  onChange: (html: string) => void;
  onReady?: (editor: Editor) => void;
};

export default function EmailEditor({ initialHtml, onChange, onReady }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(new Set<string>());

  async function insertFiles(editor: Editor, files: File[], pos?: number) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (!images.length) return false;
    setError(null);
    setUploading((n) => n + images.length);
    for (const f of images) {
      try {
        const { url, width } = await uploadEmailImage(f);
        const chain = editor.chain().focus();
        const content = { type: "image", attrs: { src: url, width, alt: "" } };
        (pos !== undefined ? chain.insertContentAt(pos, content) : chain.insertContent(content)).run();
      } catch (e) {
        setError((e as Error).message);
      }
      setUploading((n) => n - 1);
    }
    return true;
  }

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        code: false,
        codeBlock: false,
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      TextStyle,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      EmailImage,
      EmailButton,
    ],
    content: initialHtml || "<p></p>",
    editorProps: {
      attributes: { class: "email-editor" },
      handlePaste(view, event) {
        const dt = event.clipboardData;
        if (!dt || dt.getData("text/html")) return false; // formatted paste: let the editor keep it
        const files = Array.from(dt.files);
        if (!files.some((f) => f.type.startsWith("image/"))) return false;
        if (editorRef.current) insertFiles(editorRef.current, files);
        return true;
      },
      handleDrop(view, event) {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        if (!files.some((f) => f.type.startsWith("image/")) || !editorRef.current) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        insertFiles(editorRef.current, files, at?.pos);
        return true;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  useEffect(() => {
    if (editor && onReady) onReady(editor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Pictures pasted along with text arrive embedded in the message. Email programs
  // block those, so move each one to proper storage and point the picture there.
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      editor.state.doc.descendants((node) => {
        const src: string = node.type.name === "image" ? node.attrs.src ?? "" : "";
        if (!/^(data|blob):/.test(src) || pending.current.has(src)) return;
        pending.current.add(src);
        setUploading((n) => n + 1);
        fetch(src)
          .then((r) => r.blob())
          .then((b) => uploadEmailImage(b))
          .then(({ url, width }) => {
            editor.state.doc.descendants((n, pos) => {
              if (n.type.name === "image" && n.attrs.src === src) {
                editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, src: url, width: n.attrs.width ?? width }));
                return false;
              }
            });
          })
          .catch((e) => setError(`A pasted picture could not be saved: ${(e as Error).message}`))
          .finally(() => {
            pending.current.delete(src);
            setUploading((n) => n - 1);
          });
      });
    };
    editor.on("update", handler);
    handler();
    return () => {
      editor.off("update", handler);
    };
  }, [editor]);

  if (!editor) return <div className="input mt-1 min-h-[320px]" />;

  const sel = editor.state.selection;
  const selectedNode = sel instanceof NodeSelection ? sel.node : null;
  const image = selectedNode?.type.name === "image" ? selectedNode : null;
  const button = selectedNode?.type.name === "emailButton" ? selectedNode : null;
  const block = editor.isActive("heading", { level: 1 })
    ? "h1"
    : editor.isActive("heading", { level: 2 })
      ? "h2"
      : editor.isActive("heading", { level: 3 })
        ? "h3"
        : "p";

  const Btn = ({ on, title, onClick, children }: { on?: boolean; title: string; onClick: () => void; children: React.ReactNode }) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`min-w-[2rem] rounded px-2 py-1 text-sm ${on ? "bg-teal-700 text-white" : "hover:bg-black/5"}`}
    >
      {children}
    </button>
  );
  const Sep = () => <span className="mx-1 h-5 w-px bg-black/10" />;

  function setLink() {
    const current = editor!.getAttributes("link").href ?? "";
    const url = askUrl("Web address for the link (leave empty to remove the link):", current);
    if (url === null) return;
    if (!url) return editor!.chain().focus().extendMarkRange("link").unsetLink().run();
    if (editor!.state.selection.empty && !editor!.isActive("link")) {
      editor!.chain().focus().insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }).run();
    } else {
      editor!.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  }

  function addButton() {
    const text = prompt("Button words:", "Donate now");
    if (!text) return;
    const href = askUrl("Web address the button opens:");
    if (!href) return;
    editor!.chain().focus().insertContent({ type: "emailButton", attrs: { text, href } }).run();
  }

  function editButton() {
    if (!button) return;
    const text = prompt("Button words:", button.attrs.text);
    if (text === null) return;
    const href = askUrl("Web address the button opens:", button.attrs.href);
    if (href === null) return;
    editor!.chain().focus().updateAttributes("emailButton", { text: text || button.attrs.text, href: href || button.attrs.href }).run();
  }

  return (
    <div className="mt-1 rounded-lg border border-[var(--border)] bg-white">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 rounded-t-lg border-b border-[var(--border)] bg-[#faf8f3] p-1">
        <select
          className="rounded border border-[var(--border)] bg-white px-1 py-1 text-sm"
          value={block}
          title="Text style"
          onChange={(e) => {
            const v = e.target.value;
            const c = editor.chain().focus();
            (v === "p" ? c.setParagraph() : c.setHeading({ level: Number(v[1]) as 1 | 2 | 3 })).run();
          }}
        >
          <option value="p">Normal text</option>
          <option value="h1">Big heading</option>
          <option value="h2">Heading</option>
          <option value="h3">Small heading</option>
        </select>
        <Sep />
        <Btn title="Bold" on={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></Btn>
        <Btn title="Italic" on={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></Btn>
        <Btn title="Underline" on={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></Btn>
        <label title="Text color" className="flex cursor-pointer items-center rounded px-1 hover:bg-black/5">
          <span className="text-sm font-semibold" style={{ color: editor.getAttributes("textStyle").color || "#22201b" }}>A</span>
          <input
            type="color"
            className="ml-0.5 h-5 w-5 cursor-pointer border-0 bg-transparent p-0"
            value={editor.getAttributes("textStyle").color || "#22201b"}
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
          />
        </label>
        <Sep />
        <Btn title="Align left" on={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>⯇</Btn>
        <Btn title="Center" on={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>≡</Btn>
        <Btn title="Align right" on={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>⯈</Btn>
        <Sep />
        <Btn title="Bulleted list" on={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</Btn>
        <Btn title="Numbered list" on={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</Btn>
        <Sep />
        <Btn title="Add or change a link" on={editor.isActive("link")} onClick={setLink}>🔗 Link</Btn>
        <Btn title="Insert a picture (or paste or drag one in)" onClick={() => fileRef.current?.click()}>🖼 Picture</Btn>
        <Btn title="Insert a button" onClick={addButton}>▭ Button</Btn>
        <Btn title="Divider line" onClick={() => editor.chain().focus().setHorizontalRule().run()}>― Line</Btn>
        <Sep />
        <Btn title="Undo" onClick={() => editor.chain().focus().undo().run()}>↶</Btn>
        <Btn title="Redo" onClick={() => editor.chain().focus().redo().run()}>↷</Btn>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            insertFiles(editor, files);
          }}
        />
      </div>

      {(image || button) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[#eef6f8] px-2 py-1.5 text-sm">
          {image && (
            <>
              <strong>Picture:</strong>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const url = askUrl("Web address to open when someone clicks the picture (leave empty for none):", image.attrs.href ?? "");
                  if (url !== null) editor.chain().focus().updateAttributes("image", { href: url || null }).run();
                }}
              >
                {image.attrs.href ? "Change click-through link" : "Make it clickable"}
              </button>
              <select
                className="rounded border border-[var(--border)] bg-white px-1 py-1"
                value={SIZES.find((s) => String(s.width) === String(image.attrs.width))?.width ?? ""}
                onChange={(e) => editor.chain().focus().updateAttributes("image", { width: Number(e.target.value) }).run()}
              >
                <option value="" disabled>Size…</option>
                {SIZES.map((s) => <option key={s.width} value={s.width}>{s.label}</option>)}
              </select>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const alt = prompt("Short description of the picture (shown if the picture doesn't load):", image.attrs.alt ?? "");
                  if (alt !== null) editor.chain().focus().updateAttributes("image", { alt }).run();
                }}
              >
                Description
              </button>
              {image.attrs.href && <span className="muted truncate text-xs">Opens {image.attrs.href}</span>}
            </>
          )}
          {button && (
            <>
              <strong>Button:</strong>
              <button type="button" className="btn btn-secondary btn-sm" onClick={editButton}>Change words or link</button>
              <span className="muted truncate text-xs">Opens {button.attrs.href}</span>
            </>
          )}
          <button type="button" className="btn btn-danger btn-sm ml-auto" onClick={() => editor.chain().focus().deleteSelection().run()}>
            Remove
          </button>
        </div>
      )}

      <EditorContent editor={editor} />

      {(uploading > 0 || error) && (
        <div className="border-t border-[var(--border)] px-3 py-1.5 text-sm">
          {uploading > 0 && <span className="muted">Saving picture{uploading > 1 ? "s" : ""}… </span>}
          {error && <span className="text-coral-600">{error}</span>}
        </div>
      )}
    </div>
  );
}
