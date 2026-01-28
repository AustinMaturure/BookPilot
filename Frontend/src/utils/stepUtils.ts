import { Decoration, DecorationSet } from "prosemirror-view";
import { Step, Mapping } from "prosemirror-transform";
import type { Schema, Node as PMNode } from "prosemirror-model";

type ApplyResult = {
  doc: PMNode;
  failed: boolean;
  failedStepIndex?: number;
  failedReason?: string;
};

type MapResult = {
  steps: Step[];
  failed: boolean;
  failedStepIndex?: number;
  failedReason?: string;
};

type PreviewFragments = {
  inserted: string;
  deleted: string;
};

type PreviewOptions = {
  maxFragment?: number;
};

type DecorationMode = "owner" | "collab";

export const clampToTextRange = (doc: PMNode, from: number, to: number): { from: number; to: number } | null => {
  if (!doc) return null;
  const docSize = doc.content.size;
  if (docSize === 0) return null;
  const safeFrom = Math.max(0, Math.min(from, docSize));
  const safeTo = Math.max(0, Math.min(to, docSize));
  if (safeTo <= safeFrom) return null;
  let textFrom: number | null = null;
  let textTo: number | null = null;

  doc.nodesBetween(safeFrom, safeTo, (node, pos) => {
    if (node.isText) {
      if (textFrom === null) {
        textFrom = pos;
      }
      textTo = pos + node.nodeSize;
    }
    return true;
  });

  if (textFrom === null || textTo === null) return null;
  if (textTo <= textFrom) return null;
  return { from: textFrom, to: textTo };
};

const extractSliceText = (stepAny: any): string => {
  const sliceContent = stepAny?.slice?.content ?? stepAny?.slice;
  if (!sliceContent) return "";
  
  const extract = (node: any): string => {
    if (!node) return "";
    // Handle ProseMirror text nodes (live objects)
    if (node.isText && typeof node.text === "string") return node.text;
    // Handle JSON text nodes
    if (node.type === "text" && node.text) return node.text;
    // Handle arrays
    if (Array.isArray(node)) return node.map(extract).join("");
    // Handle JSON content arrays
    if (node.content && Array.isArray(node.content)) {
      return node.content.map(extract).join("");
    }
    // Handle ProseMirror Fragment objects
    if (typeof node.childCount === "number") {
      let text = "";
      for (let i = 0; i < node.childCount; i++) {
        text += extract(node.child(i));
      }
      return text;
    }
    return "";
  };
  
  return extract(sliceContent);
};

export const parseSteps = (schema: Schema, stepJson: any[] | any): Step[] => {
  const rawSteps = Array.isArray(stepJson) ? stepJson : [stepJson];
  const steps: Step[] = [];
  console.log(`[parseSteps] Parsing ${rawSteps.length} raw steps`);
  
  rawSteps.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") {
      console.log(`[parseSteps] Step ${index}: skipped (not an object)`, raw);
      return;
    }
    
    console.log(`[parseSteps] Step ${index} raw:`, JSON.stringify(raw));
    
    try {
      const step = Step.fromJSON(schema, raw);
      // Copy custom fields from raw JSON to the step instance for preview rendering
      if (raw.deletedText) {
        (step as any).deletedText = raw.deletedText;
        console.log(`[parseSteps] Step ${index}: copied deletedText="${raw.deletedText}"`);
      }
      if (raw.insertedText) {
        (step as any).insertedText = raw.insertedText;
        console.log(`[parseSteps] Step ${index}: copied insertedText="${raw.insertedText}"`);
      }
      // Copy originalFrom - the exact position where user typed
      if (typeof raw.originalFrom === "number") {
        (step as any).originalFrom = raw.originalFrom;
        console.log(`[parseSteps] Step ${index}: copied originalFrom=${raw.originalFrom}`);
      }
      console.log(`[parseSteps] Step ${index} parsed successfully: from=${(step as any).from}, to=${(step as any).to}`);
      steps.push(step);
    } catch (e) {
      // Ignore invalid steps; caller can treat as conflict if needed.
      console.warn("[parseSteps] Failed to parse step:", raw, e);
    }
  });
  
  console.log(`[parseSteps] Parsed ${steps.length} valid steps`);
  return steps;
};

