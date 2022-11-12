// @ts-check

const vscode = require('vscode');

  /**
   * This method is called when your extension is activated
   * Your extension is activated the very first time the command is executed
   * @param {import('vscode').ExtensionContext} context 
   */
function activate(context) {

  let disposable = vscode.commands.registerCommand('web-previewer.helloWorld', () => {
    console.log('hello world?');
    const panel = vscode.window.createWebviewPanel(
      'file preview', // Identifies the type of the webview. Used internally
      'HTML FILE PREVIEW', // Title of the panel displayed to the user
      vscode.ViewColumn.One, // Editor column to show the new webview panel in.
      {
        enableScripts: true
      } // Webview options. More on these later.
    );

    console.log('panel created, getting path: ' + context.extensionPath + 'index.js');

    const onDiskPath = vscode.Uri.file(
      vscode.window.activeTextEditor?.document.fileName || 'index.js');
      ///*context.extensionPath +*/ 'index.js');

    // And get the special URI to use with the webview
    const specialUrl = panel.webview.asWebviewUri(onDiskPath);

    console.log('specialUrl ', specialUrl);

    panel.webview.html =
      '<HTML><BODY><H1> HEY THERE!</H1> ' +
    '<A HREF="' + specialUrl + '"> LINK </A> <br><br> ' +
      '<IFRAME SRC="' + specialUrl + '"> NOFRAME? </IFRAME> ' +

      '<br> <P>' + specialUrl + '</P>' +
      '</BODY></HTML>';
  });

  context.subscriptions.push(disposable);
}

  // This method is called when your extension is deactivated
function deactivate() {
}


module.exports = {
  activate: (...args) => /** @type{*} */(activate)(...args),
  deactivate: (...args) => /** @type{*} */(deactivate)(...args)
};