/**
 * Recipient Whitelist Tests
 * Tests for recipient whitelist feature - skip tone check when all recipients are whitelisted
 */

/** @jest-environment jsdom */

// Mock browser globals (required for loading background.js)
const browser = {
    compose: { onBeforeSend: { addListener: jest.fn() }, getComposeDetails: jest.fn(), setComposeDetails: jest.fn() },
    tabs: { update: jest.fn(), get: jest.fn() },
    windows: { update: jest.fn(), getAll: jest.fn(), create: jest.fn() },
    runtime: { onMessage: { addListener: jest.fn() }, getURL: jest.fn((p) => `chrome://test/${p}`) },
    notifications: { create: jest.fn().mockResolvedValue(undefined) },
    accounts: { list: jest.fn() },
    storage: { local: { get: jest.fn(), set: jest.fn() } }
};

global.browser = browser;

const { handleOnBeforeSend } = require('../background.js');

// Mock fetch
global.fetch = jest.fn();

// Mock AbortController
class MockAbortController {
    constructor() {
        this.signal = {};
        this.abort = jest.fn();
    }
}
global.AbortController = MockAbortController;

// Mock DOMParser for HTML parsing (jsdom env provides these)
class MockDOMParser {
    parseFromString(html, contentType) {
        return {
            body: { innerHTML: html || '' },
            querySelectorAll: () => []
        };
    }
}
global.DOMParser = MockDOMParser;
global.window = global.window || {};

describe('Recipient Whitelist', () => {
    let mockTab;

    beforeEach(() => {
        jest.clearAllMocks();
        mockTab = { id: 123, windowId: 456 };
        
        // Default mock setup
        browser.tabs.get.mockResolvedValue(mockTab);
        browser.compose.getComposeDetails.mockResolvedValue({
            body: 'Test email',
            to: ['user@example.com'],
            cc: [],
            bcc: [],
            subject: 'Test',
            identityId: 'id1'
        });
        browser.compose.setComposeDetails.mockResolvedValue(undefined);
        browser.tabs.update.mockResolvedValue(undefined);
        browser.windows.update.mockResolvedValue(undefined);
        browser.windows.getAll.mockResolvedValue([]);
        browser.accounts.list.mockResolvedValue([
            { id: 'account1', identities: [{ id: 'id1', name: 'Test', email: 'test@example.com' }] }
        ]);
        
        // Mock successful AI response (professional email)
        fetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            isProfessional: true,
                            problems: [],
                            rewrittenEmail: '',
                            suggestions: []
                        })
                    }
                }]
            })
        });
    });

    describe('Test 1: All recipients (To only) whitelisted → skip check', () => {
        test('single whitelisted recipient → handleOnBeforeSend returns undefined AND fetch is never called', async () => {
            // Setup: whitelist contains the recipient
            browser.storage.local.get.mockResolvedValue({
                apiEndpoint: 'https://api.example.com',
                apiKey: 'test-key',
                model: 'gpt-4',
                enabled: true,
                checkedAccounts: [],
                recipientWhitelist: ['user@example.com'],
                customPrompt: ''
            });

            const result = await handleOnBeforeSend(mockTab, { to: ['user@example.com'] });

            // Should skip the check entirely
            expect(result).toBeUndefined();
            // Fetch should never be called
            expect(fetch).not.toHaveBeenCalled();
        });
    });

    describe('Test 2: To+Cc+Bcc all whitelisted → skip', () => {
        test('all recipients across To/Cc/Bcc whitelisted → fetch not called', async () => {
            browser.compose.getComposeDetails.mockResolvedValue({
                body: 'Test email',
                to: ['to@example.com'],
                cc: ['cc@example.com'],
                bcc: ['bcc@example.com'],
                subject: 'Test',
                identityId: 'id1'
            });

            browser.storage.local.get.mockResolvedValue({
                apiEndpoint: 'https://api.example.com',
                apiKey: 'test-key',
                model: 'gpt-4',
                enabled: true,
                checkedAccounts: [],
                recipientWhitelist: ['to@example.com', 'cc@example.com', 'bcc@example.com'],
                customPrompt: ''
            });

            const result = await handleOnBeforeSend(mockTab, { to: ['to@example.com'], cc: ['cc@example.com'], bcc: ['bcc@example.com'] });

            expect(result).toBeUndefined();
            expect(fetch).not.toHaveBeenCalled();
        });
    });

    describe('Test 3: One recipient NOT whitelisted → normal flow', () => {
        test('one non-whitelisted recipient → fetch is called', async () => {
            browser.storage.local.get.mockResolvedValue({
                apiEndpoint: 'https://api.example.com',
                apiKey: 'test-key',
                model: 'gpt-4',
                enabled: true,
                checkedAccounts: [],
                recipientWhitelist: ['user@example.com'],
                customPrompt: ''
            });

            // Recipient not in whitelist
            const result = await handleOnBeforeSend(mockTab, { to: ['other@example.com'] });

            // Normal flow continues
            expect(fetch).toHaveBeenCalledTimes(1);
            // Result can be undefined (professional) or { cancel: true } (unprofessional)
            // Both are valid - the key is that fetch WAS called
        });
    });

    describe('Test 4: Case-insensitive matching', () => {
        test('stored User@Example.com matches compose user@example.com → skip', async () => {
            browser.storage.local.get.mockResolvedValue({
                apiEndpoint: 'https://api.example.com',
                apiKey: 'test-key',
                model: 'gpt-4',
                enabled: true,
                checkedAccounts: [],
                recipientWhitelist: ['User@Example.com'], // Different case
                customPrompt: ''
            });

            const result = await handleOnBeforeSend(mockTab, { to: ['user@example.com'] });

            expect(result).toBeUndefined();
            expect(fetch).not.toHaveBeenCalled();
        });
    });

    describe('Test 5: No recipients at all → NO skip, normal flow', () => {
        test('empty recipient list → fetch is called', async () => {
            browser.compose.getComposeDetails.mockResolvedValue({
                body: 'Test email',
                to: [],
                cc: [],
                bcc: [],
                subject: 'Test',
                identityId: 'id1'
            });

            browser.storage.local.get.mockResolvedValue({
                apiEndpoint: 'https://api.example.com',
                apiKey: 'test-key',
                model: 'gpt-4',
                enabled: true,
                checkedAccounts: [],
                recipientWhitelist: ['user@example.com'],
                customPrompt: ''
            });

            const result = await handleOnBeforeSend(mockTab, { to: [], cc: [], bcc: [] });

            // No recipients means NO skip - normal flow
            expect(fetch).toHaveBeenCalledTimes(1);
        });
    });

    describe('Test 6: Empty whitelist → normal flow', () => {
        test('empty whitelist → fetch is called', async () => {
            browser.storage.local.get.mockResolvedValue({
                apiEndpoint: 'https://api.example.com',
                apiKey: 'test-key',
                model: 'gpt-4',
                enabled: true,
                checkedAccounts: [],
                recipientWhitelist: [],
                customPrompt: ''
            });

            const result = await handleOnBeforeSend(mockTab, { to: ['user@example.com'] });

            // Empty whitelist means NO skip - normal flow
            expect(fetch).toHaveBeenCalledTimes(1);
        });
    });
});