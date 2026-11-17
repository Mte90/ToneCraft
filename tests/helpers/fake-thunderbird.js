/**
 * Fake Thunderbird API for testing ToneCraft extension
 * 
 * Models Thunderbird compose sessions with tab-scoped state,
 * accounts/identities resolution, and onBeforeSend contract.
 * 
 * UNSUPPORTED: Multi-window compose, attachment handling, draft persistence
 */

/**
 * TB-SHAPED BODY BUILDERS
 * These helpers produce HTML shapes that the extension's filterMozElements,
 * filterQuotedReplies, and isUnmodifiedForward already handle.
 */

/**
 * Forward body wrapper - Thunderbird wraps inline forwards in this container
 */
function forwardBody(inner) {
    return `<div class="moz-forward-container"><br><br>-------- Original Message --------<table class="moz-email-headers-table"><tr><td>Subject:</td><td>Original Subject</td></tr></table>${inner}</div>`;
}

/**
 * Reply body with moz-cite-prefix - Thunderbird's citation marker
 */
function replyBody(inner) {
    return `<div class="moz-cite-prefix">On Mon, 1 Jan 2025, Sender wrote:</div>${inner}`;
}

/**
 * Signature body with moz-signature class
 */
function signatureBody(text) {
    return `<div class="moz-signature">-- <br>${text}</div>`;
}

/**
 * Quoted reply block - Thunderbird wraps quoted text in blockquote
 */
function quoteBlock(text) {
    return `<blockquote>${text}</blockquote>`;
}

/**
 * Mozilla citation prefix helper
 */
function citePrefix() {
    return '<div class="moz-cite-prefix">On Mon, 1 Jan 2025, Sender wrote:</div>';
}

/**
 * Multiple paragraphs - one <p> per argument
 */
function multiParagraph(...texts) {
    return texts.filter(Boolean).map(t => '<p>' + t + '</p>').join('');
}

/**
 * Blank line helper - emits &nbsp; for Thunderbird's blank line representation
 */
function blankLine() {
    return '<p>&nbsp;</p>';
}

/**
 * Create a fake Thunderbird browser API
 * @param {Object} options - Configuration options
 * @param {Array} options.accounts - Account data with identities
 * @param {Object} options.storage - Initial storage data
 * @returns {Object} Fake browser API with install, compose, sent helpers
 */
