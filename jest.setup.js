// Polyfills for jsdom compatibility (Node < 18)
if (typeof global.TextEncoder === 'undefined') {
    const { TextEncoder, TextDecoder } = require('util');
    global.TextEncoder = TextEncoder;
    global.TextDecoder = TextDecoder;
}

if (typeof global.ReadableStream === 'undefined') {
    global.ReadableStream = class ReadableStream {
        constructor() {}
        getReader() { return { read: () => Promise.resolve({ done: true, value: undefined }) }; }
        cancel() {}
    };
}

if (typeof global.MessagePort === 'undefined') {
    global.MessagePort = class MessagePort {
        addListener() {}
        removeListener() {}
        onmessage() {}
        onmessageerror() {}
        postMessage() {}
        start() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
        dispatchEvent() { return true; }
    };
}

if (typeof global.MessageChannel === 'undefined') {
    global.MessageChannel = class MessageChannel {
        constructor() {
            this.port1 = new global.MessagePort();
            this.port2 = new global.MessagePort();
        }
    };
}

// Mock the problematic @exodus/bytes module
jest.mock('@exodus/bytes', () => ({}));
