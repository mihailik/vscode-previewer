// @ts-check

function webPreviewer() {

  function runVscodeAddon() {

    module.exports.activate = activate;
    module.exports.deactivate = deactivate;

    function deactivate() {
      // nothing
    }

    /**
     * @param {import('vscode').ExtensionContext} context 
     */
    function activate(context) {
      const vscode = require('vscode');
      const webPreviewerStr = 'web-previewer';

      const documentPanels = {};

      context.subscriptions.push(
        vscode.commands.registerCommand(
          webPreviewerStr + '.previewDocumentAsHtml',
          openDocumentOrUriAsHtml
        ));
  
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

    }
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
    }

    function registerServiceWorker() {
      console.log('TODO: register service worker');
    }
  }

  function runWorker() {
    console.log('TODO: handle fetch requests');
  }

  if (typeof module !== 'undefined' && module?.exports) {
    return runVscodeAddon();
  } else if (typeof window !== 'undefined' && typeof window?.alert === 'function') {
    return runBrowser();
  } else if (typeof self !== 'undefined' && typeof self?.Math?.sin === 'function') {
    return runWorker();
  }

} webPreviewer()
