import { useState, useEffect, useRef, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Node as PMNode, Fragment, Slice, DOMSerializer, DOMParser as PMDOMParser } from "prosemirror-model";
import { DecorationSet, Decoration } from "prosemirror-view";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import type { BookOutline } from "./position";
import { useNotification } from "../contexts/NotificationContext";
import { updateTalkingPoint, updateSection, updateChapter, fetchBook, generateTextFromTalkingPoint, chatWithChanges, getComments, createComment, deleteComment, quickTextAction, getBookCollaborators, inviteCollaborator, removeCollaborator, updateCollaboratorRole, getContentChanges, createContentChange, approveContentChange, rejectContentChange, deleteContentChange, updateContentChangeStepJson, updateContentChangeComment, getCurrentUser, getCollaborationState, createTalkingPoint, createSection, reviewChapter, getGlossaryTerms, createGlossaryTerm, deleteGlossaryTerm, updateSpellingConvention, type CommentType, type Collaborator, type ContentChange, type GlossaryTerm } from "../utils/api";
import ChapterAssetsModal from "./ChapterAssetsModal";
import ChapterAssetsPanel from "./ChapterAssetsPanel";
import { CollaborationExtension } from "./CollaborationExtension";
// StepCaptureExtension disabled for collaborators - they use Create Edit (select → Suggest Edit) only
import { Mapping } from "prosemirror-transform";
import { parseSteps, getPreviewFragments, findTextRangeNormalized, remapStepsToBase, extractSliceText, sliceContentToHtml } from "../utils/stepUtils";
import card2 from "../assets/Branding/Card2.png"
import "./Editor.css";
import SpeechToText from "../utils/speech-to-text.tsx";
import SpeechRecognition from 'react-speech-recognition';
import {
  BoldIcon,
  ItalicIcon,
  StrikethroughIcon,
  CodeBracketIcon,
  ListBulletIcon,
  NumberedListIcon,
  LinkIcon,
  LinkSlashIcon,
  H1Icon,
  H2Icon,
  H3Icon,
  ChatBubbleLeftIcon,
} from "@heroicons/react/24/outline";
 

/** Convert HTML to readable display text, preserving bullets and numbered lists */
const htmlToDisplayText = (html: string): string => {
  if (!html || typeof html !== "string") return "";
  if (typeof document === "undefined") {
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  const div = document.createElement("div");
  div.innerHTML = html;

  function process(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent || "").replace(/\s+/g, " ");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = (node as Element).tagName?.toLowerCase();
    const children = Array.from(node.childNodes);

    if (tag === "ul") {
      return children
        .filter((c) => c.nodeType === Node.ELEMENT_NODE && (c as Element).tagName?.toLowerCase() === "li")
        .map((li) => "• " + (li.textContent || "").trim().replace(/\s+/g, " "))
        .join("\n");
    }
    if (tag === "ol") {
      return children
        .filter((c) => c.nodeType === Node.ELEMENT_NODE && (c as Element).tagName?.toLowerCase() === "li")
        .map((li, i) => `${i + 1}. ` + (li.textContent || "").trim().replace(/\s+/g, " "))
        .join("\n");
    }
    if (tag === "br") return "\n";
    if (tag === "p") return children.map(process).join("").trim() + "\n";
    if (tag === "div") {
      const blockTags = new Set(["ul", "ol", "p", "div"]);
      const parts: string[] = [];
      for (let i = 0; i < children.length; i++) {
        const c = children[i];
        if (c.nodeType === Node.ELEMENT_NODE && blockTags.has((c as Element).tagName?.toLowerCase() || "")) {
          if (parts.length > 0) parts.push("\n");
          parts.push(process(c));
        } else {
          parts.push(process(c));
        }
      }
      return parts.join("");
    }
    return children.map(process).join("");
  }

  const result = process(div).replace(/\n{3,}/g, "\n\n").trim();
  return result || (div.textContent || "").replace(/\s+/g, " ").trim();
};

/** Extract plain text from HTML for anchor matching (ProseMirror doc has text only, no tags) */
const htmlToPlainTextForMatching = (html: string): string => {
  if (!html || typeof html !== "string") return "";
  if (typeof document === "undefined") {
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || div.innerText || "").replace(/\s+/g, " ").trim();
};

// Get selected text using multiple methods for cross-browser compatibility
const getSelectedText = (): string => {
  if (window.getSelection) {
    return window.getSelection()?.toString() || "";
  }
  if (document.getSelection) {
    return document.getSelection()?.toString() || "";
  }
  if ((document as any).selection) {
    return (document as any).selection.createRange().text || "";
  }
  return "";
};

type EditorProps = {
  outline: BookOutline | null;
  bookId?: number;
  onOutlineUpdate?: (outline: BookOutline) => void;
  isCollaboration?: boolean;
  collaboratorRole?: "editor" | "viewer" | "commenter" | null;
};

type SelectedItem = {
  type: "section";
  chapterId: number;
  sectionId: number;
  sectionTitle: string;
} | null;

/** Create Edit modal's rich editor - only mounted when modal is open */
const CreateEditModalEditor = ({
  initialContent,
  editorRef,
  disabled,
  onSuggest,
  onCancel,
  isSubmitting,
}: {
  initialContent: string;
  editorRef: React.MutableRefObject<any>;
  disabled: boolean;
  onSuggest: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: "Edit the selected text…" }),
    ],
    content: initialContent,
    editable: !disabled,
    editorProps: { attributes: { class: "prose prose-sm max-w-none min-h-[200px] px-4 py-3 text-primary-900 focus:outline-none" } },
  });
  useEffect(() => {
    if (editor && editorRef) editorRef.current = editor;
    return () => {
      if (editorRef) editorRef.current = null;
    };
  }, [editor, editorRef]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1 p-1 bg-[#0d2435] rounded-lg">
        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleBold().run()}
          className={`p-1.5 rounded ${editor?.isActive("bold") ? "bg-[#CDF056] text-[#011b2d]" : "text-gray-300 hover:bg-[#1a2a3a]"}`}
          title="Bold"
        >
          <BoldIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          className={`p-1.5 rounded ${editor?.isActive("italic") ? "bg-[#CDF056] text-[#011b2d]" : "text-gray-300 hover:bg-[#1a2a3a]"}`}
          title="Italic"
        >
          <ItalicIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleStrike().run()}
          className={`p-1.5 rounded ${editor?.isActive("strike") ? "bg-[#CDF056] text-[#011b2d]" : "text-gray-300 hover:bg-[#1a2a3a]"}`}
          title="Strikethrough"
        >
          <StrikethroughIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleCode().run()}
          className={`p-1.5 rounded ${editor?.isActive("code") ? "bg-[#CDF056] text-[#011b2d]" : "text-gray-300 hover:bg-[#1a2a3a]"}`}
          title="Code"
        >
          <CodeBracketIcon className="w-4 h-4" />
        </button>
        <span className="w-px bg-[#2d3a4a] my-1" />
        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          className={`p-1.5 rounded ${editor?.isActive("bulletList") ? "bg-[#CDF056] text-[#011b2d]" : "text-gray-300 hover:bg-[#1a2a3a]"}`}
          title="Bullet list"
        >
          <ListBulletIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          className={`p-1.5 rounded ${editor?.isActive("orderedList") ? "bg-[#CDF056] text-[#011b2d]" : "text-gray-300 hover:bg-[#1a2a3a]"}`}
          title="Numbered list"
        >
          <NumberedListIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          className={`p-1.5 rounded ${editor?.isActive("blockquote") ? "bg-[#CDF056] text-[#011b2d]" : "text-gray-300 hover:bg-[#1a2a3a]"}`}
          title="Blockquote"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/></svg>
        </button>
      </div>
      <div className="border border-[#2d3a4a] rounded-lg bg-white overflow-hidden">
        <EditorContent editor={editor} />
      </div>
      <div className="flex justify-between gap-3 pt-1">
        <button
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-4 py-2 text-sm text-gray-300 hover:text-white rounded-lg hover:bg-[#1a2a3a] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={onSuggest}
          disabled={isSubmitting}
          className="px-4 py-2 text-sm font-medium bg-[#CDF056] text-[#011b2d] rounded-lg hover:bg-[#b8e04a] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Submitting..." : "Suggest"}
        </button>
      </div>
    </div>
  );
};

// Action Button Component
const ActionButton = ({ icon, label, onClick, disabled }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="flex flex-col items-center justify-center p-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
    title={label}
  >
    <div className="text-gray-600 group-hover:text-gray-900 mb-1">
      {icon}
    </div>
    <span className="text-[10px] text-gray-600 group-hover:text-gray-900 text-center leading-tight">{label}</span>
  </button>
);


type TiptapEditorProps = {
  content: string;
  onUpdate: (html: string) => void;
  onBlur: () => void;
  placeholder?: string;
  onTextSelect?: (text: string, position: { x: number; y: number }, selectionRange?: { from: number; to: number }, selectedHtml?: string) => void;
  editorRef?: React.MutableRefObject<any>;
  isCollaborator?: boolean;
  hasChanges?: boolean;
  pendingChanges?: ContentChange[];
  talkingPointId?: number;
  enableCollaboration?: boolean;
  previewStepJson?: any[] | any | null;
  canonicalContent?: string;
  shadowSuggestions?: Array<{ id: number; step_json: any[] | any }>;
  pendingHighlightStepJsons?: any[];
  aiCoachHighlights?: Array<{ anchor: string; suggested_replacement?: string }>;
  highlightPreviewMode?: "collaborators" | "ai";
  decorationRefreshTrigger?: number;
  onHighlightClick?: (params: {
    mode: "ai" | "collaborator";
    anchorOrDeletedText: string;
    suggestedOrInsertedText?: string;
    talkingPointId: number;
    clientX: number;
    clientY: number;
  }) => void;
  onTryEdit?: () => void;
};

const pendingStepPreviewKey = new PluginKey("pendingStepPreview");

/** Escape key moves cursor out of link so typing continues without link formatting. */
const LinkExitExtension = Extension.create({
  name: "linkExit",
  addKeyboardShortcuts() {
    return {
      Escape: ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;
        const linkMark = state.schema.marks.link;
        if (!linkMark) return false;
        const inLink = $from.marks().some((m) => m.type === linkMark);
        if (!inLink) return false;
        const didExtend = editor.commands.extendMarkRange("link");
        if (!didExtend) return false;
        const linkEnd = editor.state.selection.to;
        editor.commands.setTextSelection(linkEnd);
        return true;
      },
    };
  },
});
const pendingShadowHighlightKey = new PluginKey("pendingShadowHighlight");
const aiCoachHighlightKey = new PluginKey("aiCoachHighlight");

const extractInsertedTextFromRawStep = (rawStep: any): string => {
  if (!rawStep) return "";
  if (typeof rawStep.insertedText === "string") return rawStep.insertedText;
  return extractSliceText(rawStep);
};

const PendingShadowHighlightExtension = Extension.create({
  name: "pendingShadowHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pendingShadowHighlightKey,
        state: {
          init() {
            return {
              stepJsonBatches: [] as any[][],
              trackedChanges: [] as Array<{
                type: "deletion" | "insertion";
                text: string;
                trackedFrom: number;
                trackedTo: number;
                insertedHtml?: string;
              }>,
              decorations: DecorationSet.empty,
            };
          },
          apply(tr, prev) {
            const meta = tr.getMeta(pendingShadowHighlightKey);

            // New meta received - initialize tracking
            // IMPORTANT: Split deletions and insertions into SEPARATE tracked entries
            // so they can map independently through document changes
            if (meta !== undefined) {
              const batches = Array.isArray(meta) ? meta : [];
              const docSize = tr.doc.content.size;
              const decorations: Decoration[] = [];
              // Each tracked change is now either a deletion OR an insertion, not both
              const trackedChanges: Array<{
                type: "deletion" | "insertion";
                text: string;
                trackedFrom: number;
                trackedTo: number;
                insertedHtml?: string;
              }> = [];

              console.log(`[PendingShadowHighlight] Received new meta with ${batches.length} batches, docSize=${docSize}`);

              batches.forEach((batch: any[]) => {
                const rawBatch = batch || [];
                const parsedSteps = parseSteps(tr.doc.type.schema, rawBatch);
                const remappedSteps = remapStepsToBase(parsedSteps);
                let lastDeletionRange: { from: number; to: number } | null = null;

                remappedSteps.forEach((step: any, stepIdx: number) => {
                  const rawStep = rawBatch[stepIdx];
                  const from = typeof step.from === "number" ? step.from : null;
                  const to = typeof step.to === "number" ? step.to : null;
                  let deletedText = step.deletedText || null;
                  const insertedText = step.insertedText || null;

                  let baseFrom = typeof from === "number" ? from : 1;
                  let baseTo = typeof to === "number" ? to : baseFrom;

                  const hasSlice = step.slice && (step.slice.size ?? 0) > 0;
                  const hasInsertedContent = hasSlice || (insertedText && String(insertedText).trim().length > 0);
                  const isDeletion = (deletedText && typeof deletedText === "string") || (baseFrom < baseTo && !hasInsertedContent);
                  if (!deletedText && baseFrom < baseTo && baseTo <= docSize) {
                    deletedText = tr.doc.textBetween(baseFrom, baseTo, " ");
                  }

                  if (isDeletion && baseFrom < baseTo) {
                    let delFrom = baseFrom;
                    let delTo = baseTo;
                    if (delFrom > delTo) [delFrom, delTo] = [delTo, delFrom];
                    let safeFrom = Math.max(0, Math.min(delFrom, docSize));
                    let safeTo = Math.min(docSize, Math.max(0, Math.min(delTo, docSize)));
                    const maxRange = Math.max(50000, Math.floor(docSize * 0.95));
                    if (safeTo - safeFrom > maxRange) safeTo = Math.min(safeFrom + maxRange, docSize);
                    if (safeFrom < safeTo) {
                      decorations.push(
                        Decoration.inline(safeFrom, safeTo, {
                          class: "collaborator-pending-deletion",
                        })
                      );
                      trackedChanges.push({
                        type: "deletion",
                        text: deletedText || "",
                        trackedFrom: safeFrom,
                        trackedTo: safeTo,
                      });
                      lastDeletionRange = { from: safeFrom, to: safeTo };
                      baseTo = safeTo;
                    }
                  }

                  const showInsertion = (insertedText && typeof insertedText === "string") || (rawStep?.slice?.content?.length > 0);
                  if (showInsertion) {
                    const isReplacement = isDeletion;
                    let insertPos = isReplacement ? baseTo : baseFrom;
                    if (!isReplacement && lastDeletionRange && (insertPos < 1 || insertPos > docSize)) {
                      insertPos = lastDeletionRange.from;
                    }
                    const clampedPos = Math.max(1, Math.min(insertPos, docSize));
                    const displayText = insertedText || extractSliceText(rawStep) || "";
                    const displayHtml = rawStep ? sliceContentToHtml(tr.doc.type.schema, rawStep) : null;

                    console.log(`[PendingShadowHighlight] Creating insertion widget at ${clampedPos}`);
                    decorations.push(
                      Decoration.widget(
                        clampedPos,
                        () => {
                          const span = document.createElement("span");
                          span.className = "collaborator-pending-insertion";
                          if (displayHtml && /<[a-z][\s\S]*>/i.test(displayHtml)) {
                            span.innerHTML = displayHtml;
                          } else {
                            span.textContent = displayText;
                          }
                          return span;
                        },
                        { side: 1 }
                      )
                    );
                    trackedChanges.push({
                      type: "insertion",
                      text: displayText,
                      trackedFrom: clampedPos,
                      trackedTo: clampedPos,
                      insertedHtml: displayHtml && /<[a-z][\s\S]*>/i.test(displayHtml) ? displayHtml : undefined,
                    });
                  }
                });
              });

              console.log(`[PendingShadowHighlight] Created ${decorations.length} decorations, tracking ${trackedChanges.length} changes`);

              return {
                stepJsonBatches: batches,
                trackedChanges,
                decorations: DecorationSet.create(tr.doc, decorations),
              };
            }

            // Document changed - rebuild from trackedChanges (split deletion/insertion)
            if (tr.docChanged && prev.trackedChanges && prev.trackedChanges.length > 0) {
              const docSize = tr.doc.content.size;
              const decorations: Decoration[] = [];
              const updatedTrackedChanges: typeof prev.trackedChanges = [];

              // IMPORTANT: Detect full document replacement (e.g., setContent)
              if (prev.trackedChanges.length > 0) {
                const testFrom = prev.trackedChanges[0]?.trackedFrom || 0;
                const testTo = prev.trackedChanges[0]?.trackedTo || 0;
                const mappedTestFrom = tr.mapping.map(testFrom, -1);
                const mappedTestTo = tr.mapping.map(testTo, 1);

                if (mappedTestFrom === 0 && mappedTestTo >= docSize - 1) {
                  console.log(`[PendingShadowHighlight] Full document replacement detected, skipping mapping`);
                  return {
                    stepJsonBatches: prev.stepJsonBatches,
                    trackedChanges: [],
                    decorations: DecorationSet.empty,
                  };
                }
              }

              console.log(`[PendingShadowHighlight] docChanged - mapping ${prev.trackedChanges.length} tracked changes`);

              prev.trackedChanges.forEach((change: any, idx: number) => {
                const { type, text, trackedFrom, trackedTo, insertedHtml } = change;

                // Map the tracked position through the transaction
                // Use assoc=-1 for 'from' (stay left of insertions at this point)
                // Use assoc=1 for 'to' (stay right of insertions at this point)
                const mappedFrom = tr.mapping.map(trackedFrom, -1);
                const mappedTo = tr.mapping.map(trackedTo, 1);

                console.log(`[PendingShadowHighlight] Change ${idx} (${type}): ${trackedFrom}-${trackedTo} -> ${mappedFrom}-${mappedTo}`);

                if (type === "deletion") {
                  let safeFrom = Math.max(0, Math.min(mappedFrom, docSize));
                  let safeTo = Math.min(docSize, Math.max(0, Math.min(mappedTo, docSize)));
                  const maxRange = Math.max(50000, Math.floor(docSize * 0.95));
                  if (safeTo - safeFrom > maxRange) safeTo = Math.min(safeFrom + maxRange, docSize);
                  if (safeFrom < safeTo) {
                    decorations.push(
                      Decoration.inline(safeFrom, safeTo, {
                        class: "collaborator-pending-deletion",
                      })
                    );
                  }
                  updatedTrackedChanges.push({
                    type: "deletion",
                    text,
                    trackedFrom: safeFrom,
                    trackedTo: safeTo,
                  });
                } else if (type === "insertion") {
                  const insertPos = Math.max(1, Math.min(tr.mapping.map(trackedFrom, 1), docSize));
                  const displayHtml = insertedHtml;

                  decorations.push(
                    Decoration.widget(
                      insertPos,
                      () => {
                        const span = document.createElement("span");
                        span.className = "collaborator-pending-insertion";
                        if (displayHtml && /<[a-z][\s\S]*>/i.test(displayHtml)) {
                          span.innerHTML = displayHtml;
                        } else {
                          span.textContent = text;
                        }
                        return span;
                      },
                      { side: 1 }
                    )
                  );

                  updatedTrackedChanges.push({
                    type: "insertion",
                    text,
                    trackedFrom: insertPos,
                    trackedTo: insertPos,
                    insertedHtml,
                  });
                }
              });

              decorations.forEach((dec, i) => {
                const from = (dec as any).from;
                const to = (dec as any).to ?? from;
                console.log(`[PendingShadowHighlight] apply (docChanged): final decoration ${i}: from=${from}, to=${to}`);
              });

              return {
                stepJsonBatches: prev.stepJsonBatches,
                trackedChanges: updatedTrackedChanges,
                decorations: DecorationSet.create(tr.doc, decorations),
              };
            }

            // Non-editing transaction - keep state as-is
            return prev;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations;
          },
        },
      }),
    ];
  },
});

/** AI Coach Review highlights - shows anchor + suggested replacement like collaborator pending changes */
const AiCoachHighlightExtension = Extension.create({
  name: "aiCoachHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: aiCoachHighlightKey,
        state: {
          init() {
            return {
              highlights: [] as Array<{ anchor: string; suggested_replacement?: string; from: number; to: number; insertPos?: number }>,
              decorations: DecorationSet.empty,
            };
          },
          apply(tr, prev) {
            const meta = tr.getMeta(aiCoachHighlightKey);
            if (meta !== undefined) {
              const items = Array.isArray(meta) ? meta : [];
              const doc = tr.doc;
              const decorations: Decoration[] = [];
              const highlights: typeof prev.highlights = [];
              const docSize = doc.content.size;
              const maxRange = Math.max(50000, Math.floor(docSize * 0.95));
              for (const item of items) {
                const anchor = (item?.anchor || "").trim();
                if (!anchor) continue;
                const range = findTextRangeNormalized(doc as any, anchor);
                if (!range) continue;
                let rFrom = range.from;
                let rTo = range.to;
                if (rTo - rFrom > maxRange) rTo = Math.min(rFrom + maxRange, doc.content.size);

                highlights.push({
                  anchor,
                  suggested_replacement: item.suggested_replacement,
                  from: rFrom,
                  to: rTo,
                  insertPos: rTo,
                });

                decorations.push(
                  Decoration.inline(rFrom, rTo, { class: "ai-coach-suggestion" })
                );

                if (item.suggested_replacement && typeof item.suggested_replacement === "string") {
                  const suggestedText = item.suggested_replacement;
                  decorations.push(
                    Decoration.widget(
                      rTo,
                      () => {
                        const span = document.createElement("span");
                        span.className = "ai-coach-suggested-insertion";
                        span.textContent = suggestedText;
                        span.setAttribute("contenteditable", "false");
                        return span;
                      },
                      { side: 1 }
                    )
                  );
                }
              }

              return {
                highlights,
                decorations: DecorationSet.create(doc, decorations),
              };
            }

            if (tr.docChanged && prev.highlights.length > 0) {
              const doc = tr.doc;
              const decorations: Decoration[] = [];
              const updated: typeof prev.highlights = [];
              const docSize = doc.content.size;
              const maxRange = Math.max(50000, Math.floor(docSize * 0.95));

              for (const h of prev.highlights) {
                const range = findTextRangeNormalized(doc as any, h.anchor);
                if (!range) continue;
                let rFrom = range.from;
                let rTo = range.to;
                if (rTo - rFrom > maxRange) rTo = Math.min(rFrom + maxRange, doc.content.size);

                decorations.push(
                  Decoration.inline(rFrom, rTo, { class: "ai-coach-suggestion" })
                );

                if (h.suggested_replacement) {
                  const sug = h.suggested_replacement;
                  decorations.push(
                    Decoration.widget(
                      rTo,
                      () => {
                        const span = document.createElement("span");
                        span.className = "ai-coach-suggested-insertion";
                        span.textContent = sug;
                        span.setAttribute("contenteditable", "false");
                        return span;
                      },
                      { side: 1 }
                    )
                  );
                }
                updated.push({ ...h, from: rFrom, to: rTo });
              }

              return {
                highlights: updated,
                decorations: DecorationSet.create(doc, decorations),
              };
            }

            return prev;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations;
          },
        },
      }),
    ];
  },
});

