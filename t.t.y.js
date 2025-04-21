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

      /**
       * @implements {vscode.Pseudoterminal}
       */
      class PTerminal {
        /**
         * @private
         * @type {vscode.EventEmitter<string>}
         */
        _onDidWrite = new vscode.EventEmitter();

        /**
         * @readonly
         * @type {vscode.Event<string>}
         */
        onDidWrite = this._onDidWrite.event;

        /**
         * @private
         * @type {vscode.EventEmitter<number | undefined>}
         */
        _onDidClose = new vscode.EventEmitter();

        /**
         * @readonly
         * @type {vscode.Event<number | undefined>}
         */
        onDidClose = this._onDidClose.event;

        /**
         * Constructor for PTerminal.
         * @param {any} [config] - Optional configuration data.
         */
        constructor(config) {
          this._config = config;
          console.log('PTerminal constructed', this._config);
          // Initialize your custom execution environment here if needed,
          // potentially using the provided config.
        }

        /**
         * Called when the terminal is opened.
         * @param {vscode.TerminalDimensions | undefined} initialDimensions - The initial dimensions of the terminal.
         */
        open(initialDimensions) {
          console.log('Pseudoterminal opened', initialDimensions, this._config);
          this._onDidWrite.fire('Welcome to my custom JavaScript terminal!\r\n');
          // Start your process or connection here and pipe output to _onDidWrite.fire().
          // You might use 'child_process' or other modules.
        }

        /**
         * Called when the terminal is closed.
         */
        close() {
          console.log('Pseudoterminal closed');
          // Clean up your process or connection here.
          this._onDidClose.fire(0); // Indicate normal closure.
        }

        /**
         * Handles input received from the VS Code terminal.
         * @param {string} data - The input data from the terminal.
         */
        handleInput(data) {
          console.log('Input received:', data);
          // Send the input 'data' to your underlying process or handle it.
        }

        /**
         * Called when the terminal is resized.
         * @param {number} rows - The new number of rows.
         * @param {number} cols - The new number of columns.
         */
        resize(rows, cols) {
          console.log('Resized to:', rows, cols);
          // If your underlying process needs to know about terminal size, handle it here.
        }
      }

      context.subscriptions.push(
        vscode.window.registerTerminalProfileProvider(
          'tty-wasm',
          {
            /**
             * Provides the terminal profile.
             * @param {vscode.CancellationToken} token
             * @returns {vscode.ProviderResult<vscode.TerminalProfile>}
             */
            provideTerminalProfile: (token) => {
              const myConfig = { /* your configuration data based on the link context */ };
              return new vscode.TerminalProfile({
                name: 'TTY Terminal in WASM',
                pty: new PTerminal(myConfig),
              });
            }
          }
        ));
      
      context.subscriptions.push(
        vscode.commands.registerCommand(
          ttyWASMStr + '.createTerminal',
          createTerminal
        ));

      function createTerminal() {
        const terminal = vscode.window.createTerminal({
          name: 'TTY Terminal in WASM',
          pty: new PTerminal()
        });
        terminal.show();
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
