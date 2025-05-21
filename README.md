# HTML Preview for VSCode

Open current document inside VSCode WebView as an normal HTML page.

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