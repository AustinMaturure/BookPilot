import { useState, useEffect, useRef, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Node as PMNode } from "prosemirror-model";
import { DecorationSet, Decoration } from "prosemirror-view";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import type { BookOutline } from "./position";
import { updateTalkingPoint, fetchBook, generateTextFromTalkingPoint, chatWithChanges, getComments, createComment, deleteComment, quickTextAction, getBookCollaborators, inviteCollaborator, removeCollaborator, updateCollaboratorRole, getContentChanges, createContentChange, approveContentChange, rejectContentChange, deleteContentChange, updateContentChangeStepJson, getCollaborationState, createTalkingPoint, createSection, type CommentType, type Collaborator, type ContentChange } from "../utils/api";
import ChapterAssetsModal from "./ChapterAssetsModal";
import ChapterAssetsPanel from "./ChapterAssetsPanel";
import { CollaborationExtension } from "./CollaborationExtension";
import { StepCaptureExtension } from "./StepCaptureExtension";
import { Mapping, Step } from "prosemirror-transform";
import { parseSteps, getPreviewFragments, findTextRangeInDoc } from "../utils/stepUtils";
import card2 from "../assets/Branding/Card2.png"
import "./Editor.css";


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
  onTextSelect?: (text: string, position: { x: number; y: number }, selectionRange?: { from: number; to: number }) => void;
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
};

const pendingStepPreviewKey = new PluginKey("pendingStepPreview");
const pendingShadowHighlightKey = new PluginKey("pendingShadowHighlight");

const extractInsertedTextFromRawStep = (rawStep: any): string => {
  if (!rawStep) return "";
  if (typeof rawStep.insertedText === "string") return rawStep.insertedText;
  const extract = (node: any): string => {
    if (!node) return "";
    if (node.type === "text" && node.text) return node.text;
    if (Array.isArray(node.content)) return node.content.map(extract).join("");
    return "";
  };
  const content = rawStep?.slice?.content;
  if (Array.isArray(content)) return content.map(extract).join("");
  return "";
};

