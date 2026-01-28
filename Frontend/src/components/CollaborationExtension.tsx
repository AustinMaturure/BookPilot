import { Extension } from '@tiptap/core';
import { collab, receiveTransaction } from 'prosemirror-collab';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Step } from 'prosemirror-transform';

// Generate a unique client ID for this session
const generateClientID = () => {
  return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

interface CollaborationOptions {
  talkingPointId: number;
  version: number;
  onStepsReceived?: (steps: any[], clientIDs: string[]) => void;
}

export const CollaborationExtension = Extension.create<CollaborationOptions>({
  name: 'collaboration',

  addOptions() {
    return {
      talkingPointId: 0,
      version: 0,
      onStepsReceived: undefined,
    };
  },

  addProseMirrorPlugins() {
    const extension = this;
    const clientID = generateClientID();
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let lastVersion = this.options.version;

    return [
      collab({
        version: this.options.version,
        clientID: clientID,
      }),
      new Plugin({
        key: new PluginKey('collaborationSync'),
        view(editorView) {
          // Poll for new steps
          const pollForSteps = async () => {
            if (!extension.options.talkingPointId) return;

            try {
              const response = await fetch(
                `${import.meta.env.VITE_API_URL}pilot/api/talking_points/${extension.options.talkingPointId}/collab/?since=${lastVersion}`,
                {
                  headers: {
                    'Authorization': `Token ${localStorage.getItem('auth_token')}`,
                  },
                }
              );

              if (response.ok) {
                const data = await response.json();
                if (data.steps && data.steps.length > 0) {
                  const schema = editorView.state.schema;

                  // Deserialize steps and apply via receiveTransaction to avoid freezing
                  const steps = data.steps.map((stepJson: any) => Step.fromJSON(schema, stepJson));
                  const clientIDs = Array.isArray(data.clientIDs) ? data.clientIDs : steps.map(() => "remote");
                  const tr = receiveTransaction(editorView.state, steps, clientIDs);
                  editorView.dispatch(tr);
                  lastVersion = data.version;

                  if (extension.options.onStepsReceived) {
                    extension.options.onStepsReceived(data.steps, data.clientIDs);
                  }
                } else {
                  lastVersion = data.version;
                }
              }
            } catch (error) {
              console.error('Error polling for steps:', error);
            }
          };

          // Start polling every 2 seconds
          pollInterval = setInterval(pollForSteps, 2000);

          // Also poll immediately
          pollForSteps();

          return {
            destroy() {
              if (pollInterval) {
                clearInterval(pollInterval);
              }
            },
          };
        },
      }),
      new Plugin({
        key: new PluginKey('collaborationSend'),
        appendTransaction(transactions, _oldState, _newState) {
          // Collect steps from transactions
          const steps: Step[] = [];
          transactions.forEach((tr) => {
            if (tr.steps && tr.steps.length > 0) {
              steps.push(...tr.steps);
            }
          });

          if (steps.length > 0) {
            // Serialize steps
            const serializedSteps = steps.map((step: any) => step.toJSON());

            // Send steps to server asynchronously
            (async () => {
              try {
                const response = await fetch(
                  `${import.meta.env.VITE_API_URL}pilot/api/talking_points/${extension.options.talkingPointId}/collab/`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Token ${localStorage.getItem('auth_token')}`,
                    },
                    body: JSON.stringify({
                      version: lastVersion,
                      steps: serializedSteps,
                      clientID: clientID,
                    }),
                  }
                );

                if (response.ok) {
                  const data = await response.json();
                  lastVersion = data.version;
                } else if (response.status === 409) {
                  // Version conflict - need to rebase
                  const conflictData = await response.json();
                  console.warn('Version conflict, current version:', conflictData.current_version);
                  // The collab plugin will handle rebasing automatically
                }
              } catch (error) {
                console.error('Error sending steps:', error);
              }
            })();
          }

          return null;
        },
      }),
    ];
  },
});
