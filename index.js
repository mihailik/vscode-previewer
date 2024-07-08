// @ts-check

module.exports.activate = activate;

/**
 * @param {import('vscode').ExtensionContext} context 
 */
function activate(context) {
  const vscode = require('vscode');
  const webPreviewerStr = 'web-previewer';

  const documentPanels = {};

  context.subscriptions.push(
    vscode.commands.registerCommand(
      webPreviewerStr + '.activeDocumentAsHtml',
      () => {
        if (!vscode.window.activeTextEditor) throw new Error('No document selected.');
        const { document } = vscode.window.activeTextEditor;

        openDocumentAsHtml(document);
      }
    ));
  
  context.subscriptions.push(
    vscode.commands.registerCommand(
      webPreviewerStr + '.selectedDocumentAsHtml',
      /** @type {import('vscode').TextDocument | import('vscode').Uri} */
      (documentOrUri) => {
        if (!documentOrUri) throw new Error('No document selected.');
        if (/** @type {import('vscode').TextDocument} */(documentOrUri).uri) {
          openDocumentAsHtml(/** @type {import('vscode').TextDocument} */(documentOrUri));
        } else if (/** @type {import('vscode').Uri} */(documentOrUri).scheme || /** @type {import('vscode').Uri} */(documentOrUri).path) {
          return openUriAsHtml(/** @type {import('vscode').Uri} */(documentOrUri));
        } else {
          throw new Error('Document parameter is not provided.');
        }
      }
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
    const resolvedUriBase =
      vscode.Uri.joinPath(resolvedUri, '..');

    const injectCustom = '<base href="' + resolvedUri + '"><' + 'script' + '>(' + embeddedCode + ')()</' + 'script' + '>';
    let htmlInjectBase = html.replace(/<head[^>]*>/, str => str + injectCustom);
    if (htmlInjectBase === html)
      htmlInjectBase = html.replace(/<html[^>]*>|<head[^>]*>/, str => str + injectCustom);
    if (htmlInjectBase === html)
      htmlInjectBase = injectCustom + html;

    panel.webview.onDidReceiveMessage(handleWebViewMessage);

    panel.webview.html = htmlInjectBase;

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
