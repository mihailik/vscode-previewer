// @ts-check
/// <reference types="node" />
/// <reference lib="webworker" />
// <script>

/** @param {string} [environment] */
function webPreviewer(environment) {

  const HASH_CHAR_LENGTH = 8;

  if (!environment && typeof module !== 'undefined' && module?.exports) {
    if (typeof require === 'function' &&
      typeof process !== 'undefined' && typeof process?.arch === 'string') {
      environment = 'test';
    } else {
      environment = 'extension';
    }
  }

  switch (environment?.split(':')[0]) {
    case 'test':
      runExtension(module.exports);
      runWebViewProxy(module.exports);
      runRemoteAgent(module.exports);
      Object.assign(module.exports, {
        signData,
        generateSigningKeyPair,
        createIFRAME
      });
      break;

    case 'extension':
      runExtension(module.exports);
      break;

    case 'proxy':
      runWebViewProxy(environment.replace(/^proxy:/, ''));
      break;

    case 'html':
      runWebViewHtml(environment.replace(/^html:/, ''));
      break;

    case 'remoteAgent':
      runRemoteAgent();
      break;

    default:
      console.warn('webPreviewer:runExtension: Unknown environment:', environment);
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
        createWorkerIframeReadyPromise,
      }
    });

    let publicStr, publicHash, privateKey;
    const commandCompletionHandlers = new Map();


    /** @type {Promise<import('vscode').Webview | undefined | null> | undefined | null} */
    let workerIframeReadyPromise = null;
    /** @type {((value: import('vscode').Webview | undefined | null | PromiseLike<import('vscode').Webview | undefined | null>) => void) | undefined | null} */
    let resolveWorkerIframeReady = null;
    /** @type {((reason?: any) => void) | undefined | null} */
    let rejectWorkerIframeReady = null;

    /** @type {import('vscode')} */
    let vscode;
    /** @type {typeof window.crypto | undefined} */
    let crypto;
    const webPreviewerStr = 'web-previewer';
    const runtimeFrameViewId = webPreviewerStr + '.runtimeFrameView';
    const documentPanels = {};

    function deactivate() {
    }

    /**
     * @param {import('vscode').ExtensionContext & {
     *  overrides?: {
     *    vscode?: typeof import('vscode'),
     *    crypto?: typeof window.crypto
     *  }
     * }} context 
     */
    async function activate(context) {
      console.log('webPreviewer:runExtension:activate');

      vscode = context?.overrides?.vscode || require('vscode');
      crypto = context?.overrides?.crypto;
      const keys = await generateSigningKeyPair(crypto);
      publicStr = keys.publicStr;
      publicHash = keys.publicHash;
      privateKey = keys.privateKey;

      console.log('webPreviewer:runExtension:activate: Loading IFRAME for ', { publicStr, publicHash, vscode });

      context.subscriptions.push(
        vscode.commands.registerCommand(
          webPreviewerStr + '.previewDocumentAsHtml',
          previewDocumentAsHtml
        ));

      context.subscriptions.push(
        vscode.commands.registerCommand(
          webPreviewerStr + '.openJsTerminal',
          () => {
            const pty = createJsReplPty("Command");
            const terminal = vscode.window.createTerminal({ name: 'JS Terminal', pty: pty });
            terminal.show();
          })
      );

      context.subscriptions.push(
        vscode.window.registerTerminalProfileProvider(
          webPreviewerStr + '.jsTerminal',
          {
            provideTerminalProfile: (token) => {
              const pty = createJsReplPty("Profile");
              return new vscode.TerminalProfile({
                name: 'Custom JS REPL',
                pty: pty,
                isTransient: true
              });
            },
          })
      );

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
              workerIframeReadyPromise = null;
            }
          }),
      );

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
    }


    /**
     * @param {string} [terminalTypeName='JS']
     * @returns {import('vscode').Pseudoterminal}
     */
    function createJsReplPty(terminalTypeName = 'JS') {
      const writeEmitter = new vscode.EventEmitter();
      let commandLine = "";

      return {
        onDidWrite: writeEmitter.event,
        open: () => {
          commandLine = "";
          writeEmitter.fire(terminalTypeName + ' Terminal Started\r\n> ');
        },
        close: () => { },
        handleInput: async data => {
          if (data === '\r') {
            writeEmitter.fire('\r\n');
            const currentCommand = commandLine.trim();
            commandLine = "";

            if (currentCommand) {
              console.log('webPreviewer:runExtension: Executing command:', currentCommand);
              try {
                if (!workerIframeReadyPromise)
                  await ensureRuntimeFrameViewIsResolvedAndLoadsIframe();

                const proxyWebview = await workerIframeReadyPromise; 
                if (!proxyWebview) {
                  throw new Error("Proxy webview not available after promise resolution.");
                }

                const tag = 'exec_' + Date.now() + '_' + Math.random().toString(36).substring(2);
                const signature = await signData(privateKey, currentCommand);

                proxyWebview.postMessage({
                    tag: tag,
                    execute: {
                        script: currentCommand,
                        signature: signature
                    }
                });

                const resultPromise = new Promise((resolve, reject) => {
                    commandCompletionHandlers.set(tag, { resolve, reject });
                });

                const output = await resultPromise;
                writeEmitter.fire(output + '\r\n');

              } catch (e) {
                writeEmitter.fire('Error: ' + e.message + '\r\n');
              }
            }
            writeEmitter.fire('> ');
          } else if (data === '\x7f') {
            if (commandLine.length > 0) {
              commandLine = commandLine.slice(0, -1);
              writeEmitter.fire('\b \b');
            }
          } else if (data >= ' ' && data <= '~') {
            commandLine += data;
            writeEmitter.fire(data);
          } else {
            writeEmitter.fire(data);
          }
        }
      };
    }

    async function previewDocumentAsHtml(documentOrUri) {
      try {
        console.log('webPreviewer:runExtension:previewDocumentAsHtml: Ensuring worker iframe is ready...');
        await ensureRuntimeFrameViewIsResolvedAndLoadsIframe();
        console.log('webPreviewer:runExtension:previewDocumentAsHtml: Worker iframe should be ready.');
      } catch (e) {
        console.error("Failed to ensure worker iframe for preview:", e);
        vscode.window.showErrorMessage("Background worker iframe failed to load. Preview might not work correctly.");
        workerIframeReadyPromise = null;
      }
      openDocumentOrUriAsHtml(documentOrUri);
    }

    /** @param {import('vscode').TextDocument | import('vscode').Uri} documentOrUri */
    function openDocumentOrUriAsHtml(documentOrUri) {
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
      const injectCustom =
`<${'script'}>
${webPreviewer}
webPreviewer();
</${'script'}>
`;

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

    function ensureRuntimeFrameViewIsResolvedAndLoadsIframe() {
      console.log('webPreviewer:runExtension: Attempting to reveal RuntimeFrameView to load worker iframe...');
      if (!workerIframeReadyPromise) {
        createWorkerIframeReadyPromise();
      }
      vscode.commands.executeCommand(runtimeFrameViewId + '.focus');
      return workerIframeReadyPromise;
    }

    /** @type {import('vscode').WebviewViewProvider['resolveWebviewView']} */
    function resolveWebviewView(webviewView, _context, _token) {
      console.log('webPreviewer:runExtension: runtimeFrameViewProvider.resolveWebviewView (DOM context available here)');
      webviewView.webview.options = {
        enableScripts: true,
      };

      const iframeSrc = 'https://' + publicHash + '-ifrwrk.iframe.live';

      webviewView.webview.html =
`<style> body, html { margin:0; padding:0; width:100%; height:100%; overflow:hidden; border:none; } </style>
<h2>PROXY IFRAME</h2>
<${'script'}>
const webPreviewerFn = ${String(webPreviewer)};
webPreviewerFn("proxy:" + ${JSON.stringify(iframeSrc)});
</${'script'}>`;

      webviewView.webview.onDidReceiveMessage(handleProxyMessage);

      webviewView.onDidDispose(() => {
        workerIframeReadyPromise = null;
        resolveWorkerIframeReady = null;
        rejectWorkerIframeReady = null;
      });

      async function handleProxyMessage(message) {
        if (message.command === 'workerIframeReady') {
          console.log('webPreviewer:runExtension: Received workerIframeReady from webview.');
          const initTag = 'webPreviewer:runExtension:init:' + (Date.now() + Math.random()).toString(36);
          webviewView.webview.postMessage({
            tag: initTag,
            init: { publicKey: publicStr, hash: publicHash },
          });

          // After init, send the script to set up the remoteAgent
          const remoteAgentSetupTag = 'webPreviewer:runExtension:remoteAgentSetup:' + (Date.now() + Math.random()).toString(36);
          const scriptToRunInRemote = String(webPreviewer) + '\nwebPreviewer("remoteAgent");';
          const signature = await signData(privateKey, scriptToRunInRemote, crypto);

          webviewView.webview.postMessage({
            tag: remoteAgentSetupTag,
            execute: {
                script: scriptToRunInRemote,
                signature: signature
            }
          });
          // We don't necessarily need to wait for this setup script to complete before resolving workerIframeReady,
          // as subsequent execute calls will queue up if the remote isn't fully ready with evalWebPreviewer.
          // However, if there's a specific confirmation needed from this setup, we might need a new message type.

          if (resolveWorkerIframeReady) resolveWorkerIframeReady(webviewView.webview);
        } else if (message.command === 'workerIframeError') {
          console.error('webPreviewer:runExtension: Received workerIframeError from webview:', message.error);
          if (rejectWorkerIframeReady) rejectWorkerIframeReady(new Error(message.error));
        } else if (message.tag && commandCompletionHandlers.has(message.tag)) {
            const handlerInfo = commandCompletionHandlers.get(message.tag);
            if (message.executeSuccess) {
                handlerInfo.resolve(message.executeSuccess);
            } else if (message.executeError) {
                handlerInfo.reject(new Error(message.executeError));
            } else if (message.executeStart) {
                // console.log(`Execution started for tag: ${message.tag}`);
            }
            if (message.executeSuccess || message.executeError) {
                commandCompletionHandlers.delete(message.tag);
            }
        }
      }
    }

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
   * @param {string | Record<string, any>} exportsOrUrl
   */
  function runWebViewProxy(exportsOrUrl) {
    if (typeof exportsOrUrl !== 'string') {
      Object.assign(exportsOrUrl, {
      });
      return;
    }

    const url = exportsOrUrl;
    const vscode = window['acquireVsCodeApi']();

    init();

    async function init() {
      try {
        const iframe = await createIFRAME({ src: url });
        console.log('webPreviewer:runWebViewProxy: Created remote agent iframe:', iframe);
        dispatchMessages(iframe);
        vscode.postMessage({ command: 'workerIframeReady' });
      } catch (error) {
        console.error("runWebViewProxy: Error creating or loading remote agent iframe:", error);
        vscode.postMessage({ command: 'workerIframeError', error: error.message || 'Unknown error during iframe setup' });
      }
    }

    /** @param {HTMLIFrameElement} iframe */
    function dispatchMessages(iframe) {
      window.addEventListener('message', handleMessage);

      /** @param {MessageEvent} evt */
      async function handleMessage(evt) {
        if (evt.source === iframe.contentWindow) {
          console.log('webPreviewer:runWebViewProxy: Received message from iframe:', evt.data); 
          vscode.postMessage(evt.data);
        } else if (evt.source === window.parent || evt.source?.['origin'] === window.origin) {
          const messageToIframe = { ...evt.data };
          if (messageToIframe.execute && typeof messageToIframe.execute === 'object' && !messageToIframe.execute.origin) {
            messageToIframe.execute.origin = window.origin;
          }
          const remoteAgentOrigin = new URL(iframe.src).origin;
          console.log('webPreviewer:runWebViewProxy: Forwarding message to iframe:', evt.data, '-->', messageToIframe);
          iframe.contentWindow?.postMessage(messageToIframe, remoteAgentOrigin);
        }
      }
    }
  }

  function runWebViewHtml(exportsOrUrl) {
    if (typeof exportsOrUrl !== 'string') { 
      Object.assign(exportsOrUrl, {
      });
      return;
    }

    const url = exportsOrUrl;

    init();

    async function init() {
      console.log('webPreviewer:runWebViewHtml');
      const iframe = await createIFRAME({ 
        src: url,
        cssText: 'width:100%; height:100%; border:none; position:absolute; inset: 0;'
      });
    }
  }

  /**
   * @param {Record<string, any>} [exports]
   */
  function runRemoteAgent(exports) {
    console.log('webPreviewer:runRemoteAgent: Activating remote agent logic.');

    /**
     * @param {string} scriptToExecute
     */
    function evalWebPreviewer(scriptToExecute) {
        console.log('webPreviewer:runRemoteAgent:evalWebPreviewer: Executing script:', scriptToExecute);
        try {
            // Using indirect eval to ensure execution in the global scope
            const result = (0, eval)(scriptToExecute);
            console.log('webPreviewer:runRemoteAgent:evalWebPreviewer: Script executed, result:', result);
            return result;
        } catch (error) {
            console.error('webPreviewer:runRemoteAgent:evalWebPreviewer: Error executing script:', error);
            // Let the error propagate to be caught by iframe.l.i.v.e.js's handler
            throw error;
        }
    }

    // Expose evalWebPreviewer on the global scope
    if (typeof globalThis !== 'undefined') {
        (globalThis )[ 'evalWebPreviewer'] = evalWebPreviewer;
    } else if (typeof window !== 'undefined') {
        (window )[ 'evalWebPreviewer'] = evalWebPreviewer;
    } else if (typeof self !== 'undefined') {
        // Handle environments like Web Workers if 'self' is the global
        (self )[ 'evalWebPreviewer'] = evalWebPreviewer;
    } else {
        console.error('webPreviewer:runRemoteAgent: Could not find global scope to attach evalWebPreviewer.');
    }
    console.log('webPreviewer:runRemoteAgent: evalWebPreviewer is now on global scope.');
  }

  function getCrypto() {
    return crypto;
  }

  async function generateSigningKeyPair(cryptoOverride) {
    const useCrypto = cryptoOverride || getCrypto();
    const algorithm = {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    };
    const keyPair = await useCrypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);

    const publicKeySpki = await useCrypto.subtle.exportKey('spki', keyPair.publicKey);
    const publicStr = btoa(String.fromCharCode.apply(null, new Uint8Array(publicKeySpki)));

    const publicKeyDigest = await useCrypto.subtle.digest('SHA-256', publicKeySpki);
    const publicHash = [...new Uint8Array(publicKeyDigest)].map(b => b.toString(36)).join('').slice(0, HASH_CHAR_LENGTH);

    return { publicStr, publicHash, privateKey: keyPair.privateKey };
  }

  function signData(privateKey, str, cryptoOverride) {
    const useCrypto = cryptoOverride || getCrypto();
    return useCrypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, privateKey, new TextEncoder().encode(str));
  }


  /** @param {{ src: string, cssText?: string }} params */
  function createIFRAME({ src, cssText }) {
    const iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.allow = 'cross-origin-embedder-policy; cross-origin-opener-policy; cross-origin-resource-policy; cross-origin-isolated;';
    if (typeof cssText === 'string')
      iframe.style.cssText = cssText;

    document.body.appendChild(iframe);

    return new Promise((resolve, reject) => {
      function handleLoad() {
        iframe.removeEventListener('load', handleLoad);
        iframe.removeEventListener('error', handleError);
        resolve(iframe);
      }
      function handleError(eventOrMessage, source, lineno, colno, error) {
        iframe.removeEventListener('load', handleLoad);
        iframe.removeEventListener('error', handleError);
        const errorToReject = error instanceof Error ? error : new Error(typeof eventOrMessage === 'string' ? eventOrMessage : (eventOrMessage?.type || 'iframe load error'));
        Object.assign(errorToReject, { source, lineno, colno, event: typeof eventOrMessage !== 'string' ? eventOrMessage : undefined });
        reject(errorToReject);
      }
      iframe.addEventListener('load', handleLoad);
      iframe.addEventListener('error', handleError);
    });
  }

} webPreviewer() // </script>
