/**
 * Email Structure Extraction Tests
 * Tests for extractEmailStructure function - separating quoted content, signatures, and main content
 */

/** @jest-environment jsdom */

// Mock browser API before requiring background.js
const browser = {
    compose: {
        onBeforeSend: {
            addListener: jest.fn()
        },
        getComposeDetails: jest.fn()
    },
    windows: {
        getAll: jest.fn(),
        update: jest.fn(),
        create: jest.fn()
    },
    runtime: {
        onMessage: {
            addListener: jest.fn()
        },
        sendMessage: jest.fn()
    },
    notifications: {
        create: jest.fn()
    },
    storage: {
        local: {
            get: jest.fn(),
            set: jest.fn()
        }
    }
};

global.browser = browser;

// Import module under test after setting up mocks
const { extractEmailStructure } = require('../background.js');


describe('extractEmailStructure - Signature Extraction', () => {
    test('stops at email reply separators when extracting signature', () => {
        const html = `<p>Reply content here.</p>
<p>John Doe</p>
<p>Product Manager</p>
<p>-- <br>john@example.com</p>
<p>On 2025-02-15, Bob wrote:</p>
<p>Previous signature line 1</p>
<p>Previous signature line 2</p>
<p>-- <br>bob@example.com</p>`;

        const result = extractEmailStructure(html);

        // Should extract only John's signature (the last one), stop at 'On...wrote:' separator
        expect(result.signatureContent).toContain('John Doe');
        expect(result.signatureContent).toContain('Product Manager');
        expect(result.signatureContent).toContain('john@example.com');
        expect(result.signatureContent).not.toContain('Bob');
        expect(result.signatureContent).not.toContain('bob@example.com');

        const signatureOccurrences = (result.signatureContent.match(/-- /g) || []).length;
        expect(signatureOccurrences).toBe(1);
    });
});
