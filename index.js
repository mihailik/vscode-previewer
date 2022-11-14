// @ts-check

const vscode = require('vscode');

module.exports = { activate };

/**
 * This method is called when your extension is activated
 * Your extension is activated the very first time the command is executed
 * @param {import('vscode').ExtensionContext} context 
 */
function activate(context) {
  // const provider = new ColorsViewProvider(context.extensionUri);
  // context.subscriptions.push(vscode.window.registerWebviewViewProvider(ColorsViewProvider.viewType, provider));
  // context.subscriptions.push(vscode.commands.registerCommand('calicoColors.addColor', () => {
  //   provider.addColor();
  // }));
  // context.subscriptions.push(vscode.commands.registerCommand('calicoColors.clearColors', () => {
  //   provider.clearColors();
  // }));

  let disposable = vscode.commands.registerCommand('web-previewer.helloWorld', () => {
    console.log('hello world?');
    const panel = vscode.window.createWebviewPanel(
      'file preview',
      'HTML FILE PREVIEW',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    panel.webview.html = '<PRE>' + JSON.stringify({
      extensionUri_asWebviewUri_str: panel.webview.asWebviewUri(context.extensionUri).toString(),
      document_uri_asWebviewUri_str: vscode.window.activeTextEditor?.document.uri ? panel.webview.asWebviewUri(vscode.window.activeTextEditor?.document.uri).toString() : undefined,

      extensionUri_asWebviewUri: panel.webview.asWebviewUri(context.extensionUri),
      document_uri_asWebviewUri: vscode.window.activeTextEditor?.document.uri ? panel.webview.asWebviewUri(vscode.window.activeTextEditor?.document.uri) : undefined,

      extensionUri: context.extensionUri,
      document_uri: vscode.window.activeTextEditor?.document.uri,
    }, null, 2);


  });
  context.subscriptions.push(disposable);
}
class ColorsViewProvider {
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };
        webviewView.webview.html = _getHtmlForWebview(webviewView.webview, this._extensionUri);
        webviewView.webview.onDidReceiveMessage(data => {
            var _a;
            switch (data.type) {
                case 'colorSelected':
                    {
                        (_a = vscode.window.activeTextEditor) === null || _a === void 0 ? void 0 : _a.insertSnippet(new vscode.SnippetString(`#${data.value}`));
                        break;
                    }
            }
        });
    }
    addColor() {
        var _a, _b;
        if (this._view) {
            (_b = (_a = this._view).show) === null || _b === void 0 ? void 0 : _b.call(_a, true); // `show` is not implemented in 1.49 but is for 1.50 insiders
            this._view.webview.postMessage({ type: 'addColor' });
        }

    }
    clearColors() {
        if (this._view) {
            this._view.webview.postMessage({ type: 'clearColors' });
        }
    }
}
ColorsViewProvider.viewType = 'calicoColors.colorsView';
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

/**
 * @param {import('vscode').Webview} webview
 * @param {import('vscode').Uri}
 */
function _getHtmlForWebview(webview, extensionUri) {
  // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
  // Do the same for the stylesheet.
  const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'reset.css'));
  const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'vscode.css'));
  const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.css'));
  console.log('_getHtmlForWebview ', { extensionUri });
  /** @type {*} */
  let smallHtmlUri = 'none';
  try {
    let smallSrc =
      vscode.Uri.file(vscode.window.activeTextEditor?.document.fileName || 'small-html.html');
    //vscode.window.activeTextEditor?.document.uri || 'small-html.html'


    if (vscode.window.activeTextEditor?.document.uri) {
      smallSrc = {
        ...extensionUri,
        ...vscode.window.activeTextEditor?.document.uri
      };
    }

    console.log('_getHtmlForWebview ', { extensionUri, document_uri: vscode.window.activeTextEditor?.document.uri, smallSrc });
    smallHtmlUri = webview.asWebviewUri(smallSrc);
    console.log('_getHtmlForWebview ', { extensionUri, document_uri: vscode.window.activeTextEditor?.document.uri, smallSrc, smallHtmlUri });
  }
  catch (error) {
    smallHtmlUri = 'ERR ' + error.message + ' ' + error.stack;
  }
  // Use a nonce to only allow a specific script to be run.
  const nonce = getNonce();
  return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">

                <!--
                    Use a content security policy to only allow loading styles from our extension directory,
                    and only allow scripts that have a specific nonce.
                    (See the 'webview-sample' extension sample for img-src content security policy examples)
                -->
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

                <meta name="viewport" content="width=device-width, initial-scale=1.0">

                <link href="${styleResetUri}" rel="stylesheet">
                <link href="${styleVSCodeUri}" rel="stylesheet">
                <link href="${styleMainUri}" rel="stylesheet">

                <title>Cat Colors</title>
            </head>
            <body>
                <ul class="color-list">
                </ul>

                <button class="add-color-button">Add Color</button>

                <p>
                  <h3> Small HTML </h3>
                  <a href="${smallHtmlUri}"> small-html </a>
                  <br><br>

                  ${smallHtmlUri}
                </p>

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
}