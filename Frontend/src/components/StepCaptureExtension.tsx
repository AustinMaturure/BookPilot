import { Extension } from "@tiptap/core";
import { Plugin } from "prosemirror-state";
import type { Transaction, EditorState } from "prosemirror-state";

export interface StepCaptureOptions {
  talkingPointId?: number;
  captureOnly?: boolean;
}

/**
 * StepCaptureExtension - Captures ProseMirror transaction.steps as the ONLY source of truth
 * 
 * HARD CONSTRAINTS:
 * - Captures steps via transaction.steps
 * - Serializes using step.toJSON()
 * - NO text diffs, NO HTML parsing, NO position calculations
 * - Steps are stored per talking point in window.__CAPTURED_STEPS_BY_TP__[tpId]
 */
export const StepCaptureExtension = Extension.create<StepCaptureOptions>({
  name: 'stepCapture',

  addOptions() {
    return {
      talkingPointId: undefined,
      captureOnly: false,
    };
  },

  addProseMirrorPlugins() {
    const extension = this;
    const talkingPointId = extension.options.talkingPointId;
    const captureOnly = extension.options.captureOnly === true;
    
    if (!talkingPointId) {
      // No talking point ID - don't capture steps
      return [];
    }

    return [
      new Plugin({
        appendTransaction(transactions: readonly Transaction[], oldState: EditorState, newState: EditorState) {
          const steps: any[] = [];
          const inverseSteps: any[] = [];
          let workingDoc = oldState.doc;

          transactions.forEach((tr: Transaction) => {
            if (!tr.docChanged) return;

            // FIX: Only capture steps from user-initiated edits, not programmatic content loads
            // Check if this is a programmatic update (setContent) by checking:
            // 1. Transaction metadata
            // 2. Editor instance flag
            // 3. If transaction replaces entire document (typical of setContent)
            const editor = (newState as any).editorView?.state?.editorView?.dom?.closest?.('.ProseMirror')?.__tiptapEditor;
            const replacesWholeDoc = tr.steps.some((step: any) => {
              const from = typeof step?.from === "number" ? step.from : null;
              const to = typeof step?.to === "number" ? step.to : null;
              if (from === null || to === null) return false;
              return from === 0 && to >= oldState.doc.content.size - 1;
            });
            const isProgrammaticUpdate =
              tr.getMeta('preventCapture') === true ||
              tr.getMeta('setContent') === true ||
              tr.getMeta('isProgrammatic') === true ||
              tr.getMeta('addToHistory') === false ||
              // Check if editor instance has flag set
              (editor && (editor as any).__isProgrammaticUpdate === true) ||
              // Check if this transaction replaces the entire document (setContent pattern)
              replacesWholeDoc ||
              (oldState.doc.content.size > 0 &&
                Math.abs(newState.doc.content.size - oldState.doc.content.size) > oldState.doc.content.size * 0.8);
            
            if (isProgrammaticUpdate) {
              return; // Skip capturing steps from programmatic updates
            }

            // Only capture steps that are user-initiated edits
            if (tr.steps.length === 0) {
              return; // No steps to capture
            }

            // Capture each step and serialize it using step.toJSON()
            tr.steps.forEach((step: any) => {
              try {
                const stepJson = step.toJSON();
                steps.push(stepJson);

                if (captureOnly) {
                  const inverse = step.invert(workingDoc);
                  inverseSteps.unshift(inverse);
                  const applied = step.apply(workingDoc);
                  if (applied.doc) {
                    workingDoc = applied.doc;
                  }
                }
              } catch (error) {
                console.error("Error serializing step:", error);
              }
            });
          });

          // Store steps per talking point in window for access by suggest handler
          // FIX: Track steps per talking point ID, not globally
          if (steps.length > 0) {
            if (!(window as any).__CAPTURED_STEPS_BY_TP__) {
              (window as any).__CAPTURED_STEPS_BY_TP__ = {};
            }
            // Initialize array for this talking point if it doesn't exist
            if (!(window as any).__CAPTURED_STEPS_BY_TP__[talkingPointId]) {
              (window as any).__CAPTURED_STEPS_BY_TP__[talkingPointId] = [];
            }
            // Append new steps for this specific talking point only
            (window as any).__CAPTURED_STEPS_BY_TP__[talkingPointId] = [
              ...(window as any).__CAPTURED_STEPS_BY_TP__[talkingPointId],
              ...steps
            ];
          }

          if (captureOnly && inverseSteps.length > 0) {
            let revertTr = newState.tr;
            inverseSteps.forEach((inv: any) => {
              const mapped = inv.map(revertTr.mapping);
              if (mapped) {
                revertTr = revertTr.step(mapped);
              }
            });
            revertTr.setMeta("preventCapture", true);
            return revertTr;
          }

          return null; // Don't modify the transaction
        },
      } as any),
    ];
  },
});

