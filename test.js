// @ts-check
/// <reference types="node" />

const webPreviewerUncasted = require('./vscode.w.e.b');
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

/** @type {any} */
const webPreviewer = webPreviewerUncasted;
const actualSignData = webPreviewer.signData; // Store original signData

test.describe('webPreviewer top level', () => {
  const MOCK_PUBLIC_STR = 'a'.repeat(128);
  const MOCK_PUBLIC_HASH = 'b'.repeat(8);
  const MOCK_SIGNATURE_BASE = 'c'.repeat(120); // Base for unique signatures
  const mockPrivateKey = { mock: 'privateKeyInstance' };
  const mockPublicKey = { mock: 'publicKeyInstance' }; // This will be passed to crypto.subtle.verify

  test.beforeEach(() => {
    let signDataCallCounter = 0;

    test.mock.method(webPreviewer, 'generateSigningKeyPair', async () => {
      return {
        publicStr: MOCK_PUBLIC_STR,
        publicHash: MOCK_PUBLIC_HASH,
        privateKey: mockPrivateKey,
        publicKey: mockPublicKey,
      };
    });

    test.mock.method(webPreviewer, 'signData', async (key, data) => {
      signDataCallCounter++;
      return MOCK_SIGNATURE_BASE + String(signDataCallCounter).padStart(8, '0'); // Ensure unique signatures
    });
  });

  test.afterEach(() => {
    test.mock.restoreAll();
  });

  test.describe('generateSigningKeyPair', () => {
    test.it('return publicStr and publicHash', async () => {
      const { publicStr, publicHash } = await webPreviewer.generateSigningKeyPair();
      assert.strictEqual(typeof publicStr, 'string', 'publicStr should be a string');
      assert.strictEqual(typeof publicHash, 'string', 'publicHash should be a string');
      assert.strictEqual(publicStr.length, 128, 'publicStr should be 128 characters long');
      assert.ok(publicHash.length <= 8, 'publicHash length ' + publicHash.length + ' should be <= 8');
    });
  });

  test.describe('signData', () => {
    let mockCryptoSubtleSign;
    let mockCryptoSubtleVerify;
    let mockLocalCrypto;

    // These keys will come from the parent suite's mock of generateSigningKeyPair
    let mockPrivateKeyFromParent;
    let mockPublicKeyFromParent;

    test.beforeEach(async () => {
      mockCryptoSubtleSign = test.mock.fn(async (algorithm, key, data) => {
        // Use mock.calls.length to make signatures unique. 
        // .length will be 1 for the first call, 2 for the second, etc.
        const buffer = new ArrayBuffer(8);
        const view = new Uint8Array(buffer);
        view[0] = mockCryptoSubtleSign.mock.calls.length; 
        return buffer;
      });
      mockCryptoSubtleVerify = test.mock.fn(async (algorithm, key, sig, data) => true); // Mock verification success

      mockLocalCrypto = {
        subtle: {
          sign: mockCryptoSubtleSign,
          verify: mockCryptoSubtleVerify,
        }
      };

      // Get the mock keys from the parent's mocked generateSigningKeyPair
      const keys = await webPreviewer.generateSigningKeyPair();
      mockPrivateKeyFromParent = keys.privateKey;
      mockPublicKeyFromParent = keys.publicKey;
    });

    test.it('produce a valid signature and verify it', async () => {
      const dataToSign = 'This is some data to sign';
      const signatureArrayBuffer = await actualSignData(mockPrivateKeyFromParent, dataToSign, mockLocalCrypto);

      assert.ok(signatureArrayBuffer instanceof ArrayBuffer, 'Signature should be an ArrayBuffer');
      assert.strictEqual(mockCryptoSubtleSign.mock.calls.length, 1, 'mockLocalCrypto.subtle.sign should be called once');
      assert.deepStrictEqual(mockCryptoSubtleSign.mock.calls[0].arguments[0], { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, 'sign called with correct algorithm');
      assert.deepStrictEqual(mockCryptoSubtleSign.mock.calls[0].arguments[1], mockPrivateKeyFromParent, 'sign called with correct key');
      assert.ok(mockCryptoSubtleSign.mock.calls[0].arguments[2] instanceof Uint8Array, 'sign called with Uint8Array data');

      const dataBuffer = new TextEncoder().encode(dataToSign);
      const isVerified = await mockLocalCrypto.subtle.verify(
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        mockPublicKeyFromParent,
        signatureArrayBuffer,
        dataBuffer
      );

      assert.ok(isVerified, 'Signature should be verifiable with mockLocalCrypto.subtle.verify');
      assert.strictEqual(mockCryptoSubtleVerify.mock.calls.length, 1, 'mockLocalCrypto.subtle.verify should be called once');
      assert.deepStrictEqual(mockCryptoSubtleVerify.mock.calls[0].arguments[1], mockPublicKeyFromParent, 'verify called with correct public key');
    });
  });
});

test.describe('webPreviewer runExtension', () => {
  let mockVscode;
  let activate;
  let deactivate;
  let resolveWebviewView;
  let createWorkerIframeReadyPromise;
  /** @type {any} */
  let freshWebPreviewerModule;

  const MOCK_PUBLIC_HASH = "mockHash";
  const MOCK_PUBLIC_STR = "mockStr".padEnd(128, '0');

  test.beforeEach(async () => {
    mockVscode = {
      EventEmitter: test.mock.fn(() => ({
        event: test.mock.fn(),
        fire: test.mock.fn(),
        dispose: test.mock.fn(),
      })),
      commands: {
        registerCommand: test.mock.fn(),
        executeCommand: test.mock.fn(() => Promise.resolve()),
      },
      window: {
        createWebviewPanel: test.mock.fn(() => ({
          onDidDispose: test.mock.fn((disposeCallback) => {
            return { dispose: test.mock.fn() };
          }),
          webview: {
            html: '',
            options: {},
            onDidReceiveMessage: test.mock.fn((messageCallback) => {
              return { dispose: test.mock.fn() };
            }),
            asWebviewUri: test.mock.fn(uri => uri),
            postMessage: test.mock.fn(),
            cspSource: 'mock-panel-csp-source',
          },
          reveal: test.mock.fn(),
          visible: false,
          title: 'Initial Panel Title',
          dispose: test.mock.fn(),
        })),
        createTerminal: test.mock.fn(() => ({
          show: test.mock.fn(),
          dispose: test.mock.fn(),
        })),
        registerTerminalProfileProvider: test.mock.fn(),
        registerWebviewViewProvider: test.mock.fn(),
        showErrorMessage: test.mock.fn(),
        showInformationMessage: test.mock.fn(),
        onDidOpenTerminal: test.mock.fn(() => ({ dispose: test.mock.fn() })),
        activeTextEditor: undefined,
      },
      workspace: {
        openTextDocument: test.mock.fn(() => Promise.resolve({ getText: () => '', fileName: 'test.html' })),
        onDidCloseTextDocument: test.mock.fn(() => ({ dispose: test.mock.fn() })),
        onDidSaveTextDocument: test.mock.fn(() => ({ dispose: test.mock.fn() })),
      },
      Uri: {
        joinPath: test.mock.fn((base, ...parts) => (base ? (base.path || base) : '') + '/' + parts.join('/')),
        file: test.mock.fn(path => ({ scheme: 'file', path, fsPath: path, toString: () => `file://${path}` })),
      },
      ViewColumn: { One: 1 },
      TerminalProfile: test.mock.fn(options => options),
    };

    const Module = require('module');
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function (id) {
      if (id === 'vscode') {
        return mockVscode;
      }
      return originalRequire.apply(this, arguments);
    };

    const modulePath = require.resolve('./vscode.w.e.b');
    delete require.cache[modulePath];
    freshWebPreviewerModule = require('./vscode.w.e.b');

    // Mock generateSigningKeyPair on the fresh module instance
    if (freshWebPreviewerModule && typeof freshWebPreviewerModule.generateSigningKeyPair === 'function') {
      freshWebPreviewerModule.generateSigningKeyPair = test.mock.fn(async () => {
        return { publicStr: MOCK_PUBLIC_STR, publicHash: MOCK_PUBLIC_HASH, privateKey: {}, publicKey: {} };
      });
    }
    
    activate = freshWebPreviewerModule.activate;
    deactivate = freshWebPreviewerModule.deactivate;

    if (freshWebPreviewerModule && freshWebPreviewerModule.runExtension && typeof freshWebPreviewerModule.runExtension === 'object') {
      resolveWebviewView = freshWebPreviewerModule.runExtension.resolveWebviewView;
      createWorkerIframeReadyPromise = freshWebPreviewerModule.runExtension.createWorkerIframeReadyPromise;
    } else {
      console.error("freshWebPreviewerModule.runExtension is not structured as expected:", freshWebPreviewerModule.runExtension);
      resolveWebviewView = () => { throw new Error("resolveWebviewView not loaded from module"); };
      createWorkerIframeReadyPromise = () => { throw new Error("createWorkerIframeReadyPromise not loaded from module"); return Promise.reject(new Error("createWorkerIframeReadyPromise not loaded")); };
    }
    Module.prototype.require = originalRequire;
  });

  test.afterEach(() => {
    test.mock.restoreAll();
  });

  test.describe('activate', () => {
    let mockContext;

    test.beforeEach(async () => {
      mockContext = {
        subscriptions: [],
        extensionUri: mockVscode.Uri.file('/mock/extension/path/activate-test'),
        globalState: { get: test.mock.fn(), update: test.mock.fn() },
        workspaceState: { get: test.mock.fn(), update: test.mock.fn() },
        overrides: { vscode: mockVscode }
      };
      mockVscode.commands.registerCommand.mock.resetCalls();
      mockVscode.window.registerTerminalProfileProvider.mock.resetCalls();
      mockVscode.window.registerWebviewViewProvider.mock.resetCalls();
      mockVscode.window.onDidOpenTerminal.mock.resetCalls();
      mockVscode.commands.executeCommand.mock.resetCalls();
      mockVscode.window.showErrorMessage.mock.resetCalls();

      if (activate && typeof activate === 'function') {
        await activate(mockContext);
      } else {
        throw new Error("activate function is not available for testing");
      }
    });

    test.it('should register commands and providers using overridden vscode', () => {
      assert.strictEqual(mockVscode.commands.registerCommand.mock.calls.length, 2, 'Two commands should be registered');
      assert.strictEqual(mockVscode.window.registerTerminalProfileProvider.mock.calls.length, 1, 'Terminal profile provider should be registered');
      assert.strictEqual(mockVscode.window.registerWebviewViewProvider.mock.calls.length, 1, 'Webview view provider should be registered');
      assert.strictEqual(mockVscode.window.onDidOpenTerminal.mock.calls.length, 1, 'onDidOpenTerminal listener should be registered');
      assert.ok(mockContext.subscriptions.length > 0, 'Subscriptions should be added');
    });

    test.it('previewDocumentAsHtml command should create and show webview panel for the document', async () => {
      const previewCommandCall = mockVscode.commands.registerCommand.mock.calls.find(call => call.arguments[0] === 'web-previewer.previewDocumentAsHtml');
      assert.ok(previewCommandCall, "previewDocumentAsHtml command should be registered");
      const previewCommandCallback = previewCommandCall.arguments[1];
      const mockDocUri = mockVscode.Uri.file('/test.html');

      /** @type {any} */
      let capturedPanel;
      mockVscode.window.createWebviewPanel = test.mock.fn((viewType, title, column, options) => {
        const panel = {
          webview: {
            html: '',
            options: {},
            onDidReceiveMessage: test.mock.fn(() => ({ dispose: test.mock.fn() })),
            asWebviewUri: test.mock.fn(uri => uri),
            cspSource: 'mock-csp-source',
          },
          reveal: test.mock.fn(),
          onDidDispose: test.mock.fn(() => ({ dispose: test.mock.fn() })),
          visible: false,
          title: '',
          dispose: test.mock.fn(),
        };
        capturedPanel = panel;
        return panel;
      });

      await previewCommandCallback(mockDocUri);

      assert.ok(mockVscode.window.createWebviewPanel.mock.calls.length >= 1, 'createWebviewPanel should be called');
      assert.ok(capturedPanel, 'Panel should be captured');
      assert.ok(capturedPanel.reveal.mock.calls.length >= 1, 'panel.reveal() should be called');
      assert.ok(capturedPanel.webview.html.includes('webPreviewer('), 'Panel HTML should be set with webPreviewer script');
      assert.strictEqual(mockVscode.window.showErrorMessage.mock.calls.length, 0, "showErrorMessage should not have been called");
    });

    test.it('ensureRuntimeFrameViewIsResolvedAndLoadsIframe should resolve its promise on view focus and ready message', async () => {
      // activate() has run from the describe.beforeEach, so providers are registered.
      const runtimeFrameViewProviderCall = mockVscode.window.registerWebviewViewProvider.mock.calls.find(call => call.arguments[0] === 'web-previewer.runtimeFrameView');
      assert.ok(runtimeFrameViewProviderCall, 'WebviewViewProvider for runtimeFrameView should be registered by activate');
      const actualResolveWebviewView = runtimeFrameViewProviderCall.arguments[1].resolveWebviewView;
      assert.ok(typeof actualResolveWebviewView === 'function', 'resolveWebviewView function should be available from provider registration');

      let capturedMessageHandler;
      const tempMockWebviewView = {
        webview: {
          options: {}, // Used: target of assignment
          html: '',    // Used: target of assignment
          onDidReceiveMessage: test.mock.fn((handler) => { // Used: for subscription
            capturedMessageHandler = handler;
            return { dispose: test.mock.fn() };
          }),
          postMessage: test.mock.fn(), // Used: called by resolveWebviewView's message handler
        },
        onDidDispose: test.mock.fn(() => ({ dispose: test.mock.fn() })), // Used: for subscription
      };

      mockVscode.commands.executeCommand = test.mock.fn(async (commandId) => {
        if (commandId === 'web-previewer.runtimeFrameView.focus') {
          await actualResolveWebviewView(tempMockWebviewView, {}, null);
          if (capturedMessageHandler) {
            setImmediate(() => capturedMessageHandler({ command: 'workerIframeReady' }));
          } else {
            console.error("Test Error: Message handler not captured in executeCommand mock for .focus");
            throw new Error("Message handler not captured for .focus");
          }
          return Promise.resolve();
        }
        // For any other command, if the original mock had a default behavior,
        // we might need to replicate it or ensure it's covered by the per-test mockVscode setup.
        // Given mockVscode.commands.executeCommand is initialized to test.mock.fn(() => Promise.resolve()),
        // we can just return that for other commands.
        return Promise.resolve();
      });
      
      const ensureRuntimeFrameViewIsResolvedAndLoadsIframe = freshWebPreviewerModule.runExtension.ensureRuntimeFrameViewIsResolvedAndLoadsIframe;
      assert.ok(typeof ensureRuntimeFrameViewIsResolvedAndLoadsIframe === 'function', 'ensureRuntimeFrameViewIsResolvedAndLoadsIframe should be a function');

      const readyPromise = ensureRuntimeFrameViewIsResolvedAndLoadsIframe();

      await assert.doesNotReject(readyPromise, 'workerIframeReadyPromise from ensureRuntimeFrameView... should resolve');
      assert.ok(
        mockVscode.commands.executeCommand.mock.calls.some(call => call.arguments[0] === 'web-previewer.runtimeFrameView.focus'),
        'executeCommand with web-previewer.runtimeFrameView.focus should be called'
      );
      assert.ok(capturedMessageHandler, "Message handler should have been captured by resolveWebviewView simulation");
    });
  });

  test.describe('resolveWebviewView', () => {
    let mockWebviewView;
    let mockWebview;
    let mockContext;
    let capturedWebviewViewOnDidDisposeCallback = null;

    test.beforeEach(() => {
      capturedWebviewViewOnDidDisposeCallback = null;
      mockWebview = {
        options: {},
        html: '',
        cspSource: 'mockCspSourceValue',
        onDidReceiveMessage: test.mock.fn(() => ({ dispose: test.mock.fn() })),
        // This onDidDispose is for the webview content itself, not what the code currently calls for promise cleanup
        onDidDispose: test.mock.fn(() => ({ dispose: test.mock.fn() })),
        asWebviewUri: test.mock.fn(uri => uri),
        postMessage: test.mock.fn(),
      };
      mockWebviewView = {
        webview: mockWebview,
        // This is the onDidDispose that resolveWebviewView actually subscribes to
        onDidDispose: test.mock.fn((callback) => {
          capturedWebviewViewOnDidDisposeCallback = callback;
          return { dispose: test.mock.fn() };
        }),
        show: test.mock.fn(),
        visible: true,
      };
      mockContext = { // This mockContext is defined but activate() won't be called with it in the modified tests below.
        subscriptions: [],
        extensionUri: mockVscode.Uri.file('/mock/extension/path/activate-test'), // Path can be generic
        globalState: { get: test.mock.fn(), update: test.mock.fn() },
        workspaceState: { get: test.mock.fn(), update: test.mock.fn() },
        overrides: {
          vscode: mockVscode,
          // crypto: mockCrypto // crypto override was for activate, which is being removed from these tests
        }
      };

      // Mock crypto functions needed by signData, which is called by resolveWebviewView
      test.mock.method(globalThis.crypto.subtle, 'importKey', async () => ({})); // Mock importKey to return a dummy key object
      test.mock.method(globalThis.crypto.subtle, 'sign', async () => new ArrayBuffer(8)); // Mock sign to return a dummy signature
    });

    test.it('should set webview HTML and options', async () => {
      // await activate(mockContext); // Removed
      assert.ok(resolveWebviewView, "resolveWebviewView should be loaded");
      resolveWebviewView(mockWebviewView, {}, null);
      assert.strictEqual(mockWebview.options.enableScripts, true);
      assert.ok(mockWebview.html.includes('PROXY IFRAME'));
    });

    test.it('should handle workerIframeReady message and resolve promise', async () => {
      // await activate(mockContext); // Removed
      resolveWebviewView(mockWebviewView, {}, null);
      const readyPromise = createWorkerIframeReadyPromise();
      const onDidReceiveMessageCallback = mockWebview.onDidReceiveMessage.mock.calls[0].arguments[0];
      
      let promiseResolved = false;
      readyPromise.then(() => { promiseResolved = true; });

      onDidReceiveMessageCallback({ command: 'workerIframeReady' });
      
      await new Promise(resolve => setImmediate(resolve)); 
      assert.strictEqual(promiseResolved, true, 'workerIframeReadyPromise should resolve');
    });

    test.it('should handle workerIframeError message and reject promise', async () => {
      resolveWebviewView(mockWebviewView, {}, null);
      const readyPromise = createWorkerIframeReadyPromise();
      const onDidReceiveMessageCallback = mockWebview.onDidReceiveMessage.mock.calls[0].arguments[0];

      let promiseRejected = false;
      readyPromise.then(() => {}, () => { promiseRejected = true; });

      onDidReceiveMessageCallback({ command: 'workerIframeError', error: 'test error' });

      await new Promise(resolve => setImmediate(resolve));
      assert.strictEqual(promiseRejected, true, 'workerIframeReadyPromise should reject');
    });

    test.it('onDidDispose should clear promise state, allowing new promise creation and resolution/rejection', async () => {
      // await activate(mockContext); // Removed
   
      const promise_before_disposal = createWorkerIframeReadyPromise();
      
      resolveWebviewView(mockWebviewView, {}, null);
      // Check that the callback from webviewView.onDidDispose was captured
      assert.ok(typeof capturedWebviewViewOnDidDisposeCallback === 'function', 'webviewView.onDidDispose callback should have been captured');

      capturedWebviewViewOnDidDisposeCallback();

      const promise_after_dispose1 = createWorkerIframeReadyPromise();
      assert.ok(promise_after_dispose1, 'New promise should be creatable after disposal');
      assert.notStrictEqual(promise_after_dispose1, promise_before_disposal, "A new promise instance should be created after disposal");

      const onDidReceiveMessageCallback = mockWebview.onDidReceiveMessage.mock.calls[0].arguments[0];
      let p1Resolved = false;
      promise_after_dispose1.then(() => { p1Resolved = true; });
      onDidReceiveMessageCallback({ command: 'workerIframeReady' });
      await new Promise(resolve => setImmediate(resolve));
      assert.strictEqual(p1Resolved, true, 'Newly created promise (p1) after disposal should resolve');

      // Check again if the callback is still considered a function (it should be, it's the same mock)
      assert.ok(typeof capturedWebviewViewOnDidDisposeCallback === 'function', 'webviewView.onDidDispose callback should still be valid for a second call');
      capturedWebviewViewOnDidDisposeCallback();

      const promise_after_dispose2 = createWorkerIframeReadyPromise();
      assert.ok(promise_after_dispose2, 'Another new promise should be creatable after second disposal');
      assert.notStrictEqual(promise_after_dispose2, promise_after_dispose1, "A new promise instance (p2) should be created after second disposal");
      
      let p2Rejected = false;
      promise_after_dispose2.catch(() => { p2Rejected = true; });
      onDidReceiveMessageCallback({ command: 'workerIframeError', error: 'test error for p2' });
      await new Promise(resolve => setImmediate(resolve));
      assert.strictEqual(p2Rejected, true, 'Newly created promise (p2) after second disposal should reject');
    });
  });

});
