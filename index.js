// @ts-check

module.exports.activate = activate;

/**
 * @param {import('vscode').ExtensionContext} context 
 */
function activate(context) {
  const vscode = require('vscode');
  const webPreviewerStr = 'web-previewer';

  context.subscriptions.push(
    vscode.commands.registerCommand(
      webPreviewerStr + '.activeDocumentAsHtml',
      () => {
        const editor = /** @type {import('vscode').TextEditor}*/(vscode.window.activeTextEditor);
        if (!editor) throw new Error('No document selected.');

        const html = editor.document.getText();

        const panel = vscode.window.createWebviewPanel(
          webPreviewerStr + '-view',
          'Loading...' + editor.document.fileName,
          vscode.ViewColumn.One,
          { enableScripts: true, retainContextWhenHidden: true }
        );

        const resolvedUri =
          //editor.document.uri.scheme === 'file' ? editor.document.uri : // when run from actual shell
            panel.webview.asWebviewUri(editor.document.uri); // when run from VSCode Web
        const resolvedUriBase =
          vscode.Uri.joinPath(resolvedUri, '..');

        const injectCustom = '<base href="' + resolvedUriBase + '"><' + 'script' + '>(' + embeddedCode + ')()</' + 'script' + '>';
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
            panel.title = msg.title || editor.document.fileName;
          }
        }
      }
    ));

  const embeddedCode = (() => {
    return function () {
      const vscode =
        // @ts-ignore
        acquireVsCodeApi();

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

}
