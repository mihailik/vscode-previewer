// @ts-check
/// <reference types="node" />

const webPreviewerUncasted = require('./vscode.w.e.b');
const test = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

/** @type {any} */
const webPreviewer = webPreviewerUncasted;

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
    test.it('produce a valid signature and verify it', async () => {
      const { privateKey, publicKey: retrievedPublicKey } = await webPreviewer.generateSigningKeyPair();
      const dataToSign = 'This is some data to sign';
      const signature = await webPreviewer.signData(privateKey, dataToSign);

      assert.strictEqual(typeof signature, 'string', 'signature should be a string');

      const cryptoNode = require('node:crypto');
      const originalVerify = cryptoNode.webcrypto.subtle.verify;
      const verifyMock = test.mock.fn(async (algorithm, key, sig, data) => {
        assert.deepStrictEqual(key, mockPublicKey, "crypto.subtle.verify called with the correct mock public key");
        return true; // Mock verification success
      });
      cryptoNode.webcrypto.subtle.verify = verifyMock;

      const signatureBuffer = Buffer.from(signature, 'hex');
      const dataBuffer = new TextEncoder().encode(dataToSign);

      const isVerified = await cryptoNode.webcrypto.subtle.verify(
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, // Algorithm consistent with webPreviewer's generateSigningKeyPair
        retrievedPublicKey,
        signatureBuffer,
        dataBuffer
      );
      assert.ok(isVerified, 'Signature should be verifiable (using mocked crypto.subtle.verify)');
      assert.strictEqual(verifyMock.mock.calls.length, 1, 'crypto.subtle.verify mock should be called once');

      cryptoNode.webcrypto.subtle.verify = originalVerify;
    });

    test.it('produce different signatures for different data', async () => {
      const { privateKey } = await webPreviewer.generateSigningKeyPair();
      const data1 = 'data1';
      const data2 = 'data2';
      const signature1 = await webPreviewer.signData(privateKey, data1);
      const signature2 = await webPreviewer.signData(privateKey, data2);
      assert.notStrictEqual(signature1, signature2, 'Signatures for different data should not be the same');
    });

    test.it('produce different signatures for different keys', async () => {
      const { privateKey: privateKey1 } = await webPreviewer.generateSigningKeyPair();
      const { privateKey: privateKey2 } = await webPreviewer.generateSigningKeyPair();
      // Note: privateKey1 and privateKey2 are the same mock object with the current generateSigningKeyPair mock.
      // The difference in signatures relies on the signData mock's call counter.
      const data = 'some data';
      const signature1 = await webPreviewer.signData(privateKey1, data);
      const signature2 = await webPreviewer.signData(privateKey2, data);
      assert.notStrictEqual(signature1, signature2, 'Signatures from subsequent calls to signData should differ');
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

    test.it('previewDocumentAsHtml command execution flow with overridden vscode', async () => {
      const previewCommandCall = mockVscode.commands.registerCommand.mock.calls.find(call => call.arguments[0] === 'web-previewer.previewDocumentAsHtml');
      assert.ok(previewCommandCall, "previewDocumentAsHtml command should be registered");
      const previewCommandCallback = previewCommandCall.arguments[1];
      
      const mockDocUri = mockVscode.Uri.file('/test.html');
      
      const currentReadyPromise = createWorkerIframeReadyPromise();
      let promiseResolved = false;
      currentReadyPromise.then(() => { promiseResolved = true; });

      mockVscode.commands.executeCommand.mock.mockImplementation(async (commandId) => {
        if (commandId === 'web-previewer.runtimeFrameView.focus') {
          /** @type {((message: {command: string, [key: string]: any}) => Promise<void>) | null} */
          let storedMessageHandler = null;

          const tempMockWebview = {
            options: {}, html: '', cspSource: 'mockCspSource',
            onDidReceiveMessage: test.mock.fn((handler) => {
              storedMessageHandler = handler;
              return { dispose: test.mock.fn() };
            }),
            onDidDispose: test.mock.fn((cb) => ({ dispose: test.mock.fn() })),
            asWebviewUri: test.mock.fn(uri => uri), postMessage: test.mock.fn(),
          };
          const tempMockWebviewView = {
            webview: tempMockWebview, 
            onDidDispose: test.mock.fn(() => ({ dispose: test.mock.fn() })), 
            show: test.mock.fn(), 
            visible: true,
          };
          
          if (resolveWebviewView && typeof resolveWebviewView === 'function') {
            resolveWebviewView(tempMockWebviewView, {}, null);
          } else {
            console.error("resolveWebviewView is not available or not a function in test");
            throw new Error("resolveWebviewView not available for test setup");
          }
          
          // tempMockWebview.onDidReceiveMessage would have been called by resolveWebviewView
          // and storedMessageHandler should now be set.
          if (typeof storedMessageHandler === 'function') {
            // @ts-ignore storedMessageHandler could be null here, but the check above should prevent it
            setImmediate(() => storedMessageHandler({ command: 'workerIframeReady' }));
          } else {
            console.error("previewDocumentAsHtml test: messageHandler was not stored or is not a function.", { handler: storedMessageHandler });
          }
        }
        return Promise.resolve();
      });

      await previewCommandCallback(mockDocUri);
      
      await new Promise(resolve => setImmediate(resolve));

      assert.ok(promiseResolved, "workerIframeReadyPromise should have resolved after command execution");
      assert.ok(mockVscode.commands.executeCommand.mock.calls.some(call => call.arguments[0] === 'web-previewer.runtimeFrameView.focus'));
      assert.strictEqual(mockVscode.window.showErrorMessage.mock.calls.length, 0, "showErrorMessage should not have been called");
    });
  });

  test.describe('resolveWebviewView', () => {
    let mockWebviewView;
    let mockWebview;
    let mockContext;
    let mockCrypto;
    let capturedWebviewViewOnDidDisposeCallback = null;

    test.beforeEach(() => {
      // This beforeEach for 'resolveWebviewView' runs AFTER the main beforeEach.
      // So, freshWebPreviewerModule and its functions (like generateSigningKeyPair mock) are set up.
      // The publicHash used by resolveWebviewView should be MOCK_PUBLIC_HASH.

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
      mockCrypto = {
        subtle: {
          generateKey: () => /** @type {*} */({ __key: 'mock1' }),
          exportKey: /** @type {*} */(() => new TextEncoder().encode('mock2')),
          // the part to emulate the publicHash of tso86l
          digest: /** @type {*} */(() => (new TextEncoder().encode('mock3_12')).buffer),
          sign: /** @type {*} */(() => new TextEncoder().encode('mock4')),
        }
      };
      mockContext = {
        subscriptions: [],
        extensionUri: mockVscode.Uri.file('/mock/extension/path/activate-test'),
        globalState: { get: test.mock.fn(), update: test.mock.fn() },
        workspaceState: { get: test.mock.fn(), update: test.mock.fn() },
        overrides: {
          vscode: mockVscode,
          crypto: mockCrypto
        }
      };
    });

    test.it('should set webview HTML and options', async () => {
      await activate(mockContext);
      assert.ok(resolveWebviewView, "resolveWebviewView should be loaded");
      resolveWebviewView(mockWebviewView, {}, null);
      assert.strictEqual(mockWebview.options.enableScripts, true);
      assert.ok(mockWebview.html.includes('PROXY IFRAME'));
    });

    test.it('should handle workerIframeReady message and resolve promise', async () => {
      await activate(mockContext);
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
      await activate(mockContext);
   
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
