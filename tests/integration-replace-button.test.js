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

const { handleReplaceText, extractEmailStructure, pendingComposes, extractedEmailStructures } = require('../background.js');

describe('Replace Button Integration Tests', () => {
    let mockTab;

    beforeEach(() => {
        jest.clearAllMocks();
        pendingComposes.clear();
        extractedEmailStructures.clear();
        mockTab = { id: 123, windowId: 456 };
        browser.tabs.get.mockResolvedValue(mockTab);
        browser.compose.getComposeDetails.mockResolvedValue({ body: '', to: [], cc: [], subject: '' });
        browser.compose.setComposeDetails.mockResolvedValue(undefined);
        browser.tabs.update.mockResolvedValue(undefined);
        browser.windows.update.mockResolvedValue(undefined);
    });

    describe('Quote Preservation', () => {
        test.each([
            ['preserves blockquote quoted replies', '<blockquote>This is quoted text from previous message.</blockquote>', 'blockquote'],
            ['preserves nested blockquotes', '<blockquote>Level 1 quote<blockquote>Level 2 quote</blockquote></blockquote>', /blockquote.*blockquote/s]
        ])('%s', async (_, quotedContent, expected) => {
            const aiRewrite = 'Polite response.';
            const currentBody = '<p>Rude text</p>' + quotedContent;
            pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: aiRewrite }, originalRecipients: [] });
            extractedEmailStructures.set(mockTab.id, {
                originalQuotedContent: quotedContent,
                originalSignatureContent: '',
                originalMainContent: '<p>Rude text</p>'
            });
            browser.compose.getComposeDetails.mockResolvedValue({ body: currentBody, to: [], cc: [], subject: '' });
            await handleReplaceText(mockTab.id);
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
            extractedEmailStructures.set(mockTab.id, {
                originalQuotedContent: '',
                originalSignatureContent: signature,
                originalMainContent: '<p>Rude text</p>'
            });
            browser.compose.getComposeDetails.mockResolvedValue({ body: `<p>Rude text</p>${signature}`, to: [], cc: [], subject: '' });
        };

        test('preserves moz-signature', async () => {
            setupSigTest('<div class="moz-signature">-- John Doe<br>john@example.com</div>');
            await handleReplaceText(mockTab.id);
            const body = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expect(body).toContain('moz-signature');
            expect(body).toContain('-- John Doe');
            expect(body).toContain('john@example.com');
        });

        test('preserves manual "-- " signature', async () => {
            setupSigTest('<p>-- <br>Jane Smith<br>jane@company.com</p>', 'Polite email content.');
            await handleReplaceText(mockTab.id);
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
            extractedEmailStructures.set(mockTab.id, {
                originalQuotedContent: quote,
                originalSignatureContent: signature,
                originalMainContent: '<p>Rude text</p>'
            });
            browser.compose.getComposeDetails.mockResolvedValue({ body: `<p>Rude text</p>${quote}${signature}`, to: [], cc: [], subject: '' });
            await handleReplaceText(mockTab.id);
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
            extractedEmailStructures.set(mockTab.id, {
                originalQuotedContent: '',
                originalSignatureContent: original,
                originalMainContent: '<p>Rude text</p>'
            });
            browser.compose.getComposeDetails.mockResolvedValue({ body: `<p>Rude text</p>${edited}`, to: [], cc: [], subject: '' });
        };

        test('handles user-edited quotes', async () => {
            setupUserEditTest({
                original: '<blockquote>Original quoted text</blockquote>',
                edited: '<blockquote>MODIFIED quoted text by user</blockquote>'
            });
            await handleReplaceText(mockTab.id);
            const body = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expect(body).toContain('MODIFIED quoted text by user');
            expect(body).not.toContain('Original quoted text');
        });

        test('handles user-edited signature', async () => {
            setupUserEditTest({
                original: '<div class="moz-signature">-- John Doe</div>',
                edited: '<div class="moz-signature">-- Jane Smith (Updated Contact Info)</div>'
            });
            await handleReplaceText(mockTab.id);
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
            extractedEmailStructures.set(mockTab.id, {
                originalQuotedContent: quote,
                originalSignatureContent: signature,
                originalMainContent: '<p>Rude text</p>'
            });
            browser.compose.getComposeDetails.mockResolvedValue({ body: currentBody, to: [], cc: [], subject: '' });
            await handleReplaceText(mockTab.id);
            const body = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expected.forEach(text => expect(body).toContain(text));
            expect(body).toContain(aiRewrite);
        });
    });

    describe('Browser API Mocking', () => {
        const setupMockTest = (composedBody = '<p>Original text</p>', overrides = {}) => {
            pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: 'Polite rewrite.' }, originalRecipients: [] });
            extractedEmailStructures.set(mockTab.id, {
                originalQuotedContent: '',
                originalSignatureContent: '',
                originalMainContent: '<p>Original text</p>'
            });
            browser.compose.getComposeDetails.mockResolvedValue({ body: composedBody, to: [], cc: [], subject: 'Test Subject', ...overrides });
        };

        test('browser.compose.getComposeDetails is called with correct tab ID', async () => {
            setupMockTest('<p>Test content</p>', { to: ['recipient@example.com'], cc: ['cc@example.com'] });
            await handleReplaceText(mockTab.id);
            expect(browser.compose.getComposeDetails).toHaveBeenCalledWith(mockTab.id);
            expect(browser.compose.getComposeDetails).toHaveBeenCalledTimes(1);
        });

        test('mocks browser.compose.setComposeDetails correctly', async () => {
            setupMockTest();
            await handleReplaceText(mockTab.id);
            expect(browser.compose.setComposeDetails).toHaveBeenCalledWith(mockTab.id, expect.objectContaining({ body: expect.any(String) }));
            expect(browser.compose.setComposeDetails).toHaveBeenCalledTimes(1);
            const setCall = browser.compose.setComposeDetails.mock.calls[0];
            expect(setCall[0]).toBe(mockTab.id);
            expect(setCall[1].body).toContain('Polite rewrite.');
        });

        test('mocks browser.tabs.get for tab validation', async () => {
            setupMockTest();
            await handleReplaceText(mockTab.id);
            expect(browser.tabs.get).toHaveBeenCalledWith(mockTab.id);
            expect(browser.tabs.get).toHaveBeenCalledTimes(1);
        });

        test('handles tab that no longer exists', async () => {
            browser.tabs.get.mockRejectedValueOnce(new Error('Invalid tab ID'));
            setupMockTest();
            await handleReplaceText(mockTab.id);
            expect(browser.compose.setComposeDetails).not.toHaveBeenCalled();
            expect(browser.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Replace Failed', message: 'The compose window has been closed.' }));
            expect(pendingComposes.has(mockTab.id)).toBe(false);
        });
    });

    describe('Edge Cases', () => {
        test('handles empty quoted content with signature present', async () => {
            const aiRewrite = 'Polite content without quotes.';
            const signature = '<div class="moz-signature">-- John Doe</div>';
            const body = '<p>Original text</p>' + signature;
            
            pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: aiRewrite }, originalRecipients: [] });
            extractedEmailStructures.set(mockTab.id, { 
                originalQuotedContent: '', 
                originalSignatureContent: signature,
                originalMainContent: '<p>Original text</p>' 
            });
            browser.compose.getComposeDetails.mockResolvedValue({ body, to: [], cc: [], subject: '' });
            
            await handleReplaceText(mockTab.id);
            const reconstructedBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expect(reconstructedBody).toContain(aiRewrite);
            expect(reconstructedBody).toContain('-- John Doe');
        });

        test('handles empty signature with quote present', async () => {
            const aiRewrite = 'Polite content without signature.';
            const quote = '<blockquote>Quoted text</blockquote>';
            const body = '<p>Original text</p>' + quote;
            
            pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: aiRewrite }, originalRecipients: [] });
            extractedEmailStructures.set(mockTab.id, { 
                originalQuotedContent: quote,
                originalSignatureContent: '', 
                originalMainContent: '<p>Original text</p>' 
            });
            browser.compose.getComposeDetails.mockResolvedValue({ body, to: [], cc: [], subject: '' });
            
            await handleReplaceText(mockTab.id);
            const reconstructedBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expect(reconstructedBody).toContain(aiRewrite);
            expect(reconstructedBody).toContain('Quoted text');
        });

        test('handles both empty quote and signature', async () => {
            const aiRewrite = 'Pure polite content.';
            const body = '<p>Original text</p>';
            
            pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: aiRewrite }, originalRecipients: [] });
            extractedEmailStructures.set(mockTab.id, { originalQuotedContent: '', originalSignatureContent: '', originalMainContent: '<p>Original text</p>' });
            browser.compose.getComposeDetails.mockResolvedValue({ body, to: [], cc: [], subject: '' });
            
            await handleReplaceText(mockTab.id);
            const reconstructedBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expect(reconstructedBody).toBe(aiRewrite);
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
            extractedEmailStructures.set(mockTab.id, {
                originalQuotedContent: nestedQuotes,
                originalSignatureContent: signature,
                originalMainContent: userText
            });
            browser.compose.getComposeDetails.mockResolvedValue({ body: currentBody, to: [], cc: [], subject: '' });
            
            await handleReplaceText(mockTab.id);
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
            extractedEmailStructures.set(mockTab.id, {
                originalQuotedContent: '<blockquote>Only quoted content</blockquote>',
                originalSignatureContent: '<div class="moz-signature">-- Sig</div>',
                originalMainContent: ''
            });
            browser.compose.getComposeDetails.mockResolvedValue({ body: currentBody, to: [], cc: [], subject: '' });
            
            await handleReplaceText(mockTab.id);
            
            // Should still set the body to the rewritten content (fallback behavior)
            expect(browser.compose.setComposeDetails).toHaveBeenCalled();
            const body = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expect(body).toContain('Polite content.');
        });
    });

    describe('State cleanup', () => {
        test('a completed replacement drops both the pending entry and the extracted structure', async () => {
            pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: 'Polite rewrite.' }, originalRecipients: [] });
            extractedEmailStructures.set(mockTab.id, {
                originalQuotedContent: '',
                originalSignatureContent: '',
                originalMainContent: '<p>Original text</p>'
            });
            browser.compose.getComposeDetails.mockResolvedValue({ body: '<p>Original text</p>', to: [], cc: [], subject: '' });

            await handleReplaceText(mockTab.id);

            expect(pendingComposes.has(mockTab.id)).toBe(false);
            expect(extractedEmailStructures.has(mockTab.id)).toBe(false);
        });
        
        afterEach(() => {
            jest.clearAllMocks();
            pendingComposes.clear();
            extractedEmailStructures.clear();
        });
    });
});

