// @ts-check

const vscode = require('vscode');

module.exports = { activate };

/**
 * @param {import('vscode').ExtensionContext} context 
 */
function activate(context) {

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'web-previewer.asExtensionLocal',
      () => showWebviewImg(vscode.Uri.joinPath(context.extensionUri, 'cat.gif'))
    ));

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'web-previewer.activeDocument',
      () => showWebviewImg(vscode.window.activeTextEditor?.document.uri)
    ));
  
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'web-previewer.activeDocumentAsHtml',
      () => {
        if (!vscode.window.activeTextEditor) throw new Error('No document selected.');

        const wholeText = vscode.window.activeTextEditor.document.getText();
        showWebviewHtml(vscode.window.activeTextEditor.document.uri, wholeText);
      }
    ));

  /**
   * @param {import('vscode').Uri | undefined} uri
   */
  function showWebviewImg(uri) {
    const panel = vscode.window.createWebviewPanel(
      'file preview',
      'HTML FILE PREVIEW',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    const resolvedUri = uri && panel.webview.asWebviewUri(uri);

    panel.webview.html = `
    <div>${resolvedUri}</div>
    <pre>${JSON.stringify(resolvedUri, null, 2)}</pre>
    IMG: <img src="${resolvedUri}"> <br>
    IFRAME: <iframe src="${resolvedUri}"><iframe> <br>
    <br><br>
    `;
  }

  /**
   * @param {import('vscode').Uri | undefined} uri
   * @param {string} html
   */
  function showWebviewHtml(uri, html) {
    const panel = vscode.window.createWebviewPanel(
      'file preview',
      'HTML FILE PREVIEW',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    
    const resolvedUri = uri && panel.webview.asWebviewUri(uri);
    const resolvedUriBase = resolvedUri && vscode.Uri.joinPath(resolvedUri, '..');

    const injectBaseHref = '<base href="' + resolvedUriBase + '">';
    let htmlInjectBase =
      html.replace(/<html[^>]*>|<head[^>]*>/, str => str + injectBaseHref);
    if (htmlInjectBase === html)
      htmlInjectBase = injectBaseHref + html;


    panel.webview.html = htmlInjectBase;
  }

}
