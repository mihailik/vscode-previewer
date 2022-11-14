// @ts-check

const vscode = require('vscode');

module.exports = { activate };

/**
 * @param {import('vscode').ExtensionContext} context 
 */
function activate(context) {

  let disposable = vscode.commands.registerCommand('web-previewer.helloWorld', () => {
    const panel = vscode.window.createWebviewPanel(
      'file preview',
      'HTML FILE PREVIEW',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    const extensionUri_asWebviewUri = panel.webview.asWebviewUri(context.extensionUri);

    const document_uri_asWebviewUri = !vscode.window.activeTextEditor?.document.uri ? undefined :
      panel.webview.asWebviewUri(vscode.window.activeTextEditor?.document.uri);

    panel.webview.html = `
    EXTENSION link:
      <div>${extensionUri_asWebviewUri}/small-html.html</div>
      <object data="${extensionUri_asWebviewUri}/small-html.html"></object>
      <br><br>

    ACTIVE DOCUMENT link:
      <div>${document_uri_asWebviewUri}</div>
      <object data="${document_uri_asWebviewUri}"></object>
    `;
  });
  context.subscriptions.push(disposable);
}
