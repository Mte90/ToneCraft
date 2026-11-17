/** @jest-environment jsdom */

// Mock browser globals
const browser = {
    compose: { 
        onBeforeSend: { addListener: jest.fn() }, 
        getComposeDetails: jest.fn(), 
        setComposeDetails: jest.fn() 
    },
    tabs: { update: jest.fn(), get: jest.fn() },
    windows: { update: jest.fn(), getAll: jest.fn(), create: jest.fn(), remove: jest.fn() },
    runtime: { onMessage: { addListener: jest.fn() }, getURL: jest.fn((p) => `chrome://test/${p}`) },
    notifications: { create: jest.fn().mockResolvedValue(undefined) },
    accounts: { list: jest.fn() },
    storage: { local: { get: jest.fn(), set: jest.fn() } }
};

global.browser = browser;

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

// Mock checkTone before importing background.js
jest.mock('../src/ai-client.js', () => ({
    checkTone: jest.fn()
}));

// Import the module
const { handleOnBeforeSend, pendingComposes } = require('../background.js');
const { checkTone } = require('../src/ai-client.js');

describe('handleOnBeforeSend Error Paths', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        pendingComposes.clear();
    });

    const mockTab = { id: 123, windowId: 456 };
    const mockDetails = {
        to: ['test@example.com'],
        cc: [],
        bcc: [],
        plainTextBody: '',
        identityId: 'identity1'
    };
    const mockComposeDetails = {
        identityId: 'identity1',
        subject: 'Test',
        body: '<p>Hello</p>',
        type: 'new'
    };
    const mockAccounts = [{ id: 'account1', identities: [{ id: 'identity1' }] }];
    const mockSettings = {
        apiEndpoint: 'https://api.example.com/v1/chat/completions',
        apiKey: 'test-api-key',
        model: 'gpt-4',
        enabled: true,
        checkedAccounts: ['account1'],
        customPrompt: '',
        recipientWhitelist: []
    };

    describe('Configured Account + Error Recovery', () => {
        test('getComposeDetails rejects → returns { cancel: true }, windows.create called once, status ApiError', async () => {
            browser.storage.local.get.mockResolvedValue(mockSettings);
            browser.compose.getComposeDetails.mockRejectedValueOnce(new Error('Compose details error'));
            browser.accounts.list.mockResolvedValue(mockAccounts);
            browser.windows.getAll.mockResolvedValue([]);
            browser.windows.create.mockResolvedValue(undefined);

            const result = await handleOnBeforeSend(mockTab, mockDetails);

            expect(result).toEqual({ cancel: true });
            expect(browser.windows.create).toHaveBeenCalledTimes(1);
            expect(pendingComposes.has(123)).toBe(true);
            expect(pendingComposes.get(123).analysisData.status).toBe('ApiError');
        });

        test('checkTone returns error → returns { cancel: true }, windows.create called once, status ApiError', async () => {
            browser.storage.local.get.mockResolvedValue(mockSettings);
            browser.compose.getComposeDetails.mockResolvedValue(mockComposeDetails);
            browser.accounts.list.mockResolvedValue(mockAccounts);
            browser.windows.getAll.mockResolvedValue([]);
            browser.windows.create.mockResolvedValue(undefined);
            
            checkTone.mockResolvedValueOnce({
                success: false,
                error: 'API error: HTTP 500'
            });

            const result = await handleOnBeforeSend(mockTab, mockDetails);

            expect(result).toEqual({ cancel: true });
            expect(browser.windows.create).toHaveBeenCalledTimes(1);
            expect(pendingComposes.has(123)).toBe(true);
            expect(pendingComposes.get(123).analysisData.status).toBe('ApiError');
        });
    });

    describe('Unconfigured Account + Graceful Degradation', () => {
        const unconfiguredSettings = {
            ...mockSettings,
            checkedAccounts: []
        };

        test('checkTone returns error → returns undefined, notifications.create called exactly once', async () => {
            browser.storage.local.get.mockResolvedValue(unconfiguredSettings);
            browser.compose.getComposeDetails.mockResolvedValue(mockComposeDetails);
            browser.accounts.list.mockResolvedValue(mockAccounts);
            
            checkTone.mockResolvedValueOnce({
                success: false,
                error: 'API error: HTTP 500'
            });

            const result = await handleOnBeforeSend(mockTab, mockDetails);

            expect(result).toBeUndefined();
            expect(browser.notifications.create).toHaveBeenCalledTimes(1);
        });

        test('getComposeDetails rejects → returns undefined, notifications.create called once', async () => {
            browser.storage.local.get.mockResolvedValue(unconfiguredSettings);
            browser.compose.getComposeDetails.mockRejectedValueOnce(new Error('Compose details error'));
            browser.accounts.list.mockResolvedValue(mockAccounts);

            const result = await handleOnBeforeSend(mockTab, mockDetails);

            expect(result).toBeUndefined();
            expect(browser.notifications.create).toHaveBeenCalledTimes(1);
        });
    });
});