const PendingStepPreviewExtension = Extension.create<{ previewEnabled: boolean }>({
  name: "pendingStepPreview",
  addOptions() {
    return {
      previewEnabled: true,
    };
  },
  addProseMirrorPlugins() {
    const previewEnabled = this.options.previewEnabled;
    return [
      new Plugin({
        key: pendingStepPreviewKey,
        state: {
          init() {
            return {
              stepJson: null as any[] | any | null,
              trackedChanges: [] as Array<{
                type: "deletion" | "insertion";
                text: string;
                trackedFrom: number;
                trackedTo: number;
                insertedHtml?: string;
              }>,
              decorations: DecorationSet.empty,
            };
          },
          apply(tr, prev) {
            const meta = tr.getMeta(pendingStepPreviewKey);
            if (meta !== undefined) {
              if (!previewEnabled) {
                if (meta) {
                  console.warn("[PendingStepPreview] Collaborator preview ignored.");
                }
                return {
                  stepJson: null,
                  trackedChanges: [],
                  decorations: DecorationSet.empty,
                };
              }

              const docSize = tr.doc.content.size;
              const decorations: Decoration[] = [];
              const trackedChanges: Array<{
                type: "deletion" | "insertion";
                text: string;
                trackedFrom: number;
                trackedTo: number;
                insertedHtml?: string;
              }> = [];

              const rawSteps = Array.isArray(meta) ? meta : [];
              const parsedSteps = parseSteps(tr.doc.type.schema, rawSteps);
              const remappedSteps = remapStepsToBase(parsedSteps);
              let lastDeletionRangePreview: { from: number; to: number } | null = null;

              remappedSteps.forEach((step: any, stepIdx: number) => {
                const rawStep = rawSteps[stepIdx];
                const from = typeof step.from === "number" ? step.from : null;
                const to = typeof step.to === "number" ? step.to : null;
                let deletedText = step.deletedText || null;
                const insertedText = step.insertedText || null;

                let baseFrom = typeof from === "number" ? from : 1;
                let baseTo = typeof to === "number" ? to : baseFrom;
                const hasSlice = step.slice && (step.slice.size ?? 0) > 0;
                const hasInsertedContent = hasSlice || (insertedText && String(insertedText).trim().length > 0);
                const isDeletion = (deletedText && typeof deletedText === "string") || (baseFrom < baseTo && !hasInsertedContent);
                if (!deletedText && baseFrom < baseTo && baseTo <= docSize) {
                  deletedText = tr.doc.textBetween(baseFrom, baseTo, " ");
                }

                if (isDeletion && baseFrom < baseTo) {
                  let delFrom = baseFrom;
                  let delTo = baseTo;
                  if (delFrom > delTo) [delFrom, delTo] = [delTo, delFrom];
                  let safeFrom = Math.max(0, Math.min(delFrom, docSize));
                  let safeTo = Math.min(docSize, Math.max(0, Math.min(delTo, docSize)));
                  const maxRange = Math.max(50000, Math.floor(docSize * 0.95));
                  if (safeTo - safeFrom > maxRange) safeTo = Math.min(safeFrom + maxRange, docSize);
                  if (safeFrom < safeTo) {
                    decorations.push(
                      Decoration.inline(safeFrom, safeTo, {
                        class: "owner-pending-deletion",
                      })
                    );
                    trackedChanges.push({
                      type: "deletion",
                      text: deletedText || "",
                      trackedFrom: safeFrom,
                      trackedTo: safeTo,
                    });
                    lastDeletionRangePreview = { from: safeFrom, to: safeTo };
                    baseTo = safeTo;
                  }
                }

                const showInsertion = (insertedText && typeof insertedText === "string") || (rawStep?.slice?.content?.length > 0);
                if (showInsertion) {
                  // Replacement: show insertion after the deletion (at baseTo). Otherwise at baseFrom.
                  const isReplacement = isDeletion;
                  let insertPos = isReplacement ? baseTo : baseFrom;
                  if (!isReplacement && lastDeletionRangePreview && (insertPos < 1 || insertPos > docSize)) {
                    insertPos = lastDeletionRangePreview.from;
                  }
                  const clampedPos = Math.max(1, Math.min(insertPos, docSize));
                  const displayText = insertedText || extractSliceText(rawStep) || "";
                  const displayHtml = rawStep ? sliceContentToHtml(tr.doc.type.schema, rawStep) : null;
                  decorations.push(
                    Decoration.widget(
                      clampedPos,
                      () => {
                        const span = document.createElement("span");
                        span.className = "owner-pending-insertion";
                        if (displayHtml && /<[a-z][\s\S]*>/i.test(displayHtml)) {
                          span.innerHTML = displayHtml;
                        } else {
                          span.textContent = displayText;
                        }
                        return span;
                      },
                      { side: 1 }
                    )
                  );
                  trackedChanges.push({
                    type: "insertion",
                    text: displayText,
                    trackedFrom: clampedPos,
                    trackedTo: clampedPos,
                    insertedHtml: displayHtml && /<[a-z][\s\S]*>/i.test(displayHtml) ? displayHtml : undefined,
                  });
                }
              });

              return {
                stepJson: meta,
                trackedChanges,
                decorations: DecorationSet.create(tr.doc, decorations),
              };
            }

            // Document changed - rebuild from trackedChanges (split deletion/insertion)
            if (tr.docChanged && prev.trackedChanges && prev.trackedChanges.length > 0) {
              const docSize = tr.doc.content.size;
              const decorations: Decoration[] = [];
              const updatedTrackedChanges: typeof prev.trackedChanges = [];

              // Detect full document replacement
              if (prev.trackedChanges.length > 0) {
                const testFrom = prev.trackedChanges[0]?.trackedFrom || 0;
                const testTo = prev.trackedChanges[0]?.trackedTo || 0;
                const mappedTestFrom = tr.mapping.map(testFrom, -1);
                const mappedTestTo = tr.mapping.map(testTo, 1);

                if (mappedTestFrom === 0 && mappedTestTo >= docSize - 1) {
                  return {
                    stepJson: prev.stepJson,
                    trackedChanges: [],
                    decorations: DecorationSet.empty,
                  };
                }
              }

              prev.trackedChanges.forEach((change: any) => {
                const { type, text, trackedFrom, trackedTo, insertedHtml } = change;

                const mappedFrom = tr.mapping.map(trackedFrom, -1);
                const mappedTo = tr.mapping.map(trackedTo, 1);

                if (type === "deletion") {
                  let safeFrom = Math.max(0, Math.min(mappedFrom, docSize));
                  let safeTo = Math.min(docSize, Math.max(0, Math.min(mappedTo, docSize)));
                  const maxRange = Math.max(50000, Math.floor(docSize * 0.95));
                  if (safeTo - safeFrom > maxRange) safeTo = Math.min(safeFrom + maxRange, docSize);
                  if (safeFrom < safeTo) {
                    decorations.push(
                      Decoration.inline(safeFrom, safeTo, {
                        class: "owner-pending-deletion",
                      })
                    );
                  }
                  updatedTrackedChanges.push({
                    type: "deletion",
                    text,
                    trackedFrom: safeFrom,
                    trackedTo: safeTo,
                  });
                } else if (type === "insertion") {
                  const insertPos = Math.max(1, Math.min(tr.mapping.map(trackedFrom, 1), docSize));
                  const displayHtml = insertedHtml;
                  decorations.push(
                    Decoration.widget(
                      insertPos,
                      () => {
                        const span = document.createElement("span");
                        span.className = "owner-pending-insertion";
                        if (displayHtml && /<[a-z][\s\S]*>/i.test(displayHtml)) {
                          span.innerHTML = displayHtml;
                        } else {
                          span.textContent = text;
                        }
                        return span;
                      },
                      { side: 1 }
                    )
                  );

                  updatedTrackedChanges.push({
                    type: "insertion",
                    text,
                    trackedFrom: insertPos,
                    trackedTo: insertPos,
                    insertedHtml,
                  });
                }
              });

              return {
                stepJson: prev.stepJson,
                trackedChanges: updatedTrackedChanges,
                decorations: DecorationSet.create(tr.doc, decorations),
              };
            }

            // Non-editing transaction - keep state as-is
            return prev;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations;
          },
        },
      }),
    ];
  },
});

