// @ts-check
/// <reference types="node" />
/// <reference lib="webworker" />
// <script>

function webPreviewer() {

  const HASH_CHAR_LENGTH = 8;

  if (typeof module !== 'undefined' && module?.exports) {
    runExtension(module.exports);
    if (typeof require === 'function' &&
      typeof process !== 'undefined' && typeof process?.arch === 'string') {
      // export tests
      runWebView(module.exports);
      runRemoteExecutor(module.exports);
      Object.assign(module.exports, { // Changed from Object.apply to Object.assign
        signData,
        generateSigningKeyPair
      });
    } else {
      console.log('webPreviewer:runExtension');
    }
  } else if (typeof window !== 'undefined' && typeof window?.alert === 'function') {
    if (typeof window['acquireVsCodeApi'] === 'function') {
      console.log('webPreviewer:runWebView');
      return runWebView();
    } else {
      console.log('webPreviewer:runRemoteExecutor');
      runRemoteExecutor();
    }
  }

  /**
   * @param {Record<string, any>} exports
   */
  function runExtension(exports) {

    Object.assign(exports, {
      activate,
      deactivate,
      runExtension: {
        resolveWebviewView,
        createWorkerIframeReadyPromise
      }
    });

    let publicStr, publicHash;

    // This promise will be resolved by the runtimeFrameViewProvider when the iframe is loaded.
    // It allows other parts of the extension to await the iframe's readiness.
    /** @type {Promise<import('vscode').Webview> | undefined | null} */
    let workerIframeReadyPromise = null;
    /** @type {((script: string) => Promise<any>) | undefined | null} */
    let resolveWorkerIframeReady = null;
    let rejectWorkerIframeReady = null;

    function deactivate() {
      // nothing
    }

    /**
     * @param {import('vscode').ExtensionContext & {
     *  overrides?: {
     *    vscode?: typeof import('vscode'),
     *    crypto?: typeof crypto
     *  }
     * }} context 
     */
    async function activate(context) {
      console.log('webPreviewer:runExtension:activate');

      const vscode = context?.overrides?.vscode || require('vscode');

      const webPreviewerStr = 'web-previewer';
      const runtimeFrameViewId = webPreviewerStr + '.runtimeFrameView';

      [{ publicStr, publicHash }] = [await generateSigningKeyPair(context?.overrides?.crypto || crypto)];

      console.log('webPreviewer:runExtension:activate: Loading IFRAME for ', { publicStr, publicHash, vscode });

      createWorkerIframeReadyPromise(); // Initialize it

      const documentPanels = {};

      context.subscriptions.push(
        vscode.commands.registerCommand(
          webPreviewerStr + '.previewDocumentAsHtml',
          async (documentOrUri) => {
            try {
              console.log('webPreviewer:runExtension:previewDocumentAsHtml: Ensuring worker iframe is ready...');
              await ensureRuntimeFrameViewIsResolvedAndLoadsIframe();
              console.log('webPreviewer:runExtension:previewDocumentAsHtml: Worker iframe should be ready.');
            } catch (e) {
              console.error("Failed to ensure worker iframe for preview:", e);
              vscode.window.showErrorMessage("Background worker iframe failed to load. Preview might not work correctly.");
              // Reset promise for potential retry
              workerIframeReadyPromise = null;
              createWorkerIframeReadyPromise();
            }
            openDocumentOrUriAsHtml(documentOrUri);
          }
        ));

      // --- JS Terminal Logic ---
      /**
       * Creates a new Pseudoterminal instance for a simple JS REPL.
       * @param {string} [terminalTypeName="JS"] - Name to display in the initial message.
       * @returns {import('vscode').Pseudoterminal}
       */
      function createJsReplPty(terminalTypeName = "JS") {
        const writeEmitter = new vscode.EventEmitter();
        let commandLine = ""; // Buffer for the current line of input

        return {
          onDidWrite: writeEmitter.event,
          open: () => {
            commandLine = "";
            writeEmitter.fire(`${terminalTypeName} Terminal Started\r\n> `);
          },
          close: () => { /* Nothing to do */ },
          handleInput: data => {
            if (data === '\r') { // Enter key
              writeEmitter.fire('\r\n'); // Echo newline
              if (commandLine.trim()) {
                let output;
                try {
                  // Unsafe eval: Be very careful with this in a real extension.
                  // Consider sandboxing or a safer execution environment.
                  output = String(eval(commandLine));
                } catch (e) {
                  output = `Error: ${e.message}`;
                }
                writeEmitter.fire(`${output}\r\n`);
              }
              commandLine = "";
              writeEmitter.fire('> ');
            } else if (data === '\x7f') { // Backspace
              if (commandLine.length > 0) {
                commandLine = commandLine.slice(0, -1);
                writeEmitter.fire('\b \b'); // Move cursor back, erase char, move cursor back
              }
            } else if (data >= ' ' && data <= '~') { // Printable characters
              commandLine += data;
              writeEmitter.fire(data); // Echo character
            } else {
              // Echo other non-printable/non-backspace characters (e.g., arrow keys)
              // but don't add to commandLine or process further for this simple terminal.
              writeEmitter.fire(data);
            }
          }
        };
      }

      // Register command to open a JS terminal instance
      // This command is already declared in your package.json
      context.subscriptions.push(
        vscode.commands.registerCommand(
          webPreviewerStr + '.openJsTerminal',
          () => {
            const pty = createJsReplPty("Command"); // Creates a new PTY instance each time
            const terminal = vscode.window.createTerminal({ name: 'JS Terminal', pty: pty });
            terminal.show();
            // ensureHiddenFrameViewIsResolved(); // Also ensure it's resolved when our custom terminal opens
          })
      );

      // Register Terminal Profile Provider
      // This makes "Custom JS REPL" an option in the terminal creation dropdown
      context.subscriptions.push(
        vscode.window.registerTerminalProfileProvider(
          webPreviewerStr + '.jsTerminal',
          {
            provideTerminalProfile: (token) => {
              // Each new terminal created from the profile selection gets its own pty instance
              const pty = createJsReplPty("Profile");
              return new vscode.TerminalProfile({
                name: 'Custom JS REPL',
                pty: pty,
                isTransient: true
              });
            },
          })
      );

      // Listen for any terminal being opened
      context.subscriptions.push(
        vscode.window.onDidOpenTerminal(
          async (terminal) => {
            console.log('webPreviewer:runExtension: A terminal was opened:', terminal.name, 'Ensuring worker iframe is ready...');
            try {
              await ensureRuntimeFrameViewIsResolvedAndLoadsIframe();
              console.log('webPreviewer:runExtension: Terminal open: Worker iframe should be ready.');
            } catch (e) {
              console.error("webPreviewer:runExtension: Failed to ensure worker iframe on terminal open:", e);
              vscode.window.showErrorMessage("Background worker iframe failed to load.");
              // Reset promise for potential retry
              workerIframeReadyPromise = null;
              createWorkerIframeReadyPromise();
            }
          }),
      );
      // --- End JS Terminal Logic ---

      context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
          runtimeFrameViewId,
          { resolveWebviewView },
          {
            webviewOptions: {
              retainContextWhenHidden: true
            }
          })
      );
  
      const embeddedCode = (() => {
        return function () {
          const vscode =
            // @ts-ignore
            acquireVsCodeApi();

          window.addEventListener('error', (ev) => {
            console.error(ev);
            vscode.postMessage({ error: ev.message });
          });

          function alert(str) {
            vscode.postMessage({ alert: str });
          }

          function detectTitleChange() {
            let lastTitleReported = '';
            setTimeout(verifyTitle, 100);

            /** @type {typeof MutationObserver} */
            const MutationObserverCtr = typeof MutationObserver === 'function' ? MutationObserver :
              // @ts-ignore
              typeof WebKitMutationObserver === 'function' ? WebKitMutationObserver : null;
            if (!MutationObserverCtr) return;

            const observerInstance = new MutationObserverCtr(verifyTitle);
            observerInstance.observe(document.head, { childList: true, subtree: true });

            function verifyTitle() {
              if (document.title !== lastTitleReported) {
                lastTitleReported = document.title;
                vscode.postMessage({ title: document.title });
              }
            }
          }

          console.log('embeddedCode:HTML Preview Injector');
          window.alert = alert;
          detectTitleChange();
        };
      })();

      /** @param {import('vscode').TextDocument | import('vscode').Uri} documentOrUri */
      function openDocumentOrUriAsHtml(documentOrUri) {
        // ensureHiddenFrameViewIsResolved(); // Called by the command wrapper now
        console.log('webPreviewer:runExtension:previewDocumentAsHtml:openDocumentOrUriAsHtml...');
        if (!documentOrUri) {
          if (vscode.window.activeTextEditor?.document.languageId === 'html')
            return openDocumentAsHtml(vscode.window.activeTextEditor.document);
          if (vscode.window.activeTextEditor) throw new Error('No editor currently open.');
          else throw new Error('Current editor does not recognize HTML.');
        }

        if (/** @type {import('vscode').TextDocument} */(documentOrUri).uri) {
          openDocumentAsHtml(/** @type {import('vscode').TextDocument} */(documentOrUri));
        } else if (/** @type {import('vscode').Uri} */(documentOrUri).scheme || /** @type {import('vscode').Uri} */(documentOrUri).path) {
          return openUriAsHtml(/** @type {import('vscode').Uri} */(documentOrUri));
        } else {
          throw new Error('Document parameter is not provided.');
        }
      }

      /** @param {import('vscode').Uri} uri */
      async function openUriAsHtml(uri) {
        const doc = await vscode.workspace.openTextDocument(uri);
        openDocumentAsHtml(doc);
      }

      /**
       * @param {import('vscode').TextDocument} document
       */
      function openDocumentAsHtml(document) {
        /** @type {import('vscode').WebviewPanel} */
        let panel = documentPanels[document.uri];
        if (!panel) {
          panel = vscode.window.createWebviewPanel(
            webPreviewerStr + '-view',
            'Loading ' + document.fileName + '...',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
          );
          documentPanels[document.uri] = panel;
          panel.onDidDispose(() => {
            delete documentPanels[document.uri];
          });
        }

        showInPanel(document, panel);
        if (!panel.visible) panel.reveal();
      }

      /**
       * @param {import('vscode').TextDocument} document
       * @param {import('vscode').WebviewPanel} panel
       */
      function showInPanel(document, panel) {
        const html = document.getText();

        const resolvedUri =
          panel.webview.asWebviewUri(document.uri);

        const injectCustom = '<base href="' + resolvedUri + '"><' + 'script' + '>(' + embeddedCode + ')()</' + 'script' + '>';
        let htmlInjectBase = html.replace(/<head[^>]*>/, str => str + injectCustom);
        if (htmlInjectBase === html)
          htmlInjectBase = html.replace(/<html[^>]*>|<head[^>]*>/, str => str + injectCustom);
        if (htmlInjectBase === html)
          htmlInjectBase = injectCustom + html;

        panel.webview.onDidReceiveMessage(handleWebViewMessage);

        if (panel.webview.html) {
          panel.webview.html = '';
          setTimeout(function () {
            panel.webview.html = htmlInjectBase;
          }, 100);
        } else {
          panel.webview.html = htmlInjectBase;
        }

        function handleWebViewMessage(msg) {
          if ('alert' in msg) {
            vscode.window.showInformationMessage(msg.alert);
          }

          if ('title' in msg) {
            panel.title = msg.title || document.fileName;
          }

          if ('error' in msg) {
            vscode.window.showErrorMessage(msg.error);
          }
        }
      }

      // Helper function to ensure the WebviewView is resolved by revealing it.
      // This WILL cause the view to expand if collapsed.
      function ensureRuntimeFrameViewIsResolvedAndLoadsIframe() {
        console.log('webPreviewer:runExtension: Attempting to reveal RuntimeFrameView to load worker iframe...');
        vscode.commands.executeCommand(runtimeFrameViewId + '.focus');
        return workerIframeReadyPromise; // Return the promise for callers to await
      }
    } // End of activate

    /** @type {import('vscode').WebviewViewProvider['resolveWebviewView']} */
    function resolveWebviewView(webviewView, _context, _token) {
      console.log('webPreviewer:runExtension: runtimeFrameViewProvider.resolveWebviewView (DOM context available here)');
      webviewView.webview.options = {
        enableScripts: true,
        // localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
      };

      // This HTML will run in the webview's document context
      // It is responsible for creating the -ifrwrk.iframe.live
      const runtimeFrameHTML =
        `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src https:; script-src 'unsafe-inline' ${webviewView.webview.cspSource}; style-src 'unsafe-inline' ${webviewView.webview.cspSource};">
            <title>Runtime Worker Host</title>
            <style> body, html { margin:0; padding:0; width:100%; height:100%; overflow:hidden; border:none; } </style>
        </head>
        <body>
            <h2>Worker Iframe Host</h2>
            <${'script'}>${webPreviewer};
            var __publicHash = ${JSON.stringify(publicHash)};
            var __publicStr = ${JSON.stringify(publicStr)};
            webPreviewer();
            </${'script'}>
        </body>
        </html>`;
      webviewView.webview.html = runtimeFrameHTML;

      webviewView.webview.onDidReceiveMessage(handleInit);

      webviewView.onDidDispose(() => {
        workerIframeReadyPromise = null;
        resolveWorkerIframeReady = null;
        rejectWorkerIframeReady = null;
      });

      function handleInit(message) {
        if (message.command === 'workerIframeReady') {
          console.log('webPreviewer:runExtension: Received workerIframeReady from webview.');
          if (resolveWorkerIframeReady) resolveWorkerIframeReady(webviewView.webview);
        } else if (message.command === 'workerIframeError') {
          console.error('webPreviewer:runExtension: Received workerIframeError from webview:', message.error);
          if (rejectWorkerIframeReady) rejectWorkerIframeReady(new Error(message.error));
        }
      }
    }

    // function createExecuteMessageSender() {

    //   /** @type {{ [tag: string]: { resolve: (value: any) => void, reject: (reason?: any) => void } }} */
    //   const handlersByTag = {};

    //   return {
    //     handlersByTag,
    //     handleMessage,
    //     sendMessage
    //   };

    //   function handleMessage(msg) {
    //   }

    //   function sendMessage(msg) {
    //   }
    // }

    function createWorkerIframeReadyPromise() {
      if (!workerIframeReadyPromise) {
        workerIframeReadyPromise = new Promise((resolve, reject) => {
          resolveWorkerIframeReady = resolve;
          rejectWorkerIframeReady = reject;
        });
      }
      return workerIframeReadyPromise;
    }

  }

  /**
   * @param {Record<string, any>} [exports]
   */
  function runWebView(exports) {

    if (exports) {
      Object.assign(exports, {
        runWebView: {
          createIFRAME,
          dispatchMessages
        }
      });
      return;
    }

    const vscode = window['acquireVsCodeApi'](); // For communication back to extension worker if needed

    init();

    async function init() {

      const publicStr = window['__publicStr'];
      const publicHash = window['__publicHash'];
      const iframeSrc = 'https://' + publicHash + '-ifrwrk.iframe.live';
      const iframe = await createIFRAME({ src: iframeSrc });
      const initTag = 'INIT_WORKER_HOST_' + Date.now();

      window.addEventListener('message', handleInitResponse);

      iframe.contentWindow?.postMessage(
        { tag: initTag, init: { publicKey: publicStr, hash: publicHash } },
        iframeSrc
      );

      function handleInitResponse(evt) {
        if (evt.data?.tag === initTag && evt.source === iframe.contentWindow) {
          window.removeEventListener('message', handleInitResponse);
          console.log('webPreviewer:runWebView: IFRAME LOAD COMPLETE');
          vscode.postMessage({ command: 'workerIframeReady' });

          dispatchMessages(iframe);
        }
      }
    }

    /** @param {HTMLIFrameElement} iframe */
    function dispatchMessages(iframe) {
      window.addEventListener('message', handleMessage);

      /** @param {MessageEvent} evt */
      async function handleMessage(evt) {
        // messages will come either from the parent window, or from the child iframe
        if (evt.source === iframe.contentWindow) {
          vscode.postMessage(evt.data);
        } else {
          iframe.contentWindow?.postMessage(evt.data);
        }
      }
    }

    /** @param {{ src: string, cssText?: string }} _ */
    function createIFRAME({ src, cssText }) {
      const iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.allow = 'cross-origin-embedder-policy; cross-origin-opener-policy; cross-origin-resource-policy; cross-origin-isolated;';
      // iframe.style.cssText = 'width:200px; height: 200px; border:none; position:absolute; top:-190px; left:-190px; opacity:0.01; pointer-events:none;';
      if (typeof cssText === 'string')
        iframe.style.cssText = cssText;

      document.body.appendChild(iframe);

      return new Promise((resolve, reject) => {
        function handleLoad() {
          iframe.removeEventListener('load', handleLoad);
          iframe.removeEventListener('error', handleError);
          resolve(iframe);
        }

        function handleError(event, source, lineno, colno, error) {
          iframe.removeEventListener('load', handleLoad);
          iframe.removeEventListener('error', handleError);
          // Create a new Error object if the 'error' argument is not already one
          const errorToReject = error instanceof Error ? error : new Error(event?.type || 'iframe load error');
          Object.assign(errorToReject, { source, lineno, colno, event });
          reject(errorToReject);
        }

        iframe.addEventListener('load', handleLoad);
        iframe.addEventListener('error', handleError);
      });
    }

    async function initWorkerHost() {
      try {
        const iframe = document.createElement('iframe');
        const iframeSrc = 'https://' + publicHash + '-ifrwrk.iframe.live';
        iframe.src = iframeSrc;
        iframe.allow = 'cross-origin-embedder-policy; cross-origin-opener-policy; cross-origin-resource-policy; cross-origin-isolated;';
        // iframe.style.cssText = 'width:200px; height: 200px; border:none; position:absolute; top:-190px; left:-190px; opacity:0.01; pointer-events:none;';

        document.body.appendChild(iframe);

        await new Promise((resolve, reject) => {
          iframe.onload = () => {
            iframe.onload = null; iframe.onerror = null;
            console.log('Worker Host Script: Remote IFRAME channel negotiation...');
            const initTag = 'INIT_WORKER_HOST_' + Date.now();

            const messageHandler = (e) => {
              if (e.source === iframe.contentWindow && e.data?.tag === initTag) {
                window.removeEventListener('message', messageHandler);
                console.log('Worker Host Script: IFRAME LOAD COMPLETE');
                vscode.postMessage({ command: 'workerIframeReady' });
                resolve();
              }
            };
            window.addEventListener('message', messageHandler);

            iframe.contentWindow?.postMessage(
              { tag: initTag, init: { publicKey: publicStr, hash: publicHash } },
              iframeSrc
            );
          };
          iframe.onerror = (err) => {
            iframe.onload = null; iframe.onerror = null;
            console.error('Worker Host Script: Failed to load worker iframe:', iframeSrc, err);
            vscode.postMessage({ command: 'workerIframeError', error: 'Failed to load worker iframe: ' + iframeSrc });
            reject(new Error('Failed to load worker iframe'));
          };
        });
        console.log('Worker Host Script: IFRAME fully loaded and initialized.');

      } catch (error) {
        console.error('Worker Host Script: Error during iframe setup:', error);
        vscode.postMessage({ command: 'workerIframeError', error: error.message || 'Unknown error during iframe setup' });
      }
    }
  }

  /**
   * @param {Record<string, any>} [exports]
   */
  function runRemoteExecutor(exports) {
  }

  async function generateSigningKeyPair(cryptoOverride) {
    const useCrypto = cryptoOverride || crypto;
    const algorithm = { name: "HMAC", hash: "SHA-256" };
    // generateKey for HMAC returns a CryptoKey directly
    const key = /** @type {CryptoKey} */ (await useCrypto.subtle.generateKey(algorithm, true, ["sign", "verify"]));
    
    const rawKeyBuffer = await useCrypto.subtle.exportKey('raw', key);
    const publicStr = Array.from(new Uint8Array(rawKeyBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    
    const keyDigest = await useCrypto.subtle.digest('SHA-256', rawKeyBuffer);
    // Taking first HASH_CHAR_LENGTH hex characters of the SHA-256 hash of the key for publicHash
    const publicHash = Math.abs(new Uint32Array(keyDigest)[0]).toString(36).slice(-HASH_CHAR_LENGTH);

    return { publicStr, publicHash, privateKey: key, publicKey: key }; // For HMAC, private and public CryptoKey are the same
  }

  async function signData(privateKey, str) { // privateKey is the HMAC CryptoKey
    const signatureBuffer = await crypto.subtle.sign({ name: "HMAC" }, privateKey, new TextEncoder().encode(str));
    return Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }


} webPreviewer() // </script>
