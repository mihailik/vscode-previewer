// @ts-check
/// <reference types="node" />
/// <reference lib="webworker" />
// <script>

function ttyWASM() {

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

  function tryRunningNode() {
    // const { createServer } = require('http');
    // const fs = require('fs');
    // const port = 2024;
    // const server = createServer((req, res) => {
    //   res.statusCode = 200;
    //   res.setHeader('Content-Type', /\.js\b/i.test(req.url || '') ? 'application/javascript' : 'text/html');
    //   fs.readFile(__filename, (err, data) => {
    //     res.end(data);
    //   });
    //   });
    // ['127.0.0.1', 'localhost'].forEach(hostname =>
    //   server.listen(port, hostname, () => {
    //   console.log(`Server running at http://${hostname}:${port}/`);
    //   })
    // );
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
      ttyWASM + ' webPreviewer() // <' + '/script' + '>' + (inject || '') + '\n'
  }

  console.log('ttyWASM() ', {
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

} ttyWASM() // </script>