export const applyStepsToDoc = (doc: PMNode, steps: Step[]): ApplyResult => {
  let currentDoc = doc;
  for (let i = 0; i < steps.length; i++) {
    const result = steps[i].apply(currentDoc);
    if (result.failed || !result.doc) {
      return {
        doc: currentDoc,
        failed: true,
        failedStepIndex: i,
        failedReason: result.failed || "apply_failed",
      };
    }
    currentDoc = result.doc;
  }
  return { doc: currentDoc, failed: false };
};

export const mapSteps = (steps: Step[], mapping: Mapping): MapResult => {
  const mappedSteps: Step[] = [];
  for (let i = 0; i < steps.length; i++) {
    const mapped = steps[i].map(mapping);
    if (!mapped) {
      return {
        steps: mappedSteps,
        failed: true,
        failedStepIndex: i,
        failedReason: "map_failed",
      };
    }
    mappedSteps.push(mapped);
  }
  return { steps: mappedSteps, failed: false };
};

export const getPreviewFragments = (
  doc: PMNode,
  steps: Step[],
  options: PreviewOptions = {}
): PreviewFragments => {
  const maxFragment = options.maxFragment ?? Infinity;
  let currentDoc = doc;
  const deletedTexts: string[] = [];
  const insertedTexts: string[] = [];

  steps.forEach((step) => {
    const stepAny = step as any;
    if (typeof stepAny.from !== "number" || typeof stepAny.to !== "number") {
      return;
    }
    const hasSlice = stepAny.slice && stepAny.slice.size > 0;

    const docSize = currentDoc.content.size;
    const safeFrom = Math.max(0, Math.min(stepAny.from, docSize));
    const safeTo = Math.max(0, Math.min(stepAny.to, docSize));

    if (safeFrom < safeTo) {
      // PRIORITY: Use stored deletedText if available (from compressed steps)
      let deleted = "";
      if (stepAny.deletedText && typeof stepAny.deletedText === "string") {
        deleted = stepAny.deletedText;
      } else {
        try {
          deleted = currentDoc.textBetween(safeFrom, safeTo, "\n");
        } catch (e) {
          // ignore
        }
      }
      if (deleted.length > 0 && deleted.length <= maxFragment) {
        deletedTexts.push(deleted);
      }
    }

    if (stepAny.from < 0 || stepAny.to < 0 || stepAny.from > docSize || stepAny.to > docSize) {
      if (typeof globalThis !== "undefined") {
        (globalThis as any).console?.warn?.("[getPreviewFragments] step out of bounds; skipped", {
          from: stepAny.from,
          to: stepAny.to,
          docSize,
        });
      }
      return;
    }

    let applied: { failed: any; doc: PMNode | null };
    try {
      applied = step.apply(currentDoc) as any;
    } catch (error) {
      if (typeof globalThis !== "undefined") {
        (globalThis as any).console?.warn?.("[getPreviewFragments] step apply failed", error);
      }
      return;
    }
    if (applied.failed || !applied.doc) {
      return;
    }

    if (hasSlice) {
      const insertFrom = Math.max(0, Math.min(stepAny.from, applied.doc.content.size));
      const sliceSize = typeof stepAny.slice?.size === "number" ? stepAny.slice.size : 0;
      const insertTo = Math.min(applied.doc.content.size, insertFrom + sliceSize);
      const inserted = applied.doc.textBetween(insertFrom, insertTo, "\n");
      if (inserted.length > 0 && inserted.length <= maxFragment) {
        insertedTexts.push(inserted);
      }
    }

    currentDoc = applied.doc;
  });

  return {
    deleted: deletedTexts.join(" "),
    inserted: insertedTexts.join(" "),
  };
};

/**
 * findTextRangeInDoc - Searches for text in the document and returns its position
 * Used as a fallback when step mapping fails or positions are stale
 */
