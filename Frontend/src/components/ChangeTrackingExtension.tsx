import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export interface ChangeTrackingOptions {
  pendingChanges?: Array<{
    id: number;
    status?: "pending" | "approved" | "rejected";
    change_type: "insertion" | "deletion" | "replacement";
    start_position: number;
    end_position: number;
    old_text?: string | null;
    new_text?: string | null;
  }>;
}

const changeTrackingPluginKey = new PluginKey("changeTracking");

export const ChangeTrackingExtension = Extension.create<ChangeTrackingOptions>({
  name: "changeTracking",

  addOptions() {
    return {
      pendingChanges: [],
    };
  },

  addProseMirrorPlugins() {
    const extension = this;
    
    return [
      new Plugin({
        key: changeTrackingPluginKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(_tr, _set, _oldState, newState) {
            // Get pending changes from extension options
            const pendingChanges = extension.options.pendingChanges || [];
            const pending = pendingChanges.filter((c: any) => !c.status || c.status === "pending");
            
            if (pending.length === 0) {
              return DecorationSet.empty;
            }

            const { doc } = newState;
            // Build normalized plain text and position mapping
            let normalizedText = "";
            const positionMap: Array<{ pmPos: number; charIndex: number }> = [];
            
            doc.nodesBetween(0, doc.content.size, (node: any, pos: number) => {
              if (node.isText) {
                const nodeText = node.text || "";
                
                for (let i = 0; i < nodeText.length; i++) {
                  const char = nodeText[i];
                  const pmPos = pos + 1 + i; // ProseMirror position
                  
                  // Normalize: collapse multiple whitespace into single space
                  if (/\s/.test(char)) {
                    // Only add to normalized if it's the first whitespace or previous wasn't whitespace
                    if (normalizedText.length === 0 || !/\s/.test(normalizedText[normalizedText.length - 1])) {
                      normalizedText += ' ';
                      positionMap.push({ pmPos, charIndex: normalizedText.length - 1 });
                    } else {
                      // Multiple whitespace - map to same position as previous
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
            
            const plainText = normalizedText.trim();
            
            if (plainText.length === 0) {
              return DecorationSet.empty;
            }

            // Sort changes by position (descending) to apply them correctly
            const sortedChanges = [...pending].sort((a, b) => b.start_position - a.start_position);
            const decorations: Decoration[] = [];

            sortedChanges.forEach((change) => {
              const start = Math.min(change.start_position, plainText.length);
              const end = Math.min(change.end_position, plainText.length);
              
              if (start >= end && change.change_type !== "insertion") return;

              // Map normalized positions to ProseMirror positions
              let pmStart = 0;
              let pmEnd = 0;
              
              // Find ProseMirror positions by looking up in position map
              for (const mapping of positionMap) {
                if (mapping.charIndex === start && pmStart === 0) {
                  pmStart = mapping.pmPos;
                }
                if (mapping.charIndex === end && pmEnd === 0) {
                  pmEnd = mapping.pmPos;
                }
                if (pmStart > 0 && pmEnd > 0) break;
              }
              
              // Fallback: find closest position
              if (pmStart === 0 && positionMap.length > 0) {
                const closest = positionMap.reduce((prev, curr) => 
                  Math.abs(curr.charIndex - start) < Math.abs(prev.charIndex - start) ? curr : prev
                );
                pmStart = closest.pmPos;
              }
              
              if (pmEnd === 0 && change.change_type !== "insertion") {
                if (start === end) {
                  pmEnd = pmStart;
                } else if (positionMap.length > 0) {
                  const closest = positionMap.reduce((prev, curr) => 
                    Math.abs(curr.charIndex - end) < Math.abs(prev.charIndex - end) ? curr : prev
                  );
                  pmEnd = closest.pmPos;
                }
              }

              if (pmStart === 0) return; // Couldn't find start position
              if (pmEnd === 0 && change.change_type !== "insertion") pmEnd = pmStart; // Fallback

              try {
                if (change.change_type === "deletion" && change.old_text && pmEnd > pmStart) {
                  // Strikethrough for deletions
                  const decoration = Decoration.inline(pmStart, pmEnd, {
                    class: "change-indicator deletion",
                    style: "background-color: #fee2e2; text-decoration: line-through; color: #dc2626; padding: 2px 4px; border-radius: 2px;",
                    "data-change-type": "deletion",
                    "data-change-id": change.id.toString(),
                  });
                  decorations.push(decoration);
                } else if (change.change_type === "insertion" && change.new_text) {
                  // Widget decoration for insertions (shows the new text)
                  const widget = Decoration.widget(pmStart, () => {
                    const span = document.createElement("span");
                    span.className = "change-indicator insertion";
                    span.style.cssText = "background-color: #dcfce7; color: #16a34a; padding: 2px 4px; border-left: 2px solid #22c55e; border-radius: 2px; display: inline;";
                    span.setAttribute("data-change-type", "insertion");
                    span.setAttribute("data-change-id", change.id.toString());
                    span.textContent = change.new_text || "";
                    return span;
                  });
                  decorations.push(widget);
                } else if (change.change_type === "replacement" && pmEnd > pmStart) {
                  // Strikethrough for old text
                  const oldDecoration = Decoration.inline(pmStart, pmEnd, {
                    class: "change-indicator replacement-old",
                    style: "background-color: #fee2e2; text-decoration: line-through; color: #dc2626; padding: 2px 4px; border-radius: 2px;",
                    "data-change-type": "replacement-old",
                    "data-change-id": change.id.toString(),
                  });
                  decorations.push(oldDecoration);
                  
                  // Widget for new text (inserted after old text)
                  if (change.new_text) {
                    const newWidget = Decoration.widget(pmEnd, () => {
                      const span = document.createElement("span");
                      span.className = "change-indicator replacement-new";
                      span.style.cssText = "background-color: #dcfce7; color: #16a34a; padding: 2px 4px; border-left: 2px solid #22c55e; border-radius: 2px; margin-left: 4px; display: inline;";
                      span.setAttribute("data-change-type", "replacement-new");
                      span.setAttribute("data-change-id", change.id.toString());
                      span.textContent = change.new_text || "";
                      return span;
                    });
                    decorations.push(newWidget);
                  }
                }
              } catch (error) {
                console.warn("Error creating decoration:", error);
              }
            });

            return DecorationSet.create(doc, decorations);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
        appendTransaction(_transactions, _oldState, newState) {
          // Force recalculation when content or pending changes might have changed
          const pendingChanges = extension.options.pendingChanges || [];
          if (pendingChanges.length > 0) {
            // Return empty transaction to trigger decoration recalculation
            return newState.tr;
          }
          return null;
        },
      }),
    ];
  },
});
