/**
 * End-to-End Integration Tests
 * Tests complete workflow: compose → analyze → replace → verify
 * Verifies full integration from email composition to final replacement
 */

const { JSDOM } = require('jsdom');

// Set up JSDOM environment for HTML parsing
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.DOMParser = dom.window.DOMParser;
global.document = dom.window.document;
global.Element = dom.window.Element;
global.Node = dom.window.Node;

// Mock global window object using JSDOM
window = dom.window;
global.window = window;

// Mock browser API before requiring background.js
const browser = {
    compose: {
        onBeforeSend: {
            addListener: jest.fn()
        },
        getComposeDetails: jest.fn(),
        setComposeDetails: jest.fn()
    },
    tabs: {
        update: jest.fn(),
        get: jest.fn()
    },
    windows: {
        update: jest.fn(),
        getAll: jest.fn(),
        create: jest.fn()
    },
    accounts: {
        list: jest.fn()
    },
    runtime: {
        onMessage: {
            addListener: jest.fn()
        },
        getURL: jest.fn((path) => `chrome-extension://test/${path}`)
    },
    notifications: {
        create: jest.fn().mockResolvedValue(undefined)
    },
    storage: {
        local: {
            get: jest.fn(),
            set: jest.fn()
        }
    }
};

global.browser = browser;

// Mock fetch for AI API calls
global.fetch = jest.fn();

// Mock AbortController for timeout handling
global.AbortController = jest.fn(() => ({
    abort: jest.fn()
}));

// Import module under test after setting up mocks
const {
    handleOnBeforeSend,
    extractEmailContent,
    extractEmailStructure,
    handleReplaceText,
    pendingComposes,
    checkTone
} = require('../background.js');
// Helper functions for E2E test setup

const createMockTab = (id = 123) => ({ id, windowId: 456 });

const setupDefaultMocks = () => {
    const mockTab = createMockTab();
    browser.tabs.get.mockResolvedValue(mockTab);
    browser.compose.getComposeDetails.mockResolvedValue({
        body: '', to: [], cc: [], subject: '', identityId: 'id1'
    });
    browser.compose.setComposeDetails.mockResolvedValue(undefined);
    browser.tabs.update.mockResolvedValue(undefined);
    browser.windows.update.mockResolvedValue(undefined);
    browser.windows.getAll.mockResolvedValue([]);
    browser.accounts.list.mockResolvedValue([{ id: 'account1', identities: [{ id: 'id1' }] }]);
    browser.storage.local.get.mockResolvedValue({
        apiEndpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: 'test-key', model: 'gpt-4', enabled: true,
        checkedAccounts: [], customPrompt: ''
    });
    return mockTab;
};

const mockAIResponse = (overrides = {}) => {
    global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
            choices: [{
                message: {
                    content: JSON.stringify({
                        isProfessional: false,
                        problems: ['Tone is too aggressive'],
                        rewrittenEmail: 'This is a polite rewrite.',
                        suggestions: ['Use softer language'],
                        ...overrides
                    })
                }
            }]
        })
    });
};

const setupE2ETest = () => {
    jest.clearAllMocks();
    pendingComposes.clear();
};


