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
      const ttyWASMStr = 'tty-wasm';


      context.subscriptions.push(
        vscode.commands.registerCommand(
          ttyWASMStr + '.createTerminal',
          createTerminal
        ));
  
      function createTerminal() {
        console.log('createTerminal invoked');
      }

    }
  }

  function tryRunningNode() {
    console.error('Not expecting to run TTY/WASM in Node.js.');
  }

  function runBrowser() {
    console.error('Not expecting to run TTY/WASM in browser.');
  }

  function runWorker() {
    // TODO: load wasm-sh and pyodide
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
