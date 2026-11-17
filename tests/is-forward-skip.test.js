/**
 * Unmodified Forward Tests
 * The tone check must be skipped when the user forwards a message and writes
 * nothing of their own: Thunderbird keeps the forwarded message inside a
 * div.moz-forward-container, so any text outside it is user-authored.
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

const { handleOnBeforeSend, isUnmodifiedForward } = require('../background.js');

global.fetch = jest.fn();

class MockAbortController {
    constructor() {
        this.signal = {};
        this.abort = jest.fn();
    }
}
global.AbortController = MockAbortController;

// Exact shape Thunderbird produces for an inline forward (see nsMsgCompose.cpp):
// a div.moz-forward-container holding the separator, the headers table and the
// original body - never a blockquote.
const forwardedBody = `<div class="moz-forward-container"><br><br>-------- Original Message --------<table class="moz-email-headers-table"><tr><td>Subject:</td><td>Quarterly report</td></tr></table><p>Hello, this is the original message.</p></div>`;

const settings = {
    apiEndpoint: 'https://api.example.com',
    apiKey: 'test-key',
    model: 'gpt-4',
    enabled: true,
    checkedAccounts: [],
    recipientWhitelist: [],
    customPrompt: ''
};

describe('Unmodified forward skips the tone check', () => {
    let mockTab;

    beforeEach(() => {
        jest.clearAllMocks();
        mockTab = { id: 123, windowId: 456 };

        browser.tabs.get.mockResolvedValue(mockTab);
        browser.compose.setComposeDetails.mockResolvedValue(undefined);
        browser.tabs.update.mockResolvedValue(undefined);
        browser.windows.update.mockResolvedValue(undefined);
        browser.windows.getAll.mockResolvedValue([]);
        browser.accounts.list.mockResolvedValue([
            { id: 'account1', identities: [{ id: 'id1', name: 'Test', email: 'test@example.com' }] }
        ]);
        browser.storage.local.get.mockResolvedValue(settings);

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

    test('forward with no user text - returns undefined and never calls the API', async () => {
        browser.compose.getComposeDetails.mockResolvedValue({
            body: forwardedBody,
            type: 'forward',
            to: ['user@example.com'],
            cc: [],
            bcc: [],
            subject: 'FW: Quarterly report',
            identityId: 'id1'
        });

        const result = await handleOnBeforeSend(mockTab, { to: ['user@example.com'], type: 'forward' });

        expect(result).toBeUndefined();
        expect(fetch).not.toHaveBeenCalled();
    });

    test('forward with text added by the user - tone check runs', async () => {
        browser.compose.getComposeDetails.mockResolvedValue({
            body: `${forwardedBody}<p>Hey, see the report below.</p>`,
            type: 'forward',
            to: ['user@example.com'],
            cc: [],
            bcc: [],
            subject: 'FW: Quarterly report',
            identityId: 'id1'
        });

        const result = await handleOnBeforeSend(mockTab, { to: ['user@example.com'], type: 'forward' });

        // Assert the payload: user-written text reached the AI, forwarded body content did not
        const aiRequestContent = JSON.parse(fetch.mock.calls[0][1].body).messages[1].content;
        expect(aiRequestContent).toContain('Hey, see the report below.');
        // Subject line is included in the request, so "Quarterly report" will appear there
        // What we test is that the forwarded BODY content is filtered out
        expect(aiRequestContent).not.toContain('Hello, this is the original message.');
        expect(aiRequestContent).not.toContain('Original Message');
        // Assert the exact returned value (professional = undefined)
        expect(result).toBeUndefined();
    });

    test('a new message using a forward container is still checked when the user wrote text', async () => {
        browser.compose.getComposeDetails.mockResolvedValue({
            body: `${forwardedBody}<p>Please review.</p>`,
            type: 'new',
            to: ['user@example.com'],
            cc: [],
            bcc: [],
            subject: 'Notes',
            identityId: 'id1'
        });

        const result = await handleOnBeforeSend(mockTab, { to: ['user@example.com'], type: 'new' });

        // Assert the payload: user-written text reached the AI, forwarded text did not
        const aiRequestContent = JSON.parse(fetch.mock.calls[0][1].body).messages[1].content;
        expect(aiRequestContent).toContain('Please review.');
        expect(aiRequestContent).not.toContain('Quarterly report');
        expect(aiRequestContent).not.toContain('Hello, this is the original message.');
        // Assert the exact returned value (professional = undefined)
        expect(result).toBeUndefined();
    });
});

describe('isUnmodifiedForward', () => {
    test('true only for a forward whose body holds nothing but the forwarded message', () => {
        expect(isUnmodifiedForward({ type: 'forward', body: forwardedBody })).toBe(true);
    });

    test('false when the type is not forward', () => {
        expect(isUnmodifiedForward({ type: 'new', body: forwardedBody })).toBe(false);
        expect(isUnmodifiedForward({ type: 'reply', body: forwardedBody })).toBe(false);
    });

    test('false when the user text sits outside the forward container', () => {
        expect(isUnmodifiedForward({ type: 'forward', body: `${forwardedBody}<p>Added note</p>` })).toBe(false);
    });

    test('true when only whitespace and non-breaking spaces are left', () => {
        expect(isUnmodifiedForward({ type: 'forward', body: `<p>&nbsp;</p>${forwardedBody}` })).toBe(true);
    });

    test('false when there is no body', () => {
        expect(isUnmodifiedForward({ type: 'forward', body: '' })).toBe(false);
    });
});