export const findTextRangeInDoc = (
  doc: PMNode,
  searchText: string,
  hintPos?: number
): { from: number; to: number } | null => {
  if (!searchText || searchText.length === 0) return null;
  
  const fullText = doc.textContent;
  const occurrences: Array<{ from: number; to: number; textIndex: number }> = [];
  
  // Find all occurrences
  let searchStart = 0;
  let idx: number;
  while ((idx = fullText.indexOf(searchText, searchStart)) !== -1) {
    // Convert text index to doc position
    let textSeen = 0;
    let foundFrom = -1;
    doc.descendants((node: any, pos: number) => {
      if (foundFrom !== -1) return false;
      if (node.isText) {
        const nodeText = node.text || "";
        if (idx >= textSeen && idx < textSeen + nodeText.length) {
          foundFrom = pos + (idx - textSeen);
          return false;
        }
        textSeen += nodeText.length;
      }
      return true;
    });
    
    if (foundFrom !== -1) {
      occurrences.push({ from: foundFrom, to: foundFrom + searchText.length, textIndex: idx });
    }
    searchStart = idx + 1;
  }
  
  if (occurrences.length === 0) return null;
  if (occurrences.length === 1) return { from: occurrences[0].from, to: occurrences[0].to };
  
  // If we have a hint position, find the closest occurrence
  if (typeof hintPos === "number") {
    let closest = occurrences[0];
    let minDistance = Math.abs(occurrences[0].from - hintPos);
    
    for (let i = 1; i < occurrences.length; i++) {
      const distance = Math.abs(occurrences[i].from - hintPos);
      if (distance < minDistance) {
        minDistance = distance;
        closest = occurrences[i];
      }
    }
    return { from: closest.from, to: closest.to };
  }
  
  // Return first occurrence if no hint
  return { from: occurrences[0].from, to: occurrences[0].to };
};

/**
 * buildDecorations - Creates decoration overlays for pending changes
 * 
 * STRATEGY: "Base Doc + Overlay"
 * The editor document is the BASE (original) document. Steps describe changes
 * that were made but we want to visualize them WITHOUT applying them.
 * 
 * - Deletions: Use Decoration.inline because the text EXISTS in the base doc
 * - Insertions: Use Decoration.widget to inject text visually (it's NOT in the doc)
 * 
 * IMPORTANT: Steps can be passed as a flat array OR as batches (array of arrays).
 * - Within a batch: cumulative offset applies (steps are sequential in one edit session)
 * - Between batches: NO cumulative offset (each batch is relative to base doc)
 * 
 * @param doc - The current document to create decorations for
 * @param steps - Steps or batches of steps to create decorations from
 * @param mode - "owner" or "collab" for styling
 * @param mapping - Optional mapping to adjust step positions for document changes
 */
