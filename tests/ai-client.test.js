/**
 * AI Client Unit Tests
 * Tests for checkTone function - HTTP client for AI API
 */

const { checkTone } = require('./ai-client.js');

// Mock global.fetch
global.fetch = jest.fn();

// Mock AbortController
class MockAbortController {
    constructor() {
        this.signal = {};
        this.abort = jest.fn();
    }
}
global.AbortController = MockAbortController;

describe('AI Client - checkTone', () => {
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
                        problems: ['Too aggressive tone', 'Lacks proper greeting'],
                        rewrittenEmail: 'Dear Team,\n\nI wanted to follow up on the project...',
                        suggestions: ['Add a greeting', 'Soften the language']
                    })
                }
            }
        ]
    };

    describe('Success Cases', () => {
        test('Test 1: Parse valid JSON response with all fields', async () => {
            // Mock successful response
            fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => validAIResponse
            });

            const result = await checkTone('Test email content', validSettings);

            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
            expect(result.data.isProfessional).toBe(false);
            expect(result.data.problems).toHaveLength(2);
            expect(result.data.rewrittenEmail).toContain('Dear Team');
            expect(result.data.suggestions).toHaveLength(2);
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        test('Test 6: API key included in Authorization header', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => validAIResponse
            });

            await checkTone('Test email content', validSettings);

            expect(fetch).toHaveBeenCalledWith(
                validSettings.apiEndpoint,
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Authorization': `Bearer ${validSettings.apiKey}`,
                        'Content-Type': 'application/json'
                    })
                })
            );
        });

        test('Request body includes model and prompt', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => validAIResponse
            });

            await checkTone('Test email content', validSettings);

            const callArgs = fetch.mock.calls[0];
            const requestBody = JSON.parse(callArgs[1].body);

            expect(requestBody.model).toBe('gpt-4');
            expect(requestBody.messages).toHaveLength(2);
            expect(requestBody.messages[0].role).toBe('system');
            expect(requestBody.messages[1].role).toBe('user');
            expect(requestBody.messages[1].content).toContain('Test email content');
        });

        test('Handles alternative API format (direct content field)', async () => {
            const altResponse = {
                content: JSON.stringify({
                    isProfessional: true,
                    problems: [],
                    rewrittenEmail: 'Professional email content',
                    suggestions: []
                })
            };

            fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => altResponse
            });

            const result = await checkTone('Test email', validSettings);

            expect(result.success).toBe(true);
            expect(result.data.isProfessional).toBe(true);
        });

        test('Handles JSON wrapped in markdown code blocks', async () => {
            const markdownResponse = {
                choices: [
                    {
                        message: {
                            content: '```json\n' + JSON.stringify({
                                isProfessional: true,
                                problems: [],
                                rewrittenEmail: 'Email content',
                                suggestions: []
                            }) + '\n```'
                        }
                    }
                ]
            };

            fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => markdownResponse
            });

            const result = await checkTone('Test email', validSettings);

            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
        });
    });

    describe('Error Cases - Missing Fields', () => {
        test('Test 2: Parse JSON with missing fields (handle gracefully)', async () => {
            const missingFieldResponse = {
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                isProfessional: true,
                                // Missing: problems, rewrittenEmail, suggestions
                            })
                        }
                    }
                ]
            };

            fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => missingFieldResponse
            });

            const result = await checkTone('Test email', validSettings);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Missing required field');
            expect(result.error).toContain('problems');
        });

        test('Handles missing isProfessional field', async () => {
            const missingFieldResponse = {
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                problems: [],
                                rewrittenEmail: 'Email',
                                suggestions: []
                            })
                        }
                    }
                ]
            };

            fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => missingFieldResponse
            });

            const result = await checkTone('Test email', validSettings);

            expect(result.success).toBe(false);
            expect(result.error).toContain('isProfessional');
        });
    });

    describe('Error Cases - Invalid JSON', () => {
        test('Test 3: Parse invalid JSON (return error)', async () => {
            const invalidJsonResponse = {
                choices: [
                    {
                        message: {
                            content: 'not valid json {'
                        }
                    }
                ]
            };

            fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => invalidJsonResponse
            });

            const result = await checkTone('Test email', validSettings);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Failed to parse AI response content');
        });

        test('Handles JSON parse error in API response', async () => {
            fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => {
                    throw new Error('Unexpected token < in JSON at position 0');
                }
            });

            const result = await checkTone('Test email', validSettings);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Failed to parse JSON response');
        });
    });

    describe('Error Cases - HTTP Errors', () => {
        test('Test 4: HTTP 500 error (return error)', async () => {
            fetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                text: async () => 'Server error occurred'
            });

            const result = await checkTone('Test email', validSettings);

            expect(result.success).toBe(false);
            expect(result.error).toContain('HTTP error 500');
            expect(result.error).toContain('Server error occurred');
        });

        test('Handles 401 Unauthorized error', async () => {
            fetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                text: async () => 'Invalid API key'
            });

            const result = await checkTone('Test email', validSettings);

            expect(result.success).toBe(false);
            expect(result.error).toContain('HTTP error 401');
        });

        test('Handles 429 Rate Limit error', async () => {
            fetch.mockResolvedValueOnce({
                ok: false,
                status: 429,
                statusText: 'Too Many Requests',
                text: async () => 'Rate limit exceeded'
            });

            const result = await checkTone('Test email', validSettings);

            expect(result.success).toBe(false);
            expect(result.error).toContain('HTTP error 429');
        });
    });

    describe('Error Cases - Timeout', () => {
        test('Test 5: Network timeout (return error)', async () => {
            // Mock fetch that rejects with AbortError
            fetch.mockRejectedValueOnce(
                new DOMException('Aborted', 'AbortError')
            );

            const result = await checkTone('Test email', validSettings);

            expect(result.success).toBe(false);
            expect(result.error).toContain('timeout');
            expect(result.error).toContain('10 seconds');
        });
    });

    describe('Error Cases - Network Errors', () => {
        test('Handles network connection error', async () => {
            fetch.mockRejectedValueOnce(
                new TypeError('Failed to fetch')
            );

            const result = await checkTone('Test email', validSettings);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Network error');
        });

        test('Handles unexpected errors', async () => {
            fetch.mockRejectedValueOnce(
                new Error('Unexpected error')
            );

            const result = await checkTone('Test email', validSettings);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Unexpected error');
        });
    });

    describe('Error Cases - Invalid Response Format', () => {
        test('Handles unexpected API response format', async () => {
            const malformedResponse = {
                data: 'something else'
            };

            fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => malformedResponse
            });

            const result = await checkTone('Test email', validSettings);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Unexpected API response format');
        });

        test('Handles empty choices array', async () => {
            const emptyResponse = {
                choices: []
            };

            fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => emptyResponse
            });

            const result = await checkTone('Test email', validSettings);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Unexpected API response format');
        });
    });

    describe('Validation Cases', () => {
        test('Returns error for missing apiEndpoint', async () => {
            const invalidSettings = {
                apiKey: 'test-key',
                model: 'gpt-4'
            };

            const result = await checkTone('Test email', invalidSettings);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Missing required settings');
            expect(fetch).not.toHaveBeenCalled();
        });

        test('Returns error for missing apiKey', async () => {
            const invalidSettings = {
                apiEndpoint: 'https://api.example.com',
                model: 'gpt-4'
            };

            const result = await checkTone('Test email', invalidSettings);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Missing required settings');
            expect(fetch).not.toHaveBeenCalled();
        });

        test('Returns error for missing model', async () => {
            const invalidSettings = {
                apiEndpoint: 'https://api.example.com',
                apiKey: 'test-key'
            };

            const result = await checkTone('Test email', invalidSettings);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Missing required settings');
            expect(fetch).not.toHaveBeenCalled();
        });
    });
});
