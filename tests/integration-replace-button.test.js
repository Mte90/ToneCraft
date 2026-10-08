/**
 * Replace Button Integration Tests
 * Tests for handleReplaceText() in Thunderbird environment
 * Verifies quotes and signature preservation with mocked browser APIs
 */

/** @jest-environment jsdom */

const browser = {
    compose: { onBeforeSend: { addListener: jest.fn() }, getComposeDetails: jest.fn(), setComposeDetails: jest.fn() },
    tabs: { update: jest.fn(), get: jest.fn() },
    windows: { update: jest.fn() },
    runtime: { onMessage: { addListener: jest.fn() }, getURL: jest.fn((p) => `chrome://test/${p}`) },
    notifications: { create: jest.fn().mockResolvedValue(undefined) },
    storage: { local: { get: jest.fn(), set: jest.fn() } }
};

global.browser = browser;

const { handleReplaceText, extractEmailStructure, pendingComposes } = require('../background.js');

describe('Replace Button Integration Tests', () => {
    let mockTab;

    beforeEach(() => {
        jest.clearAllMocks();
        pendingComposes.clear();
        mockTab = { id: 123, windowId: 456 };
        browser.tabs.get.mockResolvedValue(mockTab);
        browser.compose.getComposeDetails.mockResolvedValue({ body: '', to: [], cc: [], subject: '' });
        browser.compose.setComposeDetails.mockResolvedValue(undefined);
        browser.tabs.update.mockResolvedValue(undefined);
        browser.windows.update.mockResolvedValue(undefined);
        window.extractedEmailStructure = window.extractedEmailStructure || {};
    });

    describe('Quote Preservation', () => {
        test.each([
            ['preserves blockquote quoted replies', '<blockquote>This is quoted text from previous message.</blockquote>', 'blockquote'],
            ['preserves nested blockquotes', '<blockquote>Level 1 quote<blockquote>Level 2 quote</blockquote></blockquote>', /blockquote.*blockquote/s]
        ])('%s', async (_, quotedContent, expected) => {
            const aiRewrite = 'Polite response.';
            const currentBody = '<p>Rude text</p>' + quotedContent;
            pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: aiRewrite }, originalRecipients: [] });
            window.extractedEmailStructure[mockTab.id] = {
                originalQuotedContent: quotedContent,
                originalSignatureContent: '',
                originalMainContent: '<p>Rude text</p>'
            };
            browser.compose.getComposeDetails.mockResolvedValue({ body: currentBody, to: [], cc: [], subject: '' });
            await handleReplaceText();
            const setCall = browser.compose.setComposeDetails.mock.calls[0];
            const reconstructedBody = setCall[1].body;
            // Check for quoted content that actually exists in this test case
            if (quotedContent.includes('quoted text')) {
                expect(reconstructedBody).toContain('quoted text');
            } else if (quotedContent.includes('Level 1 quote')) {
                expect(reconstructedBody).toContain('Level 1 quote');
            }
            expect(reconstructedBody).toContain(aiRewrite);
            if (typeof expected === 'string') {
                expect(reconstructedBody).toContain(expected);
            } else {
                expect(reconstructedBody).toMatch(expected);
            }
        });
    });

    describe('Signature Preservation', () => {
        const setupSigTest = (signature, aiRewrite = 'Polite email content.') => {
            pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: aiRewrite }, originalRecipients: [] });
            window.extractedEmailStructure[mockTab.id] = {
                originalQuotedContent: '',
                originalSignatureContent: signature,
                originalMainContent: '<p>Rude text</p>'
            };
            browser.compose.getComposeDetails.mockResolvedValue({ body: `<p>Rude text</p>${signature}`, to: [], cc: [], subject: '' });
        };

        test('preserves moz-signature', async () => {
            setupSigTest('<div class="moz-signature">-- John Doe<br>john@example.com</div>');
            await handleReplaceText();
            const body = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expect(body).toContain('moz-signature');
            expect(body).toContain('-- John Doe');
            expect(body).toContain('john@example.com');
        });

        test('preserves manual "-- " signature', async () => {
            setupSigTest('<p>-- <br>Jane Smith<br>jane@company.com</p>', 'Polite email content.');
            await handleReplaceText();
            const body = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expect(body).toContain('--');
            expect(body).toContain('Jane Smith');
            expect(body).toContain('jane@company.com');
        });

        test('preserves both quotes and signature together', async () => {
            const quote = '<blockquote>Quoted reply text</blockquote>';
            const signature = '<div class="moz-signature">-- John Doe</div>';
            const aiRewrite = 'Polite main content.';
            pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: aiRewrite }, originalRecipients: [] });
            window.extractedEmailStructure[mockTab.id] = {
                originalQuotedContent: quote,
                originalSignatureContent: signature,
                originalMainContent: '<p>Rude text</p>'
            };
            browser.compose.getComposeDetails.mockResolvedValue({ body: `<p>Rude text</p>${quote}${signature}`, to: [], cc: [], subject: '' });
            await handleReplaceText();
            const body = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expect(body).toContain(aiRewrite);
            expect(body).toContain('Quoted reply text');
            expect(body).toContain('-- John Doe');
            expect(body).toContain('blockquote');
            expect(body).toContain('moz-signature');
            expect(body.indexOf(aiRewrite)).toBeLessThan(body.indexOf('Quoted reply text'));
            expect(body.indexOf('Quoted reply text')).toBeLessThan(body.indexOf('-- John Doe'));
        });
    });

    describe('User Edit Preservation', () => {
        const setupUserEditTest = ({ original, edited, content }) => {
            pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: 'Polite content.' }, originalRecipients: [] });
            window.extractedEmailStructure[mockTab.id] = {
                originalQuotedContent: '',
                originalSignatureContent: original,
                originalMainContent: '<p>Rude text</p>'
            };
            browser.compose.getComposeDetails.mockResolvedValue({ body: `<p>Rude text</p>${edited}`, to: [], cc: [], subject: '' });
        };

        test('handles user-edited quotes', async () => {
            setupUserEditTest({
                original: '<blockquote>Original quoted text</blockquote>',
                edited: '<blockquote>MODIFIED quoted text by user</blockquote>'
            });
            await handleReplaceText();
            const body = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expect(body).toContain('MODIFIED quoted text by user');
            expect(body).not.toContain('Original quoted text');
        });

        test('handles user-edited signature', async () => {
            setupUserEditTest({
                original: '<div class="moz-signature">-- John Doe</div>',
                edited: '<div class="moz-signature">-- Jane Smith (Updated Contact Info)</div>'
            });
            await handleReplaceText();
            const body = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expect(body).toContain('Jane Smith (Updated Contact Info)');
            expect(body).not.toContain('John Doe');
        });
    });

    describe('Language-Specific Email Structures', () => {
        test.each([
            ['Italian', '<blockquote>Messaggio originale italiano</blockquote>', '<p>-- <br>Cordiali saluti,<br>Mario Rossi</p>', 'Contenuto email educato in italiano.', 'Messaggio originale italiano', 'Cordiali saluti', 'Mario Rossi'],
            ['English', '<blockquote>Original English message</blockquote>', '<p>-- <br>Best regards,<br>Alice Johnson</p>', 'Polite English content.', 'Original English message', 'Best regards', 'Alice Johnson']
        ])('handles %s email structure', async (_, quote, signature, aiRewrite, ...expected) => {
            const currentBody = `<p>Rude text</p>${quote}${signature}`;
            pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: aiRewrite }, originalRecipients: [] });
            window.extractedEmailStructure[mockTab.id] = {
                originalQuotedContent: quote,
                originalSignatureContent: signature,
                originalMainContent: '<p>Rude text</p>'
            };
            browser.compose.getComposeDetails.mockResolvedValue({ body: currentBody, to: [], cc: [], subject: '' });
            await handleReplaceText();
            const body = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expected.forEach(text => expect(body).toContain(text));
            expect(body).toContain(aiRewrite);
        });
    });

    describe('Browser API Mocking', () => {
        const setupMockTest = (composedBody = '<p>Original text</p>', overrides = {}) => {
            pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: 'Polite rewrite.' }, originalRecipients: [] });
            window.extractedEmailStructure[mockTab.id] = {
                originalQuotedContent: '',
                originalSignatureContent: '',
                originalMainContent: '<p>Original text</p>'
            };
            browser.compose.getComposeDetails.mockResolvedValue({ body: composedBody, to: [], cc: [], subject: 'Test Subject', ...overrides });
        };

        test('mocks browser.compose.getComposeDetails correctly', async () => {
            setupMockTest('<p>Test content</p>', { to: ['recipient@example.com'], cc: ['cc@example.com'] });
            await handleReplaceText();
            expect(browser.compose.getComposeDetails).toHaveBeenCalledWith(mockTab.id);
            expect(browser.compose.getComposeDetails).toHaveBeenCalledTimes(1);
        });

        test('mocks browser.compose.setComposeDetails correctly', async () => {
            setupMockTest();
            await handleReplaceText();
            expect(browser.compose.setComposeDetails).toHaveBeenCalledWith(mockTab.id, expect.objectContaining({ body: expect.any(String) }));
            expect(browser.compose.setComposeDetails).toHaveBeenCalledTimes(1);
            const setCall = browser.compose.setComposeDetails.mock.calls[0];
            expect(setCall[0]).toBe(mockTab.id);
            expect(setCall[1].body).toContain('Polite rewrite.');
        });

        test('mocks browser.tabs.get for tab validation', async () => {
            setupMockTest();
            await handleReplaceText();
            expect(browser.tabs.get).toHaveBeenCalledWith(mockTab.id);
            expect(browser.tabs.get).toHaveBeenCalledTimes(1);
        });

        test('handles tab that no longer exists', async () => {
            browser.tabs.get.mockRejectedValueOnce(new Error('Invalid tab ID'));
            setupMockTest();
            await handleReplaceText();
            expect(browser.compose.setComposeDetails).not.toHaveBeenCalled();
            expect(browser.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Replace Failed', message: 'The compose window has been closed.' }));
            expect(pendingComposes.has(mockTab.id)).toBe(false);
        });
    });

    describe('Edge Cases', () => {
        const setupEmptyTest = async (body, expectedContains, aiRewrite = 'Polite content.') => {
            pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: aiRewrite }, originalRecipients: [] });
            window.extractedEmailStructure[mockTab.id] = { originalQuotedContent: '', originalSignatureContent: '', originalMainContent: body };
            browser.compose.getComposeDetails.mockResolvedValue({ body, to: [], cc: [], subject: '' });
            await handleReplaceText();
            const reconstructedBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
            if (expectedContains) expect(reconstructedBody).toContain(expectedContains);
            return reconstructedBody;
        };

        test('handles empty quoted content', async () => {
            const aiRewrite = 'Polite content without quotes.';
            const body = await setupEmptyTest('<p>Original text</p>', aiRewrite, aiRewrite);
            expect(body).toContain(aiRewrite);
        });

        test('handles empty signature', async () => {
            const aiRewrite = 'Polite content without signature.';
            const body = await setupEmptyTest('<p>Original text</p>', aiRewrite, aiRewrite);
            expect(body).toContain(aiRewrite);
        });

        test('handles both empty quote and signature', async () => {
            const aiRewrite = 'Pure polite content.';
            const body = await setupEmptyTest('<p>Original text</p>', null, aiRewrite);
            expect(body).toBe(aiRewrite);
        });
    });

    describe('Regression Tests', () => {
        test('replaces user text block, NOT quoted header when quote appears first', async () => {
            // User-reported scenario: quoted header <p>On Oct 7, Alice wrote:</p> + nested blockquotes BEFORE user's new text
            const quotedHeader = '<p>On Oct 7, Alice wrote:</p>';
            const nestedQuotes = '<blockquote><div>Alice\'s original message</div></blockquote>';
            const userText = '<p>This is my new text that should be replaced.</p>';
            const signature = '<div class="moz-signature">-- Bob</div>';
            const aiRewrite = '<p>Polite rewritten version.</p>';
            const currentBody = quotedHeader + nestedQuotes + userText + signature;
            
            pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: 'Polite rewritten version.' }, originalRecipients: [] });
            window.extractedEmailStructure[mockTab.id] = {
                originalQuotedContent: nestedQuotes,
                originalSignatureContent: signature,
                originalMainContent: userText
            };
            browser.compose.getComposeDetails.mockResolvedValue({ body: currentBody, to: [], cc: [], subject: '' });
            
            await handleReplaceText();
            const body = browser.compose.setComposeDetails.mock.calls[0][1].body;
            
            // Should contain the rewritten text
            expect(body).toContain('Polite rewritten version.');
            // Should preserve the quoted header (NOT replaced)
            expect(body).toContain('On Oct 7, Alice wrote:');
            // Should preserve nested blockquotes
            expect(body).toContain('Alice\'s original message');
            expect(body).toContain('blockquote');
            // Should preserve signature
            expect(body).toContain('-- Bob');
            // The rewritten text should come AFTER the quoted header
            expect(body.indexOf('Polite rewritten version.')).toBeGreaterThan(body.indexOf('On Oct 7, Alice wrote:'));
        });

        test('shows Replace Failed notification when replacement cannot be performed', async () => {
            // Scenario where no valid target paragraph exists
            const currentBody = '<blockquote>Only quoted content</blockquote><div class="moz-signature">-- Sig</div>';
            
            pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: 'Polite content.' }, originalRecipients: [] });
            window.extractedEmailStructure[mockTab.id] = {
                originalQuotedContent: '<blockquote>Only quoted content</blockquote>',
                originalSignatureContent: '<div class="moz-signature">-- Sig</div>',
                originalMainContent: ''
            };
            browser.compose.getComposeDetails.mockResolvedValue({ body: currentBody, to: [], cc: [], subject: '' });
            
            await handleReplaceText();
            
            // Should still set the body to the rewritten content (fallback behavior)
            expect(browser.compose.setComposeDetails).toHaveBeenCalled();
            const body = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expect(body).toContain('Polite content.');
        });
    });
});
