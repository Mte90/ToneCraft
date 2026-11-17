/**
 * Dialog UI Tests
 * Exercises dialog/dialog.js the way the popup window runs it: the real markup
 * is loaded into jsdom first, then the script is required once per test.
 */

/** @jest-environment jsdom */

const fs = require('fs');
const path = require('path');

const dialogMarkup = fs
    .readFileSync(path.join(__dirname, '../dialog/dialog.html'), 'utf8')
    .match(/<body[^>]*>([\s\S]*)<\/body>/i)[1];

// Record the handlers each test registers so they can be removed again
const registeredListeners = [];
const addEventListener = window.addEventListener.bind(window);
window.addEventListener = (type, handler, options) => {
    registeredListeners.push([type, handler]);
    addEventListener(type, handler, options);
};

const unprofessional = {
    status: 'Unprofessional',
    problems: ['Too blunt'],
    rewrittenEmail: 'Dear team,'
};

function loadDialog(sendMessage) {
    global.browser = { runtime: { lastError: null, sendMessage } };
    window.close = jest.fn();
    global.navigator.clipboard = { writeText: jest.fn().mockResolvedValue(undefined) };
    window.history.replaceState({}, '', '/?tabId=42');
    document.body.innerHTML = dialogMarkup;
    jest.isolateModules(() => require('../dialog/dialog.js'));
}

function respondingWith(analysisData) {
    return jest.fn((message, callback) => {
        if (callback) callback({ analysisData });
        return Promise.resolve();
    });
}

describe('dialog.js', () => {
    afterEach(() => {
        registeredListeners.forEach(([type, handler]) => window.removeEventListener(type, handler));
        registeredListeners.length = 0;
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('requests the analysis exactly once for the tab in the URL and renders it', () => {
        const sendMessage = respondingWith(unprofessional);

        loadDialog(sendMessage);

        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith(
            { action: 'getAnalysisData', tabId: '42' },
            expect.any(Function)
        );
        expect(document.getElementById('statusText').textContent).toBe('😟 Unprofessional');
        const entries = document.getElementById('problems').querySelectorAll('li');
        expect(entries).toHaveLength(1);
        expect(entries[0].textContent).toBe('Too blunt');
        expect(document.getElementById('rewritten').textContent).toBe('Dear team,');
    });

    test('renders a single placeholder entry when the analysis finds no problems', () => {
        const sendMessage = respondingWith({ status: 'Professional', problems: [], rewrittenEmail: 'Hello' });

        loadDialog(sendMessage);

        const entries = document.getElementById('problems').querySelectorAll('li');
        expect(entries).toHaveLength(1);
        expect(entries[0].textContent).toBe('No problems detected');
    });

    test('hides the replace action and reports the failure for an API error', () => {
        const sendMessage = respondingWith({ status: 'ApiError', error: 'API error 500: boom' });

        loadDialog(sendMessage);

        expect(document.getElementById('replaceButton').style.display).toBe('none');
        expect(document.getElementById('ignoreButton').textContent).toBe('Send Anyway');
        expect(document.getElementById('problems').querySelector('li').textContent).toBe('API error 500: boom');
    });

    test('dismissing the window without an action cleans up the pending compose entry', () => {
        const sendMessage = respondingWith(unprofessional);
        loadDialog(sendMessage);
        sendMessage.mockClear();

        window.dispatchEvent(new Event('pagehide'));

        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith({ action: 'cleanupTab', tabId: '42' });
        expect(window.close).toHaveBeenCalled();
    });

    test('dismissing the window after an action leaves cleanup to the background handler', () => {
        const sendMessage = respondingWith(unprofessional);
        loadDialog(sendMessage);
        sendMessage.mockClear();

        document.getElementById('replaceButton').click();
        window.dispatchEvent(new Event('pagehide'));

        expect(sendMessage).toHaveBeenCalledWith({ action: 'replaceText', tabId: '42' });
        expect(sendMessage).not.toHaveBeenCalledWith({ action: 'cleanupTab', tabId: '42' });
    });
    test('offers the edit action and returns to the draft when it is used', () => {
        const sendMessage = respondingWith(unprofessional);
        loadDialog(sendMessage);

        expect(document.getElementById('editButton')).not.toBeNull();
        sendMessage.mockClear();

        document.getElementById('editButton').click();

        expect(sendMessage).toHaveBeenCalledWith({ action: 'editOriginal', tabId: '42' });
    });
});