describe('End-to-End Integration Tests', () => {
    let mockTab;

    beforeEach(() => {
        setupE2ETest();
        mockTab = setupDefaultMocks();
        mockAIResponse();
    });

    describe('E2E: Italian Email with Quotes and Signature', () => {
        test('Italian rude email → AI analysis → polite replacement with preserved quotes and signature', async () => {
            const italianQuote = '<blockquote>Messaggio originale in italiano che viene citato qui.</blockquote>';
            const italianBody = `<p>Questa email è molto scortese e poco professionale!</p>${italianQuote}${italianSignature}`;
            browser.compose.getComposeDetails.mockResolvedValue({ body: italianBody, to: ['cliente@example.com'], cc: [], subject: 'Oggetto: Richiesta urgente', identityId: 'id1' });
            const sendResult = await handleOnBeforeSend(mockTab, { to: ['cliente@example.com'] });
            expect(sendResult).toEqual({ cancel: true });
            expect(global.fetch).toHaveBeenCalledTimes(1);
            const aiInput = JSON.parse(global.fetch.mock.calls[0][1].body).messages[1].content;
            expect(aiInput).toContain('Questa email è molto scortese');
            expect(aiInput).not.toContain('Messaggio originale');
            expect(aiInput).not.toContain('Cordiali saluti');
            expect(aiInput).not.toContain('Mario Rossi');
            expect(pendingComposes.get(mockTab.id).analysisData.status).toBe('Unprofessional');
            expect(pendingComposes.get(mockTab.id).analysisData.originalQuotedContent).toContain('blockquote');
            await handleReplaceText();
            await handleReplaceText();
            const reconstructedBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expect(reconstructedBody).toContain('This is a polite rewrite');
            expect(reconstructedBody).toContain('Messaggio originale');
            expect(reconstructedBody).toContain('Cordiali saluti');
            expect(reconstructedBody).toContain('Mario Rossi');
            expect(reconstructedBody).toContain('mario@azienda.it');
            expect(reconstructedBody.indexOf('This is a polite rewrite')).toBeLessThan(reconstructedBody.indexOf('Messaggio originale'));
            expect(reconstructedBody.indexOf('Messaggio originale')).toBeLessThan(reconstructedBody.indexOf('Cordiali saluti'));
            expect(browser.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Text Replaced' }));
            expect(pendingComposes.has(mockTab.id)).toBe(false);
        });

    describe('E2E: English Email with Quotes and Signature', () => {
        test('English rude email → AI analysis → polite replacement with preserved quotes and signature', async () => {
            const englishQuote = '<blockquote>This is` original message that was quoted in reply.</blockquote>';
            const englishSignature = '<div class="moz-signature">-- <br>Best regards,<br>John Smith<br>john@company.com</div>';
            const englishBody = `<p>This email is extremely rude and unprofessional!</p>${englishQuote}${englishSignature}`;
            browser.compose.getComposeDetails.mockResolvedValue({ body: englishBody, to: ['client@example.com'], cc: [], subject: 'Subject: Urgent Request', identityId: 'id1' });
            await handleOnBeforeSend(mockTab, { to: ['client@example.com'] });
            expect(global.fetch).toHaveBeenCalledTimes(1);
            const aiInput = JSON.parse(global.fetch.mock.calls[0][1].body).messages[1].content;
            expect(aiInput).toContain('This email is extremely rude');
            expect(aiInput).not.toContain('original message that was quoted');
            expect(aiInput).not.toContain('Best regards');
            await handleReplaceText();
            const reconstructedBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expect(reconstructedBody).toContain('This is a polite rewrite');
            expect(reconstructedBody).toContain('original message that was quoted');
            expect(reconstructedBody).toContain('Best regards');
            expect(reconstructedBody).toContain('John Smith');
            expect(reconstructedBody.indexOf('This is a polite rewrite')).toBeLessThan(reconstructedBody.indexOf('original message that was quoted'));
            expect(reconstructedBody.indexOf('original message that was quoted')).toBeLessThan(reconstructedBody.indexOf('Best regards'));
        });
    });

    describe('E2E: Mixed Language Email', () => {
        test('Italian/English mixed email → AI analysis → polite replacement with preserved structure', async () => {
            const mixedQuote = '<blockquote>On Mon, 1 Jan 2025, John wrote: This is` original message.</blockquote>';
            const mixedSignature = '<p>-- <br>Cordiali saluti,<br>Jane Doe<br>jane@company.com</p>';
            const mixedBody = `<p>This email is molto scortese and unprofessional!</p>${mixedQuote}${mixedSignature}`;
            browser.compose.getComposeDetails.mockResolvedValue({ body: mixedBody, to: ['client@example.com'], cc: [], subject: 'Oggetto: Request', identityId: 'id1' });
            await handleOnBeforeSend(mockTab, { to: ['client@example.com'] });
            const aiInput = JSON.parse(global.fetch.mock.calls[0][1].body).messages[1].content;
            expect(aiInput).toContain('molto scortese');
            expect(aiInput).toContain('unprofessional');
            expect(aiInput).not.toContain('On Mon, 1 Jan');
            expect(aiInput).not.toContain('Cordiali saluti');
            const reconstructedBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expect(reconstructedBody).toContain('This is a polite rewrite');
            expect(reconstructedBody).toContain('On Mon, 1 Jan');
            expect(reconstructedBody).toContain('original message');
            expect(reconstructedBody).toContain('Cordiali saluti');
        });
    });

    describe('E2E: Email with No Quotes or Signature', () => {
        test('simple email without quotes/signature → AI analysis → simple replacement', async () => {
            browser.compose.getComposeDetails.mockResolvedValue({ body: '<p>This email is very rude and inappropriate!</p>', to: ['client@example.com'], cc: [], subject: 'Simple Subject', identityId: 'id1' });
            await handleOnBeforeSend(mockTab, { to: ['client@example.com'] });
            expect(JSON.parse(global.fetch.mock.calls[0][1].body).messages[1].content).toContain('This email is very rude');
            const reconstructedBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expect(reconstructedBody).toBe('This is a polite rewrite of the email content.');
        });
    });

    describe('E2E: Multiple Sequential Analyzes and Replaces', () => {
        test('complete workflow: analyze email → replace → user edits → analyze again → replace again', async () => {
            const firstBody = '<p>First rude email!</p><blockquote>Original quote</blockquote>';
            browser.compose.getComposeDetails.mockResolvedValue({
                body: firstBody,
                to: ['client@example.com'],
                cc: [],
                subject: 'First Subject',
                identityId: 'id1'
            });

            const sendResult1 = await handleOnBeforeSend(mockTab, { to: ['client@example.com'] });
            expect(sendResult1).toEqual({ cancel: true });
            await handleReplaceText();
            expect(pendingComposes.has(mockTab.id)).toBe(false);
            const editedBody = '<p>This is still rude after editing!</p><blockquote>Modified quote by user</blockquote>';
            browser.compose.getComposeDetails.mockResolvedValue({
                body: editedBody,
                to: ['client@example.com'],
                cc: [],
                subject: 'Second Subject',
                identityId: 'id1'
            });

            const sendResult2 = await handleOnBeforeSend(mockTab, { to: ['client@example.com'] });
            expect(sendResult2).toEqual({ cancel: true });
            expect(global.fetch).toHaveBeenCalledTimes(2);
            const secondFetchCall = global.fetch.mock.calls[1];
            const secondRequestBody = JSON.parse(secondFetchCall[1].body);
            const secondAiInput = secondRequestBody.messages[1].content;

            expect(secondAiInput).toContain('still rude after editing');

            await handleReplaceText();
            const finalCall = browser.compose.setComposeDetails.mock.calls[1];
            const finalBody = finalCall[1].body;
            expect(finalBody).toContain('This is a polite rewrite');
            expect(finalBody).toContain('Modified quote by user');
            expect(finalBody).not.toContain('Original quote');
        });

    describe('E2E: User Edits Between Analyze and Replace', () => {
        test('analyze → user modifies quote/signature → replace preserves user edits', async () => {
            const originalQuote = '<blockquote>This is` original quoted text.</blockquote>';
            const originalSignature = '<div class="moz-signature">-- Original Sender</div>';
            const initialBody = `<p>Rude email content!</p>${originalQuote}${originalSignature}`;
            browser.compose.getComposeDetails.mockResolvedValue({ body: initialBody, to: ['client@example.com'], cc: [], subject: 'Test Subject', identityId: 'id1' });
            const sendResult = await handleOnBeforeSend(mockTab, { to: ['client@example.com'] });
            expect(sendResult).toEqual({ cancel: true });
            const editedQuote = '<blockquote>MODIFIED quoted text by user</blockquote>';
            const editedSignature = '<div class="moz-signature">-- UPDATED Contact Info</div>';
            const editedBody = `<p>Rude email content!</p>${editedQuote}${editedSignature}`;
            browser.compose.getComposeDetails.mockResolvedValue({ body: editedBody, to: ['client@example.com'], cc: [], subject: 'Test Subject', identityId: 'id1' });
            await handleReplaceText();
            const reconstructedBody = browser.compose.setComposeDetails.mock.calls[0][1].body;
            expect(reconstructedBody).toContain('This is a polite rewrite');
            expect(reconstructedBody).toContain('MODIFIED quoted text by user');
            expect(reconstructedBody).toContain('UPDATED Contact Info');
            expect(reconstructedBody).not.toContain('original quoted text');
            expect(reconstructedBody).not.toContain('Original Sender');
        });
    });

    describe('E2E: Error Handling - AI Service Unavailable', () => {
        test('AI service fails → error handling → graceful degradation', async () => {
            global.fetch.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable', text: async () => 'Service Unavailable' });
            const testBody = '<p>This is a rude email!</p>';
            browser.compose.getComposeDetails.mockResolvedValue({ body: testBody, to: ['client@example.com'], cc: [], subject: 'Test', identityId: 'id1' });
            browser.storage.local.get.mockResolvedValue({ apiEndpoint: 'https://api.openai.com/v1/chat/completions', apiKey: 'test-key', model: 'gpt-4', enabled: true, checkedAccounts: ['account1'], customPrompt: '' });
            const sendResult = await handleOnBeforeSend(mockTab, { to: ['client@example.com'] });
            expect(sendResult).toEqual({ cancel: true });
            expect(pendingComposes.has(mockTab.id)).toBe(true);
            expect(pendingComposes.get(mockTab.id).analysisData.status).toBe('ApiError');
            expect(pendingComposes.get(mockTab.id).analysisData.error).toBeDefined();
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        test('AI service fails for unchecked account → graceful degradation with notification', async () => {
            global.fetch.mockResolvedValue({ ok: false, status: 503 });
            browser.compose.getComposeDetails.mockResolvedValue({ body: '<p>This is a rude email!</p>', to: ['client@example.com'], cc: [], subject: 'Test', identityId: 'id1' });
            browser.storage.local.get.mockResolvedValue({ apiEndpoint: 'https://api.openai.com/v1/chat/completions', apiKey: 'test-key', model: 'gpt-4', enabled: true, checkedAccounts: [], customPrompt: '' });
            const sendResult = await handleOnBeforeSend(mockTab, { to: ['client@example.com'] });
            expect(sendResult).toBeUndefined();
            expect(browser.notifications.create).toHaveBeenCalled();
            expect(browser.notifications.create.mock.calls[0][0].title).toContain('AI Check Failed');
        });
    });

    describe('E2E: Error Handling - Malformed Email Structure', () => {
    describe('E2E: Error Handling - AI Service Unavailable', () => {
        test('complete workflow: AI service fails → error handling → graceful degradation', async () => {
            global.fetch.mockResolvedValue({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable', text: async () => 'Service Unavailable'
            });
            const testBody = '<p>This is a rude email!</p>';
            browser.compose.getComposeDetails.mockResolvedValue({
                body: testBody,
                to: ['client@example.com'],
                cc: [],
                subject: 'Test',
                identityId: 'id1'
            });

            browser.storage.local.get.mockResolvedValue({
                apiEndpoint: 'https://api.openai.com/v1/chat/completions',
                apiKey: 'test-key',
                model: 'gpt-4',
                enabled: true,
                checkedAccounts: ['account1'],
                customPrompt: ''
            });
            const sendResult = await handleOnBeforeSend(mockTab, { to: ['client@example.com'] });
            expect(sendResult).toEqual({ cancel: true });
            expect(pendingComposes.has(mockTab.id)).toBe(true);
            const pendingEntry = pendingComposes.get(mockTab.id);
            expect(pendingEntry.analysisData.status).toBe('ApiError');
            expect(pendingEntry.analysisData.error).toBeDefined();

            expect(global.fetch).toHaveBeenCalledTimes(1);

        test('AI service fails for unchecked account → graceful degradation with notification', async () => {
            global.fetch.mockResolvedValue({ ok: false, status: 503 });
            browser.compose.getComposeDetails.mockResolvedValue({
                body: '<p>This is a rude email!</p>', to: ['client@example.com'], cc: [], subject: 'Test', identityId: 'id1'
            });
            browser.storage.local.get.mockResolvedValue({
                apiEndpoint: 'https://api.openai.com/v1/chat/completions', apiKey: 'test-key', model: 'gpt-4', enabled: true, checkedAccounts: [], customPrompt: ''
            });
            const sendResult = await handleOnBeforeSend(mockTab, { to: ['client@example.com'] });
            expect(sendResult).toBeUndefined();
            expect(browser.notifications.create).toHaveBeenCalled();
            expect(browser.notifications.create.mock.calls[0][0].title).toContain('AI Check Failed');
        });
    });

    describe('E2E: Error Handling - Malformed Email Structure', () => {
        test('malformed HTML → graceful handling → email still analyzed', async () => {
            const malformedBody = '<p>This is rude<div><span>Nested but unclosed</div>';
            browser.compose.getComposeDetails.mockResolvedValue({
                body: malformedBody, to: ['client@example.com'], cc: [], subject: 'Malformed Test', identityId: 'id1'
            });
            const sendResult = await handleOnBeforeSend(mockTab, { to: ['client@example.com'] });
            expect(sendResult).toEqual({ cancel: true });
            expect(global.fetch).toHaveBeenCalledTimes(1);
            expect(pendingComposes.has(mockTab.id)).toBe(true);
            expect(pendingComposes.get(mockTab.id).analysisData.status).toBe('Unprofessional');
            await handleReplaceText();
            expect(browser.compose.setComposeDetails).toHaveBeenCalled();
        });

        test('empty email body → graceful handling', async () => {
            browser.compose.getComposeDetails.mockResolvedValue({
                body: '', to: ['client@example.com'], cc: [], subject: 'Empty Test', identityId: 'id1'
            });
            await handleOnBeforeSend(mockTab, { to: ['client@example.com'] });
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        test('null body input → graceful degradation', async () => {
            browser.compose.getComposeDetails.mockResolvedValue({
                body: null, to: ['client@example.com'], cc: [], subject: 'Null Test', identityId: 'id1'
            });
            const sendResult = await handleOnBeforeSend(mockTab, { to: ['client@example.com'] });
            expect(sendResult).toBeDefined();
        });
    });
});
