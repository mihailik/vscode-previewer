// @ts-check
/// <reference types="node" />
/// <reference lib="webworker" />
// <script>

function webPreviewer() {

  /** @type {HTMLIFrameElement | Promise<HTMLIFrameElement> | undefined} */
  var controlIFRAME; // This might be intended for a different pattern if document was available

  function registerVscodeAddon(moduleExports) {

    moduleExports.activate = activate;
    moduleExports.deactivate = deactivate;

    function deactivate() {
      // nothing
    }

    /**
     * @param {import('vscode').ExtensionContext} context 
     */
    function activate(context) {
      console.log('webPreviewer:activate (Worker Scope)');

      const vscode = require('vscode');
      const webPreviewerStr = 'web-previewer';
      const runtimeFrameViewId = 'webPreviewer.runtimeFrameView';
      const HASH_CHAR_LENGTH = 8;


      // This promise will be resolved by the runtimeFrameViewProvider when the iframe is loaded.
      // It allows other parts of the extension to await the iframe's readiness.
      let workerIframeReadyPromise = null;
      let resolveWorkerIframeReady = null;
      let rejectWorkerIframeReady = null;

      function createWorkerIframeReadyPromise() {
        if (!workerIframeReadyPromise) {
            workerIframeReadyPromise = new Promise((resolve, reject) => {
            resolveWorkerIframeReady = resolve;
            rejectWorkerIframeReady = reject;
          });
        }
        return workerIframeReadyPromise;
      }
      createWorkerIframeReadyPromise(); // Initialize it


      // Helper function to ensure the WebviewView is resolved by revealing it.
      // This WILL cause the view to expand if collapsed.
      function ensureRuntimeFrameViewIsResolvedAndLoadsIframe() {
        console.log('Attempting to reveal RuntimeFrameView to load worker iframe...');
        vscode.commands.executeCommand(runtimeFrameViewId + '.focus');
        return workerIframeReadyPromise; // Return the promise for callers to await
      }

      const documentPanels = {};

      context.subscriptions.push(
        vscode.commands.registerCommand(
          webPreviewerStr + '.previewDocumentAsHtml',
          async (documentOrUri) => {
            try {
              console.log('Preview command: Ensuring worker iframe is ready...');
              await ensureRuntimeFrameViewIsResolvedAndLoadsIframe();
              console.log('Preview command: Worker iframe should be ready.');
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
        vscode.commands.registerCommand(webPreviewerStr + '.openJsTerminal', () => {
          const pty = createJsReplPty("Command"); // Creates a new PTY instance each time
          const terminal = vscode.window.createTerminal({ name: 'JS Terminal', pty: pty });
          terminal.show();
          // ensureHiddenFrameViewIsResolved(); // Also ensure it's resolved when our custom terminal opens
        })
      );

      // Register Terminal Profile Provider
      // This makes "Custom JS REPL" an option in the terminal creation dropdown
      const jsTerminalProfileProvider = {
        provideTerminalProfile: (token) => {
          // Each new terminal created from the profile selection gets its own pty instance
          const pty = createJsReplPty("Profile");
          return new vscode.TerminalProfile({
            name: 'Custom JS REPL',
            pty: pty,
            isTransient: true
          });
        },
      };
      context.subscriptions.push(
        vscode.window.registerTerminalProfileProvider(`${webPreviewerStr}.jsTerminal`, jsTerminalProfileProvider)
      );

      // Listen for any terminal being opened
      context.subscriptions.push(
        vscode.window.onDidOpenTerminal(async (terminal) => {
          console.log('A terminal was opened:', terminal.name, 'Ensuring worker iframe is ready...');
          try {
            await ensureRuntimeFrameViewIsResolvedAndLoadsIframe();
            console.log('Terminal open: Worker iframe should be ready.');
          } catch (e) {
             console.error("Failed to ensure worker iframe on terminal open:", e);
             vscode.window.showErrorMessage("Background worker iframe failed to load.");
             // Reset promise for potential retry
             workerIframeReadyPromise = null;
             createWorkerIframeReadyPromise();
          }
        })
      );
      // --- End JS Terminal Logic ---
  
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

          console.log('HTML Preview Injector');
          window.alert = alert;
          detectTitleChange();
        };
      })();

      /** @param {import('vscode').TextDocument | import('vscode').Uri} documentOrUri */
      function openDocumentOrUriAsHtml(documentOrUri) {
        // ensureHiddenFrameViewIsResolved(); // Called by the command wrapper now
        console.log('previewDocumentAsHtml:openDocumentOrUriAsHtml...');
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


      // --- Runtime WebviewView Provider (Responsible for loading the worker iframe) ---
      /** @type {import('vscode').WebviewViewProvider} */
      const runtimeFrameViewProvider = {
        resolveWebviewView: (webviewView, _context, _token) => {
          console.log('runtimeFrameViewProvider.resolveWebviewView (DOM context available here)');
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
                <!-- <h2>Worker Iframe Host</h2> -->
                <script>
                // This script runs inside the webview's document
                (async function initWorkerHost() {
                    const vscode = acquireVsCodeApi(); // For communication back to extension worker if needed
                    console.log('Worker Host Script: Initializing keys and loading iframe...');
                    
                    const HASH_CHAR_LENGTH = ${HASH_CHAR_LENGTH}; // Get from outer scope

                    async function generateSigningKeyPair() {
                        const algorithm = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
                        const keyPair = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
                        const publicKeySpki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
                        const publicStr = btoa(String.fromCharCode.apply(null, new Uint8Array(publicKeySpki)));
                        const publicKeyDigest = await crypto.subtle.digest('SHA-256', publicKeySpki);
                        const publicHash = [...new Uint8Array(publicKeyDigest)].map(b => b.toString(36)).join('').slice(0, HASH_CHAR_LENGTH);
                        return { publicStr, publicHash, privateKey: keyPair.privateKey };
                    }

                    try {
                        const { publicStr, publicHash } = await generateSigningKeyPair();
                        console.log('Worker Host Script: Loading IFRAME for ', { publicStr, publicHash });
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
                })();
                </script>
            </body>
            </html>`;
          webviewView.webview.html = runtimeFrameHTML;

          webviewView.webview.onDidReceiveMessage(message => {
            if (message.command === 'workerIframeReady') {
              console.log('Extension Worker: Received workerIframeReady from webview.');
              if (resolveWorkerIframeReady) resolveWorkerIframeReady();
            } else if (message.command === 'workerIframeError') {
              console.error('Extension Worker: Received workerIframeError from webview:', message.error);
              if (rejectWorkerIframeReady) rejectWorkerIframeReady(new Error(message.error));
            }
          });
        }
      };

      context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(runtimeFrameViewId, runtimeFrameViewProvider)
      );
      // --- End Runtime WebviewView Provider ---
    } // End of activate
  } // End of registerVscodeAddon

  function tryRunningNode() {
    const { createServer } = require('http');
    const fs = require('fs');
    const port = 2024;
    const server = createServer((req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', /\.js\b/i.test(req.url || '') ? 'application/javascript' : 'text/html');
      fs.readFile(__filename, (err, data) => {
        res.end(data);
      });
      });
    ['127.0.0.1', 'localhost'].forEach(hostname =>
      server.listen(port, hostname, () => {
      console.log(`Server running at http://${hostname}:${port}/`);
      })
    );
  }

  function runBrowser() {
    // TODO: if this looks like hosted file access, refresh after installing service worker

    createFileViewerUI();
    registerServiceWorker();

    function createFileViewerUI() {
      if (!document.body) {
        setTimeout(() => {
          createFileViewerUI();
        }, 10);
        return;
      }

      const h2 = document.createElement('h2');
      h2.textContent = 'LIVE1';
      document.body.appendChild(h2);

      document.title = 'LIVE1';

      console.log('TODO: show file manager');

      let num = 1;
      setInterval(() => {
        num++;
        document.title = 'LIVE' + num;
        h2.textContent = 'LIVE' + num;
      }, 1000);
    }

    async function registerServiceWorker() {
      if (!('serviceWorker' in navigator)) {
        console.log('Service workers are not supported on the platform.');
        return;
      }

      console.log('Detecting service worker status...');
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        console.log('Service worker is already registered: ', reg);
      } else {
        console.log('Service worker is not detected, registering...');
        const wrk = await navigator.serviceWorker.register('/iframe.l.i.v.e.js');
        console.log('Service worker, awaiting completion: ', wrk);
        const readyWk = await navigator.serviceWorker.ready;
        console.log('Success, reload page with service worker ', readyWk);
        location.reload();
      }
    }
  }

  function runWorker() {
    console.log('TODO: handle fetch requests');

    self.addEventListener('activate', (event) => {
      // event.waitUntil(...)
    });

    self.addEventListener('install', (event) => {
      // event.waitUntil(...)
    });

    self.addEventListener('fetch', (event) => {
      event.respondWith(handleFetch(event));
    });

    /**
     * @param {FetchEvent} _
     */
    async function handleFetch({ request }) {
      console.log('handleFetch ', request);
      const parsedURL = new URL(request.url);
      if (parsedURL.pathname === '/iframe.l.i.v.e.js') {
        if (request.method === 'GET') {
          return new Response(
            getSelfText(' serviceWorker generated at ' + new Date()),
            {
              status: 200,
              headers: {
                'Content-Type':
                  request.destination === 'document' ?
                    'text/html' :
                    'application/javascript'
              }
            });
        }
      }

      const cached = await caches.match(request);
      if (cached) return cached;

      if (parsedURL.pathname === '/' || parsedURL.pathname === '/index.html') {
        return new Response(
          '<' + 'script src=/iframe.l.i.v.e.js></' + 'script' + '>',
          { status: 200, headers: { 'Content-Type': 'text/html' } });
      } else if (parsedURL.pathname === '/favicon.ico') {
        return new Response(
          '',
          { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }

      // TODO: provide better error response
      return Response.error();
    }
  }

  /** @param {string} [inject] */
  function getSelfText(inject) {
    return '// @ts-check\n' +
      '/// <reference types="node" /' + '>\n' +
      '// <' + 'script' + '>\n' +
      '\n' +
      webPreviewer + ' webPreviewer() // <' + '/script' + '>' + (inject || '') + '\n'
  }

  console.log('webPreviewer() (Global Scope) ', {
    module: typeof module,
    'module.exports': typeof module === 'undefined' ? 'undefined' : typeof module.exports,
    process: typeof process,
    window: typeof window,
    self: typeof self
  });
  if (typeof module !== 'undefined' && module?.exports) {
    if (typeof require === 'function' && require.main === module &&
      typeof process !== undefined && typeof process?.arch === 'string')
      tryRunningNode();

    return registerVscodeAddon(module.exports);
  } else if (typeof window !== 'undefined' && typeof window?.alert === 'function') {
    return runBrowser();
  } else if (typeof self !== 'undefined' && typeof self?.Math?.sin === 'function') {
    return runWorker();
  }

} webPreviewer() // </script>