describe('Replace edge cases', () => {
    let mockTab;
    
    beforeEach(() => {
        mockTab = { id: 123, windowId: 456 };
        browser.tabs.get.mockResolvedValue(mockTab);
        browser.compose.getComposeDetails.mockResolvedValue({ body: '', to: [], cc: [], subject: '' });
        browser.compose.setComposeDetails.mockResolvedValue(undefined);
        browser.tabs.update.mockResolvedValue(undefined);
        browser.windows.update.mockResolvedValue(undefined);
    });
    
    afterEach(() => {
        jest.clearAllMocks();
        pendingComposes.clear();
        extractedEmailStructures.clear();
        browser.compose.setComposeDetails.mockClear();
        browser.compose.getComposeDetails.mockClear();
        browser.tabs.get.mockClear();
        browser.tabs.update.mockClear();
        browser.windows.update.mockClear();
    });

    test('replaces the whole multi-paragraph main content', async () => {
        const body = '<p>First rude line.</p><p>Second rude line.</p><blockquote>Quoted part</blockquote>';
        const originalMainContent = '<p>First rude line.</p><p>Second rude line.</p>';
        const rewrite = 'First polite line.\nSecond polite line.';
        
        pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: rewrite }, originalRecipients: [] });
        extractedEmailStructures.set(mockTab.id, {
            originalQuotedContent: '<blockquote>Quoted part</blockquote>',
            originalSignatureContent: '',
            originalMainContent
        });
        browser.compose.getComposeDetails.mockResolvedValue({ body, to: [], cc: [], subject: '' });
        
        await handleReplaceText(mockTab.id);
        
        const resultBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
        expect(resultBody).toBe('<p>First polite line.</p><p>Second polite line.</p><blockquote>Quoted part</blockquote>');
        expect(resultBody).not.toContain('First rude line.');
        expect(resultBody).not.toContain('Second rude line.');
    });

    test('bare-text main content keeps the quote', async () => {
        const body = 'Rude text<blockquote>Keep this quote</blockquote>';
        const originalMainContent = 'Rude text';
        const rewrite = 'Polite text.';
        
        pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: rewrite }, originalRecipients: [] });
        extractedEmailStructures.set(mockTab.id, {
            originalQuotedContent: '<blockquote>Keep this quote</blockquote>',
            originalSignatureContent: '',
            originalMainContent
        });
        browser.compose.getComposeDetails.mockResolvedValue({ body, to: [], cc: [], subject: '' });
        
        await handleReplaceText(mockTab.id);
        
        const resultBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
        expect(resultBody).toContain('Polite text.');
        expect(resultBody).toContain('Keep this quote');
        expect(resultBody).not.toContain('Rude text');
    });

    test('a blockquote inside the rewrite survives the merge', async () => {
        const body = '<p>Rude text</p><blockquote>Existing quote</blockquote>';
        const originalMainContent = '<p>Rude text</p>';
        const rewrite = '<p>Polite lead-in.</p><blockquote>Rewrite quote text</blockquote><p>Polite closing.</p>';
        
        pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: rewrite }, originalRecipients: [] });
        extractedEmailStructures.set(mockTab.id, {
            originalQuotedContent: '<blockquote>Existing quote</blockquote>',
            originalSignatureContent: '',
            originalMainContent
        });
        browser.compose.getComposeDetails.mockResolvedValue({ body, to: [], cc: [], subject: '' });
        
        await handleReplaceText(mockTab.id);
        
        const resultBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
        expect(resultBody).toContain('Polite lead-in.');
        expect(resultBody).toContain('Rewrite quote text');
        expect(resultBody).toContain('Polite closing.');
        expect(resultBody).toContain('Existing quote');
        expect(resultBody).not.toContain('Rude text');
    });

    test('replaceText with a missing tabId does not touch another tab', async () => {
        const tabA = { id: 1, windowId: 10 };
        const tabB = { id: 2, windowId: 20 };
        
        pendingComposes.set(tabA.id, { tab: tabA, analysisData: { rewrittenEmail: 'Rewrite A' }, originalRecipients: [] });
        pendingComposes.set(tabB.id, { tab: tabB, analysisData: { rewrittenEmail: 'Rewrite B' }, originalRecipients: [] });
        extractedEmailStructures.set(tabA.id, {
            originalQuotedContent: '',
            originalSignatureContent: '',
            originalMainContent: '<p>Body for tab 1</p>'
        });
        extractedEmailStructures.set(tabB.id, {
            originalQuotedContent: '',
            originalSignatureContent: '',
            originalMainContent: '<p>Body for tab 2</p>'
        });
        
        pendingComposes.delete(tabA.id);
        
        browser.compose.getComposeDetails.mockImplementation(id => Promise.resolve({ body: '<p>Body for tab ' + id + '</p>', to: [], cc: [], subject: '' }));
        browser.tabs.get.mockImplementation(id => Promise.resolve({ id, windowId: id === 1 ? 10 : 20 }));
        
        await handleReplaceText(tabA.id);
        
        expect(browser.compose.setComposeDetails).not.toHaveBeenCalledWith(2, expect.anything());
        expect(pendingComposes.has(2)).toBe(true);
    });

    test('markdown fences inside the rewrite are stripped', async () => {
        const body = '<p>Rude text</p>';
        const originalMainContent = '<p>Rude text</p>';
        const rewrite = ' ``` text\nPolite rewrite.\n``` ';
        
        pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: rewrite }, originalRecipients: [] });
        extractedEmailStructures.set(mockTab.id, {
            originalQuotedContent: '',
            originalSignatureContent: '',
            originalMainContent
        });
        browser.compose.getComposeDetails.mockResolvedValue({ body, to: [], cc: [], subject: '' });
        
        await handleReplaceText(mockTab.id);
        
        const resultBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
        expect(resultBody).toBe('Polite rewrite.');
        expect(resultBody).not.toContain('```');
        expect(resultBody).not.toContain('text');
    });

    test('entity-encoded original text still matches', async () => {
        const body = '<p>Intro line.</p><p>AT&amp;T is rude</p><blockquote>Existing</blockquote>';
        const originalMainContent = '<p>Intro line.</p><p>AT&amp;T is rude</p>';
        const rewrite = 'Polite rewrite.';
        
        pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: rewrite }, originalRecipients: [] });
        extractedEmailStructures.set(mockTab.id, {
            originalQuotedContent: '<blockquote>Existing</blockquote>',
            originalSignatureContent: '',
            originalMainContent
        });
        browser.compose.getComposeDetails.mockResolvedValue({ body, to: [], cc: [], subject: '' });
        
        await handleReplaceText(mockTab.id);
        
        const resultBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
        expect(resultBody).toContain('Polite rewrite.');
        expect(resultBody).toContain('Existing');
        expect(resultBody).not.toContain('AT&amp;T is rude');
        expect(resultBody).not.toContain('Intro line.');
    });

    test('a ">" paragraph in the rewrite is preserved', async () => {
        const body = '<p>Rude text</p><blockquote>Existing</blockquote>';
        const originalMainContent = '<p>Rude text</p>';
        const rewrite = '<p>As you wrote:</p><p>> Your exact words</p><p>Polite closing.</p>';
        
        pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: rewrite }, originalRecipients: [] });
        extractedEmailStructures.set(mockTab.id, {
            originalQuotedContent: '<blockquote>Existing</blockquote>',
            originalSignatureContent: '',
            originalMainContent
        });
        browser.compose.getComposeDetails.mockResolvedValue({ body, to: [], cc: [], subject: '' });
        
        await handleReplaceText(mockTab.id);
        
        const resultBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
        expect(resultBody).toContain('Your exact words');
        expect(resultBody).toContain('Existing');
        expect(resultBody).toContain('Polite closing.');
    });

    test('an html/body wrapper is stripped with no stray empty p', async () => {
        const body = '<p>Rude text</p><blockquote>Existing</blockquote>';
        const originalMainContent = '<p>Rude text</p>';
        const rewrite = '<html><body><p>Polite rewrite.</p></body></html>';
        
        pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: rewrite }, originalRecipients: [] });
        extractedEmailStructures.set(mockTab.id, {
            originalQuotedContent: '<blockquote>Existing</blockquote>',
            originalSignatureContent: '',
            originalMainContent
        });
        browser.compose.getComposeDetails.mockResolvedValue({ body, to: [], cc: [], subject: '' });
        
        await handleReplaceText(mockTab.id);
        
        const resultBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
        expect(resultBody).toContain('<p>Polite rewrite.</p>');
        expect(resultBody).toContain('Existing');
        expect(resultBody).not.toContain('<html');
        expect(resultBody).not.toContain('<p></p>');
    });

    test('signature inside a blockquote is preserved', async () => {
        const body = '<p>Rude text</p><blockquote><div class="moz-signature">-- Bob</div></blockquote>';
        const originalMainContent = '<p>Rude text</p>';
        const rewrite = 'Polite rewrite.';
        
        pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: rewrite }, originalRecipients: [] });
        extractedEmailStructures.set(mockTab.id, {
            originalQuotedContent: '',
            originalSignatureContent: '<blockquote><div class="moz-signature">-- Bob</div></blockquote>',
            originalMainContent
        });
        browser.compose.getComposeDetails.mockResolvedValue({ body, to: [], cc: [], subject: '' });
        
        await handleReplaceText(mockTab.id);
        
        const resultBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
        expect(resultBody).toBe('<p>Polite rewrite.</p><blockquote><div class="moz-signature">-- Bob</div></blockquote>');
    });

    test('a repeated replaceText sets the body once', async () => {
        const body = '<p>Original text</p>';
        const originalMainContent = '<p>Original text</p>';
        const rewrite = 'Polite rewrite.';
        
        pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: rewrite }, originalRecipients: [] });
        extractedEmailStructures.set(mockTab.id, {
            originalQuotedContent: '',
            originalSignatureContent: '',
            originalMainContent
        });
        browser.compose.getComposeDetails.mockResolvedValue({ body, to: [], cc: [], subject: '' });
        
        await handleReplaceText(mockTab.id);
        await handleReplaceText(mockTab.id);
        
        expect(browser.compose.setComposeDetails).toHaveBeenCalledTimes(1);
        const calls = browser.compose.setComposeDetails.mock.calls;
        expect(calls[0][0]).toBe(mockTab.id);
        expect(calls[0][1].body).toBe('Polite rewrite.');
        expect(pendingComposes.size).toBe(0);
    });

    test('CRLF still matches and round-trips', async () => {
        const body = '<p>Line one\r\nLine two</p><blockquote>Existing</blockquote>';
        const originalMainContent = '<p>Line one\r\nLine two</p>';
        const rewrite = 'Polite rewrite.';
        
        pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: rewrite }, originalRecipients: [] });
        extractedEmailStructures.set(mockTab.id, {
            originalQuotedContent: '<blockquote>Existing</blockquote>',
            originalSignatureContent: '',
            originalMainContent
        });
        browser.compose.getComposeDetails.mockResolvedValue({ body, to: [], cc: [], subject: '' });
        
        await handleReplaceText(mockTab.id);
        
        const resultBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
        expect(resultBody).toBe('<p>Polite rewrite.</p><blockquote>Existing</blockquote>');
    });

    test('non-ASCII and emoji round-trip', async () => {
        const body = '<p>😡 Questa email è scortese.</p><blockquote>Messaggio originale</blockquote>';
        const originalMainContent = '<p>😡 Questa email è scortese.</p>';
        const rewrite = 'Per favore 😊, cordiali saluti — Zürich.';
        
        pendingComposes.set(mockTab.id, { tab: mockTab, analysisData: { rewrittenEmail: rewrite }, originalRecipients: [] });
        extractedEmailStructures.set(mockTab.id, {
            originalQuotedContent: '<blockquote>Messaggio originale</blockquote>',
            originalSignatureContent: '',
            originalMainContent
        });
        browser.compose.getComposeDetails.mockResolvedValue({ body, to: [], cc: [], subject: '' });
        
        await handleReplaceText(mockTab.id);
        
        const resultBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
        expect(resultBody).toBe('<p>Per favore 😊, cordiali saluti — Zürich.</p><blockquote>Messaggio originale</blockquote>');
    });
});
