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
    vscode.window.showInformationMessage('Hi web-previewer !');
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