export const buildDecorations = (
  doc: PMNode,
  steps: Step[] | Step[][],
  mode: DecorationMode,
  mapping?: Mapping
): DecorationSet => {
  const decorations: Decoration[] = [];
  const docSize = doc.content.size;
  
  // Normalize to batches: if flat array, treat as single batch
  const stepBatches: Step[][] = Array.isArray(steps[0]) 
    ? (steps as Step[][]) 
    : [steps as Step[]];

  console.log(`[buildDecorations] mode=${mode}, batches=${stepBatches.length}, docSize=${docSize}`);

  // Collect insertions by position to merge consecutive ones
  const insertionsByPos: Map<number, { text: string; isReplacement: boolean }> = new Map();

  // Determine CSS classes based on mode
  const deletionClass = mode === "owner" ? "owner-pending-deletion" : "collaborator-pending-deletion";
  const insertionClass = mode === "owner" ? "owner-pending-insertion" : "collaborator-pending-insertion";

  // Process each batch independently - each batch is relative to base doc
  stepBatches.forEach((batch, batchIndex) => {
    // Reset offset for each batch - each content change is relative to base doc
    let cumulativeOffset = 0;
    
    console.log(`[buildDecorations] Processing batch ${batchIndex} with ${batch.length} steps`);
    
    batch.forEach((step, stepIndex) => {
      // If mapping is provided, map the step to get updated positions
      let workingStep = step;
      if (mapping) {
        const mappedStep = step.map(mapping);
        if (!mappedStep) {
          // Step's content was deleted - skip this decoration
          console.log(`[buildDecorations] Step ${stepIndex}: skipped (mapping returned null - content deleted)`);
          return;
        }
        workingStep = mappedStep;
        // Copy custom fields from original step to mapped step
        const origAny = step as any;
        const mappedAny = workingStep as any;
        if (origAny.deletedText) mappedAny.deletedText = origAny.deletedText;
        if (origAny.insertedText) mappedAny.insertedText = origAny.insertedText;
        if (typeof origAny.originalFrom === "number") mappedAny.originalFrom = origAny.originalFrom;
      }
      
      const stepAny = workingStep as any;
      
      console.log(`[buildDecorations] Step ${stepIndex}: from=${stepAny.from}, to=${stepAny.to}, deletedText="${stepAny.deletedText || ''}", slice.size=${stepAny.slice?.size || 0}, mapped=${!!mapping}`);
      
      if (typeof stepAny.from !== "number" || typeof stepAny.to !== "number") {
        console.log(`[buildDecorations] Step ${stepIndex}: skipped (invalid from/to)`);
        return;
      }
      
      // FIX: Handle inverted from/to (our compression might produce this due to position calculation bugs)
      // Normalize so actualFrom <= actualTo
      const actualFrom = Math.min(stepAny.from, stepAny.to);
      const actualTo = Math.max(stepAny.from, stepAny.to);
      
      const hasSlice = stepAny.slice && stepAny.slice.size > 0;
      const sliceSize = stepAny.slice?.size || 0;
      
      // Check for deletion based on stored deletedText (most reliable)
      const hasStoredDeletion = stepAny.deletedText && typeof stepAny.deletedText === "string" && stepAny.deletedText.length > 0;
      const hasStoredInsertion = stepAny.insertedText && typeof stepAny.insertedText === "string" && stepAny.insertedText.length > 0;
      
      // Use stored text fields as primary detection (more reliable than positions)
      const isDeletion = hasStoredDeletion && !hasSlice;
      const isInsertion = (hasSlice || hasStoredInsertion) && actualFrom === actualTo;
      const isReplacement = hasStoredDeletion && (hasSlice || hasStoredInsertion);
      
      console.log(`[buildDecorations] Step ${stepIndex}: isDeletion=${isDeletion}, isInsertion=${isInsertion}, isReplacement=${isReplacement}, hasStoredDeletion=${hasStoredDeletion}`);

      // DELETIONS: Text EXISTS in base doc → Decoration.inline with strikethrough
      if (isDeletion || isReplacement) {
        const storedDeletedText = stepAny.deletedText;
        
        let finalFrom = actualFrom;
        let finalTo = actualTo;
        
        // If we have deletedText, compute finalTo from the text length for accuracy
        if (storedDeletedText && typeof storedDeletedText === "string" && storedDeletedText.length > 0) {
          finalTo = finalFrom + storedDeletedText.length;
        }
        
        // Clamp to document bounds
        finalFrom = Math.max(0, Math.min(finalFrom, docSize));
        finalTo = Math.max(finalFrom, Math.min(finalTo, docSize));
        
        console.log(`[buildDecorations] Deletion: using step positions from=${actualFrom}, to=${actualTo}, finalFrom=${finalFrom}, finalTo=${finalTo}, deletedText="${(storedDeletedText || '').substring(0, 30)}..."`);
        
        // Verify the positions point to valid text
        let textMatches = false;
        if (finalFrom < finalTo && finalTo <= docSize && storedDeletedText) {
          try {
            const actualText = doc.textBetween(finalFrom, finalTo, "");
            textMatches = actualText === storedDeletedText;
            if (!textMatches) {
              console.log(`[buildDecorations] Text mismatch at positions ${finalFrom}-${finalTo}: expected "${storedDeletedText.substring(0, 30)}..." but found "${actualText.substring(0, 30)}..."`);
            }
          } catch (e) {
            console.log(`[buildDecorations] Could not verify text at positions ${finalFrom}-${finalTo}:`, e);
          }
        }
        
        // If text doesn't match, use findTextRangeInDoc as fallback
        if (!textMatches && storedDeletedText) {
          console.log(`[buildDecorations] Using text search fallback for deletion "${storedDeletedText.substring(0, 30)}..."`);
          const foundRange = findTextRangeInDoc(doc, storedDeletedText, finalFrom);
          if (foundRange) {
            finalFrom = foundRange.from;
            finalTo = foundRange.to;
            console.log(`[buildDecorations] Found text at ${finalFrom}-${finalTo} via text search`);
          } else {
            console.log(`[buildDecorations] Text not found in document, skipping deletion decoration`);
            return; // Skip this decoration - text was deleted
          }
        }
        
        // Create the decoration
        if (finalFrom < finalTo && finalTo <= docSize) {
          decorations.push(
            Decoration.inline(finalFrom, finalTo, {
              class: deletionClass,
              "data-pending-preview": isReplacement ? "replacement-delete" : "deletion",
            })
          );
          console.log(`[buildDecorations] Created deletion decoration at ${finalFrom}-${finalTo}`);
        } else {
          console.log(`[buildDecorations] Invalid deletion range: finalFrom=${finalFrom}, finalTo=${finalTo}, docSize=${docSize}`);
        }
        
        // Update offset within this batch
        const deletionLen = Math.abs(actualTo - actualFrom);
        if (!isReplacement) {
          cumulativeOffset += deletionLen;
        } else {
          cumulativeOffset += deletionLen - sliceSize;
        }
      }

      // INSERTIONS: Use the exact original position where user typed
      if (isInsertion || isReplacement) {
        const insertedText = stepAny.insertedText || extractSliceText(stepAny);
        
        console.log(`[buildDecorations] Processing insertion: insertedText="${(insertedText || '').substring(0, 30)}...", isReplacement=${isReplacement}`);
        
        if (insertedText) {
          // Calculate insertion position
          let insertPos = -1;
          
          if (isReplacement) {
            // For replacement: position widget at START of change (same as deletion start)
            // With side: 1, it will render AFTER any inline decoration spanning this position
            // This makes it appear visually right after the strikethrough text
            insertPos = Math.max(1, Math.min(actualFrom, docSize));
            console.log(`[buildDecorations] Replacement: positioning insertion at ${insertPos} (deletion starts here)`);
          } else {
            // For pure insertions, use originalFrom or from
            if (typeof stepAny.originalFrom === "number") {
              insertPos = Math.max(1, Math.min(stepAny.originalFrom, docSize));
              console.log(`[buildDecorations] Using originalFrom=${stepAny.originalFrom}, clamped to docPos=${insertPos}`);
            } else if (typeof stepAny.from === "number") {
              insertPos = Math.max(1, Math.min(stepAny.from, docSize));
              console.log(`[buildDecorations] Using step.from=${stepAny.from}, clamped to docPos=${insertPos}`);
            }
          }
          
          // Fallback to position 1
          if (insertPos === -1) {
            insertPos = 1;
            console.log(`[buildDecorations] Fallback to docPos=1`);
          }
          
          // Merge with existing insertion at this position
          const existing = insertionsByPos.get(insertPos);
          if (existing) {
            existing.text += insertedText;
          } else {
            insertionsByPos.set(insertPos, { text: insertedText, isReplacement });
          }
          
          console.log(`[buildDecorations] Queued insertion at ${insertPos}: "${insertedText.substring(0, 50)}..."`);
        }
        
        // Pure insertion adds characters (within this batch)
        if (isInsertion) {
          cumulativeOffset -= sliceSize;
        }
      }
    });
  });
  
  // Create merged insertion widgets
  insertionsByPos.forEach(({ text }, pos) => {
    console.log(`[buildDecorations] Creating insertion widget at ${pos}: "${text}"`);
    decorations.push(
      Decoration.widget(
        pos,
        () => {
          const span = document.createElement("span");
          span.className = insertionClass;
          span.textContent = text;
          span.setAttribute("contenteditable", "false");
          return span;
        },
        { side: 1 }
      )
    );
  });

  console.log(`[buildDecorations] Created ${decorations.length} decorations (${insertionsByPos.size} insertion widgets)`);
  return DecorationSet.create(doc, decorations);
};

