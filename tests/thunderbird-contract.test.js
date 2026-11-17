/**
 * Thunderbird Contract Test Suite
 * 
 * Tests the REAL background.js through the fake-thunderbird harness.
 * These tests verify that background.js behaves according to the Thunderbird
 * contract modeled by the harness.
 * 
 * Each test documents expected behavior with a source comment.
 */

/** @jest-environment jsdom */

const { createFakeThunderbird, multiParagraph, quoteBlock, signatureBody, replyBody, forwardBody } = require('./helpers/fake-thunderbird');

// Mock fetch for AI API calls
global.fetch = jest.fn();

// Mock AbortController
global.AbortController = jest.fn(() => ({
    abort: jest.fn()
}));

describe('Thunderbird Contract Tests', () => {
    let fakeTB;
    let background;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        global.fetch.mockReset();
        fakeTB = createFakeThunderbird({
            accounts: [
                { id: 'account1', identities: [{ id: 'id1', name: 'Test User', email: 'test@example.com' }] }
            ],
            storage: {
                apiEndpoint: 'https://api.example.com/v1/chat/completions',
                apiKey: 'test-key',
                model: 'gpt-4',
                enabled: true,
                checkedAccounts: [],
                customPrompt: '',
                recipientWhitelist: []
            }
        });
        
        // Install fake browser BEFORE requiring background.js
        fakeTB.install();
        
        // Require background.js after installing the mock
        background = require('../background.js');
        
        // Clear any state from background.js
        if (background.pendingComposes) {
            background.pendingComposes.clear();
        }
        if (background.extractedEmailStructures) {
            background.extractedEmailStructures.clear();
        }
    });

    afterEach(() => {
        // Clean up to avoid state leakage between tests
        if (background.pendingComposes) {
            background.pendingComposes.clear();
        }
        if (background.extractedEmailStructures) {
            background.extractedEmailStructures.clear();
        }
    });

    describe('Contract: Plain draft with professional answer', () => {
        test('a plain draft, two paragraphs, professional answer - message is sent unchanged and no dialog opens', async () => {
            
            const tab = fakeTB.browser.compose.openTab({
                id: 1001,
                windowId: 1,
                identityId: 'id1',
                type: 'new',
                body: multiParagraph('Hello, this is my first paragraph.', 'This is my second paragraph.')
            });

            // Mock AI response: professional
            global.fetch.mockResolvedValue({
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

            // Trigger compose.sendMessage which calls the onBeforeSend listener (handleOnBeforeSend)
            await fakeTB.browser.compose.sendMessage(tab);

            // Assert: message sent (no pending state), no dialog opened
            expect(background.pendingComposes.has(1001)).toBe(false);
            expect(fakeTB.browser.windows.created.length).toBe(0);
            expect(fakeTB.sent.length).toBe(1);
            expect(fakeTB.sent[0].body).toBe('<p>Hello, this is my first paragraph.</p><p>This is my second paragraph.</p>');
        });
    });

    describe('Contract: Plain draft with unprofessional answer', () => {
        test('a plain draft, unprofessional answer - sendMessage does not deliver and the pending state holds the analysis', async () => {
            
            const tab = fakeTB.browser.compose.openTab({
                id: 1002,
                windowId: 1,
                identityId: 'id1',
                type: 'new',
                body: multiParagraph('This is rude and inappropriate.')
            });

            // Mock AI response: unprofessional
            global.fetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: JSON.stringify({
                                isProfessional: false,
                                problems: ['Tone is too aggressive'],
                                rewrittenEmail: 'Dear Team, I wanted to follow up...',
                                suggestions: ['Use softer language'],
                                originalContent: 'This is rude and inappropriate.'
                            })
                        }
                    }]
                })
            });

            // Trigger compose.sendMessage which calls the onBeforeSend listener
            let error;
            try {
                await fakeTB.browser.compose.sendMessage(tab);
            } catch (e) {
                error = e;
            }

            // Assert: send cancelled (error thrown), pending state created, no message in sent
            expect(error).toBeDefined();
            expect(error.message).toContain('cancelled');
            expect(background.pendingComposes.has(1002)).toBe(true);
            expect(background.pendingComposes.get(1002).analysisData.status).toBe('Unprofessional');
            expect(fakeTB.sent.length).toBe(0);
        });
    });

    describe('Contract: Reply with cite prefix and quoted block', () => {
        test('a REPLY with a cite prefix and a quoted block - the quoted text is absent from the AI request and present in the body at send time', async () => {
            
            const quotedText = 'Thank you for your message. I will review it.';
            const userText = 'I disagree with your assessment.';
            
            const tab = fakeTB.browser.compose.openTab({
                id: 1003,
                windowId: 1,
                identityId: 'id1',
                type: 'reply',
                body: replyBody(multiParagraph(userText) + quoteBlock(quotedText))
            });

            // Mock AI response: professional (user text is fine)
            global.fetch.mockResolvedValue({
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

            // Trigger compose.sendMessage
            await fakeTB.browser.compose.sendMessage(tab);

            // Assert: quoted text NOT in AI request
            const aiInput = JSON.parse(global.fetch.mock.calls[0][1].body).messages[1].content;
            expect(aiInput).not.toContain(quotedText);
            expect(aiInput).toContain(userText);

            // Assert: message sent (professional)
            expect(fakeTB.sent.length).toBe(1);
            
            // Assert: sent body contains both user text and quoted text
            const sentBody = fakeTB.sent[0].body;
            expect(sentBody).toContain(userText);
            expect(sentBody).toContain(quotedText);
        });
    });

    describe('Contract: Forward behavior', () => {
        test('a FORWARD (type: forward, body = forwardBody(...)) with no user text - the AI is never called and the message is sent as-is', async () => {
            
            const forwardedContent = 'This is the forwarded message content.';
            
            const tab = fakeTB.browser.compose.openTab({
                id: 1004,
                windowId: 1,
                identityId: 'id1',
                type: 'forward',
                body: forwardBody(multiParagraph(forwardedContent))
            });

            // Trigger compose.sendMessage
            await fakeTB.browser.compose.sendMessage(tab);

            // Assert: AI never called, message sent as-is
            expect(global.fetch).not.toHaveBeenCalled();
            expect(fakeTB.sent.length).toBe(1);
            expect(fakeTB.sent[0].body).toContain(forwardedContent);
        });

        test('the same forward with a user paragraph added - the AI is called', async () => {
            
            const forwardedContent = 'This is the forwarded message content.';
            const userText = 'Please review the attached.';
            
            const tab = fakeTB.browser.compose.openTab({
                id: 1005,
                windowId: 1,
                identityId: 'id1',
                type: 'forward',
                body: forwardBody(multiParagraph(forwardedContent)) + multiParagraph(userText)
            });

            // Mock AI response
            global.fetch.mockResolvedValue({
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

            // Trigger compose.sendMessage
            await fakeTB.browser.compose.sendMessage(tab);

            // Assert: AI called with user text but not forwarded content
            expect(global.fetch).toHaveBeenCalledTimes(1);
            const aiInput = JSON.parse(global.fetch.mock.calls[0][1].body).messages[1].content;
            expect(aiInput).toContain(userText);
            expect(aiInput).not.toContain(forwardedContent);
        });
    });

    describe('Contract: Dialog round trip', () => {
        test('the dialog round trip - drive replaceText through runtime.sendMessage, then read the body back via getComposeDetails and assert the exact final string', async () => {
            
            const originalBody = multiParagraph('This is rude and unprofessional.');
            const rewrittenBody = 'Dear Team, I wanted to kindly request your attention.';
            
            const tab = fakeTB.browser.compose.openTab({
                id: 1006,
                windowId: 1,
                identityId: 'id1',
                type: 'new',
                body: originalBody
            });

            // Mock AI response: unprofessional with rewrite
            global.fetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: JSON.stringify({
                                isProfessional: false,
                                problems: ['Tone is too aggressive'],
                                rewrittenEmail: rewrittenBody,
                                suggestions: ['Use softer language']
                            })
                        }
                    }]
                })
            });

            // Trigger compose.sendMessage to create pending state
            let error;
            try {
                await fakeTB.browser.compose.sendMessage(tab);
            } catch (e) {
                error = e;
            }
            expect(background.pendingComposes.has(1006)).toBe(true);

            // Drive replaceText through runtime.sendMessage (as dialog does)
            fakeTB.browser.runtime.sendMessage({ action: 'replaceText', tabId: 1006 });
            await fakeTB.settle();

            // Read body back via getComposeDetails
            const composeDetails = await fakeTB.browser.compose.getComposeDetails(1006);

            // Assert: body was replaced with rewritten content
            expect(composeDetails.body).toBe(rewrittenBody);
            expect(background.pendingComposes.has(1006)).toBe(false);
        });
    });

    describe('Contract: Multiple tabs', () => {
        test('two compose tabs open, analysis for both, replaceText targeting one - only that tab body changes and the other session is untouched', async () => {
            
            const tab1 = fakeTB.browser.compose.openTab({
                id: 1007,
                windowId: 1,
                identityId: 'id1',
                type: 'new',
                body: multiParagraph('Tab 1: This is rude.')
            });

            const tab2 = fakeTB.browser.compose.openTab({
                id: 1008,
                windowId: 1,
                identityId: 'id1',
                type: 'new',
                body: multiParagraph('Tab 2: This is also rude.')
            });

            // Mock AI response: unprofessional for both
            global.fetch.mockResolvedValue({
                ok: true,
                json: async () => ({
                    choices: [{
                        message: {
                            content: JSON.stringify({
                                isProfessional: false,
                                problems: ['Tone is too aggressive'],
                                rewrittenEmail: 'Dear Team, I wanted to kindly request...',
                                suggestions: ['Use softer language']
                            })
                        }
                    }]
                })
            });

            // Trigger compose.sendMessage for both tabs
            let error1, error2;
            try {
                await fakeTB.browser.compose.sendMessage(tab1);
            } catch (e) {
                error1 = e;
            }
            try {
                await fakeTB.browser.compose.sendMessage(tab2);
            } catch (e) {
                error2 = e;
            }

            // Both should have pending state
            expect(background.pendingComposes.has(1007)).toBe(true);
            expect(background.pendingComposes.has(1008)).toBe(true);

            // Drive replaceText for tab 1 only
            fakeTB.browser.runtime.sendMessage({ action: 'replaceText', tabId: 1007 });
            await fakeTB.settle();

            // Assert: tab 1 body changed, tab 2 body unchanged
            const tab1Details = await fakeTB.browser.compose.getComposeDetails(1007);
            const tab2Details = await fakeTB.browser.compose.getComposeDetails(1008);

            expect(tab1Details.body).toBe('Dear Team, I wanted to kindly request...');
            expect(tab2Details.body).toBe('<p>Tab 2: This is also rude.</p>');
            expect(background.pendingComposes.has(1007)).toBe(false);
            expect(background.pendingComposes.has(1008)).toBe(true);
        });
    });

    describe('Contract: Closed tab error handling', () => {
        test('getComposeDetails rejecting (tab closed mid-flight) on a configured account - the send is cancelled and the analysis records the error', async () => {
            
            const tab = fakeTB.browser.compose.openTab({
                id: 1009,
                windowId: 1,
                identityId: 'id1',
                type: 'new',
                body: multiParagraph('This email has content.')
            });

            // Configure account to use checkedAccounts (so errors are blocked)
            fakeTB.browser.storage.local.set({
                apiEndpoint: 'https://api.example.com/v1/chat/completions',
                apiKey: 'test-key',
                model: 'gpt-4',
                enabled: true,
                checkedAccounts: ['account1'], // Configured account
                customPrompt: '',
                recipientWhitelist: []
            });

            // Mock AI response
            global.fetch.mockResolvedValue({
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

            // The tab stays open, but its compose body can no longer be read.
            // This is the race handleOnBeforeSend recovers from.
            fakeTB.browser.compose.invalidateDetails(1009);

            let error;
            try {
                await fakeTB.browser.compose.sendMessage(tab);
            } catch (e) {
                error = e;
            }

            // The listener ran, its body read failed, the configured account
            // cancels the send and records the failure for the dialog.
            expect(error).toBeDefined();
            expect(error.message).toContain('cancelled');
            expect(background.pendingComposes.has(1009)).toBe(true);
            expect(background.pendingComposes.get(1009).analysisData.status).toBe('ApiError');
            expect(fakeTB.sent.length).toBe(0);
            expect(global.fetch).not.toHaveBeenCalled();
        });
    });

    describe('Contract: onBeforeSend listener contract', () => {
        test('onBeforeSend listener returns undefined for professional email - message is sent', async () => {
            
            // Create a tab
            const tab = fakeTB.browser.compose.openTab({
                id: 1010,
                windowId: 1,
                identityId: 'id1',
                type: 'new',
                body: multiParagraph('Test content.')
            });

            // Mock professional response
            global.fetch.mockResolvedValue({
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

            // Trigger compose.sendMessage
            await fakeTB.browser.compose.sendMessage(tab);

            // Assert: message sent (no error, no pending state)
            expect(background.pendingComposes.has(1010)).toBe(false);
            expect(fakeTB.sent.length).toBe(1);
        });

        test('onBeforeSend listener async thenable is awaited', async () => {
            
            const tab = fakeTB.browser.compose.openTab({
                id: 1011,
                windowId: 1,
                identityId: 'id1',
                type: 'new',
                body: multiParagraph('Test content.')
            });

            // Mock professional response
            global.fetch.mockResolvedValue({
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

            // Trigger compose.sendMessage - should complete without hanging
            await fakeTB.browser.compose.sendMessage(tab);

            expect(background.pendingComposes.has(1011)).toBe(false);
        });
    });
});
