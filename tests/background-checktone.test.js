/**
 * checkTone Retry Logic Tests
 * Tests for the checkTone function in src/ai-client.js
 * Verifies 3-second retry delay on timeout, network errors, and HTTP 5xx
 */

/** @jest-environment jsdom */

// Mock browser globals (required for loading background.js)
const browser = {
    compose: { onBeforeSend: { addListener: jest.fn() }, getComposeDetails: jest.fn(), setComposeDetails: jest.fn() },
    tabs: { update: jest.fn(), get: jest.fn() },
    windows: { update: jest.fn() },
    runtime: { onMessage: { addListener: jest.fn() }, getURL: jest.fn((p) => `chrome://test/${p}`) },
    notifications: { create: jest.fn().mockResolvedValue(undefined) },
    storage: { local: { get: jest.fn(), set: jest.fn() } }
};

global.browser = browser;

const { checkTone } = require('../src/ai-client.js');

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

describe('checkTone Retry Logic', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    const validSettings = {
        apiEndpoint: 'https://api.example.com/v1/chat/completions',
        apiKey: 'test-api-key-12345',
        model: 'gpt-4'
    };

    const validAIResponse = {
        choices: [
            {
                message: {
                    content: JSON.stringify({
                        isProfessional: false,
                        problems: ['Too aggressive tone'],
                        rewrittenEmail: 'Dear Team,\n\nI wanted to follow up...',
                        suggestions: ['Add a greeting']
                    })
                }
            }
        ]
    };

    describe('Timeout Retry', () => {
        test('timeout → retry after 3s → success on 2nd attempt', async () => {
            // First call times out, second call succeeds
            fetch.mockRejectedValueOnce(
                new DOMException('Aborted', 'AbortError')
            );
            fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => validAIResponse
            });

            const resultPromise = checkTone('Test email content', validSettings, 0);

            // Advance past the first timeout (10s)
            await jest.advanceTimersByTimeAsync(10000);

            // Advance past the 3-second retry delay
            await jest.advanceTimersByTimeAsync(3000);

            const result = await resultPromise;

            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
            expect(fetch).toHaveBeenCalledTimes(2);
            expect(result.error).toBeUndefined();
        });

        test('timeout → retry → timeout → final error message exact match', async () => {
            // Both calls timeout
            fetch.mockRejectedValueOnce(
                new DOMException('Aborted', 'AbortError')
            );
            fetch.mockRejectedValueOnce(
                new DOMException('Aborted', 'AbortError')
            );

            const resultPromise = checkTone('Test email content', validSettings, 0);

            // Advance past the first timeout (10s)
            await jest.advanceTimersByTimeAsync(10000);

            // Advance past the 3-second retry delay
            await jest.advanceTimersByTimeAsync(3000);

            // Advance past the second timeout (10s)
            await jest.advanceTimersByTimeAsync(10000);

            const result = await resultPromise;

            expect(result.success).toBe(false);
            expect(result.error).toBe('Request timeout: API did not respond within 10 seconds');
            expect(result.isTimeout).toBe(true);
            expect(fetch).toHaveBeenCalledTimes(2);
        });
    });

    describe('Network Error Retry', () => {
        test('network error → retry after 3s → success', async () => {
            // First call fails with network error, second succeeds
            fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
            fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => validAIResponse
            });

            const resultPromise = checkTone('Test email content', validSettings, 0);

            // Advance past the first timeout (10s) - this triggers the TypeError handling
            await jest.advanceTimersByTimeAsync(10000);

            // Advance past the 3-second retry delay
            await jest.advanceTimersByTimeAsync(3000);

            const result = await resultPromise;

            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
            expect(fetch).toHaveBeenCalledTimes(2);
        });
    });

    describe('HTTP Error Handling', () => {
        test('HTTP 401 → NO retry, exactly one fetch call', async () => {
            fetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                text: async () => 'Invalid API key'
            });

            const result = await checkTone('Test email content', validSettings, 0);

            expect(result.success).toBe(false);
            expect(result.error).toContain('API error 401');
            expect(fetch).toHaveBeenCalledTimes(1); // No retry on 4xx
        });

        test('HTTP 500 → retry once after 3s', async () => {
            // First call fails with 500, second succeeds
            fetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                text: async () => 'Server error occurred'
            });
            fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => validAIResponse
            });

            const resultPromise = checkTone('Test email content', validSettings, 0);

            // Advance past the retry delay (3s)
            await jest.advanceTimersByTimeAsync(3000);

            const result = await resultPromise;

            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
            expect(fetch).toHaveBeenCalledTimes(2); // Retried once
        });
    });
});