const mapStepPositionsToBase = (
  schema: any,
  rawStep: any,
  mapping: Mapping
): { from: number | null; to: number | null } => {
  const from = typeof rawStep?.from === "number" ? rawStep.from : null;
  const to = typeof rawStep?.to === "number" ? rawStep.to : null;
  if (from === null || to === null) return { from, to };

  try {
    const step = Step.fromJSON(schema, rawStep);
    const inverse = mapping.invert();
    const baseFrom = inverse.map(from, -1);
    const baseTo = inverse.map(to, 1);
    mapping.appendMap(step.getMap());
    return { from: baseFrom, to: baseTo };
  } catch (e) {
    // Fallback to raw positions if step parsing fails
    return { from, to };
  }
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
              // Track positions that get mapped through edits
              // Each tracked change is either a deletion OR an insertion (split for independent mapping)
              trackedChanges: [] as Array<{
                type: "deletion" | "insertion";
                text: string;
                trackedFrom: number;
                trackedTo: number;
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
              }> = [];

              console.log(`[PendingShadowHighlight] Received new meta with ${batches.length} batches, docSize=${docSize}`);

              batches.forEach((batch: any[], batchIdx: number) => {
                const batchMapping = new Mapping();
                (batch || []).forEach((rawStep: any, stepIdx: number) => {
                  if (!rawStep || typeof rawStep !== "object") return;

                  const mappedPos = mapStepPositionsToBase(tr.doc.type.schema, rawStep, batchMapping);
                  const from = mappedPos.from;
                  const to = mappedPos.to;
                  const deletedText = rawStep.deletedText || null;
                  const insertedText = extractInsertedTextFromRawStep(rawStep) || null;

                  let baseFrom = typeof from === "number" ? from : 1;
                  let baseTo = typeof to === "number" ? to : baseFrom;

                  console.log(`[PendingShadowHighlight] Batch ${batchIdx} Step ${stepIdx}: from=${from}, to=${to}, deletedText="${(deletedText || '').substring(0, 30)}...", insertedText="${(insertedText || '').substring(0, 30)}..."`);

                  // Handle deletion as a SEPARATE tracked change
                  if (deletedText && typeof deletedText === "string") {
                    const safeFrom = Math.max(0, Math.min(baseFrom, docSize));
                    const safeTo = Math.max(0, Math.min(baseTo, docSize));
                    console.log(`[PendingShadowHighlight] Deletion check: baseFrom=${baseFrom}, baseTo=${baseTo}, safeFrom=${safeFrom}, safeTo=${safeTo}, docSize=${docSize}`);
                    if (safeFrom < safeTo) {
                      console.log(`[PendingShadowHighlight] Creating deletion decoration at ${safeFrom}-${safeTo}`);
                      decorations.push(
                        Decoration.inline(safeFrom, safeTo, {
                          class: "collaborator-pending-deletion",
                        })
                      );
                      trackedChanges.push({
                        type: "deletion",
                        text: deletedText,
                        trackedFrom: safeFrom,
                        trackedTo: safeTo,
                      });
                      baseTo = safeTo;
                    } else {
                      console.log(`[PendingShadowHighlight] Deletion SKIPPED: safeFrom=${safeFrom} >= safeTo=${safeTo}`);
                    }
                  }

                  // Handle insertion as a SEPARATE tracked change
                  if (insertedText && typeof insertedText === "string") {
                    // For replacements (deletion + insertion), position widget AFTER the deletion
                    // so it visually appears after the strikethrough text
                    // For pure insertions (no deletion), position at the insertion point
                    const isReplacement = deletedText && typeof deletedText === "string";
                    const insertPos = isReplacement ? baseTo : baseFrom;
                    const clampedPos = Math.max(1, Math.min(insertPos, docSize));

                    console.log(`[PendingShadowHighlight] Creating insertion widget at ${clampedPos}`);
                    decorations.push(
                      Decoration.widget(
                        clampedPos,
                        () => {
                          const span = document.createElement("span");
                          span.className = "collaborator-pending-insertion";
                          span.textContent = insertedText;
                          span.setAttribute("contenteditable", "false");
                          return span;
                        },
                        { side: 1 }
                      )
                    );
                    // Track insertion SEPARATELY (position is a single point)
                    trackedChanges.push({
                      type: "insertion",
                      text: insertedText,
                      trackedFrom: clampedPos,
                      trackedTo: clampedPos,
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
                const { type, text, trackedFrom, trackedTo } = change;

                // Map the tracked position through the transaction
                // Use assoc=-1 for 'from' (stay left of insertions at this point)
                // Use assoc=1 for 'to' (stay right of insertions at this point)
                const mappedFrom = tr.mapping.map(trackedFrom, -1);
                const mappedTo = tr.mapping.map(trackedTo, 1);

                console.log(`[PendingShadowHighlight] Change ${idx} (${type}): ${trackedFrom}-${trackedTo} -> ${mappedFrom}-${mappedTo}`);

                if (type === "deletion") {
                  const safeFrom = Math.max(0, Math.min(mappedFrom, docSize));
                  const safeTo = Math.max(0, Math.min(mappedTo, docSize));

                  // Verify text at mapped position still matches
                  let textAtPos = "";
                  try {
                    if (safeFrom < safeTo && safeTo <= docSize) {
                      textAtPos = tr.doc.textBetween(safeFrom, safeTo, "");
                    }
                  } catch (e) {
                    // Ignore
                  }

                  const textMatches = textAtPos === text;
                  console.log(`[PendingShadowHighlight] Deletion ${idx}: text at ${safeFrom}-${safeTo}="${textAtPos.substring(0, 20)}...", expected="${text.substring(0, 20)}...", matches=${textMatches}`);

                  if (safeFrom < safeTo && textMatches) {
                    decorations.push(
                      Decoration.inline(safeFrom, safeTo, {
                        class: "collaborator-pending-deletion",
                      })
                    );
                  } else if (safeFrom < safeTo) {
                    // Text doesn't match - try to find it using text search
                    const foundRange = findTextRangeInDoc(tr.doc as any, text, safeFrom);
                    if (foundRange) {
                      console.log(`[PendingShadowHighlight] Deletion ${idx}: found via text search at ${foundRange.from}-${foundRange.to}`);
                      decorations.push(
                        Decoration.inline(foundRange.from, Math.min(foundRange.to, docSize), {
                          class: "collaborator-pending-deletion",
                        })
                      );
                      // Update tracked position to found location
                      updatedTrackedChanges.push({
                        type: "deletion",
                        text,
                        trackedFrom: foundRange.from,
                        trackedTo: foundRange.to,
                      });
                      return; // Skip the default push below
                    } else {
                      console.log(`[PendingShadowHighlight] Deletion ${idx}: text not found, using mapped position anyway`);
                      decorations.push(
                        Decoration.inline(safeFrom, safeTo, {
                          class: "collaborator-pending-deletion",
                        })
                      );
                    }
                  }

                  updatedTrackedChanges.push({
                    type: "deletion",
                    text,
                    trackedFrom: mappedFrom,
                    trackedTo: mappedTo,
                  });
                } else if (type === "insertion") {
                  // For insertions, map with right association to stay after insertions at this point
                  const insertPos = Math.max(1, Math.min(tr.mapping.map(trackedFrom, 1), docSize));
                  console.log(`[PendingShadowHighlight] Insertion ${idx}: ${trackedFrom} -> ${insertPos}`);

                  decorations.push(
                    Decoration.widget(
                      insertPos,
                      () => {
                        const span = document.createElement("span");
                        span.className = "collaborator-pending-insertion";
                        span.textContent = text;
                        span.setAttribute("contenteditable", "false");
                        return span;
                      },
                      { side: 1 }
                    )
                  );

                  updatedTrackedChanges.push({
                    type: "insertion",
                    text,
                    trackedFrom: insertPos,
                    trackedTo: insertPos, // Single point
                  });
                }
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
              // Split deletions and insertions for independent mapping
              trackedChanges: [] as Array<{
                type: "deletion" | "insertion";
                text: string;
                trackedFrom: number;
                trackedTo: number;
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
              }> = [];

              const rawSteps = Array.isArray(meta) ? meta : [];
              const batchMapping = new Mapping();
              rawSteps.forEach((rawStep: any) => {
                if (!rawStep || typeof rawStep !== "object") return;

                const mappedPos = mapStepPositionsToBase(tr.doc.type.schema, rawStep, batchMapping);
                const from = mappedPos.from;
                const to = mappedPos.to;
                const deletedText = rawStep.deletedText || null;
                const insertedText = extractInsertedTextFromRawStep(rawStep) || null;

                let baseFrom = typeof from === "number" ? from : 1;
                let baseTo = typeof to === "number" ? to : baseFrom;

                // Handle deletion as SEPARATE tracked change
                if (deletedText && typeof deletedText === "string") {
                  const safeFrom = Math.max(0, Math.min(baseFrom, docSize));
                  const safeTo = Math.max(0, Math.min(baseTo, docSize));
                  if (safeFrom < safeTo) {
                    decorations.push(
                      Decoration.inline(safeFrom, safeTo, {
                        class: "owner-pending-deletion",
                      })
                    );
                    trackedChanges.push({
                      type: "deletion",
                      text: deletedText,
                      trackedFrom: safeFrom,
                      trackedTo: safeTo,
                    });
                    baseTo = safeTo;
                  }
                }

                // Handle insertion as SEPARATE tracked change
                if (insertedText && typeof insertedText === "string") {
                  // For replacements, position widget AFTER the deletion
                  const isReplacement = deletedText && typeof deletedText === "string";
                  const insertPos = isReplacement ? baseTo : baseFrom;
                  const clampedPos = Math.max(1, Math.min(insertPos, docSize));
                  decorations.push(
                    Decoration.widget(
                      clampedPos,
                      () => {
                        const span = document.createElement("span");
                        span.className = "owner-pending-insertion";
                        span.textContent = insertedText;
                        span.setAttribute("contenteditable", "false");
                        return span;
                      },
                      { side: 1 }
                    )
                  );
                  trackedChanges.push({
                    type: "insertion",
                    text: insertedText,
                    trackedFrom: clampedPos,
                    trackedTo: clampedPos,
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
                const { type, text, trackedFrom, trackedTo } = change;

                const mappedFrom = tr.mapping.map(trackedFrom, -1);
                const mappedTo = tr.mapping.map(trackedTo, 1);

                if (type === "deletion") {
                  const safeFrom = Math.max(0, Math.min(mappedFrom, docSize));
                  const safeTo = Math.max(0, Math.min(mappedTo, docSize));

                  // Verify text at mapped position still matches
                  let textAtPos = "";
                  try {
                    if (safeFrom < safeTo && safeTo <= docSize) {
                      textAtPos = tr.doc.textBetween(safeFrom, safeTo, "");
                    }
                  } catch (e) {
                    // Ignore
                  }

                  const textMatches = textAtPos === text;

                  if (safeFrom < safeTo && textMatches) {
                    decorations.push(
                      Decoration.inline(safeFrom, safeTo, {
                        class: "owner-pending-deletion",
                      })
                    );
                  } else if (safeFrom < safeTo) {
                    // Text doesn't match - try to find it using text search
                    const foundRange = findTextRangeInDoc(tr.doc as any, text, safeFrom);
                    if (foundRange) {
                      decorations.push(
                        Decoration.inline(foundRange.from, Math.min(foundRange.to, docSize), {
                          class: "owner-pending-deletion",
                        })
                      );
                      updatedTrackedChanges.push({
                        type: "deletion",
                        text,
                        trackedFrom: foundRange.from,
                        trackedTo: foundRange.to,
                      });
                      return; // Skip the default push below
                    } else {
                      decorations.push(
                        Decoration.inline(safeFrom, safeTo, {
                          class: "owner-pending-deletion",
                        })
                      );
                    }
                  }

                  updatedTrackedChanges.push({
                    type: "deletion",
                    text,
                    trackedFrom: mappedFrom,
                    trackedTo: mappedTo,
                  });
                } else if (type === "insertion") {
                  const insertPos = Math.max(1, Math.min(tr.mapping.map(trackedFrom, 1), docSize));
                  decorations.push(
                    Decoration.widget(
                      insertPos,
                      () => {
                        const span = document.createElement("span");
                        span.className = "owner-pending-insertion";
                        span.textContent = text;
                        span.setAttribute("contenteditable", "false");
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
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-blue-600 underline",
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

    // Add step capture extension for collaborators to capture steps for suggestions
    // FIX: Pass talkingPointId to track steps per talking point
    if (isCollaborator && talkingPointId) {
      baseExtensions.push(StepCaptureExtension.configure({
        talkingPointId: talkingPointId,
      }));
    }

    baseExtensions.push(PendingShadowHighlightExtension);
    baseExtensions.push(PendingStepPreviewExtension.configure({
      previewEnabled: !isCollaborator,
    }));

    return baseExtensions;
  }, [enableCollaboration, collabInitialized, talkingPointId, collabVersion, pendingChanges, isCollaborator, hasChanges, placeholder, previewStepJson]);

  const editor = useEditor({
    editable: !isReadOnly,
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
                  onTextSelect(selectedText.trim(), { x: coords.left, y: coords.top }, { from, to });
                }
              } else if (browserSelection.trim().length > 0) {
                // Fallback to browser selection if Tiptap selection is empty
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

  // Legacy ChangeTrackingExtension removed; suggestions handled by step decorations only


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
  useEffect(() => {
    if (!editor) return;

    // Serialize to compare if data actually changed
    const currentSerialized = JSON.stringify(pendingHighlightStepJsons || []);
    if (currentSerialized === prevPendingHighlightRef.current) {
      return; // No change, skip dispatch
    }
    prevPendingHighlightRef.current = currentSerialized;

    // Reset editing state when new data comes in
    isEditingRef.current = false;

    const extension = editor.extensionManager.extensions.find((ext: any) => ext.name === "pendingShadowHighlight");
    if (extension) {
      const tr = editor.state.tr.setMeta(pendingShadowHighlightKey, pendingHighlightStepJsons || []);
      editor.view.dispatch(tr);
    }
  }, [editor, pendingHighlightStepJsons]);

  // Refresh preview decorations when pending changes update (owner view)
  const prevPreviewStepJsonRef = useRef<string>("");
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
  }, [editor, pendingChanges, previewStepJson]);

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
      {/* Toolbar */}
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-2.5 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 border-r border-gray-300 pr-2 mr-2">
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={`p-1.5 rounded hover:bg-gray-200 ${editor.isActive("heading", { level: 1 }) ? "bg-gray-200" : ""
              }`}
            title="Heading 1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19h14M5 5h14M5 12h14" />
            </svg>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`p-1.5 rounded hover:bg-gray-200 ${editor.isActive("heading", { level: 2 }) ? "bg-gray-200" : ""
              }`}
            title="Heading 2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19h14M5 5h14M5 12h14" />
            </svg>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={`p-1.5 rounded hover:bg-gray-200 ${editor.isActive("heading", { level: 3 }) ? "bg-gray-200" : ""
              }`}
            title="Heading 3"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19h14M5 5h14M5 12h14" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-1 border-r border-gray-300 pr-2 mr-2">
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1.5 rounded hover:bg-gray-200 ${editor.isActive("bold") ? "bg-gray-200" : ""}`}
            title="Bold"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 4h8a4 4 0 014 4v8a4 4 0 01-4 4H6a4 4 0 01-4-4V8a4 4 0 014-4z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6" />
            </svg>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1.5 rounded hover:bg-gray-200 ${editor.isActive("italic") ? "bg-gray-200" : ""}`}
            title="Italic"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`p-1.5 rounded hover:bg-gray-200 ${editor.isActive("bulletList") ? "bg-gray-200" : ""}`}
            title="Bullet List"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h13M8 12h13m-7 6h7M3 6h.01M3 12h.01M3 18h.01" />
            </svg>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`p-1.5 rounded hover:bg-gray-200 ${editor.isActive("orderedList") ? "bg-gray-200" : ""}`}
            title="Numbered List"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              const url = window.prompt("Enter URL:");
              if (url) {
                editor.chain().focus().setLink({ href: url }).run();
              }
            }}
            className={`p-1.5 rounded hover:bg-gray-200 ${editor.isActive("link") ? "bg-gray-200" : ""}`}
            title="Link"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </button>
          <button
            onClick={() => editor.chain().focus().unsetLink().run()}
            disabled={!editor.isActive("link")}
            className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Remove Link"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </button>
        </div>
      </div>

      {/* Editor Content */}
      <div
        onClick={() => {
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
  const [selectedItem, setSelectedItem] = useState<SelectedItem>(null);
  const [generatingTpId, setGeneratingTpId] = useState<number | null>(null);
  const [expandedChapters, setExpandedChapters] = useState<Record<number, boolean>>({});
  const [assetsModalOpen, setAssetsModalOpen] = useState(false);
  const [currentTalkingPointId, setCurrentTalkingPointId] = useState<number | null>(null);
  const [currentChapterId, setCurrentChapterId] = useState<number | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<number[]>([]);
  const [activeRightView, setActiveRightView] = useState<"comments" | "chat" | "changes" | "moreActions">("comments");
  const [selectedText, setSelectedText] = useState<string>("");
  const [selectionPosition, setSelectionPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectionRange, setSelectionRange] = useState<{ from: number; to: number } | null>(null);
  const [chatMessages, setChatMessages] = useState<Array<{ from: "user" | "ai"; text: string; highlightedText?: string }>>([]);
  const [chatInput, setChatInput] = useState("");
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
  const isBookOwner = !isCollaboration;
  // Track original content for change detection (for collaborators)
  const [originalContents, setOriginalContents] = useState<Record<number, string>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<Record<number, boolean>>({});
  const currentUserId = (window as any).currentUserId ?? null;

  const escapeHtml = (value: string): string =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

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
    const preview = getPreviewFragments(doc, steps, { maxFragment: 200 });

    console.log(`[getChangePreviewText] From getPreviewFragments: deleted="${preview.deleted}", inserted="${preview.inserted}"`);

    // ALWAYS extract from raw step_json - this is more reliable for compressed steps
    const stepJson = (change as any).step_json;
    const rawSteps = Array.isArray(stepJson) ? stepJson : [stepJson];

    const deletedParts: string[] = [];
    const insertedParts: string[] = [];

    for (const raw of rawSteps) {
      if (!raw || typeof raw !== "object") continue;

      console.log(`[getChangePreviewText] Raw step keys:`, Object.keys(raw));

      // Check for stored deletedText (from compression) - ACCUMULATE all deletions
      if (raw.deletedText && typeof raw.deletedText === "string" && raw.deletedText.trim()) {
        deletedParts.push(raw.deletedText);
      }

      // Check for stored insertedText (from compression) - ACCUMULATE all insertions
      if (raw.insertedText && typeof raw.insertedText === "string" && raw.insertedText.trim()) {
        insertedParts.push(raw.insertedText);
      }
      // Fallback: extract from slice content
      else if (raw.slice?.content && Array.isArray(raw.slice.content)) {
        const extractText = (content: any[]): string => {
          return content
            .map((node: any) => {
              if (node.type === "text" && node.text) return node.text;
              if (node.content && Array.isArray(node.content)) return extractText(node.content);
              return "";
            })
            .join("");
        };
        const sliceText = extractText(raw.slice.content);
        if (sliceText.trim()) {
          insertedParts.push(sliceText);
        }
      }
    }

    // Join all parts with a separator for clarity
    const rawDeleted = deletedParts.join(" ... ");
    const rawInserted = insertedParts.join(" ... ");

    console.log(`[getChangePreviewText] Extracted from raw: deleted="${rawDeleted}", inserted="${rawInserted}"`);

    // Prefer raw extraction if it has content (more reliable for compressed steps)
    // Filter out very short deletions that are likely artifacts (like single "-" or whitespace)
    const cleanDeleted = rawDeleted && rawDeleted.length > 1 && rawDeleted.trim().length > 0 ? rawDeleted : "";

    if (cleanDeleted || rawInserted) {
      return { deleted: cleanDeleted, inserted: rawInserted };
    }

    // Fall back to getPreviewFragments result, but also clean short artifacts
    const cleanPreviewDeleted = preview.deleted && preview.deleted.length > 1 && preview.deleted.trim().length > 0
      ? preview.deleted
      : "";
    return { deleted: cleanPreviewDeleted, inserted: preview.inserted };
  };

  const getChangePreviewHtml = (change: ContentChange): string => {
    const diff = getChangePreviewText(change);
    if (!diff.deleted && !diff.inserted) return "";

    const parts: string[] = [];
    if (diff.deleted) {
      parts.push(
        `<span class="pending-step-deletion" data-pending-preview="deletion">${escapeHtml(diff.deleted)}</span>`
      );
    }
    if (diff.inserted) {
      parts.push(
        `<span class="pending-step-insertion" data-pending-preview="insertion">${escapeHtml(diff.inserted)}</span>`
      );
    }
    return parts.join(" ").trim();
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
        setSelectionPosition(null);
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
      alert("No changes detected. Please make some edits in the editor first, then click Suggest Edit.");
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

        // If texts are the same, no change needed
        if (originalText !== finalText) {
          // Multi-hunk diff algorithm to detect SEPARATE edit regions
          // This properly handles "add here, delete there" scenarios
          type Hunk = { origStart: number; origEnd: number; finalStart: number; finalEnd: number; deleted: string; inserted: string };
          const hunks: Hunk[] = [];

          const MIN_MATCH = 10; // Minimum matching chars to consider a "stable" region

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

            // Found a difference - now find where texts sync up again
            const hunkOrigStart = origIdx;
            const hunkFinalStart = finalIdx;

            // Look for next matching region of at least MIN_MATCH characters
            let foundMatch = false;
            let bestOrigEnd = originalText.length;
            let bestFinalEnd = finalText.length;

            // Search for sync point
            for (let searchOrig = origIdx; searchOrig <= originalText.length - MIN_MATCH && !foundMatch; searchOrig++) {
              for (let searchFinal = finalIdx; searchFinal <= finalText.length - MIN_MATCH && !foundMatch; searchFinal++) {
                // Check if we have MIN_MATCH matching characters
                let matchLen = 0;
                while (
                  searchOrig + matchLen < originalText.length &&
                  searchFinal + matchLen < finalText.length &&
                  originalText[searchOrig + matchLen] === finalText[searchFinal + matchLen]
                ) {
                  matchLen++;
                }

                if (matchLen >= MIN_MATCH) {
                  bestOrigEnd = searchOrig;
                  bestFinalEnd = searchFinal;
                  foundMatch = true;
                }
              }
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
                step.slice = { content: [{ type: "text", text: hunk.inserted }] };
                step.insertedText = hunk.inserted;
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
      // Send compressed step_json
      const result = await createContentChange({
        talking_point_id: tpId,
        step_json: stepsToSubmit,
      });

      if (result.success) {
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
        setActiveRightView("changes");
      } else {
        console.error("❌ Failed to create suggestion:", result);
        alert("Failed to create suggestion. Please try again.");
      }
    } catch (error) {
      console.error("Error suggesting edit:", error);
      alert("Error creating suggestion. Please try again.");
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
      alert("This suggestion has already been approved.");
      return;
    }

    const changeTpId = change.talking_point;
    const stepJsonArray = change.step_json;

    if (!stepJsonArray || !Array.isArray(stepJsonArray) || stepJsonArray.length === 0) {
      console.error("❌ No step_json found - this suggestion cannot be applied");
      alert("This suggestion cannot be applied - no step data available.");
      return;
    }

    if (isBookOwner && change.status === "pending") {
      const oldestPendingId = getOldestPendingChangeId(change.talking_point);
      if (oldestPendingId && change.id !== oldestPendingId) {
        alert("Please approve earlier changes for this talking point first.");
        return;
      }
    }

    try {
      const editorRef = editorRefs.current[changeTpId]?.current;
      if (!editorRef) {
        console.error("❌ Editor not found for talking point:", changeTpId);
        alert("Editor not found. Please refresh the page.");
        return;
      }

      // CRITICAL: Apply steps using ProseMirror transactions
      // Steps must be applied in a single transaction, sequentially
      // Each step sees the document state after previous steps are applied
      const { state, view } = editorRef;

      // Ensure we have a valid document state
      if (!state || !state.doc) {
        console.error("❌ Invalid editor state");
        alert("Editor state is invalid. Please refresh the page.");
        return;
      }

      // Ensure we are applying against the correct base document to avoid invalid steps
      const baseDocJson = (change as any).base_doc_json || (change as any).base_doc;
      if (baseDocJson) {
        try {
          const baseDoc = PMNode.fromJSON(state.schema, baseDocJson);
          if (!baseDoc.eq(state.doc)) {
            alert(
              "This suggestion was created on an older version of the document. Please refresh to rebase before approving."
            );
            return;
          }
        } catch (error) {
          console.warn("[Approve] Invalid base_doc_json; cannot safely apply steps.", error);
          alert("This suggestion cannot be applied safely. Please refresh and try again.");
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
              alert("Change incompatible");
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
            alert("Change incompatible");
            return;
          }

          tr = stepResult;
          tempDoc = testResult.doc;
        } catch (error: any) {
          console.error("❌ Error applying step:", error);
          console.error("Step index:", i, "Total steps:", steps.length);
          console.error("Current document size:", tempDoc.content.size);
          console.error("Step JSON:", JSON.stringify(stepJsonArray[i], null, 2));
          alert(`Change incompatible: ${error?.message || "validation failed"}`);
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
        alert("Steps were applied but failed to save content. Please refresh and try again.");
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
        alert("Steps were applied and saved, but failed to update approval status. Please refresh the page.");
      }
    } catch (error) {
      console.error("❌ Error applying change:", error);
      alert("Error applying change. Please try again.");
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
    // Only auto-save for book owners. Collaborators must use "Suggest Edit" button
    if (!isBookOwner) {
      return;
    }

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
          alert("Failed to create section. Please try again.");
          return;
        }
      } catch (error) {
        console.error("Error creating section:", error);
        alert("Failed to create section. Please try again.");
        return;
      }
    }

    if (!targetSection?.id) {
      alert("Could not find or create a section. Please try again.");
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
      alert("Failed to generate talking points. Please try again.");
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
      alert("Viewers cannot add comments. Please ask the book owner to change your role.");
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
      alert("Failed to update collaborator role. Please try again.");
    }
  };

  const handleQuickAction = async (action: "shorten" | "strengthen" | "clarify" | "expand" | "remove_repetition" | "regenerate" | "improve_flow" | "split_paragraph" | "turn_into_bullets" | "add_transition" | "rewrite_heading" | "suggest_subheading" | "give_example") => {
    // Only editors can perform quick actions
    if (!isBookOwner && collaboratorRole !== "editor") {
      alert("Only editors can perform this action. Please ask the book owner to change your role.");
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
      {/* Chapter Assets Panel - Left Side (when open for chapters) */}
      {assetsModalOpen && currentChapterId && bookId && outline && (() => {
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
      })()}

      {/* Left Sidebar - Contents/Outline (hidden when chapter assets modal is open) */}
      <div className={`mt-13 bg-[#011b2d] border-r border-gray-200 overflow-y-auto transition-all ${assetsModalOpen && currentChapterId ? 'w-0 hidden' : 'w-64'}`}>
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
                      className="flex-1 text-left px-3 py-2 text-sm font-semibold text-white hover:bg-[#011b2d]/50 rounded flex items-center gap-2"
                    >
                      <svg
                        className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <span> {chapter.title}</span>
                    </button>
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
                          <button
                            key={sectionId}
                            onClick={() => handleSectionClick(chapterId, sectionId, section.title)}
                            className={`w-full text-left px-3 py-2 text-sm text-white/70 hover:bg-[#CDF056]/5  flex items-center gap-2 ${isSelected ? "bg-[#CDF056]/10 border-l-2 border-[#CDF056]" : ""
                              }`}
                          >
                            <span className="text-xs text-gray-500">{si + 1}</span>
                            <span className="flex-1 truncate">{section.title}</span>

                          </button>
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

      {/* Middle Editor Area */}
      <div className="flex-1 flex flex-col bg-white overflow-hidden mt-15">
        {selectedSection ? (
          <>
            {/* Editor Header */}
            <div className="border-b border-gray-200 px-6 py-4 bg-white shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">{selectedSection.title}</h2>
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
                    const pendingHighlightStepJsons = shadowSuggestions.map((s) =>
                      Array.isArray(s.step_json) ? s.step_json : [s.step_json]
                    );
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
                    const previewStepJson = previewChange ? (previewChange as any).step_json : null;

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
                                  : "bg-[#CDF056] text-white hover:bg-[#3bc96d] disabled:opacity-50 disabled:cursor-not-allowed"
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
                          <div className="text-gray-900 font-semibold" data-tp-id={tpId}>{tp.text || `Talking Point ${ti + 1}`}</div>
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
                            onTextSelect={(text, position, range) => {
                              setSelectedText(text);
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
                            isReadOnly={!isBookOwner && collaboratorRole !== "editor"}
                            hasPendingChanges={hasPendingChanges}
                            previewStepJson={previewStepJson}
                            shadowSuggestions={shadowSuggestions}
                            pendingHighlightStepJsons={pendingHighlightStepJsons}
                            onPendingChangeClick={() => {
                              if (!isBookOwner || !hasPendingChanges) return;
                              setCurrentTalkingPointId(tpId);
                              setFocusedChangeTpId(tpId);
                              setActiveRightView("changes");
                              const oldestPendingId = getOldestPendingChangeId(tpId);
                              const changeToHighlight = contentChanges.find((c) => c.id === oldestPendingId);
                              if (changeToHighlight) {
                                highlightChangeInEditor(changeToHighlight);
                              }
                            }}
                          />
                          {/* Suggest Edit Button - for editors only */}
                          {!isBookOwner && collaboratorRole === "editor" && (() => {
                            // FIX: Only show button if there are actual edits (content differs from original)
                            const hasEdits = !!hasUnsavedChanges[tpId];
                            // FIX: Get steps for this specific talking point only
                            const capturedStepsForTp = (window as any).__CAPTURED_STEPS_BY_TP__?.[tpId];
                            const hasCapturedSteps = capturedStepsForTp && capturedStepsForTp.length > 0;

                            // Show button only if there are both edits AND captured steps for THIS talking point
                            if (!hasEdits || !hasCapturedSteps) return null;

                            return (
                              <div className="mt-2 flex justify-end">
                                <button
                                  onClick={() => handleSuggestEdit(tpId)}
                                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm font-medium"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                  Suggest Edit ({capturedStepsForTp.length} steps)
                                </button>
                              </div>
                            );
                          })()}
                          {/* Quick Actions & Add to Chat - appears when text is selected */}
                          {selectedText && selectionPosition && currentTalkingPointId === tpId && (
                            <div
                              className="fixed z-50 bg-[#011b2d] border border-[#2d3a4a] rounded-lg shadow-lg p-1 flex flex-col gap-2"
                              style={{
                                left: `${selectionPosition.x}px`,
                                top: `${selectionPosition.y + 20}px`,
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {/* Quick Actions */}
                              <div className="flex flex-col gap-0.5">
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
                          )}
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
                      className="mt-2 px-4 py-1.5 bg-[#CDF056] text-white rounded-lg hover:bg-[#3bc96d] disabled:opacity-50 disabled:cursor-not-allowed text-sm"
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
                  <div className="text-center text-gray-400 text-sm py-4">Loading comments...</div>
                ) : comments.length === 0 ? (
                  <div className="text-center text-gray-400 text-sm py-4">No comments yet. Be the first to comment!</div>
                ) : (
                  <div className="space-y-3">
                    {comments.map((comment) => renderComment(comment))}
                  </div>
                )}
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
                  <div className="text-center text-gray-400 text-sm py-4">Loading changes...</div>
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
                  relevantChanges = relevantChanges.sort((a, b) => {
                    const dateA = new Date(a.created_at).getTime();
                    const dateB = new Date(b.created_at).getTime();
                    return dateB - dateA; // Descending order (newest first)
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
                            <div className="text-white text-xs font-semibold mb-1">{change.user_name}</div>
                            <div className="text-gray-400 text-xs">
                              {new Date(change.created_at).toLocaleDateString()} {new Date(change.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                            <div className={`inline-block px-2 py-0.5 rounded text-xs mt-1 ${change.status === "pending" ? "bg-yellow-500/20 text-yellow-400" :
                                change.status === "approved" ? "bg-green-500/20 text-green-400" :
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

                            if (!isBookOwner) {
                              const preview = getChangePreviewText(change);
                              const hasDeleted = preview.deleted.length > 0;
                              const hasInserted = preview.inserted.length > 0;

                              console.log(`[ChangesTab] Rendering change ${change.id}: hasDeleted=${hasDeleted}, hasInserted=${hasInserted}`);
                              console.log(`[ChangesTab] preview.deleted="${preview.deleted.substring(0, 50)}..."`);
                              console.log(`[ChangesTab] preview.inserted="${preview.inserted.substring(0, 50)}..."`);
                              console.log(`[ChangesTab] Raw step_json:`, (change as any).step_json);

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
                            }

                            const previewHtml = getChangePreviewHtml(change);
                            if (previewHtml) {
                              return (
                                <div>
                                  <div className="text-xs text-gray-400 mb-2 font-medium">SUGGESTED CHANGE:</div>
                                  <div
                                    className="text-sm text-gray-200 whitespace-pre-wrap"
                                    style={{ wordBreak: "break-word" }}
                                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                                  />
                                </div>
                              );
                            }

                            if (!hasDeleted && !hasInserted) {
                              const steps = Array.isArray(stepJson) ? stepJson : [stepJson];
                              return (
                                <div>
                                  <div className="text-xs text-gray-400 mb-2 font-medium">SUGGESTED CHANGE:</div>
                                  <div className="bg-gray-500/10 border border-gray-500/30 rounded p-3">
                                    <p className="text-xs text-gray-400">
                                      {steps.length > 1 ? "Preview unavailable" : "Preview unavailable"}
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
                                        className="text-sm text-red-300 whitespace-pre-wrap line-through"
                                        style={{ wordBreak: "break-word" }}
                                      >
                                        {preview.deleted}
                                      </p>
                                    </div>
                                  )}
                                  {hasInserted && (
                                    <div className="bg-green-500/10 border border-green-500/30 rounded p-3">
                                      <div className="text-xs text-green-400 mb-1 font-semibold">Inserted</div>
                                      <p
                                        className="text-sm text-green-300 whitespace-pre-wrap"
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

                        {isBookOwner && change.status === "pending" && (
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={() => handleApproveChange(change)}
                              disabled={!isOldestPending}
                              className={`flex-1 px-3 py-1.5 rounded text-sm ${!isOldestPending
                                  ? "bg-gray-500 text-gray-300 cursor-not-allowed"
                                  : "bg-green-600 text-white hover:bg-green-700"
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

                        {!isBookOwner && change.status === "pending" && change.user === (window as any).currentUserId && (
                          <button
                            onClick={async () => {
                              const result = await deleteContentChange(change.id);
                              if (result.success) {
                                // Reload changes for the current section
                                if (selectedSection && bookId) {
                                  await loadChanges();
                                }
                              }
                            }}
                            className="mt-3 px-3 py-1.5 bg-red-600 text-white rounded hover:bg-red-700 text-sm w-full"
                          >
                            Delete
                          </button>
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
                {chatMessages.length === 0 ? (
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
                    onChange={(e) => setChatInput(e.target.value)}
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
