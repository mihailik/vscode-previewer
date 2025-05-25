# HTML Preview for VSCode

Open current document inside VSCode WebView as an normal HTML page.

![🌍 HTML Preview](./demo.gif)

Supports:
* local and remote images: `<IMG SRC="...">`
* local, remote and embedded scripts: `<SCRIPT SRC="..."></SCRIPT>` and `<SCRIPT> ... </SCRIPT>`
* local, remote and embedded stylesheets: `<LINK REL=STYLESHEET HREF="...">` and `<STYLE> ... </STYLE>`
* `alert(...)` popups
* notifications on unhandled exceptions

Does not support (security restricted):
* embedded pages: `<IFRAME>` and `<OBJECT>`
* opening new windows: `window.open(...)`
* synchronous prompts: `prompt(...)`


## Implementation notes

This extension implemented inside a single function called **webPreviewer()**.
That makes it easier to pass around the execution flow across certain boundaries.

At the start of the function, the code checks or detects the environment, and acts accordingly.

### Environments:

* **test**<br>
Assigns several otherwise hidden functions to the module.exports, allowing the test code to evaluate them.
* **extension**<br>
The top level scope in VSCode web extension. Technically runs inside WebWorker,
has access to many VSCode APIs.
* **proxy**<br>
Hosted inside a small web view, in a side panel called Runtime.
VSCode uses IFRAME for such web views.
This web view is there to host another IFRAME , this time external
on https://iframe.live site, which provides execution environment for the terminals.
* **html**<br>
Web view hosted inside top a document tab in VSCode, used to show
preview of HTML content. The web view hosts two IFRAMEs:
one to negotiate the file content, and another to host the actual HTML content.
* **remoteAgent**<br>
Running all the way inside https://iframe.live site and executing terminal requests.