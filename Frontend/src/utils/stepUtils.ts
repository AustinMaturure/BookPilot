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

const BLOCK_TYPES = new Set(["paragraph", "heading", "blockquote", "codeBlock", "listItem", "bulletList", "orderedList"]);

export const extractSliceText = (stepAny: any): string => {
  const slice = stepAny?.slice;
  const sliceContent = slice?.content ?? slice;
  if (!sliceContent) return "";

  const extract = (node: any): string => {
    if (!node) return "";
    const nodeType = node.type ?? node.nodeType;
    if (nodeType === "hardBreak" || nodeType === "hard_break") return "\n";
    if (node.isText && typeof node.text === "string") return node.text;
    if (nodeType === "text" && node.text != null) return String(node.text);
    if (Array.isArray(node)) return node.map(extract).join("");
    if (node.content && Array.isArray(node.content)) {
      return node.content.map(extract).join("");
    }
    if (typeof node.childCount === "number") {
      let text = "";
      for (let i = 0; i < node.childCount; i++) {
        text += extract(node.child(i));
      }
      return text;
    }
    return "";
  };

  const nodes = Array.isArray(sliceContent) ? sliceContent : (sliceContent.content ? sliceContent.content : [sliceContent]);
  if (!Array.isArray(nodes) || nodes.length === 0) return extract(sliceContent);

  // For open slices (paragraph split): only show the TRULY inserted content.
  // openStart/openEnd mean the first/last nodes merge with the doc - they're not new.
  // Showing them would duplicate existing text and "cut"/"separate" incorrectly.
  const openStart = typeof slice?.openStart === "number" ? slice.openStart : 0;
  const openEnd = typeof slice?.openEnd === "number" ? slice.openEnd : 0;
  let nodesToExtract = nodes;
  if (nodes.length >= 3 && (openStart > 0 || openEnd > 0)) {
    const skipFirst = openStart > 0 ? 1 : 0;
    const skipLast = openEnd > 0 ? 1 : 0;
    const start = skipFirst;
    const end = nodes.length - skipLast;
    if (start < end) {
      nodesToExtract = nodes.slice(start, end);
    }
  }

  const parts: string[] = [];
  for (let i = 0; i < nodesToExtract.length; i++) {
    const node = nodesToExtract[i];
    const nodeType = node?.type ?? node?.nodeType;
    let text = extract(node);
    if (i > 0) {
      const prevType = nodesToExtract[i - 1]?.type ?? nodesToExtract[i - 1]?.nodeType;
      const prevIsHardBreak = prevType === "hardBreak" || prevType === "hard_break";
      const currIsHardBreak = nodeType === "hardBreak" || nodeType === "hard_break";
      const prevIsBlock = BLOCK_TYPES.has(prevType) || prevIsHardBreak;
      const prevHadContent = parts.length > 0 && parts[parts.length - 1] !== "\n";
      if (prevIsBlock && !currIsHardBreak && (text || prevHadContent)) parts.push("\n");
    }
    if (!text && BLOCK_TYPES.has(nodeType)) text = "\n";
    parts.push(text);
  }
  return parts.join("");
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
      } else if (raw.slice) {
        const fromSlice = extractSliceText(raw);
        if (fromSlice) (step as any).insertedText = fromSlice;
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

/**
 * Remap step positions through previous steps before computing decorations.
 * ProseMirror pattern: step.map(mapping) then mapping.appendMap(step.getMap()).
 * Build highlights using returned remappedSteps, not original steps.
 */
export const remapStepsToBase = (steps: Step[]): Step[] => {
  const mapping = new Mapping();
  const remappedSteps: Step[] = [];
  for (const step of steps) {
    const mappedStep = step.map(mapping);
    if (mappedStep) {
      const orig = step as any;
      const mapped = mappedStep as any;
      if (orig.deletedText) mapped.deletedText = orig.deletedText;
      if (orig.insertedText) mapped.insertedText = orig.insertedText;
      if (typeof orig.originalFrom === "number") mapped.originalFrom = orig.originalFrom;
      remappedSteps.push(mappedStep);
      mapping.appendMap(step.getMap());
    }
  }
  return remappedSteps;
};

export const getPreviewFragments = (
  doc: PMNode,
  steps: Step[],
  options: PreviewOptions = {}
): PreviewFragments => {
  const maxFragment = options.maxFragment ?? Infinity;
  const deletedTexts: string[] = [];
  const insertedTexts: string[] = [];

  // Remap steps through previous steps so each step has positions in the doc it applies to.
  // This fixes "step out of bounds" when compressed steps have positions in base doc.
  const remappedSteps = remapStepsToBase(steps);
  let currentDoc = doc;

  for (let i = 0; i < remappedSteps.length; i++) {
    const step = remappedSteps[i];
    const stepAny = step as any;
    if (typeof stepAny.from !== "number" || typeof stepAny.to !== "number") {
      continue;
    }
    const hasSlice = stepAny.slice && stepAny.slice.size > 0;

    const docSize = currentDoc.content.size;
    const safeFrom = Math.max(0, Math.min(stepAny.from, docSize));
    const safeTo = Math.max(0, Math.min(stepAny.to, docSize));

    if (safeFrom < safeTo) {
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

    let applied: { failed: any; doc: PMNode | null };
    try {
      applied = step.apply(currentDoc) as any;
    } catch (error) {
      if (typeof globalThis !== "undefined") {
        (globalThis as any).console?.warn?.("[getPreviewFragments] step apply failed", error);
      }
      continue;
    }
    if (applied.failed || !applied.doc) {
      continue;
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
  }

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
 * findTextRangeNormalized - Like findTextRangeInDoc but normalizes whitespace (collapse to space, trim)
 * Useful for AI suggestions where anchor may have different whitespace than the document
 */
export const findTextRangeNormalized = (
  doc: PMNode,
  searchText: string
): { from: number; to: number } | null => {
  const normalizeSearch = (t: string) => t.replace(/\s+/g, " ").trim();
  const normalizedTarget = normalizeSearch(searchText);
  if (!normalizedTarget) return null;

  let normalizedText = "";
  const positionMap: Array<{ pmPos: number; charIndex: number }> = [];

  doc.nodesBetween(0, doc.content.size, (node: any, pos: number) => {
    if (node.isText) {
      const nodeText = node.text || "";
      for (let i = 0; i < nodeText.length; i++) {
        const char = nodeText[i];
        // pos is before the text node; character i runs from pos+i to pos+i+1
        const pmPos = pos + i;
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

  // Only collapse whitespace for doc - do NOT trim, so positionMap indices stay correct
  const normalizedDoc = normalizedText.replace(/\s+/g, " ");
  const normalizedDocNoSpaces = normalizedText.replace(/\s+/g, "");
  if (!normalizedDoc) return null;

  // Try with spaces first; fallback to no spaces (lists/adjacent blocks often have no space between text nodes)
  let startIndex = normalizedDoc.indexOf(normalizedTarget);
  let endIndex: number;
  if (startIndex >= 0) {
    endIndex = startIndex + normalizedTarget.length;
  } else if (normalizedTarget.includes(" ")) {
    const targetNoSpaces = normalizedTarget.replace(/\s+/g, "");
    const idx = normalizedDocNoSpaces.indexOf(targetNoSpaces);
    if (idx >= 0) {
      startIndex = idx;
      endIndex = idx + targetNoSpaces.length;
    } else {
      return null;
    }
  } else {
    return null;
  }

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

  // Process each batch: remap steps through previous steps, then build decorations
  stepBatches.forEach((batch) => {
    const remappedSteps = remapStepsToBase(batch);
    let cumulativeOffset = 0;

    remappedSteps.forEach((step, stepIndex) => {
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

      // DELETIONS: Use remapped step positions only
      if (isDeletion || isReplacement) {
        let finalFrom = actualFrom;
        let finalTo = actualTo;
        
        // Clamp to document bounds (use remapped step positions only, no text search)
        finalFrom = Math.max(0, Math.min(finalFrom, docSize));
        finalTo = Math.min(docSize, Math.max(finalFrom, Math.min(finalTo, docSize)));

        // Safeguard: cap unreasonably large ranges (prevents full-line/editor highlights from position bugs)
        const maxRange = 1200; // ~paragraph; larger spans suggest wrong positions
        if (finalTo - finalFrom > maxRange) {
          const origTo = finalTo;
          finalTo = Math.min(finalFrom + maxRange, docSize);
          console.warn(`[buildDecorations] Step ${stepIndex}: range capped from ${origTo - finalFrom} to ${finalTo - finalFrom} (full-line highlight prevention)`);
        }

        // Create the decoration
        console.log(`[buildDecorations] Step ${stepIndex}: docSize=${docSize}, finalFrom=${finalFrom}, finalTo=${finalTo}`);
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
          console.log(`[buildDecorations] Step ${stepIndex}: docSize=${docSize}, finalFrom=${insertPos}, finalTo=${insertPos}`);
          
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