function createFakeThunderbird(options = {}) {
    // Session state, keyed by tab id
    const composeSessions = new Map(); // tabId -> { id, windowId, identityId, type, body, plainTextBody }
    let nextTabId = 1000;
    const sentMessages = []; // Array of { tabId, to, cc, bcc, subject, body, identityId, type }
    
    // Storage - real stored state
    const storage = {
        local: {
            data: options.storage || {
                apiEndpoint: '',
                apiKey: '',
                model: '',
                enabled: true,
                checkedAccounts: [],
                customPrompt: '',
                recipientWhitelist: []
            },
            async get(defaults) {
                const result = { ...defaults };
                for (const key of Object.keys(defaults)) {
                    if (this.data.hasOwnProperty(key)) {
                        result[key] = this.data[key];
                    }
                }
                return result;
            },
            async set(value) {
                Object.assign(this.data, value);
            }
        }
    };

    // Notifications - record calls
    const notifications = {
        calls: [],
        async create(options) {
            this.calls.push(options);
            return 'notification-id-' + this.calls.length;
        }
    };

    // Tabs - minimal tab management
    const tabs = {
        async get(tabId) {
            const session = composeSessions.get(tabId);
            if (!session) {
                const error = new Error('Tab ' + tabId + ' not found');
                error.code = 'TAB_NOT_FOUND';
                throw error;
            }
            return { id: session.id, windowId: session.windowId };
        },
        async update(tabId, properties) {
            const session = composeSessions.get(tabId);
            if (!session) {
                const error = new Error('Tab ' + tabId + ' not found');
                error.code = 'TAB_NOT_FOUND';
                throw error;
            }
            return { ...session, ...properties };
        }
    };

    // Windows - minimal window management
    const windows = {
        created: [],
        async getAll() {
            return this.created;
        },
        async create(options) {
            const window = { id: Date.now(), type: options.type || 'normal', ...options };
            this.created.push(window);
            return window;
        },
        async update(windowId, properties) {
            const win = this.created.find(w => w.id === windowId);
            if (win) {
                Object.assign(win, properties);
            }
            return win;
        },
        async remove(windowId) {
            const idx = this.created.findIndex(w => w.id === windowId);
            if (idx >= 0) {
                this.created.splice(idx, 1);
            }
        }
    };

    // Runtime - message passing
    const runtime = {
        listeners: [],
        lastError: null,
        getURL(path) {
            return 'chrome-extension://test/' + path;
        },
        sendMessage(message) {
            // Dispatch to onMessage listener
            for (const listener of this.onMessage.listeners) {
                try {
                    const result = listener(message, { tab: { id: message.tabId } }, { sendResponse: () => {} });
                    if (result instanceof Promise) {
                        return result;
                    }
                    return result || false;
                } catch (err) {
                    console.error('Runtime message listener error:', err);
                }
            }
            return false;
        },
        onMessage: {
            listeners: [],
            addListener(listener) {
                this.listeners.push(listener);
            }
        }
    };

    // Accounts - identity resolution
    const accounts = {
        list() {
            return options.accounts || [
                { id: 'account1', identities: [{ id: 'id1', name: 'Test User', email: 'test@example.com' }] }
            ];
        }
    };

    // Compose - the core compose session API
    const compose = {
        onBeforeSend: {
            listeners: [],
            addListener(listener) {
                this.listeners.push(listener);
            }
        },

        /**
         * Get compose details for a tab
         * @param {number} tabId - The tab ID
         * @returns {Object} Compose details with body, type, to, cc, bcc, subject, identityId
         */
        async getComposeDetails(tabId) {
            const session = composeSessions.get(tabId);
            if (!session || session.detailsInvalid) {
                const error = new Error('Compose details not available for closed tab ' + tabId);
                error.code = 'COMPOSE_TAB_CLOSED';
                throw error;
            }
            return {
                body: session.body || '',
                type: session.type || 'new',
                to: session.to || [],
                cc: session.cc || [],
                bcc: session.bcc || [],
                subject: session.subject || '',
                identityId: session.identityId || 'id1',
                plainTextBody: session.plainTextBody || ''
            };
        },

        /**
         * Set compose details for a tab
         * @param {number} tabId - The tab ID
         * @param {Object} details - Details to set (body, subject, etc.)
         */
        async setComposeDetails(tabId, details) {
            const session = composeSessions.get(tabId);
            if (!session || session.detailsInvalid) {
                const error = new Error('Cannot set details for closed tab ' + tabId);
                error.code = 'COMPOSE_TAB_CLOSED';
                throw error;
            }
            if (details.body !== undefined) session.body = details.body;
            if (details.subject !== undefined) session.subject = details.subject;
            if (details.to !== undefined) session.to = details.to;
            if (details.cc !== undefined) session.cc = details.cc;
            if (details.bcc !== undefined) session.bcc = details.bcc;
        },

        /**
         * Send message for a tab
         * @param {number} tabId - The tab ID
         * @returns {Promise} Resolves when message is sent
         */
        async sendMessage(tabOrTabId) {
            const tabId = typeof tabOrTabId === 'object' ? tabOrTabId.id : tabOrTabId;
            const session = composeSessions.get(tabId);
            if (!session) {
                const error = new Error('Cannot send from closed tab ' + tabId);
                error.code = 'COMPOSE_TAB_CLOSED';
                throw error;
            }

            // The listener receives Thunderbird's own details snapshot, so an
            // unreadable compose body must not stop the listener from running.
            const details = {
                body: session.body || '',
                type: session.type || 'new',
                to: session.to || [],
                cc: session.cc || [],
                bcc: session.bcc || [],
                subject: session.subject || '',
                identityId: session.identityId || 'id1'
            };
            // Invoke onBeforeSend listeners
            for (const listener of this.onBeforeSend.listeners) {
                const tab = { id: tabId, windowId: session.windowId };
                const listenerDetails = {
                    to: details.to,
                    cc: details.cc,
                    bcc: details.bcc,
                    subject: details.subject,
                    identityId: details.identityId,
                    type: details.type
                };

                let result;
                try {
                    result = listener(tab, listenerDetails);
                    if (result && typeof result.then === 'function') {
                        result = await result;
                    }
                } catch (error) {
                    // UNCONFIRMED: how Thunderbird treats a listener that throws is not
                    // cited yet; treat it as non-cancelling and log it.
                    console.error('onBeforeSend listener error:', error);
                    continue;
                }

                if (result && result.cancel === true) {
                    // UNCONFIRMED: how Thunderbird's own promise settles on a cancelled
                    // send is not cited yet; this models cancellation as a rejection.
                    throw new Error('Message send cancelled by onBeforeSend listener');
                }
            }

            // Message not cancelled - record as sent
            sentMessages.push({
                tabId,
                to: details.to,
                cc: details.cc,
                bcc: details.bcc,
                subject: details.subject,
                body: details.body,
                identityId: details.identityId,
                type: details.type
            });

            return { success: true };
        },

        /**
         * Open a new compose tab
         * @param {Object} options - Tab options
         * @returns {Object} The created tab
         */
        openTab(options) {
            const tabId = options.id || ++nextTabId;
            const session = {
                id: tabId,
                windowId: options.windowId || 1,
                identityId: options.identityId || 'id1',
                type: options.type || 'new',
                body: options.body || '',
                plainTextBody: options.plainTextBody || '',
                to: options.to || [],
                cc: options.cc || [],
                bcc: options.bcc || [],
                subject: options.subject || ''
            };
            composeSessions.set(tabId, session);
            return { id: tabId, windowId: session.windowId };
        },

        /**
         * Make a compose body unreadable while the tab stays open, to model the
         * body read failing while a send is in flight. That race is what the
         * recovery path in handleOnBeforeSend exists for.
         * @param {number} tabId - The tab ID whose details become unreadable
         */
        invalidateDetails(tabId) {
            const session = composeSessions.get(tabId);
            if (!session) {
                throw new Error('Cannot invalidate details for closed tab ' + tabId);
            }
            session.detailsInvalid = true;
        },

        /**
         * Close a compose tab
         * @param {number} tabId - The tab ID to close
         */
        closeTab(tabId) {
            composeSessions.delete(tabId);
        }
    };

    return {
        browser: {
            compose,
            accounts,
            tabs,
            windows,
            runtime,
            notifications,
            storage
        },

        /**
         * Install the fake browser API on global.browser
         * Call this before requiring background.js
         */
        install() {
            global.browser = this.browser;
        },

        /**
         * Get sent messages
         */
        get sent() {
            return [...sentMessages];
        },

        /**
         * Get compose sessions
         */
        get sessions() {
            return new Map(composeSessions);
        },

        /**
         * Let the promise callbacks queued by a message handler run.
         * background.js replies false to replaceText, so the sender has no
         * completion signal; the fake performs no I/O, so one macrotask turn
         * is enough for every awaited fake call to settle. jsdom has no
         * setImmediate, so use a zero timeout.
         */
        settle() {
            return new Promise(resolve => setTimeout(resolve, 0));
        },

        /**
         * Clear all state
         */
        reset() {
            composeSessions.clear();
            sentMessages.length = 0;
            notifications.calls.length = 0;
            windows.created.length = 0;
            runtime.listeners.length = 0;
            runtime.lastError = null;
        },

        // Body builders exported for test convenience
        forwardBody,
        replyBody,
        signatureBody,
        quoteBlock,
        citePrefix,
        multiParagraph,
        blankLine
    };
}

module.exports = {
    createFakeThunderbird,
    forwardBody,
    replyBody,
    signatureBody,
    quoteBlock,
    citePrefix,
    multiParagraph,
    blankLine
};
