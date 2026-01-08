import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Step } from 'prosemirror-transform';

interface SuggestionTrackingOptions {
  onTransaction?: (transaction: any, steps: Step[], mapping: any) => void;
  enabled?: boolean;
}

/**
 * Extension to capture ProseMirror steps from ALL editor transactions.
 * 
 * CRITICAL: This captures steps at the transaction level, NOT text diffs.
 * Steps preserve document structure, formatting, and positions accurately.
 */
export const SuggestionTrackingExtension = Extension.create<SuggestionTrackingOptions>({
  name: 'suggestionTracking',

  addOptions() {
    return {
      onTransaction: undefined,
      enabled: false,
    };
  },

  addProseMirrorPlugins() {
    const extension = this;

    return [
      new Plugin({
        key: new PluginKey('suggestionTracking'),
        state: {
          init() {
            return { transactions: [] };
          },
          apply(tr, value) {
            // Only track if enabled and callback exists
            if (!extension.options.enabled || !extension.options.onTransaction) {
              return value;
            }

            // Only capture transactions that change the document
            if (!tr.docChanged) {
              return value;
            }

            // Extract steps, mapping, and selection from transaction
            const steps = tr.steps || [];
            const mapping = tr.mapping;
            const selection = tr.selection;

            // Call callback with transaction data
            if (steps.length > 0) {
              extension.options.onTransaction?.(tr, steps, mapping);
            }

            return value;
          },
        },
      }),
    ];
  },
});