/** Applies heading only to the selected text (splits block if needed). Falls back to block-level toggle when selection is empty. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyHeadingToSelection(editor: any, level: 1 | 2 | 3) {
  if (!editor) return;
  const { state } = editor;
  const { from, to } = state.selection;
  const schema = state.schema;
  const headingType = schema.nodes.heading;
  if (!headingType) return;

  // When selection is empty (cursor only), do nothing - headings apply only to highlighted text
  if (from === to) return;

  // Selection is non-empty: replace selected content with a heading block containing that content
  const selectedSlice = state.doc.slice(from, to);
  if (!selectedSlice.content.size) return;

  try {
    const headingNode = headingType.create({ level }, selectedSlice.content);
    const slice = new Slice(Fragment.from(headingNode), 0, 0);
    const tr = state.tr.replaceRange(from, to, slice);
    editor.view.dispatch(tr);
    editor.commands.focus();
  } catch {
    // Fallback to block-level toggle if replace fails
    editor.chain().focus().toggleHeading({ level }).run();
  }
}

function TiptapEditor({
  content,
  onUpdate,
  onBlur,
  placeholder,
  onTextSelect,
  editorRef,
  isCollaborator = false,
  hasChanges = false,
  pendingChanges = [],
  talkingPointId,
  enableCollaboration = false,
  isReadOnly = false,
  hasPendingChanges = false,
  onPendingChangeClick,
  previewStepJson = null,
  canonicalContent: _canonicalContent,
  shadowSuggestions: _shadowSuggestions = [],
  pendingHighlightStepJsons = [],
  aiCoachHighlights = [],
  highlightPreviewMode = "collaborators",
  decorationRefreshTrigger = 0,
  onHighlightClick,
  onTryEdit,
}: TiptapEditorProps & { isReadOnly?: boolean; hasPendingChanges?: boolean; onPendingChangeClick?: () => void }) {
  const isUpdatingRef = useRef(false);
  const isInitialMountRef = useRef(true);
  const isEditingRef = useRef(false); // Track if user is actively editing
  const [collabVersion, setCollabVersion] = useState<number>(0);

  // Suppress unused variable warnings (these props are received but no longer used after removing shadow-apply)
  void _canonicalContent;
  void _shadowSuggestions;
  const [collabInitialized, setCollabInitialized] = useState(false);

  // Strip change indicators from content before processing
  const stripChangeIndicators = (html: string): string => {
    if (!html) return html;
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const changeSpans = doc.querySelectorAll('[data-change-type]');
    changeSpans.forEach((span) => {
      const parent = span.parentNode;
      if (parent) {
        while (span.firstChild) {
          parent.insertBefore(span.firstChild, span);
        }
        parent.removeChild(span);
      }
    });
    const serializer = new XMLSerializer();
    const bodyHtml = serializer.serializeToString(doc.body);
    return bodyHtml.replace(/^<body[^>]*>/, "").replace(/<\/body>$/, "");
  };


  // Get clean content without indicators
  const cleanContent = useMemo(() => {
    return stripChangeIndicators(content);
  }, [content]);

  // Initialize collaboration state
  useEffect(() => {
    if (enableCollaboration && talkingPointId && !collabInitialized) {
      getCollaborationState(talkingPointId).then((result: { success: boolean; data?: { version?: number } }) => {
        if (result.success && result.data) {
          setCollabVersion(result.data.version || 0);
          setCollabInitialized(true);
        }
      });
    }
  }, [enableCollaboration, talkingPointId, collabInitialized]);

  // Build extensions array - useMemo to ensure it updates when collaboration state changes
  const extensions = useMemo(() => {
    const baseExtensions: any[] = [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        link: {
          openOnClick: true,
          HTMLAttributes: {
            target: "_blank",
            rel: "noopener noreferrer",
            class: "text-blue-600 underline",
          },
        },
      }),
      Image,
      Placeholder.configure({
        placeholder: placeholder || "Start writing...",
      }),
      Highlight.configure({
        multicolor: true,
        HTMLAttributes: {
          class: isCollaborator && hasChanges ? "bg-yellow-200 border-b-2 border-yellow-400" : "bg-yellow-200",
        },
      }),
      LinkExitExtension,
    ];

    // Use collaboration extension if enabled
    if (enableCollaboration && collabInitialized && talkingPointId) {
      baseExtensions.push(
        CollaborationExtension.configure({
          talkingPointId: talkingPointId,
          version: collabVersion,
        })
      );
    }

    // Step capture disabled for collaborators - they use Create Edit (select text → modal) only
    // if (isCollaborator && talkingPointId) {
    //   baseExtensions.push(StepCaptureExtension.configure({ talkingPointId }));
    // }

    baseExtensions.push(PendingShadowHighlightExtension);
    baseExtensions.push(AiCoachHighlightExtension);
    baseExtensions.push(PendingStepPreviewExtension.configure({
      previewEnabled: !isCollaborator,
    }));

    return baseExtensions;
  }, [enableCollaboration, collabInitialized, talkingPointId, collabVersion, pendingChanges, isCollaborator, hasChanges, placeholder, previewStepJson]);

  const editor = useEditor({
    editable: !isReadOnly,
    // Collaborators: read-only, use Create Edit (select text → Suggest Edit) only
    shouldRerenderOnTransaction: true,
    extensions,
    content: cleanContent,
    // Collaborators can edit, but their edits become suggestions (not direct changes)
    parseOptions: {
      preserveWhitespace: 'full',
    },
    onUpdate: ({ editor }) => {
      // Don't trigger update if we're in the middle of a programmatic update
      if (isUpdatingRef.current) return;

      // Strip change indicators before passing to parent
      const html = editor.getHTML();
      const cleanHTML = stripChangeIndicators(html);
      const currentClean = stripChangeIndicators(content);

      // Only call onUpdate if content actually changed (not just indicators)
      if (cleanHTML !== currentClean) {
        onUpdate(cleanHTML);
      }
    },
    onBlur,
    editorProps: {
      attributes: {
        class: "ProseMirror focus:outline-none",
      },
      // Allow custom data attributes and styles
      transformPastedHTML: (html) => {
        return html;
      },
      handleKeyDown: (_view, event) => {
        if (onTryEdit && (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete" || event.key === "Enter")) {
          onTryEdit();
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        mouseup: (view) => {
          // Use a small delay to ensure browser selection is updated
          setTimeout(() => {
            const browserSelection = getSelectedText();
            if (browserSelection.trim().length > 0 && onTextSelect) {
              const { state } = view;
              const { selection } = state;
              const { from, to } = selection;

              if (from !== to) {
                const selectedText = state.doc.textBetween(from, to, " ");
                if (selectedText.trim().length > 0) {
                  const coords = view.coordsAtPos(to);
                  let selectedHtml: string | undefined;
                  try {
                    const slice = state.doc.slice(from, to);
                    if (slice.content.size > 0) {
                      const div = document.createElement("div");
                      DOMSerializer.fromSchema(state.schema).serializeFragment(slice.content, { document }, div);
                      selectedHtml = div.innerHTML?.trim() || undefined;
                    }
                  } catch (_) {}
                  onTextSelect(selectedText.trim(), { x: coords.left, y: coords.top }, { from, to }, selectedHtml);
                }
              } else if (browserSelection.trim().length > 0) {
                const selection = window.getSelection();
                if (selection && selection.rangeCount > 0) {
                  const range = selection.getRangeAt(0);
                  const rect = range.getBoundingClientRect();
                  onTextSelect(browserSelection.trim(), { x: rect.right, y: rect.bottom });
                }
              }
            }
          }, 10);
          return false;
        },
      },
    },
  });

  useEffect(() => {
    // Expose editor instance via ref
    if (editor && editorRef) {
      editorRef.current = editor;
      // Store programmatic update flag on editor instance for extension access
      (editor as any).__isProgrammaticUpdate = false;
    }
  }, [editor, editorRef]);



  // Initial mount only: hydrate editor from canonical content
  useEffect(() => {
    if (!editor) return;
    if (!isInitialMountRef.current) return;
    const cleanContent = stripChangeIndicators(content);
    (editor as any).__isProgrammaticUpdate = true;
    editor.commands.setContent(cleanContent);
    setTimeout(() => {
      (editor as any).__isProgrammaticUpdate = false;
    }, 100);
    isInitialMountRef.current = false;
  }, [editor, content]);

  useEffect(() => {
    if (!editor) return;
    const extension = editor.extensionManager.extensions.find((ext: any) => ext.name === "pendingStepPreview");
    if (extension) {
      const tr = editor.state.tr.setMeta(pendingStepPreviewKey, previewStepJson);
      editor.view.dispatch(tr);
    }
  }, [editor, previewStepJson]);


  // Only dispatch decorations when data actually changes from the backend
  // Use a ref to track the previous value and avoid re-dispatching during editing
  const prevPendingHighlightRef = useRef<string>("");
  const prevAiCoachHighlightsRef = useRef<string>("");

  const prevPreviewStepJsonRef = useRef<string>("");

  // Reset refs when mode toggles so data effects don't skip on coincidental serialized match
  useEffect(() => {
    prevPendingHighlightRef.current = "";
    prevAiCoachHighlightsRef.current = "";
    prevPreviewStepJsonRef.current = "";
  }, [highlightPreviewMode]);

  // Reset AI coach highlight ref when "Go to" triggers a refresh so decorations re-apply
  useEffect(() => {
    prevAiCoachHighlightsRef.current = "";
  }, [decorationRefreshTrigger]);

  // When highlight preview mode toggles, ALWAYS dispatch to both plugins so the inactive one clears
  // and the active one shows. This fixes stale preview when toggling between Collaborators and AI Coach.
  useEffect(() => {
    if (!editor) return;
    const shadowExt = editor.extensionManager.extensions.find((ext: any) => ext.name === "pendingShadowHighlight");
    const aiExt = editor.extensionManager.extensions.find((ext: any) => ext.name === "aiCoachHighlight");
    if (shadowExt) {
      const shadowData = highlightPreviewMode === "collaborators" ? (pendingHighlightStepJsons || []) : [];
      editor.view.dispatch(editor.state.tr.setMeta(pendingShadowHighlightKey, shadowData));
    }
    if (aiExt) {
      const aiData = highlightPreviewMode === "ai" ? (aiCoachHighlights || []) : [];
      editor.view.dispatch(editor.state.tr.setMeta(aiCoachHighlightKey, aiData));
    }
  }, [editor, highlightPreviewMode, pendingHighlightStepJsons, aiCoachHighlights]);

  useEffect(() => {
    if (!editor) return;
    const currentSerialized = JSON.stringify(pendingHighlightStepJsons || []);
    if (currentSerialized === prevPendingHighlightRef.current && highlightPreviewMode !== "ai") return;
    prevPendingHighlightRef.current = currentSerialized;
    isEditingRef.current = false;
    const extension = editor.extensionManager.extensions.find((ext: any) => ext.name === "pendingShadowHighlight");
    if (extension && highlightPreviewMode === "collaborators") {
      const tr = editor.state.tr.setMeta(pendingShadowHighlightKey, pendingHighlightStepJsons || []);
      editor.view.dispatch(tr);
    }
  }, [editor, pendingHighlightStepJsons, highlightPreviewMode]);

  useEffect(() => {
    if (!editor) return;
    const currentSerialized = JSON.stringify(aiCoachHighlights || []);
    if (currentSerialized === prevAiCoachHighlightsRef.current && highlightPreviewMode !== "collaborators") return;
    prevAiCoachHighlightsRef.current = currentSerialized;
    const ext = editor.extensionManager.extensions.find((ext: any) => ext.name === "aiCoachHighlight");
    if (ext && highlightPreviewMode === "ai") {
      editor.view.dispatch(editor.state.tr.setMeta(aiCoachHighlightKey, aiCoachHighlights || []));
    }
  }, [editor, aiCoachHighlights, highlightPreviewMode, decorationRefreshTrigger]);

  // Refresh preview decorations when pending changes update (owner view)
  useEffect(() => {
    if (!editor) return;

    // Serialize to compare if data actually changed
    const currentSerialized = JSON.stringify(previewStepJson || null);
    if (currentSerialized === prevPreviewStepJsonRef.current) {
      return; // No change, skip dispatch
    }
    prevPreviewStepJsonRef.current = currentSerialized;

    const tr = editor.state.tr.setMeta(pendingStepPreviewKey, previewStepJson);
    editor.view.dispatch(tr);
  }, [editor, pendingChanges, previewStepJson, highlightPreviewMode]);

  // Refresh decorations when pending changes update
  useEffect(() => {
    if (!editor) return;
    const tr = editor.state.tr.setMeta("collaborationRefresh", Date.now());
    editor.view.dispatch(tr);
  }, [editor, pendingChanges]);



 





  // NOTE: Shadow suggestions are now shown via DECORATIONS only (Base Doc + Overlay strategy)
  // We do NOT apply steps to the document - the editor keeps the canonical content
  // and decorations show deletions (strikethrough) and insertions (widgets)
  // 
  // The old shadow-apply effect has been removed to support the new strategy.


  if (!editor) {
    return null;
  }

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
      {/* Toolbar - hidden for collaborators (they use formatting only in Suggest Edit modal) */}
      {!isCollaborator && (
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-2.5 flex items-center gap-2 flex-wrap">
        {/* Headings */}
        <div className="flex items-center gap-1 border-r border-gray-300 pr-2 mr-2">
          <button
            type="button"
            disabled={isCollaborator}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyHeadingToSelection(editor, 1)}
            className={`p-1.5 rounded transition-colors duration-150 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed ${editor.isActive("heading", { level: 1 }) ? "bg-[#cdf056] hover:bg-[#b8e04a]" : ""}`}
            title="Heading 1 (applies to selected text only)"
          >
            <H1Icon className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={isCollaborator}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyHeadingToSelection(editor, 2)}
            className={`p-1.5 rounded transition-colors duration-150 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed ${editor.isActive("heading", { level: 2 }) ? "bg-[#cdf056] hover:bg-[#b8e04a]" : ""}`}
            title="Heading 2 (applies to selected text only)"
          >
            <H2Icon className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={isCollaborator}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyHeadingToSelection(editor, 3)}
            className={`p-1.5 rounded transition-colors duration-150 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed ${editor.isActive("heading", { level: 3 }) ? "bg-[#cdf056] hover:bg-[#b8e04a]" : ""}`}
            title="Heading 3 (applies to selected text only)"
          >
            <H3Icon className="w-4 h-4" />
          </button>
        </div>

        {/* Text formatting */}
        <div className="flex items-center gap-1 border-r border-gray-300 pr-2 mr-2">
          <button
            type="button"
            disabled={isCollaborator}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1.5 rounded transition-colors duration-150 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed ${editor.isActive("bold") ? "bg-[#cdf056] hover:bg-[#b8e04a]" : ""}`}
            title="Bold"
          >
            <BoldIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={isCollaborator}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1.5 rounded transition-colors duration-150 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed ${editor.isActive("italic") ? "bg-[#cdf056] hover:bg-[#b8e04a]" : ""}`}
            title="Italic"
          >
            <ItalicIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={isCollaborator}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={`p-1.5 rounded transition-colors duration-150 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed ${editor.isActive("strike") ? "bg-[#cdf056] hover:bg-[#b8e04a]" : ""}`}
            title="Strikethrough"
          >
            <StrikethroughIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={isCollaborator}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={`p-1.5 rounded transition-colors duration-150 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed ${editor.isActive("code") ? "bg-[#cdf056] hover:bg-[#b8e04a]" : ""}`}
            title="Inline Code"
          >
            <CodeBracketIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Lists */}
        <div className="flex items-center gap-1 border-r border-gray-300 pr-2 mr-2">
          <button
            type="button"
            disabled={isCollaborator}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`p-1.5 rounded transition-colors duration-150 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed ${editor.isActive("bulletList") ? "bg-[#cdf056] hover:bg-[#b8e04a]" : ""}`}
            title="Bullet List"
          >
            <ListBulletIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={isCollaborator}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`p-1.5 rounded transition-colors duration-150 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed ${editor.isActive("orderedList") ? "bg-[#cdf056] hover:bg-[#b8e04a]" : ""}`}
            title="Numbered List"
          >
            <NumberedListIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={isCollaborator}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={`p-1.5 rounded transition-colors duration-150 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed ${editor.isActive("blockquote") ? "bg-[#cdf056] hover:bg-[#b8e04a]" : ""}`}
            title="Blockquote"
          >
            <ChatBubbleLeftIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Links */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={isCollaborator}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const url = window.prompt("Enter URL:");
              if (url) {
                const href = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
                editor.chain().focus().setLink({ href }).run();
              }
            }}
            className={`p-1.5 rounded transition-colors duration-150 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed ${editor.isActive("link") ? "bg-[#cdf056] hover:bg-[#b8e04a]" : ""}`}
            title="Link"
          >
            <LinkIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().unsetLink().run()}
            disabled={isCollaborator || !editor.isActive("link")}
            className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Remove Link"
          >
            <LinkSlashIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      )}

      {/* Editor Content */}
      <div
        className={pendingChanges.length > 0 ? "editor-has-pending-highlights" : undefined}
        onClick={(e) => {
          const el = e.target as HTMLElement;
          const highlightEl = el.closest(".ai-coach-suggestion, .ai-coach-suggested-insertion, .collaborator-pending-deletion, .collaborator-pending-insertion, .owner-pending-deletion, .owner-pending-insertion");
          if (highlightEl && onHighlightClick && talkingPointId != null) {
            e.preventDefault();
            e.stopPropagation();
            const text = (highlightEl.textContent || "").trim().replace(/\s+/g, " ");
            const isSuggested = highlightEl.classList.contains("ai-coach-suggested-insertion") || highlightEl.classList.contains("collaborator-pending-insertion") || highlightEl.classList.contains("owner-pending-insertion");
            onHighlightClick({
              mode: highlightPreviewMode === "ai" ? "ai" : "collaborator",
              anchorOrDeletedText: isSuggested ? "" : text,
              suggestedOrInsertedText: isSuggested ? text : undefined,
              talkingPointId,
              clientX: e.clientX,
              clientY: e.clientY,
            });
            return;
          }
          if (hasPendingChanges && onPendingChangeClick) {
            onPendingChangeClick();
          }
        }}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export default function Editor({ outline, bookId, onOutlineUpdate, isCollaboration = false, collaboratorRole = null }: EditorProps) {
  const notification = useNotification();
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null);
  const [generatingTpId, setGeneratingTpId] = useState<number | null>(null);
  const [expandedChapters, setExpandedChapters] = useState<Record<number, boolean>>({});
  const [assetsModalOpen, setAssetsModalOpen] = useState(false);
  const [currentTalkingPointId, setCurrentTalkingPointId] = useState<number | null>(null);
  const [currentChapterId, setCurrentChapterId] = useState<number | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<number[]>([]);
  const [activeRightView, setActiveRightView] = useState<"comments" | "chat" | "changes" | "moreActions" | "review" | "glossary">("comments");
  const [isReviewing, setIsReviewing] = useState(false);
  type AiSuggestion = {
    talking_point_id: number;
    talking_point_text: string;
    section_title: string;
    category: string;
    anchor: string;
    suggested_change: string;
    comment: string;
    options?: string;
    glossary_suggestion?: string;
  };
  const [reviewResult, setReviewResult] = useState<{ review_items_found: number; suggestions: AiSuggestion[] } | null>(null);
  const [dismissedAiSuggestions, setDismissedAiSuggestions] = useState<Set<string>>(new Set());
  const [highlightedReviewSuggestionKey, setHighlightedReviewSuggestionKey] = useState<string | null>(null);
  const [highlightCommentPopover, setHighlightCommentPopover] = useState<
    | { type: "ai"; suggestion: AiSuggestion; x: number; y: number }
    | { type: "collaborator"; change: ContentChange; x: number; y: number }
    | null
  >(null);

  const suggestionKey = (s: AiSuggestion) =>
    `${s.talking_point_id}|${(s.anchor || "").replace(/\s+/g, " ").trim()}|${(s.suggested_change || "").replace(/\s+/g, " ").trim()}`;
  const displayedAiSuggestions = (reviewResult?.suggestions ?? []).filter(
    (s) => !dismissedAiSuggestions.has(suggestionKey(s))
  );
  // Glossary state
  const [glossaryTerms, setGlossaryTerms] = useState<GlossaryTerm[]>([]);
  const [isLoadingGlossary, setIsLoadingGlossary] = useState(false);
  const [newTermInput, setNewTermInput] = useState("");
  const [spellingConvention, setSpellingConvention] = useState<"us" | "uk" | "auto">("auto");
  const [selectedText, setSelectedText] = useState<string>("");
  const [selectedHtml, setSelectedHtml] = useState<string>("");
  const [selectionPosition, setSelectionPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectionRange, setSelectionRange] = useState<{ from: number; to: number } | null>(null);
  const [chatMessages, setChatMessages] = useState<Array<{ from: "user" | "ai"; text: string; highlightedText?: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const handleTranscript = (text: string) => {
    setChatInput(prev => (prev + ' ' + text).trim());
  };
  
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const [comments, setComments] = useState<CommentType[]>([]);
  const [newCommentText, setNewCommentText] = useState("");
  const [isAddingComment, setIsAddingComment] = useState(false);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [replyingToCommentId, setReplyingToCommentId] = useState<number | null>(null);
  const [replyTexts, setReplyTexts] = useState<Record<number, string>>({});
  const [isAddingReply, setIsAddingReply] = useState<Record<number, boolean>>({});
  const [expandedReplies, setExpandedReplies] = useState<Record<number, boolean>>({});
  const editorRefs = useRef<Record<number, any>>({});
  const [isApplyingQuickAction, setIsApplyingQuickAction] = useState(false);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [showCollaboratorModal, setShowCollaboratorModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer" | "commenter">("commenter");
  const [isInviting, setIsInviting] = useState(false);
  const [contentChanges, setContentChanges] = useState<ContentChange[]>([]);

  const [isLoadingChanges, setIsLoadingChanges] = useState(false);
  const [hasAutoOpenedChanges, setHasAutoOpenedChanges] = useState(false);
  const [focusedChangeTpId, setFocusedChangeTpId] = useState<number | null>(null);
  const [highlightPreviewMode, setHighlightPreviewMode] = useState<"collaborators" | "ai">("collaborators");
  const [decorationRefreshTrigger, setDecorationRefreshTrigger] = useState(0);
  const isBookOwner = !isCollaboration;
  // Track original content for change detection (for collaborators)
  const [originalContents, setOriginalContents] = useState<Record<number, string>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<Record<number, boolean>>({});
  const [applyChangeComments, setApplyChangeComments] = useState<Record<number, string>>({});
  const [editingChangeCommentId, setEditingChangeCommentId] = useState<number | null>(null);
  const [editingChangeCommentText, setEditingChangeCommentText] = useState("");
  const [currentUserId, setCurrentUserId] = useState<number | null>((window as any).currentUserId ?? null);
  // Inline edit state for section title and talking point text (double-tap to edit)
  const [editingSectionId, setEditingSectionId] = useState<number | null>(null);
  const [editingSectionTitleValue, setEditingSectionTitleValue] = useState("");
  const [editingTpTextId, setEditingTpTextId] = useState<number | null>(null);
  const [editingTpTextValue, setEditingTpTextValue] = useState("");
  const [editingChapterId, setEditingChapterId] = useState<number | null>(null);
  const [editingChapterTitleValue, setEditingChapterTitleValue] = useState("");
  const sectionTitleEditStartedAtRef = useRef<number>(0);
  const chapterTitleEditStartedAtRef = useRef<number>(0);
  // Collaborator "Create Edit" modal: select text → edit in rich editor → suggest
  const [createEditModalOpen, setCreateEditModalOpen] = useState(false);
  const [createEditInitialContent, setCreateEditInitialContent] = useState<string>("");
  const [createEditTpId, setCreateEditTpId] = useState<number | null>(null);
  const [createEditFrom, setCreateEditFrom] = useState<number>(0);
  const [createEditTo, setCreateEditTo] = useState<number>(0);
  const [createEditOriginalText, setCreateEditOriginalText] = useState("");
  const [isSubmittingCreateEdit, setIsSubmittingCreateEdit] = useState(false);
  const createEditEditorRef = useRef<any>(null);

  useEffect(() => {
    getCurrentUser().then((result) => {
      if (result.success && result.data) {
        const id = (result.data as any).user_id ?? (result.data as any).id;
        if (id != null) setCurrentUserId(id);
      }
    });
  }, []);

  const getChangeSteps = (change: ContentChange) => {
    const editorRef = editorRefs.current[change.talking_point]?.current;
    const schema = editorRef?.state?.schema;
    if (!schema) return [];
    return parseSteps(schema, (change as any).step_json || []);
  };

  const getChangeDoc = (change: ContentChange) => {
    const editorRef = editorRefs.current[change.talking_point]?.current;
    return editorRef?.state?.doc || null;
  };

  const getChangePreviewText = (change: ContentChange): { deleted: string; inserted: string } => {
    const doc = getChangeDoc(change);
    if (!doc) return { deleted: "", inserted: "" };
    const steps = getChangeSteps(change);

    // First try normal flow with parsed steps
    const preview = getPreviewFragments(doc, steps, { maxFragment: 50000 });

    console.log(`[getChangePreviewText] From getPreviewFragments: deleted="${preview.deleted}", inserted="${preview.inserted}"`);

    // ALWAYS extract from raw step_json - this is more reliable for compressed steps
    const stepJson = (change as any).step_json;
    const rawSteps = Array.isArray(stepJson) ? stepJson : [stepJson];

    const deletedParts: string[] = [];
    const insertedParts: string[] = [];

    for (const raw of rawSteps) {
      if (!raw || typeof raw !== "object") continue;

      console.log(`[getChangePreviewText] Raw step keys:`, Object.keys(raw));

      // Check for stored deletedText (from compression) - preserve whitespace
      if (raw.deletedText && typeof raw.deletedText === "string") {
        deletedParts.push(raw.deletedText);
      }

      // Check for stored insertedText - preserve all whitespace (spaces, newlines)
      if (raw.insertedText && typeof raw.insertedText === "string") {
        insertedParts.push(raw.insertedText);
      }
      // Fallback: extract from slice content (handles hardBreak, preserves whitespace)
      else if (raw.slice?.content && Array.isArray(raw.slice.content)) {
        const sliceText = extractInsertedTextFromRawStep(raw);
        if (sliceText) {
          insertedParts.push(sliceText);
        }
      }
    }

    // Join parts: use " ... " only between distinct edit regions, not between single chars from per-keystroke steps
    const rawDeleted = deletedParts.join(" ... ");
    const rawInserted = (() => {
      if (insertedParts.length === 0) return "";
      // If all parts are single chars and form one contiguous string, merge them (avoids "P ... r ... o ... j ..." from delete+retype)
      const allSingleChars = insertedParts.every((p) => p.length === 1);
      if (allSingleChars && insertedParts.length > 1) {
        return insertedParts.join("");
      }
      return insertedParts.join(" ... ");
    })();

    console.log(`[getChangePreviewText] Extracted from raw: deleted="${rawDeleted}", inserted="${rawInserted}"`);

    // Prefer raw extraction if it has content (more reliable for compressed steps)
    // Filter out very short deletions that are likely artifacts (like single "-" or whitespace)
    const cleanDeleted = rawDeleted && rawDeleted.length > 1 && rawDeleted.trim().length > 0 ? rawDeleted : "";

    // No net change: delete + re-insert of same text (e.g. "Projects" → delete → "Projects")
    const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim();
    if (cleanDeleted && rawInserted && norm(cleanDeleted) === norm(rawInserted)) {
      return { deleted: "", inserted: "" }; // Triggers "Preview unavailable" - no real change
    }

    if (cleanDeleted || rawInserted) {
      return { deleted: cleanDeleted, inserted: rawInserted };
    }

    // Fall back to getPreviewFragments result, but also clean short artifacts
    const cleanPreviewDeleted = preview.deleted && preview.deleted.length > 1 && preview.deleted.trim().length > 0
      ? preview.deleted
      : "";
    return { deleted: cleanPreviewDeleted, inserted: preview.inserted };
  };

  const getMappedRangeFromStepJson = (doc: any, schema: any, stepJson: any): { from: number; to: number } | null => {
    if (!stepJson || !doc) return null;
    const steps = parseSteps(schema, stepJson);
    if (steps.length === 0) return null;
    const mapping = new Mapping();
    for (const step of steps) {
      const stepAny = step as any;
      if (typeof stepAny.from !== "number" || typeof stepAny.to !== "number") {
        continue;
      }
      const mappedFrom = mapping.map(stepAny.from, -1);
      const mappedTo = mapping.map(stepAny.to, 1);
      const from = Math.max(1, Math.min(mappedFrom, doc.content.size));
      const to = Math.max(1, Math.min(mappedTo, doc.content.size));

      const hasSlice = stepAny.slice && stepAny.slice.size > 0;
      const isDeletion = stepAny.from < stepAny.to && !hasSlice;
      const isReplacement = stepAny.from < stepAny.to && hasSlice;
      const isInsertion = stepAny.from === stepAny.to && hasSlice;

      if ((isDeletion || isReplacement) && from < to) {
        return { from, to };
      }
      if (isInsertion) {
        return { from, to: from };
      }

      mapping.appendMap(step.getMap());
    }
    return null;
  };

  const findTextRangeInDoc = (doc: any, targetText: string): { from: number; to: number } | null => {
    if (!doc || !targetText) return null;
    const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
    const normalizedTarget = normalize(targetText);
    if (!normalizedTarget) return null;

    let normalizedText = "";
    const positionMap: Array<{ pmPos: number; charIndex: number }> = [];

    doc.nodesBetween(0, doc.content.size, (node: any, pos: number) => {
      if (node.isText) {
        const nodeText = node.text || "";
        for (let i = 0; i < nodeText.length; i++) {
          const char = nodeText[i];
          const pmPos = pos + 1 + i;
          if (/\s/.test(char)) {
            if (normalizedText.length === 0 || !/\s/.test(normalizedText[normalizedText.length - 1])) {
              normalizedText += " ";
              positionMap.push({ pmPos, charIndex: normalizedText.length - 1 });
            } else {
              positionMap.push({ pmPos, charIndex: normalizedText.length - 1 });
            }
          } else {
            normalizedText += char;
            positionMap.push({ pmPos, charIndex: normalizedText.length - 1 });
          }
        }
      }
      return true;
    });

    const normalizedDoc = normalize(normalizedText);
    if (!normalizedDoc) return null;

    const startIndex = normalizedDoc.indexOf(normalizedTarget);
    if (startIndex < 0) return null;
    const endIndex = startIndex + normalizedTarget.length;

    const findPmPosForCharIndex = (index: number): number | null => {
      const exact = positionMap.find((m) => m.charIndex === index);
      if (exact) return exact.pmPos;
      if (positionMap.length === 0) return null;
      const closest = positionMap.reduce((prev, curr) =>
        Math.abs(curr.charIndex - index) < Math.abs(prev.charIndex - index) ? curr : prev
      );
      return closest.pmPos;
    };

    const pmStart = findPmPosForCharIndex(startIndex);
    const pmEnd = findPmPosForCharIndex(Math.max(endIndex - 1, startIndex));
    if (!pmStart || !pmEnd) return null;

    const from = Math.max(1, pmStart);
    const to = Math.min(doc.content.size, pmEnd + 1);
    if (to < from) return null;
    return { from, to };
  };

  const extractInsertedTextFromStepJson = (stepJson: any): string => {
    const steps = Array.isArray(stepJson) ? stepJson : [stepJson];
    const extract = (node: any): string => {
      if (!node) return "";
      if (node.type === "text" && node.text) return node.text;
      if (Array.isArray(node.content)) return node.content.map(extract).join("");
      return "";
    };
    return steps
      .map((raw) => raw?.slice?.content)
      .filter(Boolean)
      .map((content: any) => (Array.isArray(content) ? content.map(extract).join("") : ""))
      .filter(Boolean)
      .join(" ");
  };

  const highlightChangeInEditor = (change: ContentChange) => {
    const tpId = change.talking_point;
    const editorRef = editorRefs.current[tpId]?.current;
    if (!editorRef) return;

    const { state, view } = editorRef;
    if (!state?.doc || !view) return;

    const stepJson = (change as any).step_json;
    const range =
      getMappedRangeFromStepJson(state.doc, state.schema, stepJson) ||
      (() => {
        const insertedText = extractInsertedTextFromStepJson(stepJson);
        return insertedText ? findTextRangeInDoc(state.doc, insertedText) : null;
      })();

    if (range) {
      editorRef.commands.setTextSelection(range);
      view.dispatch(state.tr.scrollIntoView());
    } else {
      editorRef.commands.focus();
      view.dispatch(state.tr.scrollIntoView());
    }
  };

  const getOldestPendingChangeId = (tpId: number): number | null => {
    const pending = contentChanges
      .filter((c) => c.talking_point === tpId && (!c.status || c.status === "pending"))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return pending.length > 0 ? pending[0].id : null;
  };

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isChatLoading]);

  // Clear selection when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (selectedText && selectionPosition) {
        setSelectedText("");
        setSelectedHtml("");
        setSelectionPosition(null);
        setSelectionRange(null);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [selectedText, selectionPosition]);

  useEffect(() => {
    if (outline && outline.chapters && outline.chapters.length > 0) {
      // Only auto-select first section if no section is currently selected
      if (!selectedItem) {
        const firstChapter = outline.chapters[0];
        if (firstChapter?.id && firstChapter.sections && firstChapter.sections.length > 0) {
          setExpandedChapters({ [firstChapter.id]: true });
          const firstSection = firstChapter.sections[0];
          if (firstSection?.id) {
            setSelectedItem({
              type: "section",
              chapterId: firstChapter.id,
              sectionId: firstSection.id,
              sectionTitle: firstSection.title,
            });
            // Content is sourced from canonical data; editor owns live state after mount
          }
        }
      } else {
        // Preserve selected section when outline updates
        const chapter = outline.chapters?.find((ch) => ch.id === selectedItem.chapterId);
        const section = chapter?.sections?.find((sec) => sec.id === selectedItem.sectionId);
        if (section) {
          // Update section title if it changed
          if (section.title !== selectedItem.sectionTitle) {
            setSelectedItem({
              ...selectedItem,
              sectionTitle: section.title,
            });
          }
          // Content is sourced from canonical data; editor owns live state after mount
          // Ensure chapter is expanded
          setExpandedChapters((prev) => ({
            ...prev,
            [selectedItem.chapterId]: true,
          }));
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outline]);

  // Handle URL parameters for navigation from checks
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const chapterId = urlParams.get("chapter");
    const sectionId = urlParams.get("section");
    const tpId = urlParams.get("tp");

    if (chapterId && sectionId && outline && !selectedItem) {
      const chapter = outline.chapters?.find(c => c.id === parseInt(chapterId));
      const section = chapter?.sections?.find(s => s.id === parseInt(sectionId));

      if (section) {
        setSelectedItem({
          type: "section",
          chapterId: parseInt(chapterId),
          sectionId: parseInt(sectionId),
          sectionTitle: section.title,
        });

        // Expand the chapter
        setExpandedChapters((prev) => ({
          ...prev,
          [parseInt(chapterId)]: true,
        }));

        // Scroll to talking point if specified
        if (tpId) {
          setTimeout(() => {
            const tpElement = document.querySelector(`[data-tp-id="${tpId}"]`);
            if (tpElement) {
              tpElement.scrollIntoView({ behavior: "smooth", block: "center" });
              // Highlight the talking point briefly
              const parent = tpElement.parentElement?.parentElement;
              if (parent) {
                parent.classList.add("ring-2", "ring-blue-500", "rounded-lg", "p-2");
                setTimeout(() => {
                  parent.classList.remove("ring-2", "ring-blue-500", "rounded-lg", "p-2");
                }, 3000);
              }
            }
          }, 1000);
        }

        // Clear URL parameters after navigation
        setTimeout(() => {
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.delete("chapter");
          newUrl.searchParams.delete("section");
          newUrl.searchParams.delete("tp");
          window.history.replaceState({}, "", newUrl.pathname + newUrl.search);
        }, 2000);
      }
    }
  }, [outline, selectedItem]);

  // Get selected section
  const selectedSection = selectedItem
    ? outline?.chapters
      ?.find((ch) => ch.id === selectedItem.chapterId)
      ?.sections?.find((sec) => sec.id === selectedItem.sectionId)
    : null;

  // Load comments when talking point changes
  useEffect(() => {
    const loadComments = async () => {
      const activeTpId = currentTalkingPointId || (selectedSection?.talking_points?.[0]?.id ?? null);
      if (activeTpId && bookId) {
        setIsLoadingComments(true);
        try {
          const result = await getComments(activeTpId);
          if (result.success && result.data) {
            setComments(result.data);
          }
        } catch (error) {
          console.error("Error loading comments:", error);
        } finally {
          setIsLoadingComments(false);
        }
      } else {
        setComments([]);
      }
    };
    loadComments();
  }, [currentTalkingPointId, selectedSection, bookId]);

  // Load glossary terms when glossary tab is opened
  useEffect(() => {
    const loadGlossary = async () => {
      if (activeRightView === "glossary" && bookId) {
        setIsLoadingGlossary(true);
        try {
          const result = await getGlossaryTerms(bookId);
          if (result.success && result.data) {
            setGlossaryTerms(result.data);
          }
        } catch (error) {
          console.error("Error loading glossary:", error);
        } finally {
          setIsLoadingGlossary(false);
        }
      }
    };
    loadGlossary();
  }, [activeRightView, bookId]);

  // Scroll to the specific AI Coach review item when "View in AI Coach Review" is clicked from popover
  useEffect(() => {
    if (activeRightView === "review" && highlightedReviewSuggestionKey) {
      const timer = setTimeout(() => {
        const el = document.querySelector(`[data-suggestion-key="${CSS.escape(highlightedReviewSuggestionKey)}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("ring-2", "ring-[#CDF056]", "ring-opacity-50", "ring-offset-2", "ring-offset-[#0f172a]");
          setTimeout(() => {
            el.classList.remove("ring-2", "ring-[#CDF056]", "ring-opacity-50", "ring-offset-2", "ring-offset-[#0f172a]");
          }, 2000);
        }
        setHighlightedReviewSuggestionKey(null);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [activeRightView, highlightedReviewSuggestionKey]);

  // Clear review results when chapter changes
  useEffect(() => {
    setReviewResult(null);
    setDismissedAiSuggestions(new Set());
  }, [selectedItem?.chapterId]);

  // Auto-run AI coach review in background when entering a chapter (book owner or editor only)
  useEffect(() => {
    if (!selectedItem?.chapterId || !bookId) return;
    if (!isBookOwner && collaboratorRole !== "editor") return;

    let cancelled = false;
    const runReview = async () => {
      setIsReviewing(true);
      try {
        const result = await reviewChapter(selectedItem!.chapterId);
        if (cancelled) return;
        if (result.success && result.data) {
          setReviewResult(result.data);
          setDismissedAiSuggestions(new Set());
        }
      } catch (error) {
        if (!cancelled) console.error("Error auto-reviewing chapter:", error);
      } finally {
        if (!cancelled) setIsReviewing(false);
      }
    };
    runReview();
    return () => { cancelled = true; };
  }, [selectedItem?.chapterId, bookId, isBookOwner, collaboratorRole]);

  // Function to load changes (reusable for refresh)
  // For owners: Load changes for ALL talking points in the section
  // For collaborators: Load changes for the active talking point
  const loadChanges = async () => {
    if (!bookId || !selectedSection) {
      console.log("No bookId or selectedSection, clearing changes");
      setContentChanges([]);
      return;
    }

    setIsLoadingChanges(true);
    try {
      const talkingPoints = selectedSection.talking_points || [];

      if (talkingPoints.length === 0) {
        setContentChanges([]);
        setIsLoadingChanges(false);
        return;
      }

      // For owners and editors: Load changes for ALL talking points in the section
      // For viewers/commenters: Load changes for the active talking point only
      const loadAllForSection = isBookOwner || collaboratorRole === "editor";
      const tpIdsToLoad = loadAllForSection
        ? talkingPoints.map(tp => tp.id).filter((id): id is number => id !== null && id !== undefined)
        : [currentTalkingPointId || talkingPoints[0]?.id].filter((id): id is number => id !== null && id !== undefined);

      if (tpIdsToLoad.length === 0) {
        setContentChanges([]);
        setIsLoadingChanges(false);
        return;
      }

      // Load changes for all relevant talking points
      const allChangesPromises = tpIdsToLoad.map(tpId => getContentChanges(tpId));
      const allResults = await Promise.all(allChangesPromises);

      // Combine all changes into a single array
      const allChanges: ContentChange[] = [];
      allResults.forEach((result, index) => {
        if (result.success && result.data) {
          console.log(`Loaded ${result.data.length} changes for tpId ${tpIdsToLoad[index]}`);
          allChanges.push(...result.data);
        } else {
          console.error(`Failed to load changes for tpId ${tpIdsToLoad[index]}:`, result);
        }
      });

      console.log(`loadChanges - Loaded ${allChanges.length} total changes for ${tpIdsToLoad.length} talking points`);
      setContentChanges(allChanges);
    } catch (error) {
      console.error("Error loading changes:", error);
      setContentChanges([]);
    } finally {
      setIsLoadingChanges(false);
    }
  };

  // Load content changes when section or talking point changes
  useEffect(() => {
    // Only load if we have a selected section
    if (selectedSection && bookId) {
      console.log("Loading changes for section:", selectedSection.id, "talking point:", currentTalkingPointId);
      loadChanges();
    } else {
      // Clear changes if no section selected
      console.log("No selected section, clearing changes");
      setContentChanges([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem?.sectionId, currentTalkingPointId, bookId, isBookOwner]);


  // Auto-open changes tab for owners if there are pending changes (only once when changes are first loaded)
  useEffect(() => {
    if (isBookOwner && contentChanges.length > 0 && !hasAutoOpenedChanges && !isLoadingChanges) {
      const pendingCount = contentChanges.filter(c => !c.status || c.status === "pending").length;
      if (pendingCount > 0 && activeRightView === "comments") {
        setActiveRightView("changes");
        setHighlightPreviewMode("collaborators");
        setHasAutoOpenedChanges(true);
      }
    }
  }, [contentChanges, isBookOwner, isLoadingChanges, hasAutoOpenedChanges, activeRightView]);

  // Reset auto-open flag when section changes
  useEffect(() => {
    setHasAutoOpenedChanges(false);
  }, [selectedSection]);

  const handleSectionClick = (chapterId: number, sectionId: number, sectionTitle: string) => {
    setSelectedItem({ type: "section", chapterId, sectionId, sectionTitle });
    // Clear chat when switching sections
    setChatMessages([]);
    setSelectedText("");
    setSelectionPosition(null);
    setCurrentTalkingPointId(null);
    setComments([]);
    setFocusedChangeTpId(null);
    // Don't clear contentChanges here - let the useEffect handle it when selectedSection changes
    // FIX: Clear all captured steps when switching sections
    (window as any).__CAPTURED_STEPS_BY_TP__ = {};

    // Content is sourced from canonical data; editor owns live state after mount
  };

  const handleChapterTitleEditStart = (chapterId: number, currentTitle: string) => {
    chapterTitleEditStartedAtRef.current = Date.now();
    setEditingChapterId(chapterId);
    setEditingChapterTitleValue(currentTitle);
  };

  const handleChapterTitleSave = async () => {
    if (editingChapterId == null || !bookId || !onOutlineUpdate || !outline) return;
    if (Date.now() - chapterTitleEditStartedAtRef.current < 200) return;
    const trimmed = editingChapterTitleValue.replace(/\s+/g, ' ').trim();
    if (!trimmed) {
      setEditingChapterId(null);
      return;
    }
    const chapterIdToUpdate = editingChapterId;
    const previousOutline = outline;
    const optimisticOutline = {
      ...outline,
      chapters: outline.chapters?.map((ch: any) =>
        ch.id === chapterIdToUpdate ? { ...ch, title: trimmed } : ch
      ) || [],
    };
    setEditingChapterId(null);
    onOutlineUpdate(optimisticOutline);
    try {
      const res = await updateChapter(chapterIdToUpdate, { title: trimmed });
      if (!res.success) {
        onOutlineUpdate(previousOutline);
        notification.error(res.error || "Failed to update chapter title");
      }
    } catch {
      onOutlineUpdate(previousOutline);
      notification.error("Failed to update chapter title");
    }
  };

  const handleSectionTitleEditStart = (sectionId: number, currentTitle: string) => {
    sectionTitleEditStartedAtRef.current = Date.now();
    setEditingSectionId(sectionId);
    setEditingSectionTitleValue(currentTitle);
  };

  const handleSectionTitleSave = async () => {
    if (editingSectionId == null || !bookId || !onOutlineUpdate || !outline) return;
    if (Date.now() - sectionTitleEditStartedAtRef.current < 200) return;
    const trimmed = editingSectionTitleValue.trim();
    if (!trimmed) {
      setEditingSectionId(null);
      return;
    }
    const sectionIdToUpdate = editingSectionId;
    const previousOutline = outline;
    const previousSectionTitle = outline.chapters
      ?.flatMap((ch: any) => ch.sections || [])
      .find((sec: any) => sec.id === sectionIdToUpdate)?.title || "";
    const optimisticOutline = {
      ...outline,
      chapters: outline.chapters?.map((ch: any) => ({
        ...ch,
        sections: (ch.sections || []).map((sec: any) =>
          sec.id === sectionIdToUpdate ? { ...sec, title: trimmed } : sec
        ),
      })) || [],
    };
    setEditingSectionId(null);
    if (selectedItem?.sectionId === sectionIdToUpdate) {
      setSelectedItem((prev) => prev ? { ...prev, sectionTitle: trimmed } : prev);
    }
    onOutlineUpdate(optimisticOutline);
    try {
      const res = await updateSection(sectionIdToUpdate, { title: trimmed });
      if (!res.success) {
        onOutlineUpdate(previousOutline);
        if (selectedItem?.sectionId === sectionIdToUpdate) {
          setSelectedItem((prev) => prev ? { ...prev, sectionTitle: previousSectionTitle } : prev);
        }
        notification.error(res.error || "Failed to update section title");
      }
    } catch {
      onOutlineUpdate(previousOutline);
      if (selectedItem?.sectionId === sectionIdToUpdate) {
        setSelectedItem((prev) => prev ? { ...prev, sectionTitle: previousSectionTitle } : prev);
      }
      notification.error("Failed to update section title");
    }
  };

  const handleTpTextEditStart = (tpId: number, currentText: string) => {
    setEditingTpTextId(tpId);
    setEditingTpTextValue(currentText || "");
  };

  const handleTpTextSave = async () => {
    if (editingTpTextId == null || !bookId || !onOutlineUpdate) return;
    const trimmed = editingTpTextValue.trim();
    const res = await updateTalkingPoint(editingTpTextId, { text: trimmed || `Talking Point` });
    setEditingTpTextId(null);
    if (res.success) {
      const updatedBook = await fetchBook(bookId);
      if (updatedBook.success) onOutlineUpdate(updatedBook.data);
    } else {
      notification.error(res.error || "Failed to update talking point");
    }
  };

  // Strip change indicator spans from HTML before saving
  const stripChangeIndicators = (html: string): string => {
    if (!html) return html;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const changeSpans = doc.querySelectorAll('[data-change-type]');
    changeSpans.forEach((span) => {
      const parent = span.parentNode;
      if (parent) {
        while (span.firstChild) {
          parent.insertBefore(span.firstChild, span);
        }
        parent.removeChild(span);
      }
    });

    const serializer = new XMLSerializer();
    const bodyHtml = serializer.serializeToString(doc.body);
    return bodyHtml.replace(/^<body[^>]*>/, "").replace(/<\/body>$/, "");
  };

  const handleTpContentChange = (tpId: number, content: string) => {
    // Only editors and owners can edit content
    if (!isBookOwner && collaboratorRole !== "editor") {
      return;
    }

    // Strip change indicators before comparing
    const cleanContent = stripChangeIndicators(content);

    // For collaborators, check if content has changed from original
    if (!isBookOwner && originalContents[tpId] !== undefined) {
      const original = originalContents[tpId];
      const hasChanges = cleanContent !== original;
      setHasUnsavedChanges((prev) => ({ ...prev, [tpId]: hasChanges }));
    }
  };

  /**
   * handleAcceptAiSuggestion - Apply AI Coach suggested replacement to the talking point.
   * Only allowed when there are no pending collaborator changes for that talking point.
   * Works with ephemeral suggestions (no DB persistence).
   */
  const handleAcceptAiSuggestion = async (suggestion: AiSuggestion) => {
    if (suggestion.suggested_change == null || !bookId || !onOutlineUpdate) return;

    const tpId = suggestion.talking_point_id;

    // Block if there are pending collaborator changes - must accept/reject those first
    const pendingForTp = contentChanges.filter(
      (c) => c.talking_point === tpId && (!c.status || c.status === "pending")
    );
    if (pendingForTp.length > 0) {
      // Navigate to section containing this talking point, open changes tab, notify user
      let targetChapterId: number | null = null;
      let targetSectionId: number | null = null;
      let targetSectionTitle: string | null = null;
      if (outline?.chapters) {
        for (const ch of outline.chapters) {
          for (const sec of ch.sections || []) {
            for (const tp of sec.talking_points || []) {
              if (tp.id === tpId) {
                targetChapterId = ch.id ?? null;
                targetSectionId = sec.id ?? null;
                targetSectionTitle = sec.title;
                break;
              }
            }
            if (targetSectionId) break;
          }
          if (targetSectionId) break;
        }
      }
      if (targetChapterId && targetSectionId && targetSectionTitle && selectedItem?.sectionId !== targetSectionId) {
        handleSectionClick(targetChapterId, targetSectionId, targetSectionTitle);
      }
      setCurrentTalkingPointId(tpId);
      setFocusedChangeTpId(tpId);
      setHighlightPreviewMode("collaborators");
      setActiveRightView("changes");
      notification.info(
        "This talking point has pending suggestions from collaborators. Please accept or reject those changes first before applying AI Coach suggestions.\n\nOpening the Changes tab.",
        { duration: 8000 }
      );
      return;
    }

    const anchorRaw = (suggestion.anchor || "").trim();
    if (!anchorRaw) return;
    // Use plain text for matching - anchor from AI may be HTML but ProseMirror doc has text only
    const anchor = htmlToPlainTextForMatching(anchorRaw) || anchorRaw;

    // Navigate to the section containing this talking point if not already there
    let targetChapterId: number | null = null;
    let targetSectionId: number | null = null;
    let targetSectionTitle: string | null = null;
    if (outline?.chapters) {
      for (const ch of outline.chapters) {
        for (const sec of ch.sections || []) {
          for (const tp of sec.talking_points || []) {
            if (tp.id === tpId) {
              targetChapterId = ch.id ?? null;
              targetSectionId = sec.id ?? null;
              targetSectionTitle = sec.title;
              break;
            }
          }
          if (targetSectionId) break;
        }
        if (targetSectionId) break;
      }
    }
    if (targetChapterId && targetSectionId && targetSectionTitle && selectedItem?.sectionId !== targetSectionId) {
      handleSectionClick(targetChapterId, targetSectionId, targetSectionTitle);
    }
    setCurrentTalkingPointId(tpId);

    // Wait for the section to render and editor to be available
    await new Promise((r) => setTimeout(r, 350));

    const editorRef = editorRefs.current[tpId]?.current;
    if (!editorRef) {
      notification.error("Could not find the editor. Please try again.");
      return;
    }

    // Use ProseMirror doc to find the anchor (handles whitespace; anchor is normalized to plain text)
    const range = findTextRangeNormalized(editorRef.state.doc as any, anchor);
    if (!range) {
      notification.error(
        "Could not find the text to replace. It may have been edited already, or the suggestion may not match the current content."
      );
      return;
    }

    try {
      // Replace at document level - insertContentAt with range replaces the span
      editorRef.chain().focus().insertContentAt({ from: range.from, to: range.to }, suggestion.suggested_change).run();
      const modifiedContent = editorRef.getHTML();
      handleTpContentChange(tpId, modifiedContent);

      const res = await updateTalkingPoint(tpId, { content: modifiedContent });
      if (res.success) {
        const updatedBook = await fetchBook(bookId);
        if (updatedBook.success) onOutlineUpdate(updatedBook.data);
        setDismissedAiSuggestions((prev) => new Set([...prev, suggestionKey(suggestion)]));
      } else {
        notification.error(res.error || "Failed to save changes.");
      }
    } catch (error) {
      console.error("Error applying AI suggestion:", error);
      notification.error("Failed to apply suggestion.");
    }
  };

  /**
   * handleSuggestEdit - Creates a suggestion from captured ProseMirror steps
   * 
   * HARD CONSTRAINTS:
   * - Uses window.__CAPTURED_STEPS__ (steps captured by StepCaptureExtension)
   * - Sends ONLY step_json to backend (array of step.toJSON() objects)
   * - NO text extraction, NO position calculations, NO diffs
   */
  const handleSuggestEdit = async (tpId: number) => {
    if (!tpId || isBookOwner || !bookId) return;

    // FIX: Get captured steps for this specific talking point only
    const capturedSteps = (window as any).__CAPTURED_STEPS_BY_TP__?.[tpId];

    if (!capturedSteps || capturedSteps.length === 0) {
      notification.info("No changes detected. Please make some edits in the editor first, then click Suggest Edit.");
      return;
    }

    // Get the original canonical content BEFORE creating the change
    const originalContent = originalContents[tpId] || "";
    console.log(`[handleSuggestEdit] originalContents keys:`, Object.keys(originalContents));
    console.log(`[handleSuggestEdit] originalContent for tpId=${tpId}:`, originalContent ? `"${originalContent.substring(0, 80)}..."` : "EMPTY");

    if (!originalContent) {
      console.error(`[handleSuggestEdit] No original content stored for tpId=${tpId}! Cannot reset editor.`);
    }

    // Get the editor to compress steps
    const editorRef = editorRefs.current[tpId]?.current;

    // Compress steps to get the NET change(s)
    // This handles cases like typing "carm" → backspace → "cart" = just "insert 'cart'"
    // Also detects MULTIPLE separate changes and creates separate steps for each
    let stepsToSubmit = capturedSteps;
    if (editorRef && originalContent && capturedSteps.length > 0) {
      try {
        // Parse the original HTML to get a ProseMirror document for proper position mapping
        const { DOMParser } = await import('prosemirror-model');
        const schema = editorRef.state.schema;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = originalContent;
        const originalDoc = DOMParser.fromSchema(schema).parse(tempDiv);

        // Get text content from both
        const originalText = originalDoc.textContent;
        const finalText = editorRef.state.doc.textContent;

        console.log(`[handleSuggestEdit] Compressing: original="${originalText.substring(0, 50)}...", final="${finalText.substring(0, 50)}..."`);

        // No net change: user deleted and retyped the same text (e.g. "Projects" → delete → "Projects")
        const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim();
        if (norm(originalText) === norm(finalText)) {
          (window as any).__CAPTURED_STEPS_BY_TP__[tpId] = [];
          notification.info("No changes to suggest. The text is the same as before your edits.");
          return;
        }

        // If texts are the same, no change needed (legacy check - now handled above)
        if (originalText !== finalText) {
          // Multi-hunk diff algorithm to detect SEPARATE edit regions
          // This properly handles "add here, delete there" scenarios
          type Hunk = { origStart: number; origEnd: number; finalStart: number; finalEnd: number; deleted: string; inserted: string };
          const hunks: Hunk[] = [];

          // Use higher MIN_MATCH to avoid spurious matches (e.g. "ment" in "implement" matching "requitment")
          const MIN_MATCH = 12;
          // When change is large (length differs by >30%), use single hunk - avoid wrong sync points from coincidental substrings
          const lenRatio = Math.abs(originalText.length - finalText.length) / Math.max(1, Math.max(originalText.length, finalText.length));
          const useSingleHunk = lenRatio > 0.3;

          let origIdx = 0;
          let finalIdx = 0;

          while (origIdx < originalText.length || finalIdx < finalText.length) {
            // Skip matching characters
            while (
              origIdx < originalText.length &&
              finalIdx < finalText.length &&
              originalText[origIdx] === finalText[finalIdx]
            ) {
              origIdx++;
              finalIdx++;
            }

            // If we've consumed both strings, we're done
            if (origIdx >= originalText.length && finalIdx >= finalText.length) {
              break;
            }

            // Found a difference - find sync point
            // PREFER sync at START of final (smallest searchFinal): the kept content begins there.
            // This avoids both (a) under-delete: matching "away from your body" in deleted para,
            // and (b) over-delete: matching it in kept para - we sync at "It's crucial to cut" instead.
            const hunkOrigStart = origIdx;
            const hunkFinalStart = finalIdx;

            let bestOrigEnd = originalText.length;
            let bestFinalEnd = finalText.length;
            let bestMatchLen = 0;
            let bestSearchFinal = Infinity;

            // When change is large, skip sync search - treat as single replacement (avoids wrong matches like "ment")
            if (!useSingleHunk) {
              const searchLimitOrig = originalText.length;
              const searchLimitFinal = finalText.length;

              for (let searchOrig = origIdx; searchOrig <= searchLimitOrig - MIN_MATCH; searchOrig++) {
                for (let searchFinal = finalIdx; searchFinal <= searchLimitFinal - MIN_MATCH; searchFinal++) {
                  let matchLen = 0;
                  while (
                    searchOrig + matchLen < originalText.length &&
                    searchFinal + matchLen < finalText.length &&
                    originalText[searchOrig + matchLen] === finalText[searchFinal + matchLen]
                  ) {
                    matchLen++;
                  }
                  if (matchLen >= MIN_MATCH) {
                    // Prefer sync at START of final (kept content): smallest searchFinal
                    // When same phrase appears in deleted and kept, pick the one at boundary
                    if (searchFinal < bestSearchFinal || (searchFinal === bestSearchFinal && matchLen > bestMatchLen)) {
                      bestSearchFinal = searchFinal;
                      bestMatchLen = matchLen;
                      bestOrigEnd = searchOrig;
                      bestFinalEnd = searchFinal;
                    }
                  }
                }
              }
            }

            const foundMatch = !useSingleHunk && bestMatchLen >= MIN_MATCH;
            if (!foundMatch) {
              bestOrigEnd = originalText.length;
              bestFinalEnd = finalText.length;
            }

            // Avoid splitting a word at a shared boundary char (e.g. "approximate" vs "some" both have "e")
            // When sync lands on "e" in "e projects...", we get deleted="...appropiat", inserted="...som",
            // and "e" is treated as unchanged - wrong. Extend hunk to include the boundary letter in both.
            const isLetter = (c: string) => /[a-zA-Z]/.test(c);
            while (
              foundMatch &&
              bestOrigEnd < originalText.length &&
              bestFinalEnd < finalText.length &&
              bestMatchLen > MIN_MATCH &&
              isLetter(originalText[bestOrigEnd]) &&
              isLetter(finalText[bestFinalEnd - 1])
            ) {
              bestOrigEnd += 1;
              bestFinalEnd += 1;
              bestMatchLen -= 1;
            }

            // Create hunk for this change region
            const deleted = originalText.slice(hunkOrigStart, bestOrigEnd);
            const inserted = finalText.slice(hunkFinalStart, bestFinalEnd);

            if (deleted || inserted) {
              hunks.push({
                origStart: hunkOrigStart,
                origEnd: bestOrigEnd,
                finalStart: hunkFinalStart,
                finalEnd: bestFinalEnd,
                deleted,
                inserted,
              });
              console.log(`[handleSuggestEdit] Found hunk: origStart=${hunkOrigStart}, origEnd=${bestOrigEnd}, deleted="${deleted.substring(0, 30)}...", inserted="${inserted.substring(0, 30)}..."`);
            }

            // Move past this hunk
            origIdx = bestOrigEnd;
            finalIdx = bestFinalEnd;
          }

          console.log(`[handleSuggestEdit] Multi-hunk diff found ${hunks.length} separate changes`);

          if (hunks.length > 0) {
            // Helper to map text offset to ProseMirror position
            const textOffsetToDocPos = (textOffset: number): number => {
              let result = 1;
              let textSeen = 0;
              let found = false;

              originalDoc.descendants((node: any, pos: number) => {
                if (found) return false;
                if (node.isText) {
                  const nodeText = node.text || "";
                  const nodeStart = textSeen;
                  const nodeEnd = textSeen + nodeText.length;

                  if (textOffset >= nodeStart && textOffset < nodeEnd) {
                    result = pos + (textOffset - nodeStart);
                    found = true;
                    return false;
                  } else if (textOffset === nodeEnd) {
                    result = pos + nodeText.length;
                  }
                  textSeen = nodeEnd;
                }
                return true;
              });

              const docSize = originalDoc.content.size;
              return Math.max(1, Math.min(result, docSize));
            };

            // Create a step for EACH hunk (separate edit regions)
            const steps: any[] = [];

            // Process hunks in REVERSE order (from end to start) so positions don't shift
            // when we have multiple changes relative to original doc
            const sortedHunks = [...hunks].sort((a, b) => b.origStart - a.origStart);

            sortedHunks.forEach((hunk, idx) => {
              const from = textOffsetToDocPos(hunk.origStart);
              const to = textOffsetToDocPos(hunk.origEnd);

              console.log(`[handleSuggestEdit] Creating step ${idx + 1}/${sortedHunks.length}: from=${from}, to=${to}`);
              console.log(`  deleted="${(hunk.deleted || '').substring(0, 50)}..." (${(hunk.deleted || '').length} chars)`);
              console.log(`  inserted="${(hunk.inserted || '').substring(0, 50)}..." (${(hunk.inserted || '').length} chars)`);

              const step: any = {
                stepType: "replace",
                from: from,
                to: to,
              };

              if (hunk.inserted) {
                step.slice = { content: [{ type: "text", text: hunk.inserted }], openStart: 0, openEnd: 0 };
                step.insertedText = hunk.inserted;
              } else {
                // Deletion-only: empty slice required for valid ReplaceStep
                step.slice = { content: [], openStart: 0, openEnd: 0 };
              }

              if (hunk.deleted) {
                step.deletedText = hunk.deleted;
              }

              steps.push(step);
            });

            console.log(`[handleSuggestEdit] Created ${steps.length} steps from ${hunks.length} hunks`);
            stepsToSubmit = steps;
          }
        }
      } catch (e) {
        console.warn(`[handleSuggestEdit] Step compression failed, using original steps:`, e);
      }
    }

    try {
      const comment = (applyChangeComments[tpId] || "").trim() || undefined;
      const result = await createContentChange({
        talking_point_id: tpId,
        step_json: stepsToSubmit,
        comment,
      });

      if (result.success) {
        setApplyChangeComments((prev) => ({ ...prev, [tpId]: "" }));
        // Clear captured steps for this talking point after successful submission
        if ((window as any).__CAPTURED_STEPS_BY_TP__) {
          (window as any).__CAPTURED_STEPS_BY_TP__[tpId] = [];
        }

        // Reset hasUnsavedChanges for this talking point
        setHasUnsavedChanges((prev) => ({ ...prev, [tpId]: false }));

        // FIX: Set current talking point to ensure changes load correctly
        setCurrentTalkingPointId(tpId);

        // FIX: Reload changes for this specific talking point to show the new suggestion
        // For collaborators, explicitly load changes for this TP
        try {
          console.log("Reloading changes for tpId:", tpId);
          const changesResult = await getContentChanges(tpId);
          console.log("Changes result:", changesResult);
          if (changesResult.success && changesResult.data) {
            console.log(`Loaded ${changesResult.data.length} changes for tpId ${tpId}`);
            // Update contentChanges state to include the new suggestion
            setContentChanges((prev) => {
              // Remove any existing changes for this TP and add the new ones
              const filtered = prev.filter(c => c.talking_point !== tpId);
              const updated = [...filtered, ...changesResult.data];
              console.log(`Updated contentChanges: ${updated.length} total changes`);
              return updated;
            });

            // CRITICAL: Reset editor to base content AND dispatch decorations
            // Must do this AFTER state updates to ensure proper timing
            setTimeout(() => {
              const editorRefAfter = editorRefs.current[tpId]?.current;
              if (editorRefAfter && originalContent) {
                console.log(`[handleSuggestEdit] Resetting editor content to original`);
                console.log(`[handleSuggestEdit] originalContent: "${originalContent.substring(0, 100)}..."`);
                console.log(`[handleSuggestEdit] Current editor content: "${editorRefAfter.getHTML?.().substring(0, 100)}..."`);

                // Set flag to prevent step capture
                (editorRefAfter as any).__isProgrammaticUpdate = true;

                // Reset to original content
                editorRefAfter.commands.setContent(originalContent, false, { preserveWhitespace: 'full' });

                // After a small delay, dispatch decorations
                setTimeout(() => {
                  (editorRefAfter as any).__isProgrammaticUpdate = false;
                  console.log(`[handleSuggestEdit] Content after reset: "${editorRefAfter.getHTML?.().substring(0, 100)}..."`);

                  // Get ALL pending changes for this talking point (not just the new one)
                  // to show all pending decorations together
                  const pendingChanges = changesResult.data
                    .filter((c: any) => c.talking_point === tpId && (!c.status || c.status === "pending"))
                    .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

                  if (pendingChanges.length > 0) {
                    // CRITICAL: Pass as batches (array of arrays) - each content change is a batch
                    const stepBatches = pendingChanges.map((c: any) =>
                      Array.isArray(c.step_json) ? c.step_json : [c.step_json]
                    );
                    const totalSteps = stepBatches.reduce((sum: number, batch: any[]) => sum + batch.length, 0);
                    console.log(`[handleSuggestEdit] Dispatching ${totalSteps} steps in ${stepBatches.length} batches for decoration`);
                    const tr = editorRefAfter.state.tr.setMeta(pendingShadowHighlightKey, stepBatches);
                    editorRefAfter.view.dispatch(tr);
                  }
                }, 50);
              }
            }, 100);
          } else {
            console.error("Failed to load changes:", changesResult);
            // Fallback to full reload
            await loadChanges();
          }
        } catch (error) {
          console.error("Error reloading changes:", error);
          // Fallback to full reload
          await loadChanges();
        }

        // Open the changes tab after creating suggestion
        setHighlightPreviewMode("collaborators");
        setActiveRightView("changes");
      } else {
        console.error("❌ Failed to create suggestion:", result);
        notification.error("Failed to create suggestion. Please try again.");
      }
    } catch (error) {
      console.error("Error suggesting edit:", error);
      notification.error("Error creating suggestion. Please try again.");
    }
  };

  /**
   * handleCreateEditSuggest - Collaborator select-text flow: build replace step from modal and submit
   */
  const handleCreateEditSuggest = async () => {
    if (!createEditTpId || createEditFrom < 0 || createEditTo <= createEditFrom) return;
    const editor = createEditEditorRef.current;
    if (!editor) return;
    setIsSubmittingCreateEdit(true);
    try {
      const html = editor.getHTML();
      let sliceJson: { content: any[]; openStart: number; openEnd: number };
      const plainText = htmlToPlainTextForMatching(html).trim();
      if (plainText) {
        try {
          const dom = document.createElement("div");
          dom.innerHTML = html;
          const slice = PMDOMParser.fromSchema(editor.schema).parseSlice(dom);
          sliceJson = slice.toJSON();
          // Use open slice (openStart=1, openEnd=1) so the content can merge when replacing
          // within a block (e.g. a word in a paragraph). Without this, we get "Inserted content
          // deeper than insertion position" because a closed slice assumes block-level insertion.
          sliceJson.openStart = 1;
          sliceJson.openEnd = 1;
        } catch {
          sliceJson = { content: [{ type: "paragraph", content: [{ type: "text", text: plainText }] }], openStart: 1, openEnd: 1 };
        }
      } else {
        sliceJson = { content: [], openStart: 0, openEnd: 0 };
      }
      const step: any = {
        stepType: "replace",
        from: createEditFrom,
        to: createEditTo,
        deletedText: createEditOriginalText,
        insertedText: plainText || undefined,
        slice: sliceJson,
      };
      const result = await createContentChange({
        talking_point_id: createEditTpId,
        step_json: [step],
      });
      if (result.success) {
        setCreateEditModalOpen(false);
        setCreateEditInitialContent("");
        setCreateEditTpId(null);
        setCreateEditFrom(0);
        setCreateEditTo(0);
        setCreateEditOriginalText("");
        setSelectedText("");
        setSelectedHtml("");
        setSelectionPosition(null);
        setSelectionRange(null);
        if (window.getSelection) window.getSelection()?.removeAllRanges();
        setCurrentTalkingPointId(createEditTpId);
        try {
          const changesResult = await getContentChanges(createEditTpId);
          if (changesResult.success && changesResult.data) {
            setContentChanges((prev) => {
              const filtered = prev.filter((c) => c.talking_point !== createEditTpId);
              return [...filtered, ...changesResult.data];
            });
          }
        } catch (_) {}
        setHighlightPreviewMode("collaborators");
        setActiveRightView("changes");
        notification.success("Suggestion submitted. The author can approve or reject it.");
      } else {
        notification.error("Failed to submit suggestion. Please try again.");
      }
    } catch (error) {
      console.error("Error submitting create edit:", error);
      notification.error("Error submitting suggestion. Please try again.");
    } finally {
      setIsSubmittingCreateEdit(false);
    }
  };

  /**
   * handleApproveChange - Applies approved suggestion using ProseMirror steps
   * 
   * HARD CONSTRAINTS:
   * - Deserializes steps using parseSteps(schema, stepJson[])
   * - Applies all steps in a SINGLE transaction
   * - NEVER calls setContent, getHTML, or rehydrates editor
   * - Editor content is NEVER reset
   */
  const handleApproveChange = async (change: ContentChange) => {
    if (!bookId || !onOutlineUpdate) return;

    // FIX: Prevent double application - check if already approved
    if (change.status === "approved") {
      notification.info("This suggestion has already been approved.");
      return;
    }

    const changeTpId = change.talking_point;
    const stepJsonArray = change.step_json;

    if (!stepJsonArray || !Array.isArray(stepJsonArray) || stepJsonArray.length === 0) {
      console.error("❌ No step_json found - this suggestion cannot be applied");
      notification.error("This suggestion cannot be applied - no step data available.");
      return;
    }

    if (isBookOwner && change.status === "pending") {
      const oldestPendingId = getOldestPendingChangeId(change.talking_point);
      if (oldestPendingId && change.id !== oldestPendingId) {
        notification.info("Please approve earlier changes for this talking point first.");
        return;
      }
    }

    try {
      const editorRef = editorRefs.current[changeTpId]?.current;
      if (!editorRef) {
        console.error("❌ Editor not found for talking point:", changeTpId);
        notification.error("Editor not found. Please refresh the page.");
        return;
      }

      // CRITICAL: Apply steps using ProseMirror transactions
      // Steps must be applied in a single transaction, sequentially
      // Each step sees the document state after previous steps are applied
      const { state, view } = editorRef;

      // Ensure we have a valid document state
      if (!state || !state.doc) {
        console.error("❌ Invalid editor state");
        notification.error("Editor state is invalid. Please refresh the page.");
        return;
      }

      // Ensure we are applying against the correct base document to avoid invalid steps
      const baseDocJson = (change as any).base_doc_json || (change as any).base_doc;
      if (baseDocJson) {
        try {
          const baseDoc = PMNode.fromJSON(state.schema, baseDocJson);
          if (!baseDoc.eq(state.doc)) {
            notification.warning(
              "This suggestion was created on an older version of the document. Please refresh to rebase before approving."
            );
            return;
          }
        } catch (error) {
          console.warn("[Approve] Invalid base_doc_json; cannot safely apply steps.", error);
          notification.error("This suggestion cannot be applied safely. Please refresh and try again.");
          return;
        }
      }

      // Create transaction from current state
      let tr = state.tr;

      console.log(`[handleApproveChange] Raw stepJsonArray:`, JSON.stringify(stepJsonArray, null, 2));

      const steps = parseSteps(state.schema, stepJsonArray);
      console.log(`[handleApproveChange] Parsed ${steps.length} steps from ${stepJsonArray.length} raw steps`);

      if (steps.length !== stepJsonArray.length) {
        console.error(`[handleApproveChange] Step parsing mismatch! Raw: ${stepJsonArray.length}, Parsed: ${steps.length}`);
        console.error(`[handleApproveChange] Failed to parse some steps. Check step format.`);
        throw new Error("One or more steps could not be parsed.");
      }

      // Validate and apply steps sequentially against the live transaction
      // IMPORTANT: Use step.map(tr.mapping) to adjust positions after each step
      let tempDoc = tr.doc;
      console.log(`[handleApproveChange] Initial doc size: ${tempDoc.content.size}`);
      console.log(`[handleApproveChange] Initial doc text: "${tempDoc.textContent.substring(0, 100)}..."`);

      for (let i = 0; i < steps.length; i++) {
        const originalStep = steps[i];
        const stepAny = originalStep as any;

        console.log(`[handleApproveChange] Applying step ${i + 1}/${steps.length}:`);
        console.log(`  original: from=${stepAny.from}, to=${stepAny.to}`);
        console.log(`  deletedText="${stepAny.deletedText || ''}", insertedText="${stepAny.insertedText || ''}"`);
        console.log(`  slice size=${stepAny.slice?.size || 0}`);
        console.log(`  current doc size=${tempDoc.content.size}`);

        try {
          // Map the step through the current transaction mapping
          // This adjusts positions based on previous steps in the same transaction
          const mappedStep = originalStep.map(tr.mapping);

          if (!mappedStep) {
            // Step's target content was deleted by a previous step - skip it
            console.log(`  Step ${i + 1} mapping returned null - content was deleted, skipping`);
            continue;
          }

          const mappedAny = mappedStep as any;
          console.log(`  mapped: from=${mappedAny.from}, to=${mappedAny.to}`);

          if (typeof mappedAny.from === "number" && typeof mappedAny.to === "number") {
            const docSize = tempDoc.content.size;
            if (mappedAny.from < 0 || mappedAny.to < 0 || mappedAny.from > docSize || mappedAny.to > docSize) {
              console.error(`Step ${i + 1} out of bounds after mapping! from=${mappedAny.from}, to=${mappedAny.to}, docSize=${docSize}`);
              notification.error("Change incompatible");
              return;
            }
          }

          const testResult = mappedStep.apply(tempDoc);
          if (testResult.failed || !testResult.doc) {
            console.error(`Step ${i + 1} apply failed: ${testResult.failed}`);
            throw new Error(`Step ${i + 1} validation failed: ${testResult.failed || "apply_failed"}`);
          }

          console.log(`  ✓ Step ${i + 1} applied successfully. New doc size: ${testResult.doc.content.size}`);
          console.log(`  New doc text: "${testResult.doc.textContent.substring(0, 100)}..."`);

          const stepResult = tr.step(mappedStep);
          if (stepResult === null) {
            console.error(`Step ${i + 1} tr.step returned null`);
            notification.error("Change incompatible");
            return;
          }

          tr = stepResult;
          tempDoc = testResult.doc;
        } catch (error: any) {
          console.error("❌ Error applying step:", error);
          console.error("Step index:", i, "Total steps:", steps.length);
          console.error("Current document size:", tempDoc.content.size);
          console.error("Step JSON:", JSON.stringify(stepJsonArray[i], null, 2));
          notification.error(`Change incompatible: ${error?.message || "validation failed"}`);
          return;
        }
      }

      // Dispatch the transaction with all steps applied
      // This updates the editor WITHOUT resetting content
      view.dispatch(tr);

      // Mark that we just applied steps to prevent content sync effect from resetting
      // Store a flag in the editor instance to skip setContent in the sync effect
      (editorRef as any).__stepsJustApplied = true;

      // FIX: After applying steps, save the updated content to the database
      // Get the updated HTML from the editor after steps are applied
      const updatedContent = editorRef.getHTML();

      console.log(`[handleApproveChange] Saving updated content for tpId=${changeTpId}:`);
      console.log(`[handleApproveChange] Content (first 200 chars): "${updatedContent.substring(0, 200)}..."`);
      console.log(`[handleApproveChange] Content length: ${updatedContent.length}`);

      // Update the talking point content in the database
      const saveResult = await updateTalkingPoint(changeTpId, { content: updatedContent });
      console.log(`[handleApproveChange] Save result:`, saveResult);

      if (!saveResult.success) {
        console.error("Failed to save updated content:", saveResult);
        notification.error("Steps were applied but failed to save content. Please refresh and try again.");
        (editorRef as any).__stepsJustApplied = false;
        return;
      }

      // Clear the flag after a delay to allow content sync to resume
      setTimeout(() => {
        (editorRef as any).__stepsJustApplied = false;
      }, 1000);

      // Approve the change in backend (status change only - backend never touches content)
      const result = await approveContentChange(change.id);
      if (result.success) {
        console.log("✅ Change approved, applied, and saved");

        // CRITICAL: Remap positions of OTHER pending changes for this talking point
        // The approved change shifted the document, so other changes' positions are now stale
        const otherPendingChanges = contentChanges.filter(
          (c) => c.talking_point === changeTpId &&
            c.id !== change.id &&
            (!c.status || c.status === "pending")
        );

        if (otherPendingChanges.length > 0 && tr.mapping) {
          console.log(`[handleApproveChange] Remapping ${otherPendingChanges.length} other pending changes`);

          for (const otherChange of otherPendingChanges) {
            try {
              const otherStepJson = otherChange.step_json;
              if (!otherStepJson || !Array.isArray(otherStepJson)) continue;

              // Map each step's positions through the applied transaction's mapping
              const remappedSteps = otherStepJson.map((rawStep: any) => {
                if (!rawStep || typeof rawStep.from !== "number" || typeof rawStep.to !== "number") {
                  return rawStep;
                }

                // Map positions: -1 for left association on 'from', 1 for right association on 'to'
                const newFrom = tr.mapping.map(rawStep.from, -1);
                const newTo = tr.mapping.map(rawStep.to, 1);

                console.log(`[handleApproveChange] Remapping change ${otherChange.id}: ${rawStep.from}-${rawStep.to} -> ${newFrom}-${newTo}`);

                return {
                  ...rawStep,
                  from: newFrom,
                  to: newTo,
                };
              });

              // Update the change on the server with remapped positions
              const updateResult = await updateContentChangeStepJson(otherChange.id, remappedSteps);
              if (updateResult.success) {
                console.log(`[handleApproveChange] Successfully remapped change ${otherChange.id}`);
              } else {
                console.error(`[handleApproveChange] Failed to remap change ${otherChange.id}:`, updateResult);
              }
            } catch (remapError) {
              console.error(`[handleApproveChange] Error remapping change ${otherChange.id}:`, remapError);
            }
          }
        }

        // Reload changes to update UI
        console.log(`[handleApproveChange] Reloading changes after position remapping...`);
        await loadChanges();
        console.log(`[handleApproveChange] Changes reloaded`);

        // Force decoration refresh after state update
        // Use setTimeout to ensure React has processed the state update
        setTimeout(async () => {
          const editorRefNow = editorRefs.current[changeTpId]?.current;
          if (editorRefNow) {
            // Fetch fresh changes from server to get updated positions
            const freshChangesResult = await getContentChanges(changeTpId);
            if (freshChangesResult.success && freshChangesResult.data) {
              const freshPendingChanges = freshChangesResult.data
                .filter((c: any) => c.id !== change.id && (!c.status || c.status === "pending"))
                .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

              if (freshPendingChanges.length > 0) {
                const nextPending = freshPendingChanges[0];
                console.log(`[handleApproveChange] Dispatching decorations for next pending change ${nextPending.id}`);
                console.log(`[handleApproveChange] Updated step_json positions:`, JSON.stringify(nextPending.step_json));
                const tr = editorRefNow.state.tr.setMeta(pendingStepPreviewKey, nextPending.step_json);
                editorRefNow.view.dispatch(tr);
              } else {
                // Clear decorations if no more pending changes
                console.log(`[handleApproveChange] No more pending changes, clearing decorations`);
                const tr = editorRefNow.state.tr.setMeta(pendingStepPreviewKey, null);
                editorRefNow.view.dispatch(tr);
              }
            }
          }
        }, 100);

        // Reload book outline to get the updated content
        if (bookId && onOutlineUpdate) {
          const updatedBook = await fetchBook(bookId);
          if (updatedBook.success) {
            onOutlineUpdate(updatedBook.data);
          }
        }
      } else {
        console.error("Failed to approve change:", result);
        notification.warning("Steps were applied and saved, but failed to update approval status. Please refresh the page.");
      }
    } catch (error) {
      console.error("❌ Error applying change:", error);
      notification.error("Error applying change. Please try again.");
    }
  };





  // Store original content when collaborator starts editing a section
  useEffect(() => {
    if (!isBookOwner && selectedSection?.talking_points) {
      const newOriginalContents: Record<number, string> = {};
      selectedSection.talking_points.forEach((tp) => {
        if (tp.id && !originalContents[tp.id]) {
          // Store the original content when first loaded
          const content = tp.content || (tp.text ? `<p>${tp.text}</p>` : "");
          newOriginalContents[tp.id] = content;
          console.log(`[originalContents] Storing original for tpId=${tp.id}: "${content.substring(0, 50)}..."`);
        }
      });
      if (Object.keys(newOriginalContents).length > 0) {
        setOriginalContents((prev) => ({ ...prev, ...newOriginalContents }));
      }
    }
  }, [selectedSection, isBookOwner]);


  const handleTpBlur = async (tpId: number) => {
    if (isBookOwner) {
      // Book owners: direct save
      const editorRef = editorRefs.current[tpId]?.current;
      if (editorRef && bookId) {
        const content = editorRef.getHTML();
        const res = await updateTalkingPoint(tpId, { content });
        if (res.success && onOutlineUpdate) {
          const updatedBook = await fetchBook(bookId);
          if (updatedBook.success) {
            onOutlineUpdate(updatedBook.data);
          }
        }
      }
      return;
    }

    // Owners: auto-submit as suggestion when leaving the field (collaborators use Create Edit only)
    const hasEdits = !!hasUnsavedChanges[tpId];
    const capturedStepsForTp = (window as any).__CAPTURED_STEPS_BY_TP__?.[tpId];
    const hasCapturedSteps = capturedStepsForTp && capturedStepsForTp.length > 0;
    if (isBookOwner && hasEdits && hasCapturedSteps && bookId) {
      await handleSuggestEdit(tpId);
    }
  };

  const handleOpenAssetsModal = (tpId?: number, chapterId?: number) => {
    if (tpId) {
      setCurrentTalkingPointId(tpId);
      setCurrentChapterId(null);
    } else if (chapterId) {
      setCurrentChapterId(chapterId);
      setCurrentTalkingPointId(null);
    }
    setAssetsModalOpen(true);
  };

  const handleAssetsGenerate = async (assetIds: number[]) => {
    if (!bookId) return;

    setSelectedAssetIds(assetIds);

    // If generating for a talking point
    if (currentTalkingPointId) {
      const tp = selectedSection?.talking_points?.find((t) => t.id === currentTalkingPointId);
      if (tp) {
        await handleGenerateText(currentTalkingPointId, tp.text || `Talking Point`, assetIds);
      }
    }
    // If generating for a chapter (create talking points)
    else if (currentChapterId) {
      await handleGenerateTalkingPointsFromChapter(currentChapterId, assetIds);
    }
  };

  const [browserSupportsSpeechRecognition, setBrowserSupportsSpeechRecognition] = useState(false);
  const [isListening, setIsListening] = useState(false);

  useEffect(() => {
    // Web Speech API requires secure context (HTTPS) in production
    const supports = SpeechRecognition.browserSupportsSpeechRecognition();
    const secure = typeof window !== 'undefined' && window.isSecureContext;
    setBrowserSupportsSpeechRecognition(supports && secure);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setChatInput(e.target.value);

    if (isListening) {
      SpeechRecognition.abortListening();
      setIsListening(false);
    }
  };
  
  



  const handleGenerateTalkingPointsFromChapter = async (chapterId: number, assetIds: number[]) => {
    if (!bookId || !outline) return;

    const chapter = outline.chapters?.find((ch) => ch.id === chapterId);
    if (!chapter) return;

    // Find the first section in the chapter (or create one if none exists)
    let targetSection = chapter.sections?.[0];

    // Create a section if none exists
    if (!targetSection || !targetSection.id) {
      try {
        const sectionResult = await createSection(chapterId, { title: `Section for ${chapter.title}` });
        if (sectionResult.success && sectionResult.data && onOutlineUpdate) {
          onOutlineUpdate(sectionResult.data);
          const updatedChapter = sectionResult.data.chapters?.find((ch: any) => ch.id === chapterId);
          targetSection = updatedChapter?.sections?.[0];
        } else {
          notification.error("Failed to create section. Please try again.");
          return;
        }
      } catch (error) {
        console.error("Error creating section:", error);
        notification.error("Failed to create section. Please try again.");
        return;
      }
    }

    if (!targetSection?.id) {
      notification.error("Could not find or create a section. Please try again.");
      return;
    }

    try {
      // Generate talking points based on chapter name and assets
      // This would typically call an AI endpoint to generate talking point suggestions
      // For now, we'll create a single talking point with the chapter name
      const talkingPointText = `Talking points for ${chapter.title}`;

      // Create a new talking point
      const result = await createTalkingPoint(targetSection.id, { text: talkingPointText });

      if (result.success && result.data && onOutlineUpdate) {
        // Update the outline
        onOutlineUpdate(result.data);

        // Find the newly created talking point and generate content for it
        const updatedChapter = result.data.chapters?.find((ch: any) => ch.id === chapterId);
        const updatedSection = updatedChapter?.sections?.find((sec: any) => sec.id === targetSection.id);
        const newTp = updatedSection?.talking_points?.find((tp: any) => tp.text === talkingPointText);

        if (newTp?.id) {
          // Generate content using the assets
          await handleGenerateText(newTp.id, talkingPointText, assetIds);
        }
      }
    } catch (error) {
      console.error("Error generating talking points from chapter:", error);
      notification.error("Failed to generate talking points. Please try again.");
    }
  };

  // Get selected text using multiple methods for cross-browser compatibility
  const getSelectedText = (): string => {
    if (window.getSelection) {
      return window.getSelection()?.toString() || "";
    }
    if (document.getSelection) {
      return document.getSelection()?.toString() || "";
    }
    if ((document as any).selection) {
      return (document as any).selection.createRange().text || "";
    }
    return "";
  };

  const handleAddToChat = (text: string) => {
    // Get the actual selected text from browser selection as fallback
    const browserSelectedText = getSelectedText().trim();
    const textToAdd = browserSelectedText || text.trim();

    if (!textToAdd) return;

    // Add selected text to chat input field
    setChatInput((prev) => {
      if (prev.trim()) {
        return `${prev}\n\nSelected text: "${textToAdd}"\n\n`;
      }
      return `Selected text: "${textToAdd}"\n\n`;
    });
    setActiveRightView("chat");

    // Clear browser selection
    if (window.getSelection) {
      window.getSelection()?.removeAllRanges();
    }

    // Focus on chat input
    setTimeout(() => {
      if (chatInputRef.current) {
        chatInputRef.current.focus();
        // Move cursor to end
        const length = chatInputRef.current.value.length;
        chatInputRef.current.setSelectionRange(length, length);
      }
    }, 100);
  };

  const handleSendChatMessage = async (applyChanges = false) => {
    SpeechRecognition.abortListening();
    // Use the currently visible talking point if no specific one is set
    const activeTpId = currentTalkingPointId || (selectedSection?.talking_points?.[0]?.id ?? null);
    if (!chatInput.trim() || !bookId || !activeTpId || isChatLoading) return;

    const userMessage = chatInput.trim();

    // Extract highlighted text from message if it contains "Selected text:"
    let highlightedText = selectedText || undefined;
    const selectedTextMatch = userMessage.match(/Selected text: "([^"]+)"/);
    if (selectedTextMatch && selectedTextMatch[1]) {
      highlightedText = selectedTextMatch[1];
    }

    setChatInput("");
    setChatMessages((prev) => [...prev, { from: "user", text: userMessage, highlightedText }]);
    setIsChatLoading(true);

    try {
      const result = await chatWithChanges({
        book_id: bookId,
        talking_point_id: activeTpId,
        question: userMessage,
        highlighted_text: highlightedText,
        apply_changes: applyChanges,
      });

      if (result.success && result.data.response) {
        setChatMessages((prev) => [...prev, { from: "ai", text: result.data.response }]);

        // If changes were applied, reload the content
        if (applyChanges && result.data.applied_changes && onOutlineUpdate) {
          const updatedBook = await fetchBook(bookId);
          if (updatedBook.success) {
            onOutlineUpdate(updatedBook.data);
            // Reload talking point content
            if (updatedBook.data && selectedItem) {
              // Canonical updates will flow through onOutlineUpdate; editor owns live state
            }
          }
        }
      } else {
        setChatMessages((prev) => [
          ...prev,
          { from: "ai", text: "Sorry, I couldn't generate a response. Please try again." },
        ]);
      }
    } catch (error) {
      console.error("Error sending chat message:", error);
      setChatMessages((prev) => [
        ...prev,
        { from: "ai", text: "An error occurred. Please try again." },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleAddComment = async () => {
    // Viewers cannot add comments
    if (collaboratorRole === "viewer") {
      notification.info("Viewers cannot add comments. Please ask the book owner to change your role.");
      return;
    }

    const activeTpId = currentTalkingPointId || (selectedSection?.talking_points?.[0]?.id ?? null);
    if (!newCommentText.trim() || !activeTpId || isAddingComment) return;

    setIsAddingComment(true);
    try {
      const result = await createComment({
        talking_point_id: activeTpId,
        text: newCommentText.trim(),
        comment_type: "user",
      });

      if (result.success && result.data) {
        // Reload all comments to get updated structure with replies
        const activeTpId = currentTalkingPointId || (selectedSection?.talking_points?.[0]?.id ?? null);
        if (activeTpId) {
          const commentsResult = await getComments(activeTpId);
          if (commentsResult.success && commentsResult.data) {
            setComments(commentsResult.data);
          }
        }
        setNewCommentText("");
      }
    } catch (error) {
      console.error("Error adding comment:", error);
    } finally {
      setIsAddingComment(false);
    }
  };

  const handleAddReply = async (parentCommentId: number) => {
    const activeTpId = currentTalkingPointId || (selectedSection?.talking_points?.[0]?.id ?? null);
    const replyText = replyTexts[parentCommentId];
    if (!replyText?.trim() || !activeTpId || isAddingReply[parentCommentId]) return;

    setIsAddingReply((prev) => ({ ...prev, [parentCommentId]: true }));
    try {
      const result = await createComment({
        talking_point_id: activeTpId,
        text: replyText.trim(),
        comment_type: "user",
        parent_id: parentCommentId,
      });

      if (result.success && result.data) {
        // Reload all comments to get updated structure with replies
        const commentsResult = await getComments(activeTpId);
        if (commentsResult.success && commentsResult.data) {
          setComments(commentsResult.data);
        }
        setReplyTexts((prev) => ({ ...prev, [parentCommentId]: "" }));
        setReplyingToCommentId(null);
      }
    } catch (error) {
      console.error("Error adding reply:", error);
    } finally {
      setIsAddingReply((prev) => ({ ...prev, [parentCommentId]: false }));
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    try {
      const result = await deleteComment(commentId);
      if (result.success) {
        // Reload comments to get updated structure
        const activeTpId = currentTalkingPointId || (selectedSection?.talking_points?.[0]?.id ?? null);
        if (activeTpId) {
          const commentsResult = await getComments(activeTpId);
          if (commentsResult.success && commentsResult.data) {
            setComments(commentsResult.data);
          }
        }
      }
    } catch (error) {
      console.error("Error deleting comment:", error);
    }
  };

  // Helper function to find parent comment
  const findParentComment = (parentId: number | null | undefined): CommentType | null => {
    if (!parentId) return null;

    const findInComments = (commentList: CommentType[]): CommentType | null => {
      for (const comment of commentList) {
        if (comment.id === parentId) {
          return comment;
        }
        if (comment.replies && comment.replies.length > 0) {
          const found = findInComments(comment.replies);
          if (found) return found;
        }
      }
      return null;
    };

    return findInComments(comments);
  };

  // Recursive function to render a comment and its replies
  const renderComment = (comment: CommentType, depth: number = 0, parentComment?: CommentType) => {
    const isReplying = replyingToCommentId === comment.id;
    const replyText = replyTexts[comment.id] || "";
    const isAdding = isAddingReply[comment.id] || false;
    const isReply = !!comment.parent;
    const parent = parentComment || (comment.parent ? findParentComment(comment.parent) : null);
    const hasReplies = comment.replies && comment.replies.length > 0;
    const isExpanded = expandedReplies[comment.id] || false;
    const replyCount = comment.replies?.length || 0;

    return (
      <div key={comment.id} className={depth > 0 ? "mt-3 ml-6 border-l-2 border-blue-300 pl-3 relative" : ""}>
        {depth > 0 && (
          <div className="absolute -left-2 top-0 w-4 h-4 bg-blue-300 rounded-full border-2 border-white"></div>
        )}
        <div className={`bg-white rounded-lg p-3 text-sm ${isReply ? "border-l-4 border-blue-400" : ""}`}>
          {/* Reply indicator */}
          {isReply && (comment.parent_user_name || parent) && (
            <div className="mb-2 flex items-center gap-1.5 text-xs">
              <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              <span className="text-blue-600 font-medium bg-blue-50 px-2 py-0.5 rounded">
                Replying to <span className="font-semibold text-blue-700">
                  {comment.parent_user_name || (parent?.comment_type === "ai" ? "AI Coach Review" : parent?.user_name || "User")}
                </span>
              </span>
            </div>
          )}

          <div className="flex items-start gap-2 mb-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${comment.comment_type === "ai"
              ? "bg-[#CDF056]/20"
              : comment.comment_type === "collaborator"
                ? "bg-blue-500/20"
                : "bg-gray-200"
              }`}>
              {comment.comment_type === "ai" ? (
                <svg className="w-4 h-4 text-[#CDF056]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
              ) : (
                <span className={`text-xs font-semibold ${comment.comment_type === "collaborator" ? "text-blue-600" : "text-gray-600"
                  }`}>
                  {comment.user_name ? comment.user_name.substring(0, 2).toUpperCase() : "U"}
                </span>
              )}
            </div>
            <div className="flex-1">
              <div className="text-gray-900 font-semibold mb-1">
                {comment.comment_type === "ai"
                  ? "AI Coach Review"
                  : comment.user_name || "User"}
              </div>
              <div className="text-gray-500 text-xs">
                {new Date(comment.created_at).toLocaleDateString()} {new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
          <p className="text-gray-700 text-sm mt-2">{comment.text}</p>
          {comment.suggested_replacement && (
            <div className="mt-3 bg-gray-50 border border-gray-200 rounded p-2">
              <div className="text-xs font-semibold text-gray-600 mb-1">REPLACE WITH:</div>
              <p className="text-sm text-gray-700">{comment.suggested_replacement}</p>
            </div>
          )}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => {
                setReplyingToCommentId(isReplying ? null : comment.id);
                if (!isReplying) {
                  setReplyTexts((prev) => ({ ...prev, [comment.id]: "" }));
                }
              }}
              className="px-3 py-1 text-xs border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
            >
              {isReplying ? "Cancel" : "Reply"}
            </button>
            {hasReplies && (
              <button
                onClick={() => setExpandedReplies((prev) => ({ ...prev, [comment.id]: !prev[comment.id] }))}
                className="px-3 py-1 text-xs border border-gray-300 rounded text-gray-700 hover:bg-gray-50 flex items-center gap-1"
              >
                <svg
                  className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                Replies ({replyCount})
              </button>
            )}
            <button
              onClick={() => handleDeleteComment(comment.id)}
              className="w-6 h-6 rounded-full bg-gray-100 hover:bg-red-50 flex items-center justify-center"
            >
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {comment.suggested_replacement && (
              <button className="w-6 h-6 rounded-full bg-[#CDF056] hover:bg-[#3bc96d] flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </button>
            )}
          </div>

          {/* Reply Form */}
          {isReplying && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <textarea
                value={replyText}
                onChange={(e) => setReplyTexts((prev) => ({ ...prev, [comment.id]: e.target.value }))}
                placeholder="Write a reply..."
                className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-900 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#CDF056] resize-none"
                rows={2}
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => handleAddReply(comment.id)}
                  disabled={!replyText.trim() || isAdding}
                  className="px-3 py-1.5 bg-[#CDF056] text-white rounded-lg hover:bg-[#3bc96d] disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                >
                  {isAdding ? "Replying..." : "Reply"}
                </button>
                <button
                  onClick={() => {
                    setReplyingToCommentId(null);
                    setReplyTexts((prev) => ({ ...prev, [comment.id]: "" }));
                  }}
                  className="px-3 py-1.5 text-xs border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Render Replies - Only if expanded */}
          {hasReplies && isExpanded && comment.replies && (
            <div className="mt-3 space-y-3">
              {comment.replies.map((reply) => renderComment(reply, depth + 1, comment))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Load collaborators when bookId is available
  useEffect(() => {
    const loadCollaborators = async () => {
      if (bookId) {
        try {
          const result = await getBookCollaborators(bookId);
          if (result.success && result.data) {
            setCollaborators(result.data);
          }
        } catch (error) {
          console.error("Error loading collaborators:", error);
        }
      }
    };
    loadCollaborators();
  }, [bookId]);

  const handleInviteCollaborator = async () => {
    if (!inviteEmail.trim() || !bookId || isInviting) return;

    setIsInviting(true);
    try {
      const result = await inviteCollaborator({
        book_id: bookId,
        email: inviteEmail.trim(),
        role: inviteRole,
      });

      if (result.success && result.data) {
        setCollaborators((prev) => [...prev, result.data]);
        setInviteEmail("");
        setShowCollaboratorModal(false);
      }
    } catch (error) {
      console.error("Error inviting collaborator:", error);
    } finally {
      setIsInviting(false);
    }
  };




  const handleRemoveCollaborator = async (collaboratorId: number) => {
    if (!bookId) return;

    try {
      const result = await removeCollaborator(bookId, collaboratorId);
      if (result.success) {
        setCollaborators((prev) => prev.filter((c) => c.id !== collaboratorId));
      }
    } catch (error) {
      console.error("Error removing collaborator:", error);
    }
  };

  const handleUpdateCollaboratorRole = async (collaboratorId: number, newRole: "editor" | "viewer" | "commenter") => {
    if (!bookId) return;

    try {
      const result = await updateCollaboratorRole(bookId, collaboratorId, newRole);
      if (result.success && result.data) {
        setCollaborators((prev) =>
          prev.map((c) => (c.id === collaboratorId ? { ...c, role: newRole } : c))
        );
      }
    } catch (error) {
      console.error("Error updating collaborator role:", error);
      notification.error("Failed to update collaborator role. Please try again.");
    }
  };

  const handleQuickAction = async (action: "shorten" | "strengthen" | "clarify" | "expand" | "remove_repetition" | "regenerate" | "improve_flow" | "split_paragraph" | "turn_into_bullets" | "add_transition" | "rewrite_heading" | "suggest_subheading" | "give_example") => {
    // Only editors can perform quick actions
    if (!isBookOwner && collaboratorRole !== "editor") {
      notification.info("Only editors can perform this action. Please ask the book owner to change your role.");
      return;
    }

    // Actions that work on talking point level don't require selected text
    const talkingPointActions = ["rewrite_heading", "suggest_subheading"];
    const requiresSelection = !talkingPointActions.includes(action);

    if (requiresSelection && (!selectedText || !currentTalkingPointId || !bookId || isApplyingQuickAction)) return;
    if (!requiresSelection && (!currentTalkingPointId || !bookId || isApplyingQuickAction)) return;

    const activeTpId = currentTalkingPointId;
    setIsApplyingQuickAction(true);

    try {
      // For talking point level actions, use the entire content
      if (!activeTpId) return;

      const editorRef = editorRefs.current[activeTpId]?.current;
      const fullText = editorRef ? editorRef.getText() : "";
      const textToProcess = requiresSelection ? (selectedText || "") : fullText;

      const result = await quickTextAction({
        book_id: bookId!,
        talking_point_id: activeTpId,
        selected_text: textToProcess,
        action: action as "shorten" | "strengthen" | "clarify" | "expand" | "give_example",
      });

      if (result.success && result.data.modified_text && activeTpId) {
        // Strip quotation marks from the response
        let modifiedText = result.data.modified_text.trim();
        // Remove surrounding quotes if present
        if ((modifiedText.startsWith('"') && modifiedText.endsWith('"')) ||
          (modifiedText.startsWith("'") && modifiedText.endsWith("'"))) {
          modifiedText = modifiedText.slice(1, -1).trim();
        }

        const editorRef = editorRefs.current[activeTpId];
        const editor = editorRef?.current;

        // Actions that should prepend to content (headings)
        const prependActions = ["rewrite_heading", "suggest_subheading"];
        const shouldPrepend = prependActions.includes(action);

        const replaceEditorContent = (nextHtml: string) => {
          if (!editor) return;
          const docSize = editor.state.doc.content.size;
          editor
            .chain()
            .focus()
            .setTextSelection({ from: 0, to: docSize })
            .deleteSelection()
            .insertContent(nextHtml)
            .run();
        };

        if (requiresSelection && editor && selectionRange) {
          // Replace the selected text with the modified text using Tiptap commands
          editor
            .chain()
            .focus()
            .setTextSelection({ from: selectionRange.from, to: selectionRange.to })
            .deleteSelection()
            .insertContent(modifiedText)
            .run();
        } else if (editor && activeTpId) {
          // For talking point level actions or when no selection
          if (shouldPrepend) {
            // Prepend heading to the top of the content
            const currentContent = editor.getHTML() || "";
            const headingTag = action === "rewrite_heading" ? "h1" : "h2";
            const headingHtml = `<${headingTag}>${modifiedText}</${headingTag}>`;

            // If content already starts with a heading, replace it; otherwise prepend
            let newContent: string;
            if (currentContent.trim().match(/^<h[1-6]/)) {
              // Replace existing heading
              newContent = currentContent.replace(/^<h[1-6][^>]*>.*?<\/h[1-6]>/, headingHtml);
            } else {
              // Prepend new heading
              newContent = currentContent.trim() ? `${headingHtml}\n${currentContent}` : headingHtml;
            }

            replaceEditorContent(newContent);
            handleTpContentChange(activeTpId, newContent);
          } else if (requiresSelection && selectedText) {
            // Try to find and replace selected text
            const currentContent = editor.getHTML() || "";
            const textToReplace = selectedText.trim();

            const modifiedContent = currentContent.replace(
              new RegExp(textToReplace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
              modifiedText
            );

            replaceEditorContent(modifiedContent);
            handleTpContentChange(activeTpId, modifiedContent);
          } else {
            // Replace entire content (for other talking point level actions)
            replaceEditorContent(modifiedText);
            handleTpContentChange(activeTpId, modifiedText);
          }
        }

        // Clear selection only if we had one
        if (requiresSelection) {
          setSelectedText("");
          setSelectionPosition(null);
          setSelectionRange(null);
          if (window.getSelection) {
            window.getSelection()?.removeAllRanges();
          }
        }
      }
    } catch (error) {
      console.error("Error applying quick action:", error);
    } finally {
      setIsApplyingQuickAction(false);
    }
  };

  const handleGenerateText = async (tpId: number, tpName: string, assetIds: number[] = []) => {
    if (!bookId || !selectedItem) return;

    setGeneratingTpId(tpId);
    try {
      const result = await generateTextFromTalkingPoint({
        talking_point_id: tpId,
        talking_point_name: tpName,
        book_id: bookId,
        asset_ids: assetIds,
      });

      if (result.success && result.data.generated_text) {
        // Convert plain text to HTML for rich text editor
        const generatedText = result.data.generated_text;
        const htmlText = generatedText.split('\n\n').map((para: string) => `<p>${para.replace(/\n/g, '<br>')}</p>`).join('');
        const editorRef = editorRefs.current[tpId]?.current;
        if (editorRef) {
          const docSize = editorRef.state.doc.content.size;
          editorRef
            .chain()
            .focus()
            .setTextSelection({ from: 0, to: docSize })
            .deleteSelection()
            .insertContent(htmlText)
            .run();
        }

        // Auto-save the generated text to the content field (save as HTML)
        const res = await updateTalkingPoint(tpId, { content: htmlText });
        if (res.success && onOutlineUpdate) {
          const updatedBook = await fetchBook(bookId);
          if (updatedBook.success) {
            // Preserve the selected section when updating outline
            const currentSectionId = selectedItem?.sectionId;
            const currentChapterId = selectedItem?.chapterId;
            onOutlineUpdate(updatedBook.data);

            // Restore selection after update
            if (currentSectionId && currentChapterId) {
              const updatedSection = updatedBook.data.chapters
                ?.find((ch: any) => ch.id === currentChapterId)
                ?.sections?.find((sec: any) => sec.id === currentSectionId);
              if (updatedSection) {
                setSelectedItem({
                  type: "section",
                  chapterId: currentChapterId,
                  sectionId: currentSectionId,
                  sectionTitle: updatedSection.title,
                });
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Error generating text:", error);
    } finally {
      setGeneratingTpId(null);
    }
  };

  return (
    <div className="flex h-full bg-white relative">
      {/* Left Sidebar - Contents/Outline OR Chapter Assets (contained in same column) */}
      <div className="mt-13 w-64 flex flex-col border-r border-gray-200 overflow-hidden shrink-0 bg-[#011b2d]">
        {assetsModalOpen && currentChapterId && bookId && outline ? (() => {
          const chapter = outline.chapters?.find((ch) => ch.id === currentChapterId);
          return chapter ? (
            <ChapterAssetsPanel
              isOpen={assetsModalOpen}
              onClose={() => {
                setAssetsModalOpen(false);
                setCurrentChapterId(null);
              }}
              bookId={bookId}
              chapterId={currentChapterId}
              chapterTitle={chapter.title}
            />
          ) : null;
        })() : (
        <div className="flex-1 overflow-y-auto bg-[#011b2d]">
          <div className="p-4">
            <h3 className="text-sm font-semibold text-gray-400 mb-4">CONTENTS</h3>
          <hr className="border-gray-400" />
          <div className="space-y-1">
            {outline?.chapters?.map((chapter) => {
              const chapterId = chapter.id ?? -1;
              const isExpanded = expandedChapters[chapterId] ?? false;

              return (
                <div key={chapterId}>
                  <div className="flex items-center gap-2 w-full">
                    <button
                      onClick={() =>
                        setExpandedChapters((prev) => ({
                          ...prev,
                          [chapterId]: !prev[chapterId],
                        }))
                      }
                      className="shrink-0 p-1 text-white hover:bg-[#011b2d]/50 rounded"
                      title="Expand/collapse"
                    >
                      <svg
                        className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    {editingChapterId === chapterId && (isBookOwner || collaboratorRole === "editor") ? (
                      <textarea
                        value={editingChapterTitleValue}
                        onChange={(e) => setEditingChapterTitleValue(e.target.value)}
                        onBlur={handleChapterTitleSave}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleChapterTitleSave();
                          }
                          if (e.key === "Escape") {
                            setEditingChapterId(null);
                            setEditingChapterTitleValue(chapter.title || "");
                          }
                          e.stopPropagation();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                        rows={Math.max(2, Math.min(6, Math.ceil((editingChapterTitleValue.length || 1) / 28) + 1))}
                        className="flex-1 min-w-0 w-full px-2 py-1.5 text-sm font-semibold text-white bg-white/10 border border-white/30 rounded focus:outline-none focus:ring-1 focus:ring-[#CDF056] break-words resize-none overflow-y-auto leading-snug"
                      />
                    ) : (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isBookOwner || collaboratorRole === "editor") {
                            handleChapterTitleEditStart(chapterId, chapter.title || "");
                          }
                        }}
                        className={`flex-1 min-w-0 min-h-[2rem] px-2 py-1.5 text-sm font-semibold text-white hover:bg-[#011b2d]/50 rounded break-words select-none ${(isBookOwner || collaboratorRole === "editor") ? "cursor-text" : ""}`}
                        title={(isBookOwner || collaboratorRole === "editor") ? "Click to edit" : ""}
                      >
                        {chapter.title}
                      </span>
                    )}
                    {chapterId > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isBookOwner && collaboratorRole !== "editor") return;
                          handleOpenAssetsModal(undefined, chapterId);
                        }}
                        disabled={!isBookOwner && collaboratorRole !== "editor"}
                        className={`px-2 py-2 rounded transition-colors ${!isBookOwner && collaboratorRole !== "editor"
                          ? "text-gray-600 opacity-50 cursor-not-allowed"
                          : "text-gray-400 hover:text-white hover:bg-[#011b2d]/50"
                          }`}
                        title={!isBookOwner && collaboratorRole !== "editor" ? "Only editors can access assets" : "Chapter Assets"}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="ml-6 space-y-1">
                      {chapter.sections?.map((section, si) => {
                        const sectionId = section.id ?? -1;
                        const isSelected =
                          selectedItem?.type === "section" &&
                          selectedItem.sectionId === sectionId &&
                          selectedItem.chapterId === chapterId;

                        return (
                          <div
                            key={sectionId}
                            className={`w-full text-left px-3 py-2 text-sm text-white/70 hover:bg-[#CDF056]/5 flex items-center gap-2 ${isSelected ? "bg-[#CDF056]/10 border-l-2 border-[#CDF056]" : ""
                              }`}
                          >
                            <span className="text-xs text-gray-500 shrink-0">{si + 1}</span>
                            <button
                              onClick={() => handleSectionClick(chapterId, sectionId, section.title)}
                              className="flex-1 min-w-0 text-left truncate select-none bg-transparent border-none p-0 cursor-pointer text-inherit hover:bg-transparent"
                              title="Click to select"
                            >
                              {section.title}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </div>
        </div>
        )}
      </div>

      {/* Middle Editor Area */}
      <div className="flex-1 flex flex-col bg-white overflow-hidden mt-15">
        {selectedSection ? (
          <>
            {/* Editor Header */}
            <div className="border-b border-gray-200 px-6 py-4 bg-white shrink-0">
              <div className="flex items-center justify-between gap-3">
                {editingSectionId === selectedSection.id ? (
                  <input
                    value={editingSectionTitleValue}
                    onChange={(e) => setEditingSectionTitleValue(e.target.value)}
                    onBlur={handleSectionTitleSave}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSectionTitleSave();
                      }
                      if (e.key === "Escape") {
                        setEditingSectionId(null);
                        setEditingSectionTitleValue(selectedSection.title || "");
                      }
                    }}
                    autoFocus
                    className="flex-1 min-w-0 text-2xl font-bold text-gray-900 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-[#CDF056] focus:border-[#CDF056]"
                  />
                ) : (
                  <h2
                    onClick={() => {
                      if (isBookOwner || collaboratorRole === "editor") {
                        handleSectionTitleEditStart(selectedSection.id!, selectedSection.title || "");
                      }
                    }}
                    className={`flex-1 min-w-0 text-2xl font-bold text-gray-900 truncate ${(isBookOwner || collaboratorRole === "editor") ? "cursor-text hover:bg-gray-50 rounded px-1 -mx-1 select-none" : ""}`}
                    title={(isBookOwner || collaboratorRole === "editor") ? "Click to edit" : ""}
                  >
                    {selectedSection.title}
                  </h2>
                )}
                <div className="flex items-center gap-1 p-0.5 bg-gray-100 rounded-lg shrink-0">
                  <button
                    onClick={() => {
                      setHighlightPreviewMode("collaborators");
                      if (isBookOwner || collaboratorRole === "editor") setActiveRightView("changes");
                    }}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      highlightPreviewMode === "collaborators"
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                    title="Show collaborator suggestions in editor"
                  >
                    Collaborators
                  </button>
                  <button
                    onClick={() => {
                      setHighlightPreviewMode("ai");
                      if (isBookOwner || collaboratorRole === "editor") setActiveRightView("review");
                    }}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      highlightPreviewMode === "ai"
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                    title="Show AI Coach suggestions in editor"
                  >
                    AI Coach
                  </button>
                </div>
              </div>
            </div>

            {/* Editor Content */}
            <div className="flex-1 relative overflow-hidden  bg-gray-100 ">
              {/* Main Talking Points Area */}
              <div className="h-full overflow-y-auto p-8">
                <div className="max-w-3xl mx-auto space-y-6">
                  {selectedSection.talking_points?.map((tp, ti) => {
                    const tpId = tp.id ?? -1;
                    const canonicalContent = tp.content ?? (tp.text ? `<p>${tp.text}</p>` : "");
                    const content = canonicalContent;
                    const shadowSuggestions =
                      !isBookOwner && collaboratorRole === "editor"
                        ? contentChanges
                          .filter(
                            (change) =>
                              change.talking_point === tpId &&
                              (!change.status || change.status === "pending") &&
                              (currentUserId === null || change.user === currentUserId)
                          )
                          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                          .map((change) => ({ id: change.id, step_json: change.step_json }))
                        : [];
                    // Only show submitted pending changes - preview appears after "Suggest Edit" is clicked
                    // CRITICAL: Keep as batches (array of arrays) - each content change is relative to base doc
                    // Cumulative offset only applies WITHIN a batch, not BETWEEN batches
                    const pendingHighlightStepJsonsRaw = shadowSuggestions.map((s) =>
                      Array.isArray(s.step_json) ? s.step_json : [s.step_json]
                    );
                    const pendingHighlightStepJsons = highlightPreviewMode === "collaborators" ? pendingHighlightStepJsonsRaw : [];
                    const isGenerating = generatingTpId === tpId;
                    const hasPendingChanges = isBookOwner && contentChanges.some(
                      (change) => change.talking_point === tpId && (!change.status || change.status === "pending")
                    );
                    const previewChange = isBookOwner
                      ? (() => {
                        const oldestPendingId = getOldestPendingChangeId(tpId);
                        return contentChanges.find((c) => c.id === oldestPendingId) || null;
                      })()
                      : null;
                    const previewStepJson = highlightPreviewMode === "collaborators" && previewChange
                      ? (previewChange as any).step_json
                      : null;

                    return (
                      <div
                        key={tpId}
                        className="border border-gray-200 rounded-lg p-6 bg-white"
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-gray-700">
                              Talking Point {ti + 1}
                            </span>
                            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                              {content ? `${content.replace(/<[^>]*>/g, '').length} chars` : "Empty"}
                            </span>
                            {hasPendingChanges && (
                              <span className="text-xs text-yellow-700 bg-yellow-100 px-2 py-1 rounded">
                                Pending change
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!isBookOwner && collaboratorRole !== "editor") return;
                                handleOpenAssetsModal(tpId);
                              }}
                              disabled={!isBookOwner && collaboratorRole !== "editor"}
                              className={`px-3 py-1.5 text-sm border rounded-lg flex items-center gap-2 ${!isBookOwner && collaboratorRole !== "editor"
                                ? "border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed opacity-50"
                                : "border-gray-300 text-gray-700 hover:bg-gray-50"
                                }`}
                              title={!isBookOwner && collaboratorRole !== "editor" ? "Only editors can access assets" : "Add files for context"}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                              </svg>
                              <span>Assets</span>
                            </button>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!isBookOwner && collaboratorRole !== "editor") return;
                                handleGenerateText(tpId, tp.text || `Talking Point ${ti + 1}`, selectedAssetIds);
                              }}
                              disabled={isGenerating || !tp.text || (!isBookOwner && collaboratorRole !== "editor")}
                              className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-2 ${!isBookOwner && collaboratorRole !== "editor"
                                ? "bg-gray-300 text-gray-500 cursor-not-allowed opacity-50"
                                : "bg-[#CDF056] text-black  hover:bg-[#CDF056]/70 disabled:opacity-50 disabled:cursor-not-allowed"
                                }`}
                              title={!isBookOwner && collaboratorRole !== "editor" ? "Only editors can generate text" : "Generate Text"}
                            >
                              {isGenerating ? (
                                <>
                                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                  </svg>
                                  <span>Generating...</span>
                                </>
                              ) : (
                                <>
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                  </svg>
                                  <span>Generate Text</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        <div className="mb-4">
                          {editingTpTextId === tpId && (isBookOwner || collaboratorRole === "editor") ? (
                            <input
                              value={editingTpTextValue}
                              onChange={(e) => setEditingTpTextValue(e.target.value)}
                              onBlur={handleTpTextSave}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleTpTextSave();
                                }
                                if (e.key === "Escape") {
                                  setEditingTpTextId(null);
                                  setEditingTpTextValue(tp.text || `Talking Point ${ti + 1}`);
                                }
                              }}
                              autoFocus
                              className="w-full text-gray-900 font-semibold px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-[#CDF056] focus:border-[#CDF056]"
                              data-tp-id={tpId}
                            />
                          ) : (
                            <div
                              onClick={() => {
                                if (isBookOwner || collaboratorRole === "editor") {
                                  handleTpTextEditStart(tpId, tp.text || `Talking Point ${ti + 1}`);
                                }
                              }}
                              className={`text-gray-900 font-semibold ${(isBookOwner || collaboratorRole === "editor") ? "cursor-text hover:bg-gray-50 rounded px-1 -mx-1" : ""}`}
                              data-tp-id={tpId}
                              title={(isBookOwner || collaboratorRole === "editor") ? "Click to edit" : ""}
                            >
                              {tp.text || `Talking Point ${ti + 1}`}
                            </div>
                          )}
                        </div>

                        <div className="relative">
                          <TiptapEditor
                            key={`${tpId}-${canonicalContent?.length || 0}`}
                            content={content}
                            canonicalContent={canonicalContent}
                            onUpdate={(html) => {
                              handleTpContentChange(tpId, html);
                            }}
                            onBlur={() => {
                              handleTpBlur(tpId);
                            }}
                            placeholder="Start writing or click 'Generate Text' to create content from the talking point..."
                            onTextSelect={(text, position, range, html) => {
                              setSelectedText(text);
                              setSelectedHtml(html || "");
                              setSelectionPosition(position);
                              setSelectionRange(range || null);
                              // FIX: Track current talking point (steps are already tracked per TP)
                              setCurrentTalkingPointId(tpId);
                            }}
                            editorRef={(() => {
                              if (!editorRefs.current[tpId]) {
                                editorRefs.current[tpId] = { current: null };
                              }
                              return editorRefs.current[tpId];
                            })()}
                            isCollaborator={!isBookOwner && collaboratorRole === "editor"}
                            hasChanges={hasUnsavedChanges[tpId] || false}
                            pendingChanges={contentChanges.filter(c => c.talking_point === tpId && c.status === "pending")}
                            talkingPointId={tpId}
                            enableCollaboration={isCollaboration && (isBookOwner || collaboratorRole === "editor")}
                            isReadOnly={!isBookOwner}
                            onTryEdit={!isBookOwner ? () => notification.info("Select a piece of text and click Suggest Edit to propose changes.") : undefined}
                            hasPendingChanges={hasPendingChanges}
                            previewStepJson={previewStepJson}
                            shadowSuggestions={shadowSuggestions}
                            pendingHighlightStepJsons={pendingHighlightStepJsons}
                            highlightPreviewMode={highlightPreviewMode}
                            decorationRefreshTrigger={decorationRefreshTrigger}
                            aiCoachHighlights={highlightPreviewMode === "ai" ? (() => {
                              const items = displayedAiSuggestions
                                .filter((s) => s.talking_point_id === tpId && s.anchor)
                                .map((s) => ({
                                  anchor: htmlToPlainTextForMatching(s.anchor) || (s.anchor || "").trim(),
                                  suggested_replacement: s.suggested_change ?? undefined,
                                }));
                              // Deduplicate by normalized anchor - one highlight per unique text span
                              const seen = new Set<string>();
                              return items.filter((h) => {
                                const key = h.anchor.replace(/\s+/g, " ").trim();
                                if (seen.has(key)) return false;
                                seen.add(key);
                                return true;
                              });
                            })() : []}
                            onPendingChangeClick={() => {
                              if (!isBookOwner || !hasPendingChanges) return;
                              setCurrentTalkingPointId(tpId);
                              setFocusedChangeTpId(tpId);
                              setHighlightPreviewMode("collaborators");
                              setActiveRightView("changes");
                              const oldestPendingId = getOldestPendingChangeId(tpId);
                              const changeToHighlight = contentChanges.find((c) => c.id === oldestPendingId);
                              if (changeToHighlight) {
                                highlightChangeInEditor(changeToHighlight);
                              }
                            }}
                            onHighlightClick={(params) => {
                              const { mode, anchorOrDeletedText, suggestedOrInsertedText, talkingPointId: tpId, clientX, clientY } = params;
                              if (mode === "ai") {
                                const norm = (t: string) => (t || "").replace(/\s+/g, " ").trim();
                                const match = displayedAiSuggestions.find(
                                  (s) =>
                                    s.talking_point_id === tpId &&
                                    ((anchorOrDeletedText && norm(htmlToPlainTextForMatching(s.anchor || "")) === norm(anchorOrDeletedText)) ||
                                      (suggestedOrInsertedText && norm(s.suggested_change || "") === norm(suggestedOrInsertedText)))
                                );
                                if (match) {
                                  setHighlightCommentPopover({ type: "ai", suggestion: match, x: clientX, y: clientY });
                                }
                              } else {
                                const changesForTp = contentChanges.filter((c) => c.talking_point === tpId && (!c.status || c.status === "pending"));
                                const match = changesForTp.find((c) => {
                                  const steps = Array.isArray((c as any).step_json) ? (c as any).step_json : [(c as any).step_json];
                                  for (const raw of steps || []) {
                                    if (!raw || typeof raw !== "object") continue;
                                    const deleted = (raw.deletedText || "").replace(/\s+/g, " ").trim();
                                    const inserted = extractInsertedTextFromRawStep(raw).replace(/\s+/g, " ").trim();
                                    if (anchorOrDeletedText && deleted === anchorOrDeletedText) return true;
                                    if (suggestedOrInsertedText && inserted === suggestedOrInsertedText) return true;
                                  }
                                  return false;
                                });
                                if (match) {
                                  setHighlightCommentPopover({ type: "collaborator", change: match, x: clientX, y: clientY });
                                }
                              }
                            }}
                          />
                          {/* Collaborators use Create Edit (select text → modal) instead of Apply Changes */}
                          {/* Apply Changes removed for collaborators - they suggest via selection popover */}
                          {/* Quick Actions & Add to Chat - appears when text is selected */}
                          {selectedText && selectionPosition && currentTalkingPointId === tpId && (() => {
                            const gap = 20;
                            const estHeight = 320;
                            const preferredTop = selectionPosition.y + gap;
                            const wouldOverflow = preferredTop + estHeight > window.innerHeight - 16;
                            const top = wouldOverflow ? Math.max(16, window.innerHeight - estHeight - 16) : preferredTop;
                            return (
                            <div
                              className="fixed z-50 bg-[#011b2d] border border-[#2d3a4a] rounded-lg shadow-lg p-1 flex flex-col gap-2 max-h-[calc(100vh-32px)] overflow-y-auto"
                              style={{
                                left: `${selectionPosition.x}px`,
                                top: `${top}px`,
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {/* Quick Actions */}
                              <div className="flex flex-col gap-0.5">
                                {/* Create Edit / Suggest Edit - only action for collaborators */}
                                {!isBookOwner && collaboratorRole === "editor" && selectionRange && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const initialContent = selectedHtml
                                        ? selectedHtml
                                        : `<p>${String(selectedText).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
                                      setCreateEditInitialContent(initialContent);
                                      setCreateEditOriginalText(selectedText);
                                      setCreateEditTpId(currentTalkingPointId ?? null);
                                      setCreateEditFrom(selectionRange.from);
                                      setCreateEditTo(selectionRange.to);
                                      setCreateEditModalOpen(true);
                                    }}
                                    className="px-3 py-2 text-sm text-[#CDF056] font-medium rounded hover:bg-[#1a2a3a] flex items-center gap-2 w-full text-left border border-[#CDF056]/30"
                                    title="Suggest an edit for the author to review"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                    Suggest Edit
                                  </button>
                                )}
                                {isBookOwner && (
                                <>
                                <button
                                  onClick={() => handleQuickAction("shorten")}
                                  disabled={isApplyingQuickAction}
                                  className="px-3 py-2 text-sm text-gray-200 rounded hover:bg-[#1a2a3a] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 w-full text-left"
                                  title="Shorten this text"
                                >
                                  <svg className="w-4 h-4 text-[#CDF056]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
                                  </svg>
                                  Shorten
                                </button>
                                <button
                                  onClick={() => handleQuickAction("strengthen")}
                                  disabled={isApplyingQuickAction}
                                  className="px-3 py-2 text-sm text-gray-200 rounded hover:bg-[#1a2a3a] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 w-full text-left"
                                  title="Strengthen this text"
                                >
                                  <svg className="w-4 h-4 text-[#CDF056]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                  </svg>
                                  Strengthen
                                </button>
                                <button
                                  onClick={() => handleQuickAction("clarify")}
                                  disabled={isApplyingQuickAction}
                                  className="px-3 py-2 text-sm text-gray-200 rounded hover:bg-[#1a2a3a] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 w-full text-left"
                                  title="Clarify this text"
                                >
                                  <svg className="w-4 h-4 text-[#CDF056]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                    <circle cx="18.5" cy="4.5" r="1" fill="currentColor" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 4l1 1m0-2l-1 1" opacity="0.6" />
                                  </svg>
                                  Clarify
                                </button>
                                <button
                                  onClick={() => {
                                    setActiveRightView("moreActions");
                                    setSelectedText("");
                                    setSelectionPosition(null);
                                    setSelectionRange(null);
                                    if (window.getSelection) {
                                      window.getSelection()?.removeAllRanges();
                                    }
                                  }}
                                  className="px-3 py-2 text-sm text-gray-200 rounded hover:bg-[#1a2a3a] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 w-full text-left"
                                  title="More actions"
                                >
                                  <svg className="w-4 h-4 text-[#CDF056]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                                  </svg>
                                  More Actions
                                </button>
                                </>
                                )}
                              </div>
                              {/* Separator */}
                              <div className="border-t border-[#2d3a4a] my-1"></div>
                              {/* Add to Chat */}
                              <button
                                onClick={() => {
                                  // Get the actual browser selection text
                                  const browserText = getSelectedText();
                                  const textToAdd = browserText.trim() || selectedText;
                                  handleAddToChat(textToAdd);
                                  setSelectedText("");
                                  setSelectionPosition(null);
                                  setSelectionRange(null);
                                  // Clear selection in editor
                                  if (window.getSelection) {
                                    window.getSelection()?.removeAllRanges();
                                  } else if (document.getSelection) {
                                    document.getSelection()?.removeAllRanges();
                                  } else if ((document as any).selection) {
                                    (document as any).selection.empty();
                                  }
                                }}
                                className="px-3 py-2 text-sm text-gray-200 rounded hover:bg-[#1a2a3a] flex items-center gap-2 w-full text-left"
                              >
                                <svg className="w-4 h-4 text-[#CDF056]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                </svg>
                                Add to Chat
                              </button>
                            </div>
                          );
                          })()}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Talking Point Assets Sidebar - Right Side (when open for talking points) */}
              {bookId && assetsModalOpen && currentTalkingPointId && !currentChapterId && (
                <ChapterAssetsModal
                  isOpen={assetsModalOpen}
                  onClose={() => {
                    setAssetsModalOpen(false);
                    setCurrentTalkingPointId(null);
                  }}
                  bookId={bookId}
                  talkingPointId={currentTalkingPointId}
                  onGenerate={handleAssetsGenerate}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            Select a section from the left sidebar to start editing
          </div>
        )}
      </div>

      {/* Right Sidebar - Comments & Chat with Toggle */}
      <div className="flex border-l border-[#2d3a4a] mt-13 overflow-hidden">
        {/* Content Area */}
        <div className="w-80 bg-[#011b2d] flex flex-col flex-1 overflow-hidden" style={{
          backgroundImage: `url(${card2})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}>
          {activeRightView === "comments" ? (
            <div className="flex flex-col h-full">
              {/* Fixed Header and Form */}
              <div className="p-4 shrink-0 border-b border-[#2d3a4a]">
                <h3 className="text-sm font-semibold text-white mb-4">COMMENTS</h3>

                {/* Add Comment Form - Hidden for viewers */}
                {collaboratorRole !== "viewer" && (
                  <div>
                    <textarea
                      value={newCommentText}
                      onChange={(e) => setNewCommentText(e.target.value)}
                      placeholder="Add a comment..."
                      className="w-full px-3 py-2 bg-[#1a2a3a] border border-[#2d3a4a] rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#CDF056] resize-none"
                      rows={3}
                    />
                    <button
                      onClick={handleAddComment}
                      disabled={!newCommentText.trim() || isAddingComment}
                      className="mt-2 px-4 py-1.5 bg-[#CDF056] text-white rounded-lg  disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      {isAddingComment ? "Adding..." : "Add Comment"}
                    </button>
                  </div>
                )}
                {collaboratorRole === "viewer" && (
                  <div className="text-xs text-gray-400 italic">Viewers can only view comments</div>
                )}
              </div>

              {/* Scrollable Comments List */}
              <div className="flex-1 overflow-y-auto p-4">
                {isLoadingComments ? (
                  <div className="flex flex-col items-center justify-center py-6 gap-3">
                    <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#2d3a4a] border-t-[#CDF056]"></div>
                    <p className="text-gray-400 text-sm">Loading comments...</p>
                  </div>
                ) : (() => {
                  // Filter out AI comments - they should only appear in the Review tab
                  const userComments = comments.filter(comment => comment.comment_type !== "ai");
                  return userComments.length === 0 ? (
                    <div className="text-center text-gray-400 text-sm py-4">No comments yet. Be the first to comment!</div>
                  ) : (
                    <div className="space-y-3">
                      {userComments.map((comment) => renderComment(comment))}
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : activeRightView === "changes" ? (
            <div className="flex flex-col h-full">
              {/* Changes Header */}
              <div className="p-4 border-b border-[#2d3a4a] shrink-0">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold text-white">CHANGES</h3>
                  <div className="flex items-center gap-2">
                    {isBookOwner && focusedChangeTpId && (
                      <button
                        onClick={() => {
                          setFocusedChangeTpId(null);
                        }}
                        className="text-xs text-gray-300 hover:text-white underline"
                        title="Show all pending changes"
                      >
                        Show all
                      </button>
                    )}
                    <button
                      onClick={loadChanges}
                      disabled={isLoadingChanges}
                      className="p-1.5 rounded hover:bg-[#2d3a4a] disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Refresh changes"
                    >
                      <svg
                        className={`w-4 h-4 text-gray-400 ${isLoadingChanges ? 'animate-spin' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-400">
                  {isBookOwner ? "Review and approve changes" : "Your suggested changes"}
                </p>
              </div>

              {/* Changes List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {isLoadingChanges ? (
                  <div className="flex flex-col items-center justify-center py-6 gap-3">
                    <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#2d3a4a] border-t-[#CDF056]"></div>
                    <p className="text-gray-400 text-sm">Loading changes...</p>
                  </div>
                ) : (() => {
                  // For owners: Show ALL pending changes in the section
                  // For collaborators: Show changes for the current talking point only
                  let relevantChanges: ContentChange[];

                  if (isBookOwner) {
                    // Owner sees all pending changes in the section
                    relevantChanges = contentChanges.filter(c => !c.status || c.status === "pending");
                    if (focusedChangeTpId) {
                      relevantChanges = relevantChanges.filter(c => c.talking_point === focusedChangeTpId);
                    }
                    console.log("Owner view - showing all pending changes:", relevantChanges.length, "out of", contentChanges.length);
                  } else {
                    // Collaborator sees changes for current talking point
                    const activeTpId = currentTalkingPointId ||
                      (selectedSection?.talking_points?.find(tp => tp.id)?.id) ||
                      (selectedSection?.talking_points?.[0]?.id) ||
                      null;

                    console.log("Collaborator view - activeTpId:", activeTpId, "all changes:", contentChanges.length, "contentChanges:", contentChanges.map(c => ({ id: c.id, tp: c.talking_point, status: c.status })));

                    relevantChanges = activeTpId
                      ? contentChanges.filter(c => {
                        const matches = c.talking_point === activeTpId;
                        if (!matches) {
                          console.log("Change filtered out:", c.id, "talking_point:", c.talking_point, "activeTpId:", activeTpId);
                        }
                        return matches;
                      })
                      : []; // Show none if no activeTpId

                    console.log("Collaborator view - relevant changes:", relevantChanges.length, "changes:", relevantChanges.map(c => ({ id: c.id, tp: c.talking_point, status: c.status })));
                  }

                  // Sort by created_at descending (newest first)
                  relevantChanges = [...relevantChanges].sort((a, b) => {
                    const dateA = new Date(a.created_at).getTime();
                    const dateB = new Date(b.created_at).getTime();
                    return dateB - dateA; // Newest first
                  });

                  if (relevantChanges.length === 0) {
                    return (
                      <div className="text-center text-gray-400 text-sm py-4">
                        {isBookOwner
                          ? (focusedChangeTpId ? "No pending changes for this talking point" : "No pending changes")
                          : "No changes yet. Select text to suggest edits."}
                      </div>
                    );
                  }

                  return relevantChanges.map((change) => {
                    const oldestPendingId = isBookOwner ? getOldestPendingChangeId(change.talking_point) : null;
                    const isOldestPending =
                      !isBookOwner || change.status !== "pending" || change.id === oldestPendingId;
                    return (
                      <div
                        key={change.id}
                        className="bg-[#1a2a3a] border border-[#2d3a4a] rounded-lg p-3 cursor-pointer"
                        onClick={() => {
                          setCurrentTalkingPointId(change.talking_point);
                          if (isBookOwner) {
                            setFocusedChangeTpId(change.talking_point);
                          }
                          highlightChangeInEditor(change);
                        }}
                        title="Click to highlight in editor"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="flex items-center justify-between">

                            
                            <div className="text-white text-xs font-semibold mb-1">{change.user_name}</div>
                            <div>{!isBookOwner && change.status === "pending" && change.user === currentUserId && (
                          <button
                            onClick={async () => {
                              const result = await deleteContentChange(change.id);
                              if (result.success) {
                                if (selectedSection && bookId) {
                                  await loadChanges();
                                }
                              }
                            }}
                            className=" px-1.5 py-0.25 bg-red-100 text-red-700 rounded hover:bg-red-200 text-sm w-full rounded-full"
                          >
                            X
                          </button>
                        )}</div></div>
                            <div className="text-gray-400 text-xs">
                              {new Date(change.created_at).toLocaleDateString()} {new Date(change.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                            <div className={`inline-block px-2 py-0.5 rounded text-xs mt-1 ${change.status === "pending" ? "bg-yellow-500/20 text-yellow-400" :
                              change.status === "approved" ? "bg-[#CDF056] text-[#0a1a2e]" :
                                "bg-red-500/20 text-red-400"
                              }`}>
                              {change.status.toUpperCase()}
                            </div>
                          </div>
                        </div>

                        <div className="mt-3 space-y-2">
                          {(() => {
                            const stepJson = (change as any).step_json;
                            if (!stepJson) {
                              return <div className="text-xs text-gray-400">No step data available</div>;
                            }

                            const preview = getChangePreviewText(change);
                            const hasDeleted = preview.deleted.length > 0;
                            const hasInserted = preview.inserted.length > 0;

                            if (!hasDeleted && !hasInserted) {
                              return (
                                <div>
                                  <div className="text-xs text-gray-400 mb-2 font-medium">SUGGESTED CHANGE:</div>
                                  <div className="bg-gray-500/10 border border-gray-500/30 rounded p-3">
                                    <p className="text-xs text-gray-400">
                                      Preview unavailable
                                    </p>
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div>
                                <div className="text-xs text-gray-400 mb-2 font-medium">SUGGESTED CHANGE:</div>
                                <div className="space-y-2">
                                  {hasDeleted && (
                                    <div className="bg-red-500/10 border border-red-500/30 rounded p-3">
                                      <div className="text-xs text-red-400 mb-1 font-semibold">Deleted</div>
                                      <p
                                        className="text-sm text-red-300 whitespace-pre-wrap line-through pending-step-deletion"
                                        style={{ wordBreak: "break-word" }}
                                      >
                                        {preview.deleted}
                                      </p>
                                    </div>
                                  )}
                                  {hasInserted && (
                                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3">
                                      <div className="text-xs text-yellow-400 mb-1 font-semibold">Inserted</div>
                                      <p
                                        className="text-sm text-yellow-200 whitespace-pre-wrap pending-step-highlight"
                                        style={{ wordBreak: "break-word" }}
                                      >
                                        {preview.inserted}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Comment section - add/edit for change author only; display for all with normal comment styling */}
                        <div className="mt-3 pt-3 border-t border-[#2d3a4a]">
                          {editingChangeCommentId === change.id ? (
                            <div className="space-y-2">
                              <textarea
                                value={editingChangeCommentText}
                                onChange={(e) => setEditingChangeCommentText(e.target.value)}
                                placeholder="Add a comment explaining this change..."
                                className="w-full px-3 py-2 text-sm border border-[#2d3a4a] rounded bg-[#0a1a2e] text-gray-200 placeholder-gray-500 resize-none"
                                rows={2}
                                autoFocus
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={async () => {
                                    const result = await updateContentChangeComment(change.id, editingChangeCommentText.trim());
                                    if (result.success) {
                                      setContentChanges((prev) =>
                                        prev.map((c) =>
                                          c.id === change.id ? { ...c, comment: editingChangeCommentText.trim() } : c
                                        )
                                      );
                                      setEditingChangeCommentId(null);
                                      setEditingChangeCommentText("");
                                    }
                                  }}
                                  className="px-2 py-1 text-xs bg-[#CDF056] text-[#0a1a2e] rounded hover:bg-[#CDF056]/80"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => {
                                    setEditingChangeCommentId(null);
                                    setEditingChangeCommentText("");
                                  }}
                                  className="px-2 py-1 text-xs text-gray-400 hover:text-gray-200"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (change.comment && change.comment.trim()) ? (
                            <div className="bg-white rounded-lg p-3 text-sm border border-gray-200">
                              <p className="text-gray-700 whitespace-pre-wrap">{change.comment}</p>
                              {change.status === "pending" && !isBookOwner && change.user === currentUserId && (
                                <button
                                  onClick={() => {
                                    setEditingChangeCommentId(change.id);
                                    setEditingChangeCommentText(change.comment || "");
                                  }}
                                  className="mt-2 text-xs text-[#CDF056] hover:underline"
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                          ) : change.status === "pending" && !isBookOwner && change.user === currentUserId ? (
                            <button
                              onClick={() => {
                                setEditingChangeCommentId(change.id);
                                setEditingChangeCommentText("");
                              }}
                              className="text-xs text-[#CDF056] hover:underline"
                            >
                              + Add comment
                            </button>
                          ) : (
                            (change.comment && change.comment.trim()) ? (
                              <div className="bg-white rounded-lg p-3 text-sm border border-gray-200">
                                <p className="text-gray-700 whitespace-pre-wrap">{change.comment}</p>
                              </div>
                            ) : (
                              <p className="text-xs text-gray-500 italic">No comment</p>
                            )
                          )}
                        </div>

                        {isBookOwner && change.status === "pending" && (
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={() => handleApproveChange(change)}
                              disabled={!isOldestPending}
                              className={`flex-1 px-3 py-1.5 rounded text-sm ${!isOldestPending
                                ? "bg-gray-500 text-gray-300 cursor-not-allowed"
                                : "bg-[#CDF056] text-white hover:bg-[#CDF056]/70"
                                }`}
                              title={!isOldestPending ? "Approve earlier changes first" : "Approve"}
                            >
                              Approve
                            </button>
                            <button
                              onClick={async () => {
                                const result = await rejectContentChange(change.id);
                                if (result.success) {
                                  console.log("❌ Change rejected, reloading changes...");
                                  // Reload ALL changes for the section
                                  await loadChanges();
                                } else {
                                  console.error("Failed to reject change:", result);
                                }
                              }}
                              className="flex-1 px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                        {isBookOwner && change.status === "pending" && !isOldestPending && (
                          <div className="text-xs text-gray-400 mt-2">
                            Approve earlier change(s) for this talking point first.
                          </div>
                        )}

                        
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          ) : activeRightView === "chat" ? (
            <div className="flex flex-col h-full">
              {/* Chat Header */}
              <div className="p-4 border-b border-[#2d3a4a] shrink-0">
                <h3 className="text-sm font-semibold text-white mb-1">CHAT</h3>
                {selectedSection && (
                  <p className="text-xs text-gray-400">
                    About: {selectedSection.talking_points?.[0]?.text || selectedSection.title || "Current section"}
                  </p>
                )}
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {
                
                
                chatMessages.length === 0 ? (
                  <div className="flex justify-start">
                    <div className="bg-white rounded-lg p-3 text-sm max-w-[80%]">
                      <p className="text-gray-900">How can i help?</p>
                    </div>
                  </div>
                ) : (
                  chatMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex ${msg.from === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg p-3 text-sm ${msg.from === "user"
                          ? "bg-[#CDF056] text-white"
                          : "bg-white text-gray-900"
                          }`}
                      >
                        {msg.highlightedText && (
                          <div className="mb-2 pb-2 border-b border-gray-200 text-xs italic text-gray-600">
                            "{msg.highlightedText}"
                          </div>
                        )}
                        <p className="whitespace-pre-wrap">{msg.text}</p>
                      </div>
                    </div>
                  ))
                )}
                {isChatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white rounded-lg p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span className="text-gray-600">Thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatMessagesEndRef} />
              </div>

              {/* Chat Input */}
              <div className="p-4 border-t border-[#2d3a4a] shrink-0">
  
                <div className="flex gap-2 mb-2">

                  <input
                    ref={chatInputRef}
                    type="text"
                    value={chatInput}
                    onChange={handleInputChange}
                    onKeyPress={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendChatMessage(false);
                      }
                    }}
                    placeholder="Ask a question about this talking point..."
                    className="flex-1 px-3 py-2 bg-[#1a2a3a] border border-[#2d3a4a] rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#CDF056]"
                    disabled={isChatLoading}
                  />
                                  
{browserSupportsSpeechRecognition && (
  <SpeechToText
    onTranscript={handleTranscript}
    onListeningChange={setIsListening}
    onError={(msg) => notification.error(msg)}
  />
)}
                  <button
                    onClick={() => handleSendChatMessage(false)}
                    disabled={!chatInput.trim() || isChatLoading}
                    className="px-4 py-2 bg-[#CDF056] text-white rounded-lg hover:bg-[#3bc96d] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  </button>
                </div>
                
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    handleSendChatMessage(true);
                  }}
                  disabled={!chatInput.trim() || isChatLoading}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Apply Changes to Content
                </button>
                
              </div>
            </div>
          ) : activeRightView === "review" ? (
            <div className="flex flex-col h-full">
              {/* Review Header */}
              <div className="p-4 border-b border-[#2d3a4a] shrink-0">
                <h3 className="text-sm font-semibold text-white mb-1">AI COACH REVIEW</h3>
                <p className="text-xs text-gray-400">
                  Review the entire chapter for clarity, flow, tone, and more
                </p>
              </div>

              {/* Review Content */}
              <div className="flex-1 overflow-y-auto p-4">
                {!selectedItem ? (
                  <div className="text-center text-gray-400 text-sm py-8">
                    Select a section to review its chapter
                  </div>
                ) : (
                  <div className="space-y-4">
                    {!reviewResult && !isReviewing && (
                      <div className="bg-[#1a2a3a] border border-[#2d3a4a] rounded-lg p-4">
                        <p className="text-sm text-gray-300 mb-4">
                          Get AI-powered feedback on your chapter covering:
                        </p>
                        <ul className="text-xs text-gray-400 space-y-2 mb-4 list-disc list-inside">
                          <li>Clarity & Meaning</li>
                          <li>Flow & Readability</li>
                          <li>Argumentation & Consistency</li>
                          <li>Tone of Voice</li>
                          <li>Proofreading</li>
                          <li>Credibility & Sources</li>
                        </ul>
                        <button
                          onClick={async () => {
                            if (!selectedItem || !bookId) return;
                            setIsReviewing(true);
                            setReviewResult(null);
                            setDismissedAiSuggestions(new Set());
                            try {
                              const result = await reviewChapter(selectedItem.chapterId);
                              if (result.success && result.data) {
                                setReviewResult(result.data);
                                setDismissedAiSuggestions(new Set());
                              } else {
                                notification.error(result.error || "Failed to review chapter");
                              }
                            } catch (error) {
                              console.error("Error reviewing chapter:", error);
                              notification.error("Error reviewing chapter. Please try again.");
                            } finally {
                              setIsReviewing(false);
                            }
                          }}
                          disabled={isReviewing}
                          className="w-full px-4 py-2 bg-[#CDF056] text-white rounded-lg hover:bg-[#3bc96d] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold"
                        >
                          {isReviewing ? (
                            <span className="flex items-center justify-center gap-2">
                              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              Reviewing...
                            </span>
                          ) : (
                            "Review Chapter"
                          )}
                        </button>
                      </div>
                    )}

                    {isReviewing && (
                      <div className="text-center py-8">
                        <div className="flex flex-col items-center gap-3">
                          <svg className="animate-spin h-8 w-8 text-[#CDF056]" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <p className="text-sm text-gray-400">Analyzing your chapter...</p>
                          <p className="text-xs text-gray-500">This may take a moment</p>
                        </div>
                      </div>
                    )}

                    {reviewResult && (
                      <div className="bg-[#1a2a3a] border border-[#2d3a4a] rounded-lg p-4 mb-4">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-semibold text-white">Review Complete</h4>
                          <button
                            onClick={() => {
                              setReviewResult(null);
                              setDismissedAiSuggestions(new Set());
                            }}
                            className="text-xs text-gray-400 hover:text-white"
                          >
                            Clear
                          </button>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="text-gray-300">
                            <span className="font-semibold">{reviewResult.review_items_found}</span> issues found
                          </div>
                          {displayedAiSuggestions.length < reviewResult.review_items_found && (
                            <div className="text-gray-400 text-xs">
                              {displayedAiSuggestions.length} shown (some dismissed)
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Display AI Review Suggestions */}
                    {displayedAiSuggestions.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-white mb-2">Review Suggestions</h4>
                          {displayedAiSuggestions.map((suggestion) => {
                            const key = suggestionKey(suggestion);
                            return (
                              <div key={key} data-suggestion-key={key} className="bg-[#1a2a3a] border border-[#2d3a4a] rounded-lg p-3">
                                <div className="flex items-start justify-between mb-1">

                                  
                                  <span className="px-2 py-0.5 bg-[#CDF056]/20 text-[#CDF056] text-xs font-semibold rounded ">
                                  {suggestion.category}
                                </span>
                                  <button
                                    onClick={() => {
                                      // Find the section containing this talking point
                                      let targetChapterId: number | null = null;
                                      let targetSectionId: number | null = null;
                                      let targetSectionTitle: string | null = null;

                                      if (outline?.chapters) {
                                        for (const chapter of outline.chapters) {
                                          for (const section of chapter.sections || []) {
                                            for (const tp of section.talking_points || []) {
                                              if (tp.id === suggestion.talking_point_id) {
                                                targetChapterId = chapter.id!;
                                                targetSectionId = section.id!;
                                                targetSectionTitle = section.title;
                                                break;
                                              }
                                            }
                                            if (targetSectionId) break;
                                          }
                                          if (targetSectionId) break;
                                        }
                                      }

                                      // Navigate to the section if different from current
                                      if (targetChapterId && targetSectionId && targetSectionTitle) {
                                        if (selectedItem?.sectionId !== targetSectionId) {
                                          handleSectionClick(targetChapterId, targetSectionId, targetSectionTitle);
                                        }
                                      }

                                      // Navigate to the talking point
                                      setCurrentTalkingPointId(suggestion.talking_point_id);
                                      // Ensure AI preview is shown
                                      setHighlightPreviewMode("ai");

                                      // Scroll to the talking point element after section loads
                                      setTimeout(() => {
                                        const tpElement = document.querySelector(`[data-tp-id="${suggestion.talking_point_id}"]`);
                                        if (tpElement) {
                                          tpElement.scrollIntoView({ behavior: "smooth", block: "center" });
                                          // Highlight the talking point briefly
                                          const parent = tpElement.parentElement?.parentElement;
                                          if (parent) {
                                            parent.classList.add("ring-2", "ring-[#CDF056]", "ring-opacity-50");
                                            setTimeout(() => {
                                              parent.classList.remove("ring-2", "ring-[#CDF056]", "ring-opacity-50");
                                            }, 2000);
                                          }
                                        }
                                        // Retrigger decorations so AI preview reappears if it disappeared
                                        setDecorationRefreshTrigger((t) => t + 1);
                                      }, 300); // Longer delay to allow section to render
                                    }}
                                    className="text-xs text-[#CDF056] hover:text-[#CDF056]/80 flex items-center gap-1 hover:underline"
                                    title="Go to talking point"
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                    </svg>
                                    Go to
                                  </button>
                                </div>
                                <div className="text-xs text-gray-500 mb-2">
                                    {suggestion.section_title}
                                  </div>
                               

                                
                                {suggestion.anchor && (
                                  <div className="bg-[#0a1a2e] rounded p-2 mb-2">
                                    <p className="text-xs text-gray-400 mb-1 font-semibold">Original:</p>
                                    <p className="text-sm text-gray-300 italic whitespace-pre-wrap">"{htmlToDisplayText(suggestion.anchor)}"</p>
                                  </div>
                                )}
                                {suggestion.suggested_change && (
                                  <div className="bg-gray-50 rounded p-2 mb-2">
                                    <p className="text-xs text-gray-400 mb-1 font-semibold">Replace with:</p>
                                    <p className="text-sm text-primary-500 whitespace-pre-wrap">"{htmlToDisplayText(suggestion.suggested_change)}"</p>
                                  </div>
                                )}
                                {/* AI Coach comment bubble - styled like a speech bubble with Dismiss/Accept inside */}
                                <div className="relative mt-3">
                                  <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-3">
                                    <div className="flex items-center gap-2 mb-2">
                                      <div className="w-7 h-7 rounded-full bg-[#CDF056]/30 flex items-center justify-center shrink-0">
                                        <svg className="w-4 h-4 text-[#2d4a3e]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                                        </svg>
                                      </div>
                                      <span className="text-gray-900 font-semibold text-sm">AI Coach Review</span>
                                    </div>
                                    {suggestion.comment?.trim() && (
                                      <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap mb-3">{suggestion.comment.trim()}</p>
                                    )}
                                    <div className="flex items-center justify-end gap-2">
                                      <button
                                        onClick={() => setDismissedAiSuggestions(prev => new Set([...prev, key]))}
                                        className="text-xs px-2 py-1 text-gray-500 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                                        title="Dismiss"
                                      >
                                        Dismiss
                                      </button>
                                      <button
                                        onClick={() => handleAcceptAiSuggestion(suggestion)}
                                        disabled={suggestion.suggested_change == null}
                                        className="text-xs px-2 py-1 bg-[#CDF056] text-[#011b2d] rounded-md hover:bg-[#CDF056]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        title={
                                          contentChanges.some(
                                            (c) =>
                                              c.talking_point === suggestion.talking_point_id &&
                                              (!c.status || c.status === "pending")
                                          )
                                            ? "Accept or reject collaborator suggestions first (click to open Changes tab)"
                                            : "Accept suggestion"
                                        }
                                      >
                                        Accept
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}

                    {reviewResult && displayedAiSuggestions.length === 0 && (
                      <div className="text-center text-gray-400 text-sm py-4">
                        No review suggestions found for this chapter.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : activeRightView === "glossary" ? (
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="p-4 border-b border-[#2d3a4a] shrink-0">
                <h3 className="text-sm font-semibold text-white mb-1">GLOSSARY</h3>
                <p className="text-xs text-gray-400">
                  Manage domain terms that should not be flagged as spelling errors
                </p>
              </div>

              {/* Spelling Convention */}
              <div className="p-4 border-b border-[#2d3a4a]">
                <label className="text-xs font-semibold text-gray-400 mb-2 block">SPELLING CONVENTION</label>
                <select
                  value={spellingConvention}
                  onChange={async (e) => {
                    const newConvention = e.target.value as "us" | "uk" | "auto";
                    setSpellingConvention(newConvention);
                    if (bookId) {
                      const result = await updateSpellingConvention(bookId, newConvention);
                      if (!result.success) {
                        console.error("Failed to update spelling convention:", result.error);
                      }
                    }
                  }}
                  className="w-full px-3 py-2 bg-[#1a2a3a] border border-[#2d3a4a] rounded text-white text-sm focus:outline-none focus:border-[#CDF056]"
                >
                  <option value="auto">Auto-detect from content</option>
                  <option value="us">American English (US)</option>
                  <option value="uk">British English (UK)</option>
                </select>
              </div>

              {/* Add Term */}
              <div className="p-4 border-b border-[#2d3a4a]">
                <label className="text-xs font-semibold text-gray-400 mb-2 block">ADD TERM</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTermInput}
                    onChange={(e) => setNewTermInput(e.target.value)}
                    placeholder="Enter term..."
                    className="flex-1 px-3 py-2 bg-[#1a2a3a] border border-[#2d3a4a] rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-[#CDF056]"
                    onKeyDown={async (e) => {
                      if (e.key === "Enter" && newTermInput.trim() && bookId) {
                        const result = await createGlossaryTerm(bookId, {
                          term: newTermInput.trim(),
                          do_not_change: true,
                          category: "other",
                        });
                        if (result.success && result.data) {
                          setGlossaryTerms([...glossaryTerms, result.data]);
                          setNewTermInput("");
                        } else {
                          notification.error(result.error || "Failed to add term");
                        }
                      }
                    }}
                  />
                  <button
                    onClick={async () => {
                      if (newTermInput.trim() && bookId) {
                        const result = await createGlossaryTerm(bookId, {
                          term: newTermInput.trim(),
                          do_not_change: true,
                          category: "other",
                        });
                        if (result.success && result.data) {
                          setGlossaryTerms([...glossaryTerms, result.data]);
                          setNewTermInput("");
                        } else {
                          notification.error(result.error || "Failed to add term");
                        }
                      }
                    }}
                    disabled={!newTermInput.trim()}
                    className="px-3 py-2 bg-[#CDF056] text-black rounded text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#CDF056]/80"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Terms List */}
              <div className="flex-1 overflow-y-auto p-4">
                {isLoadingGlossary ? (
                  <div className="text-center py-8">
                    <svg className="animate-spin h-6 w-6 text-[#CDF056] mx-auto" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p className="text-gray-400 text-sm mt-2">Loading glossary...</p>
                  </div>
                ) : glossaryTerms.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    <p className="mb-2">No glossary terms yet.</p>
                    <p className="text-xs">Add domain, brand, or framework terms that shouldn&apos;t be flagged as spelling errors.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {glossaryTerms.map((term) => (
                      <div key={term.id} className="bg-[#1a2a3a] border border-[#2d3a4a] rounded-lg p-3 group">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-white font-medium">{term.term}</span>
                              {term.preferred_spelling && term.preferred_spelling !== term.term && (
                                <span className="text-xs text-gray-400">→ {term.preferred_spelling}</span>
                              )}
                              {term.do_not_change && (
                                <span className="px-1.5 py-0.5 bg-[#CDF056]/20 text-[#CDF056] text-[10px] font-semibold rounded">
                                  DO NOT CHANGE
                                </span>
                              )}
                            </div>
                            {term.definition && (
                              <p className="text-xs text-gray-400 mt-1">{term.definition}</p>
                            )}
                            <span className="text-[10px] text-gray-500 mt-1 inline-block capitalize">
                              {term.category.replace("_", " ")}
                            </span>
                          </div>
                          <button
                            onClick={async () => {
                              if (confirm(`Delete "${term.term}" from glossary?`)) {
                                const result = await deleteGlossaryTerm(term.id);
                                if (result.success) {
                                  setGlossaryTerms(glossaryTerms.filter((t) => t.id !== term.id));
                                } else {
                                  notification.error(result.error || "Failed to delete term");
                                }
                              }
                            }}
                            className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Delete term"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : activeRightView === "moreActions" ? (
            <div className="flex flex-col h-full bg-white overflow-hidden">
              {/* Header */}
              <div className="p-4 border-b border-gray-200 shrink-0 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">More Actions</h3>
                </div>
                <button
                  onClick={() => setActiveRightView("comments")}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Loading indicator */}
              {isApplyingQuickAction && (
                <div className="shrink-0 px-4 py-3 bg-[#CDF056]/10 border-b border-[#CDF056]/30 flex items-center gap-3">
                  <svg className="animate-spin h-5 w-5 text-[#2d4a3e]" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span className="text-sm font-medium text-gray-700">Applying action...</span>
                </div>
              )}

              {/* Actions Content */}
              <div className="flex-1 overflow-y-auto p-4">
                {/* STRUCTURE & CLARITY */}
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex-1 h-px bg-gray-200"></div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">STRUCTURE & CLARITY</h4>
                    <div className="flex-1 h-px bg-gray-200"></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      }
                      label="Clarify text"
                      onClick={() => handleQuickAction("clarify")}
                      disabled={!selectedText || isApplyingQuickAction}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
                        </svg>
                      }
                      label="Shorten text"
                      onClick={() => handleQuickAction("shorten")}
                      disabled={!selectedText || isApplyingQuickAction}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                        </svg>
                      }
                      label="Expand explanation"
                      onClick={() => handleQuickAction("expand")}
                      disabled={!selectedText || isApplyingQuickAction}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      }
                      label="Strengthen argument"
                      onClick={() => handleQuickAction("strengthen")}
                      disabled={!selectedText || isApplyingQuickAction}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                      }
                      label="Remove repetition"
                      onClick={() => handleQuickAction("remove_repetition")}
                      disabled={!selectedText || isApplyingQuickAction}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      }
                      label="Regenerate selected"
                      onClick={() => handleQuickAction("regenerate")}
                      disabled={!selectedText || isApplyingQuickAction}
                    />
                  </div>
                </div>

                {/* STRUCTURE & FLOW */}
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex-1 h-px bg-gray-200"></div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">STRUCTURE & FLOW</h4>
                    <div className="flex-1 h-px bg-gray-200"></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      }
                      label="Improve flow"
                      onClick={() => handleQuickAction("improve_flow")}
                      disabled={!selectedText || isApplyingQuickAction}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                      }
                      label="Split paragraph"
                      onClick={() => handleQuickAction("split_paragraph")}
                      disabled={!selectedText || isApplyingQuickAction}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      }
                      label="Turn into bullets"
                      onClick={() => handleQuickAction("turn_into_bullets")}
                      disabled={!selectedText || isApplyingQuickAction}
                    />
                    <ActionButton
                      icon={<span className="text-lg font-bold">H1</span>}
                      label="Rewrite heading"
                      onClick={() => handleQuickAction("rewrite_heading")}
                      disabled={!currentTalkingPointId || isApplyingQuickAction}
                    />
                    <ActionButton
                      icon={<span className="text-lg font-bold">H2</span>}
                      label="Suggest subheading"
                      onClick={() => handleQuickAction("suggest_subheading")}
                      disabled={!currentTalkingPointId || isApplyingQuickAction}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      }
                      label="Add transition sentence"
                      onClick={() => handleQuickAction("add_transition")}
                      disabled={!selectedText || isApplyingQuickAction}
                    />
                  </div>
                </div>

                {/* NONFICTION PACKAGING */}
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex-1 h-px bg-gray-200"></div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">NONFICTION PACKAGING</h4>
                    <div className="flex-1 h-px bg-gray-200"></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                      }
                      label="Create simple model"
                      onClick={() => { }}
                      disabled={true}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0V4a2 2 0 012-2h14a2 2 0 012 2v16a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                        </svg>
                      }
                      label="Compare in table"
                      onClick={() => { }}
                      disabled={true}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      }
                      label="Add key takeaways"
                      onClick={() => { }}
                      disabled={true}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
                        </svg>
                      }
                      label="Suggest visual model"
                      onClick={() => { }}
                      disabled={true}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0V4a2 2 0 012-2h14a2 2 0 012 2v16a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                        </svg>
                      }
                      label="Suggest table structure"
                      onClick={() => { }}
                      disabled={true}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                        </svg>
                      }
                      label="Add numbered framework"
                      onClick={() => { }}
                      disabled={true}
                    />
                  </div>
                </div>

                {/* EXAMPLES & EVIDENCE */}
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex-1 h-px bg-gray-200"></div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">EXAMPLES & EVIDENCE</h4>
                    <div className="flex-1 h-px bg-gray-200"></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      }
                      label="Add example"
                      onClick={() => { }}
                      disabled={true}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                      }
                      label="Add story / case"
                      onClick={() => { }}
                      disabled={true}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      }
                      label="Add evidence / rationale"
                      onClick={() => { }}
                      disabled={true}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      }
                      label="Add quote / blockquote"
                      onClick={() => { }}
                      disabled={true}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                        </svg>
                      }
                      label="Add source to footnote"
                      onClick={() => { }}
                      disabled={true}
                    />
                  </div>
                </div>
                {/* FORMATTING */}
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex-1 h-px bg-gray-200"></div>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">FORMATTING</h4>
                    <div className="flex-1 h-px bg-gray-200"></div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                        </svg>
                      }
                      label="Convert to bullet list"
                      onClick={() => { }}
                      disabled={true}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                      }
                      label="Convert to paragraph"
                      onClick={() => { }}
                      disabled={true}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      }
                      label="Rewrite chapter intro"
                      onClick={() => { }}
                      disabled={true}
                    />
                    <ActionButton
                      icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      }
                      label="Rewrite Chapter Summary"
                      onClick={() => { }}
                      disabled={true}
                    />
                  </div>
                </div>


              </div>
            </div>
          ) : null}
        </div>

        {/* Navigation Icons - Far Right Edge */}
        <div className="w-12 bg-[#0a1a2e] border-l border-[#2d3a4a] flex flex-col items-center py-4 gap-4 shrink-0">
          <button
            onClick={() => {
              if (collaboratorRole === "viewer") return;
              setActiveRightView("comments");
            }}
            disabled={collaboratorRole === "viewer"}
            className={`p-2 rounded transition-colors ${collaboratorRole === "viewer"
              ? "text-gray-600 opacity-50 cursor-not-allowed"
              : activeRightView === "comments" ? "bg-[#2d4a3e] text-[#CDF056]" : "text-gray-400 hover:text-white"
              }`}
            title={collaboratorRole === "viewer" ? "Viewers cannot comment" : "Comments"}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </button>
          <button
            onClick={() => {
              if (collaboratorRole === "viewer") return;
              setActiveRightView("chat");
            }}
            disabled={collaboratorRole === "viewer"}
            className={`p-2 rounded transition-colors ${collaboratorRole === "viewer"
              ? "text-gray-600 opacity-50 cursor-not-allowed"
              : activeRightView === "chat" ? "bg-[#2d4a3e] text-[#CDF056]" : "text-gray-400 hover:text-white"
              }`}
            title={collaboratorRole === "viewer" ? "Viewers cannot use chat" : "Chat"}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </button>
          <button
            onClick={() => {
              if (!isBookOwner && collaboratorRole !== "editor") return;
              setHighlightPreviewMode("collaborators");
              setActiveRightView("changes");
            }}
            disabled={!isBookOwner && collaboratorRole !== "editor"}
            className={`p-2 rounded transition-colors relative ${!isBookOwner && collaboratorRole !== "editor"
              ? "text-gray-600 opacity-50 cursor-not-allowed"
              : activeRightView === "changes" ? "bg-[#2d4a3e] text-[#CDF056]" : "text-gray-400 hover:text-white"
              }`}
            title={!isBookOwner && collaboratorRole !== "editor" ? "Only editors can view changes" : "Changes"}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            {(() => {
              if (!isBookOwner && collaboratorRole !== "editor") return null;
              const pendingCount = contentChanges.filter(c => !c.status || c.status === "pending").length;
              if (pendingCount > 0) {
                return (
                  <span className="absolute -top-1 -right-1 bg-yellow-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center border-2 border-[#0a1a2e]">
                    {pendingCount > 9 ? "9+" : pendingCount}
                  </span>
                );
              }
              return null;
            })()}
          </button>
          <button
            onClick={() => {
              if (!isBookOwner && collaboratorRole !== "editor") return;
              setHighlightPreviewMode("ai");
              setActiveRightView("review");
            }}
            disabled={!isBookOwner && collaboratorRole !== "editor"}
            className={`p-2 rounded transition-colors ${!isBookOwner && collaboratorRole !== "editor"
              ? "text-gray-600 opacity-50 cursor-not-allowed"
              : activeRightView === "review" ? "bg-[#2d4a3e] text-[#CDF056]" : "text-gray-400 hover:text-white"
              }`}
            title={!isBookOwner && collaboratorRole !== "editor" ? "Only editors can review chapters" : isReviewing ? "Reviewing chapter..." : "AI Coach Review"}
          >
            {isReviewing ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.3482396,15.9535197 C18.7664592,15.0561341 19,14.0553403 19,13 C19,9.13400675 15.8659932,6 12,6 C8.13400675,6 5,9.13400675 5,13 C5,14.1167756 5.2615228,15.1724692 5.72666673,16.1091793 L5.72666673,16.1091793 M12,3 C12.5522847,3 13,2.55228475 13,2 C13,1.44771525 12.5522847,1 12,1 C11.4477153,1 11,1.44771525 11,2 C11,2.55228475 11.4477153,3 12,3 Z M12,23 C12.5522847,23 13,22.5522847 13,22 C13,21.4477153 12.5522847,21 12,21 C11.4477153,21 11,21.4477153 11,22 C11,22.5522847 11.4477153,23 12,23 Z M12,6 L12,3 M9,14 C9.55228475,14 10,13.5522847 10,13 C10,12.4477153 9.55228475,12 9,12 C8.44771525,12 8,12.4477153 8,13 C8,13.5522847 8.44771525,14 9,14 Z M15,14 C15.5522847,14 16,13.5522847 16,13 C16,12.4477153 15.5522847,12 15,12 C14.4477153,12 14,12.4477153 14,13 C14,13.5522847 14.4477153,14 15,14 Z M6,18.9876876 L5,16 C5,16 5.07242747,15.2283988 5.5,15.5 C6.43069361,16.0911921 8.57396448,17 12,17 C15.5536669,17 17.6181635,16.0844828 18.5,15.5 C18.8589052,15.262117 19,16 19,16 L18,18.9876876 C18,18.9876876 17.0049249,20.9999997 12,21 C6.99507512,21.0000003 6,18.9876876 6,18.9876876 Z" />
              </svg>
            )}
          </button>
          <button
            onClick={() => {
              if (!isBookOwner) return;
              setActiveRightView("glossary");
            }}
            disabled={!isBookOwner}
            className={`p-2 rounded transition-colors ${!isBookOwner
              ? "text-gray-600 opacity-50 cursor-not-allowed"
              : activeRightView === "glossary" ? "bg-[#2d4a3e] text-[#CDF056]" : "text-gray-400 hover:text-white"
              }`}
            title={!isBookOwner ? "Only book owners can manage glossary" : "Glossary"}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </button>
          <button
            onClick={() => {
              if (!isBookOwner && collaboratorRole !== "editor") return;
              setActiveRightView(activeRightView === "moreActions" ? "comments" : "moreActions");
            }}
            disabled={!isBookOwner && collaboratorRole !== "editor"}
            className={`p-2 rounded transition-colors ${!isBookOwner && collaboratorRole !== "editor"
              ? "text-gray-600 opacity-50 cursor-not-allowed"
              : activeRightView === "moreActions" ? "bg-[#CDF056] text-white" : "text-gray-400 hover:text-white"
              }`}
            title={!isBookOwner && collaboratorRole !== "editor" ? "Only editors can use more actions" : "More Actions"}
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2L9.09 8.26L2 9.27L7 14.14L5.18 21.02L12 17.77L18.82 21.02L17 14.14L22 9.27L14.91 8.26L12 2Z" />
              <path d="M16 16L18 18L20 16L18 14L16 16Z" fill="currentColor" opacity="0.6" />
            </svg>
          </button>
          <button
            onClick={() => {
              if (!isBookOwner) return;
              setShowCollaboratorModal(true);
            }}
            disabled={!isBookOwner}
            className={`p-2 rounded transition-colors ${!isBookOwner
              ? "text-gray-600 opacity-50 cursor-not-allowed"
              : "text-gray-400 hover:text-white"
              }`}
            title={!isBookOwner ? "Only book owners can manage collaborators" : "Collaborators"}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Highlight Comment Popover - shows comment when clicking a highlight */}
      {highlightCommentPopover && (
        <>
          <div
            className="fixed inset-0 z-[100]"
            onClick={() => setHighlightCommentPopover(null)}
          />
          <div
            className="fixed z-[101] w-80 max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] overflow-y-auto bg-white rounded-xl shadow-xl border border-gray-200 p-4"
            style={{
              left: Math.max(12, Math.min(highlightCommentPopover.x, window.innerWidth - 336)),
              top: (() => {
                const padding = 12;
                const minFromBottom = 400;
                const preferredTop = highlightCommentPopover.y + 12;
                const maxTop = window.innerHeight - minFromBottom - padding;
                return Math.max(padding, Math.min(preferredTop, maxTop));
              })(),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-[#CDF056]/30 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-[#2d4a3e]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                </div>
                <span className="text-gray-900 font-semibold text-sm">
                  {highlightCommentPopover.type === "ai" ? "AI Coach Review" : (highlightCommentPopover.change.user_name || "Collaborator")}
                </span>
              </div>
              <button
                onClick={() => setHighlightCommentPopover(null)}
                className="text-gray-400 hover:text-gray-600 p-0.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {highlightCommentPopover.type === "ai" ? (
              <>
                {highlightCommentPopover.suggestion.category && (
                  <span className="inline-block px-2 py-0.5 bg-[#CDF056]/20 text-[#CDF056] text-xs font-semibold rounded mb-2">
                    {highlightCommentPopover.suggestion.category}
                  </span>
                )}
                {highlightCommentPopover.suggestion.comment ? (
                  <p className="text-gray-800 text-xs leading-relaxed whitespace-pre-wrap">
                    {highlightCommentPopover.suggestion.comment}
                  </p>
                ) : (
                  <p className="text-gray-500 text-sm italic">No additional comment</p>
                )}
                {highlightCommentPopover.suggestion.suggested_change && (
                  <div className="my-2 p-2 bg-gray-50 rounded text-sm">
                    <span className="text-gray-500 font-medium">Replace with: </span>
                    <span className="text-[#2d4a3e] whitespace-pre-wrap">"{htmlToDisplayText(highlightCommentPopover.suggestion.suggested_change)}"</span>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2 items-center">
                  <button
                    onClick={() => {
                      setHighlightedReviewSuggestionKey(suggestionKey(highlightCommentPopover.suggestion));
                      setHighlightPreviewMode("ai");
                      setActiveRightView("review");
                      setHighlightCommentPopover(null);
                    }}
                    className="text-xs text-[#CDF056] hover:underline"
                  >
                    View in AI Coach Review →
                  </button>
                  {isBookOwner && (
                    <div className="flex gap-2 ml-auto">
                      <button
                        onClick={() => {
                          setDismissedAiSuggestions((prev) => new Set([...prev, suggestionKey(highlightCommentPopover.suggestion)]));
                          setHighlightCommentPopover(null);
                        }}
                        className="text-xs px-2 py-1 text-gray-500 border border-gray-300 rounded-md hover:bg-gray-50"
                      >
                        Dismiss
                      </button>
                      <button
                        onClick={async () => {
                          const suggestion = highlightCommentPopover.suggestion;
                          setHighlightCommentPopover(null);
                          await handleAcceptAiSuggestion(suggestion);
                        }}
                        disabled={
                          highlightCommentPopover.suggestion.suggested_change == null ||
                          contentChanges.some(
                            (c) =>
                              c.talking_point === highlightCommentPopover.suggestion.talking_point_id &&
                              (!c.status || c.status === "pending")
                          )
                        }
                        className="text-xs px-2 py-1 bg-[#CDF056] text-[#011b2d] rounded-md hover:bg-[#CDF056]/80 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={
                          contentChanges.some(
                            (c) =>
                              c.talking_point === highlightCommentPopover.suggestion.talking_point_id &&
                              (!c.status || c.status === "pending")
                          )
                            ? "Accept or reject collaborator suggestions first"
                            : "Apply this suggestion"
                        }
                      >
                        Accept
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {highlightCommentPopover.change.comment ? (
                  <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">
                    {highlightCommentPopover.change.comment}
                  </p>
                ) : (
                  <p className="text-gray-500 text-sm italic">No comment provided</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2 items-center">
                  <button
                    onClick={() => {
                      setHighlightPreviewMode("collaborators");
                      setActiveRightView("changes");
                      setFocusedChangeTpId(highlightCommentPopover.change.talking_point);
                      setHighlightCommentPopover(null);
                    }}
                    className="text-xs text-[#CDF056] hover:underline"
                  >
                    View in Changes →
                  </button>
                  {!isBookOwner && highlightCommentPopover.change.user === currentUserId && highlightCommentPopover.change.status === "pending" && (
                    <button
                      onClick={async () => {
                        const result = await deleteContentChange(highlightCommentPopover.change.id);
                        if (result.success) {
                          await loadChanges();
                          setHighlightCommentPopover(null);
                        }
                      }}
                      className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                {isBookOwner && highlightCommentPopover.change.status === "pending" && (() => {
                  const oldestId = getOldestPendingChangeId(highlightCommentPopover.change.talking_point);
                  const isOldestPending = highlightCommentPopover.change.id === oldestId;
                  return (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      {!isOldestPending && (
                        <p className="text-xs text-gray-500 mb-2">Approve earlier change(s) for this talking point first.</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            const changeToApprove = highlightCommentPopover.change;
                            setHighlightCommentPopover(null);
                            await handleApproveChange(changeToApprove);
                          }}
                          disabled={!isOldestPending}
                          className={`flex-1 px-3 py-1.5 rounded text-sm ${!isOldestPending
                            ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                            : "bg-green-600 text-white hover:bg-green-700"
                            }`}
                          title={!isOldestPending ? "Approve earlier changes first" : "Accept this change"}
                        >
                          Accept
                        </button>
                        <button
                          onClick={async () => {
                            const result = await rejectContentChange(highlightCommentPopover.change.id);
                            if (result.success) {
                              await loadChanges();
                              setHighlightCommentPopover(null);
                            }
                          }}
                          className="flex-1 px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </>
      )}

      {/* Create Edit Modal - collaborator suggests change from selected text (rich editor with formatting) */}
      {createEditModalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onClick={() => !isSubmittingCreateEdit && setCreateEditModalOpen(false)}
        >
          <div
            className="bg-[#011b2d] border border-[#2d3a4a] rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-[#2d3a4a] flex items-center justify-between shrink-0">
              <h3 className="text-lg font-semibold text-white">Suggest Edit</h3>
              <button
                onClick={() => !isSubmittingCreateEdit && setCreateEditModalOpen(false)}
                className="text-gray-400 hover:text-white p-1"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1 min-h-0">
              <p className="text-sm text-gray-400 mb-4">Edit the text below with formatting (bold, italic, lists, etc.). Your suggestion will appear to the author with the original highlighted and your replacement shown.</p>
              <CreateEditModalEditor
                key={`${createEditTpId}-${createEditFrom}`}
                initialContent={createEditInitialContent}
                editorRef={createEditEditorRef}
                disabled={isSubmittingCreateEdit}
                onSuggest={handleCreateEditSuggest}
                onCancel={() => !isSubmittingCreateEdit && setCreateEditModalOpen(false)}
                isSubmitting={isSubmittingCreateEdit}
              />
            </div>
          </div>
        </div>
      )}

      {/* Collaborator Management Modal */}
      {showCollaboratorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCollaboratorModal(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Collaborators</h3>
                <button
                  onClick={() => setShowCollaboratorModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Invite Form */}
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Invite Collaborator</h4>
                <div className="space-y-3">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="Enter email address"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#CDF056]"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as "editor" | "viewer" | "commenter")}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#CDF056]"
                  >
                    <option value="commenter">Commenter - Can add comments</option>
                    <option value="editor">Editor - Can edit content</option>
                    <option value="viewer">Viewer - Can view only</option>
                  </select>
                  <button
                    onClick={handleInviteCollaborator}
                    disabled={!inviteEmail.trim() || isInviting}
                    className="w-full px-4 py-2 bg-[#CDF056] text-white rounded-lg hover:bg-[#3bc96d] disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    {isInviting ? "Inviting..." : "Invite"}
                  </button>
                </div>
              </div>

              {/* Collaborators List */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Current Collaborators</h4>
                {collaborators.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">No collaborators yet</p>
                ) : (
                  <div className="space-y-2">
                    {collaborators.map((collab) => (
                      <div key={collab.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3 flex-1">
                          <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                            <span className="text-blue-600 text-xs font-semibold">
                              {collab.user_name.substring(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-900">{collab.user_name}</div>
                            <div className="text-xs text-gray-500">{collab.user_email}</div>
                            <select
                              value={collab.role}
                              onChange={(e) => handleUpdateCollaboratorRole(collab.id, e.target.value as "editor" | "viewer" | "commenter")}
                              className="mt-1 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#CDF056]"
                            >
                              <option value="viewer">Viewer - View only</option>
                              <option value="commenter">Commenter - Can comment</option>
                              <option value="editor">Editor - Can edit</option>
                            </select>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveCollaborator(collab.id)}
                          className="text-red-500 hover:text-red-700 p-1 ml-2"
                          title="Remove collaborator"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
