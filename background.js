/**
 * Background script for ToneCraft Thunderbird extension
 * Intercepts outgoing emails and checks tone using AI
 */

// Track consecutive API failures for graceful degradation
let consecutiveApiFailures = 0;

// Pending compose operations indexed by tab ID
const pendingComposes = new Map();
// Extracted email structure indexed by tab ID, beside the pending compose entry
const extractedEmailStructures = new Map();
// Set of tab IDs that should skip tone check when sending
const tabsToSkipCheck = new Set();
function initialize() {
    browser.compose.onBeforeSend.addListener(handleOnBeforeSend);
    browser.runtime.onMessage.addListener(handleMessage);
}

async function handleOnBeforeSend(tab, details) {
    // Skip tone check if user clicked 'Send Anyway' on this tab
    if (tabsToSkipCheck.has(tab.id)) {
        tabsToSkipCheck.delete(tab.id);
        return undefined;
    }

    // Declared outside the try so the recovery path below can read them
    let settings = null;
    let senderAccountId = null;

    try {

        settings = await browser.storage.local.get({
            apiEndpoint: '',
            apiKey: '',
            model: '',
            enabled: true,
            checkedAccounts: [],
            customPrompt: '',
            recipientWhitelist: []
        });

        if (!settings.enabled || !settings.apiKey) {
            console.log('Tone check skipped - extension disabled or no API key');
            return undefined;
        }

        // Resolve the sender account before the compose body is read, so the
        // recovery path below still knows which account is configured
        const accounts = await browser.accounts.list();
        const identityId = details.identityId || (await browser.compose.getComposeDetails(tab.id)).identityId;
        senderAccountId = accounts.find(acc => acc.identities?.some(id => id.id === identityId))?.id;
        
        // Skip tone check if account is NOT in checkedAccounts (allowlist)
        // If checkedAccounts is empty, check all accounts (default behavior)
        if (settings.checkedAccounts.length > 0 && !settings.checkedAccounts.includes(senderAccountId)) {
            return undefined;
        }

        // Skip tone check if ALL recipients are whitelisted (and there is at least one recipient)
        const allRecipients = [
            ...(details.to || []),
            ...(details.cc || []),
            ...(details.bcc || [])
        ].map(r => r.toLowerCase());

        const whitelistLowercased = (settings.recipientWhitelist || []).map(r => r.toLowerCase());

        if (allRecipients.length > 0 && whitelistLowercased.length > 0) {
            const allWhitelisted = allRecipients.every(recipient => whitelistLowercased.includes(recipient));
            if (allWhitelisted) {
                console.log('Skip tone check - all recipients are whitelisted');
                return undefined;
            }
        }

        const composeDetails = await browser.compose.getComposeDetails(tab.id);

        // Skip tone check when the user forwards a message without writing
        // anything of their own: only user-authored text is worth analysing.
        if (isUnmodifiedForward(composeDetails)) {
            console.log('Skip tone check - unmodified forward');
            return undefined;
        }

        const emailContent = await extractEmailContent(tab, details, composeDetails);
        const result = await checkTone(emailContent, settings);

        if (result.success) {
            consecutiveApiFailures = 0;
        } else {
            consecutiveApiFailures++;
            console.error('Tone check failed:', result.error);
            
            // If account is configured (in checkedAccounts), block send on API failure
            if (senderAccountId && settings.checkedAccounts.includes(senderAccountId)) {
                
                pendingComposes.set(tab.id, {
                    tab,
                    analysisData: {
                        status: 'ApiError',
                        error: result.error
                    },
                    originalRecipients: details.to || []
                });

                await openDialogWindow(tab.id);
                return { cancel: true };
            }
            
            // Account is not configured - graceful degradation with notification
            const failureMessage = consecutiveApiFailures >= 2
                ? 'Multiple API failures occurred. Check your API settings. Email will be sent without tone check.'
                : 'Could not check email tone: ' + result.error + '. Email will be sent without tone check.';
            showNotification('AI Check Failed', failureMessage);
            return undefined;
        }
        if (result.data.isProfessional) {
            showNotification(
                'Professional Email Detected',
                'Email tone is professional. Sending...'
            );
            return undefined;
        }

        // Get extracted structure for this tab (if available)
        const extractedStructure = extractedEmailStructures.get(tab.id) || null;

        pendingComposes.set(tab.id, {
            tab,
            analysisData: {
                status: 'Unprofessional',
                problems: result.data.problems,
                rewrittenEmail: result.data.rewrittenEmail,
                suggestions: result.data.suggestions,
                originalContent: emailContent,
                originalQuotedContent: extractedStructure?.originalQuotedContent || '',
                originalSignatureContent: extractedStructure?.originalSignatureContent || '',
                recipients: details.to || []
            },
            originalRecipients: details.to || []
        });

        await openDialogWindow(tab.id);
        return { cancel: true };

    } catch (error) {
        console.error('Error in onBeforeSend handler:', error);
        
        // Check if we have access to settings (might be undefined if error occurred before)
        if (settings) {
            // If account is configured (in checkedAccounts), block send on error
            if (senderAccountId && settings.checkedAccounts.includes(senderAccountId)) {
                
                // Get extracted structure for this tab (if available)
                const extractedStructure = extractedEmailStructures.get(tab.id) || null;
                
                pendingComposes.set(tab.id, {
                    tab,
                    analysisData: {
                        status: 'ApiError',
                        error: error.message || 'Unknown error',
                        originalQuotedContent: extractedStructure?.originalQuotedContent || '',
                        originalSignatureContent: extractedStructure?.originalSignatureContent || ''
                    },
                    originalRecipients: details.to || []
                });
            
                await openDialogWindow(tab.id);
                return { cancel: true };
            }
        }
        
        // Account is not configured - graceful degradation with notification
        showNotification(
            'Tone Check Error',
            'An error occurred during tone checking. Email will be sent without the check. Check your API settings.'
        );
        return undefined;
    }
}

async function extractEmailContent(tab, details, composeDetails = null) {
    try {
        if (!composeDetails) {
            composeDetails = await browser.compose.getComposeDetails(tab.id);
        }

        let content = '';
        if (composeDetails.subject) {
            content += `Subject: ${composeDetails.subject}\n\n`;
        }
        if (composeDetails.body) {
            // Parse HTML and filter out moz- class elements
            const cleanBody = filterMozElements(composeDetails.body);
            
            // Extract email structure (quotes, signature, main content)
            const { quotedContent, signatureContent, mainContent } = extractEmailStructure(cleanBody);
            
            // Store extracted structure for later reconstruction
            if (tab.id) {
                extractedEmailStructures.set(tab.id, {
                    originalQuotedContent: quotedContent,
                    originalSignatureContent: signatureContent,
                    originalMainContent: mainContent
                });
            }
            
            // Send only mainContent to AI (not quotes, not signature)
            content += mainContent;
        }

        return content;
    } catch (error) {
        console.error('Error extracting email content:', error);
        return details.plainTextBody || '';
    }
}

/**
 * Detect a message the user forwarded without writing anything of their own.
 * Thunderbird wraps an inline forward in a div.moz-forward-container, so any
 * text left outside that container, a quote or a signature is user input.
 *
 * @param {Object} composeDetails - ComposeDetails from browser.compose
 * @returns {boolean} - True when the message is an unmodified forward
 */
function isUnmodifiedForward(composeDetails) {
    if (!composeDetails || composeDetails.type !== 'forward' || !composeDetails.body) {
        return false;
    }

    const doc = new DOMParser().parseFromString(composeDetails.body, 'text/html');
    ['div.moz-forward-container', 'div.moz-cite-prefix', '[class^="moz-signature"]', 'blockquote']
        .forEach(selector => doc.querySelectorAll(selector).forEach(el => el.remove()));

    const remainingText = doc.body.textContent.replace(/\u00a0/g, ' ').trim();
    return remainingText.length === 0;
}

/**
 * Filter out HTML elements with class starting with "moz-"
 * Used to remove Thunderbird-generated signatures and quoted content
 * @param {string} html - The HTML content to filter
 * @returns {string} - Cleaned HTML content
 */
/**
 * Generic DOM filter helper
 * @param {string} html - HTML content to filter
 * @param {string[]} selectors - CSS selectors to remove
 * @param {Function} customFilter - Optional custom element filter
 * @returns {string} - Filtered HTML
 */
function filterDOM(html, selectors = [], customFilter = null) {
    if (!html || typeof html !== 'string') return html;
    
    const doc = new DOMParser().parseFromString(html, 'text/html');
    
    // Remove elements matching selectors
    selectors.forEach(selector => {
        doc.querySelectorAll(selector).forEach(el => el.remove());
    });
    
    // Apply custom filter if provided
    if (customFilter) {
        customFilter(doc);
    }
    
    return doc.body.innerHTML;
}
 
/**
 * Filter Thunderbird moz- elements (signatures, etc.)
 */
const filterMozElements = html => filterDOM(html, ['[class^="moz-"]']);
 
/**
 * Filter quoted reply sections
 */
const filterQuotedReplies = html => filterDOM(html, ['blockquote'], doc => {
    doc.querySelectorAll('p, div').forEach(el => {
        if (el.textContent.trim().startsWith('>')) {
            el.remove();
        }
    });
});

/**
 * Filter quoted replies with context - only strips text that echoes original quoted content
 * @param {string} html - HTML content to filter
 * @param {string} knownQuotedText - Normalized quoted text from original body
 * @returns {string} - Filtered HTML
 */
function filterQuotedRepliesWithContext(html, knownQuotedText) {
    if (!html || typeof html !== 'string') return html;
    
    const doc = new DOMParser().parseFromString(html, 'text/html');
    
    // Remove blockquotes only when their text is contained in known quoted text
    doc.querySelectorAll('blockquote').forEach(el => {
        const elText = el.textContent.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        // Only remove if this blockquote's text is contained in the known quoted text
        if (knownQuotedText && elText && knownQuotedText.includes(elText)) {
            el.remove();
        }
    });
    
    // Remove p/div elements starting with > only when their text is in known quoted text
    doc.querySelectorAll('p, div').forEach(el => {
        const elText = el.textContent.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        if (elText.startsWith('>') && knownQuotedText && knownQuotedText.includes(elText)) {
            el.remove();
        }
    });
    
    return doc.body.innerHTML;
}


/**
 * Remove markdown code fences from model output, keeping the fenced content.
 * @param {string} text - Raw model output
 * @returns {string} - Text without fences
 */
function stripCodeFences(text) {
    if (!text) return '';
    return text
        .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
        .replace(/```[^\n]*\n?/g, '')
        .replace(/```/g, '')
        .trim();
}

/**
 * Serialise a rewrite that replaces a paragraph region, one <p> per non-empty
 * line so the author's paragraph structure survives the round trip.
 * @param {string} text - Rewrite, fences already allowed
 * @returns {string} - HTML
 */
function rewriteToParagraphs(text) {
    const stripped = stripCodeFences(text);
    if (/<[a-z][\s\S]*>/i.test(stripped)) return stripped;
    return stripped
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => '<p>' + line + '</p>')
        .join('');
}

/**
 * Serialise a rewrite that replaces the whole body, protecting the line breaks
 * the model wrote. A single-line rewrite is returned unchanged.
 * @param {string} text - Rewrite, fences already allowed
 * @returns {string} - HTML
 */
function rewriteToBodyHtml(text) {
    const stripped = stripCodeFences(text);
    if (/<[a-z][\s\S]*>/i.test(stripped)) return stripped;
    return stripped
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .join('<br>');
}

/**
 * Extract email content structure from HTML body
 * Parses HTML and separates main content from quoted replies and signatures
 * 
 * @param {string} html - Raw HTML body content from Thunderbird compose
 * @returns {EmailStructure} Object containing extracted email content sections
 * @throws Error if HTML parsing fails (caught and handled by caller)
 */
function extractEmailStructure(html) {
    try {
        // Input validation
        if (!html || typeof html !== 'string') {
            return {
                quotedContent: '',
                signatureContent: '',
                mainContent: '',
                originalBody: html || ''
            };
        }
        
        // Parse HTML using DOMParser (following filterMozElements pattern)
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Clone document to avoid modifying original during extraction
        const workingDoc = doc.cloneNode(true);
        
        // Extract quoted content (blockquotes - handle nested quotes, EXCLUDE moz-signatures)
        const blockquotes = workingDoc.querySelectorAll('blockquote');
        let quotedContent = '';
        for (let i = 0; i < blockquotes.length; i++) {
            const bq = blockquotes[i];
            // Skip blockquotes that contain moz-signature
            if (!bq.querySelector('[class^="moz-signature"]')) {
                quotedContent += bq.outerHTML;
            }
        }
        
        // Extract signature content (moz- signature elements, including those inside blockquotes)
        const mozSignatures = workingDoc.querySelectorAll('[class^="moz-signature"]');
        let signatureContent = '';
        for (let i = 0; i < mozSignatures.length; i++) {
            signatureContent += mozSignatures[i].outerHTML;
        }
        // Also include the blockquote wrapper if signature is inside one
        for (let i = 0; i < mozSignatures.length; i++) {
            const sig = mozSignatures[i];
            const parentBlockquote = sig.closest('blockquote');
            if (parentBlockquote && !signatureContent.includes(parentBlockquote.outerHTML)) {
                signatureContent = parentBlockquote.outerHTML + signatureContent;
            }
        }
        
        // Detect and extract manual signatures (lines starting with "-- ")
        // Pattern: "-- " followed by content, typically at end of document
        const paragraphs = workingDoc.querySelectorAll('p, div');
        let manualSignatureFound = false;
        
        // Find all email reply separators to identify quoted/previous sections
        const separatorIndices = [];
        for (let i = 0; i < paragraphs.length; i++) {
            const text = paragraphs[i].textContent;
            if (text && text.includes('On ') && text.includes('wrote:')) {
                separatorIndices.push(i);
            }
        }
        
        // Scan from end to find last signature BEFORE any email separator
        const lastSeparatorIndex = separatorIndices.length > 0 ? separatorIndices[separatorIndices.length - 1] : -1;

        
        for (let i = paragraphs.length - 1; i >= 0; i--) {
            // Skip elements that are after the last separator (in quoted content)
            if (lastSeparatorIndex >= 0 && i > lastSeparatorIndex) {
                continue;
            }
            const element = paragraphs[i];
            const text = element.textContent;
            
            // Check for signature marker "-- "
            if (text && text.trim().startsWith('-- ')) {
                // Found manual signature - extract it
                signatureContent += element.outerHTML;
                manualSignatureFound = true;
                
                // Check preceding elements for multi-line signatures
                for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
                    const prevElement = paragraphs[j];
                    const prevText = prevElement.textContent;
                    
                    // Include preceding elements if they look like signature content
                    if (prevText && prevText.trim().length > 0 &&
                        !prevText.trim().startsWith('-- ') &&
                        !prevText.includes('On ') &&
                        !prevText.includes('wrote:')) {
                        signatureContent += prevElement.outerHTML;
                    }
                }
                break; // Only extract the last (most recent) signature
            }
        }
        
        // Calculate main content by removing quoted and signature elements
        // from a fresh clone to avoid affecting our extractions
        const mainDoc = doc.cloneNode(true);
        const mainBlockquotes = mainDoc.querySelectorAll('blockquote');
        for (let i = 0; i < mainBlockquotes.length; i++) {
            mainBlockquotes[i].remove();
        }
        const mainMozSignatures = mainDoc.querySelectorAll('[class^="moz-signature"]');
        for (let i = 0; i < mainMozSignatures.length; i++) {
            mainMozSignatures[i].remove();
        }
        
        // Remove manual signature from main content if found
        if (manualSignatureFound) {
            const mainParagraphs = mainDoc.querySelectorAll('p, div');
            for (let i = mainParagraphs.length - 1; i >= 0; i--) {
                const element = mainParagraphs[i];
                const text = element.textContent;
                
                if (text && text.trim().startsWith('-- ')) {
                    // Remove manual signature and any preceding signature-like elements
                    for (let j = i; j >= Math.max(0, i - 3); j--) {
                        const prevElement = mainParagraphs[j];
                        const prevText = prevElement.textContent;
                        
                        if (prevText && prevText.trim().length > 0 &&
                            !prevText.trim().startsWith('-- ') &&
                            !prevText.includes('On ') &&
                            !prevText.includes('wrote:')) {
                            mainParagraphs[j].remove();
                        } else if (prevText && prevText.trim().startsWith('-- ')) {
                            mainParagraphs[j].remove();
                            break;
                        } else {
                            break;
                        }
                    }
                    break;
                }
            }
        }
        
        const mainContent = mainDoc.body.innerHTML;
        
        return {
            quotedContent, // HTML preserves formatting
            signatureContent, // HTML preserves formatting
            mainContent, // Body without quotes and signature
            originalBody: html // Original for reference
        };
        
    } catch (error) {
        console.error('Failed to extract email structure:', error);
        
        // Graceful degradation - return original as main content
        return {
            quotedContent: '',
            signatureContent: '',
            mainContent: html, // Original as fallback
            originalBody: html
        };
    }
}

async function openDialogWindow(tabId) {
    try {
        const windows = await browser.windows.getAll();
        const dialogWindow = windows.find(w => w.type === 'popup');

        // Always close existing dialog and open new one with correct tabId
        if (dialogWindow) {
            await browser.windows.remove(dialogWindow.id);
        }
        
        // Pass tabId as URL parameter so dialog knows which email to request
        const url = tabId ? `dialog/dialog.html?tabId=${tabId}` : 'dialog/dialog.html';
        await browser.windows.create({
            url: url,
            type: 'popup',
            state: 'maximized'
        });
    } catch (error) {
        console.error('Error opening dialog window:', error);
    }
}

function handleMessage(message, sender, sendResponse) {

    if (message.action === 'getAnalysisData') {
        // Use tabId from message to get the correct email data
        const tabId = message.tabId ? Number(message.tabId) : null; // Convert string to number for Map lookup
        const entry = tabId ? pendingComposes.get(tabId) : pendingComposes.values().next().value;

        sendResponse({ analysisData: entry?.analysisData });
        return true;
    }

    if (message.action === 'replaceText') {
        handleReplaceText(message.tabId ? Number(message.tabId) : null);
        return false;
    }

    if (message.action === 'ignoreAndSend') {
        handleIgnoreAndSend(message.tabId ? Number(message.tabId) : null);
        return false;
    }

    if (message.action === 'cleanupTab') {
        // Clean up pending compose data for a specific tab
        if (message.tabId) {
            pendingComposes.delete(Number(message.tabId));
            extractedEmailStructures.delete(Number(message.tabId));
        }
        return false;
    }

    if (message.action === 'editOriginal') {
        handleEditOriginal(message.tabId ? Number(message.tabId) : null);
        return false;
    }

    return false;
}
async function handleIgnoreAndSend(tabId) {
    // Use tabId from parameter to get the correct entry
    const entry = tabId ? pendingComposes.get(tabId) : pendingComposes.values().next().value;
    if (!entry) {
        console.error('No pending compose tab');
        return;
    }

    const { tab } = entry;

    // Add tab to set of tabs to skip tone check on next send
    tabsToSkipCheck.add(tab.id);

    await browser.tabs.update(tab.id, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });

    pendingComposes.delete(tab.id);
    extractedEmailStructures.delete(tab.id);
    await browser.compose.sendMessage(tab.id);

    showNotification(
        'Email Sent',
        'Email sent successfully.'
    );
}

async function handleReplaceText(tabId) {
    // Use tabId from parameter to get the correct entry
    let entry, actualTabId;
    if (tabId && pendingComposes.has(tabId)) {
        entry = pendingComposes.get(tabId);
        actualTabId = tabId;
    } else {
        // P1c: No fallback - error out with console.error, never touch another tab
        console.error('No pending compose tab for tabId:', tabId);
        return;
    }
    
    if (!entry) {
        console.error('No pending compose tab');
        return;
    }
    const { tab, analysisData } = entry;

    if (!analysisData || !analysisData.rewrittenEmail) {
        console.error('No rewritten email to replace');
        return;
    }

    // Validate tab exists first
    try {
        await browser.tabs.get(tab.id);
    } catch (error) {
        console.error('Tab validation failed:', error);
        showNotification('Replace Failed', 'The compose window has been closed.');
        pendingComposes.delete(actualTabId);
        return;
    }

    try {
        await browser.tabs.update(tab.id, { active: true });
        await browser.windows.update(tab.windowId, { focused: true });

        // Get current compose details to get CURRENT body (with any user edits)
        const composeDetails = await browser.compose.getComposeDetails(tab.id);
        const currentBody = composeDetails.body;

        // Extract CURRENT email structure from the current body
        // This captures any manual edits the user made to quotes/signature
        const { quotedContent: currentQuoted, signatureContent: currentSignature, mainContent: currentMainContent } = extractEmailStructure(currentBody);

        // Get the originalMainContent that was sent to AI
        const extractedStructure = extractedEmailStructures.get(tab.id);
        const originalMainContent = extractedStructure?.originalMainContent || '';

        const rewriteWithoutFences = stripCodeFences(analysisData.rewrittenEmail);
        // Clean the rewritten email
        const knownQuotedText = currentQuoted ? currentQuoted.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : '';
        const cleanRewrittenEmail = filterQuotedRepliesWithContext(rewriteWithoutFences, knownQuotedText);
        
        // Parse current body to find target block for replacement
        const parser = new DOMParser();
        const currentDoc = parser.parseFromString(currentBody, 'text/html');
        
        // Check if both quotes and signature are empty - if so, use rewritten content as plain text
        const hasQuotes = currentQuoted && currentQuoted.trim().length > 0;
        const hasSignature = currentSignature && currentSignature.trim().length > 0;
        
        if (!hasQuotes && !hasSignature) {
            // No quotes or signature - output is just the rewritten content (plain text)
            await browser.compose.setComposeDetails(tab.id, { body: rewriteToBodyHtml(cleanRewrittenEmail) });
            pendingComposes.delete(actualTabId);
            extractedEmailStructures.delete(actualTabId);
            return;
        }
        
        // Find all <p> elements that are NOT inside blockquotes and NOT part of signature
        const allParagraphs = currentDoc.querySelectorAll('p');
        const candidateParagraphs = [];
        
        for (let i = 0; i < allParagraphs.length; i++) {
            const p = allParagraphs[i];
            // Skip if inside blockquote
            if (p.closest('blockquote')) {
                continue;
            }
            // Skip if inside signature
            if (p.closest('[class^="moz-signature"]') || (p.textContent.trim().startsWith('-- ') && currentSignature && currentSignature.includes(p.outerHTML))) {
                continue;
            }
            candidateParagraphs.push(p);
        }

        if (candidateParagraphs.length === 0) {
            // P1b: No candidate paragraphs - preserve quotes/signature, replace only main text
            // Build new body: rewrite + quotes + signature
            let newBody = rewriteToParagraphs(cleanRewrittenEmail);
            if (currentQuoted && currentQuoted.trim().length > 0) {
                newBody += currentQuoted;
            }
            if (currentSignature && currentSignature.trim().length > 0) {
                newBody += currentSignature;
            }
            await browser.compose.setComposeDetails(tab.id, { body: newBody });
            pendingComposes.delete(actualTabId);
            extractedEmailStructures.delete(actualTabId);
            return;
        }

        // Try to find the target paragraph by matching normalized text content
        let targetParagraph = null;
        let replaced = false;

        if (originalMainContent && originalMainContent.trim().length > 0) {
            // P2b: Parse originalMainContent to get individual paragraphs for matching
            const origDoc = new DOMParser().parseFromString(originalMainContent, 'text/html');
            const origParagraphs = origDoc.querySelectorAll('p');
            
            for (let i = 0; i < candidateParagraphs.length; i++) {
                const p = candidateParagraphs[i];
                const pText = p.textContent
                    .replace(/&nbsp;/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                
                // Check each paragraph in originalMainContent (P2b: decoded comparison)
                for (let j = 0; j < origParagraphs.length; j++) {
                    const origPText = origParagraphs[j].textContent
                        .replace(/&nbsp;/g, ' ')
                        .replace(/&amp;/g, '&')
                        .replace(/\s+/g, ' ')
                        .trim();
                    
                    if (pText.includes(origPText) || origPText.includes(pText)) {
                        targetParagraph = p;
                        break;
                    }
                }
                if (targetParagraph) break;
            }
        }

        // Fallback: use first candidate paragraph if no match found
        if (!targetParagraph) {
            targetParagraph = candidateParagraphs[0];
        }

        // P2d: Replace the target paragraph(s) - build fragment, preserve attributes, no double-wrapping
        if (targetParagraph) {
            const finalRewrite = rewriteToParagraphs(cleanRewrittenEmail);
            // The HTML parser already consumed any outer <html>/<body> wrapper
            const rewriteBody = new DOMParser().parseFromString(finalRewrite, 'text/html').body;
            
            // P2d: Build fragment from rewrite body children
            const fragment = currentDoc.createDocumentFragment();
            const children = Array.from(rewriteBody.childNodes);
            children.forEach(child => fragment.appendChild(child.cloneNode(true)));
            
            // P2d: Preserve target's attributes on first element, remove all matching paragraphs
            const allTargetParagraphs = [];
            if (originalMainContent && originalMainContent.trim().length > 0) {
                // P2b: Parse originalMainContent to get individual paragraphs for matching
                const origDoc = new DOMParser().parseFromString(originalMainContent, 'text/html');
                const origParagraphs = origDoc.querySelectorAll('p');
                const candidateParagraphs = currentDoc.querySelectorAll('p:not(blockquote p):not([class^="moz-signature"])');
                for (let i = 0; i < candidateParagraphs.length; i++) {
                    const p = candidateParagraphs[i];
                    const pText = p.textContent.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
                    // P2b: Check each paragraph in originalMainContent (decoded comparison)
                    for (let j = 0; j < origParagraphs.length; j++) {
                        const origPText = origParagraphs[j].textContent
                            .replace(/&nbsp;/g, ' ')
                            .replace(/&amp;/g, '&')
                            .replace(/\s+/g, ' ')
                            .trim();
                        if (pText.includes(origPText) || origPText.includes(pText)) {
                            allTargetParagraphs.push(p);
                            break;
                        }
                    }
                }
            }
            
            if (allTargetParagraphs.length > 0) {
                // P2d: Replace first with fragment (preserving attributes on first element)
                const firstTarget = allTargetParagraphs[0];
                const firstFragmentChild = fragment.firstChild;
                if (firstFragmentChild && firstFragmentChild.nodeType === 1) {
                    // Carry over style/class/dir from target
                    if (firstTarget.style.length > 0) {
                        firstFragmentChild.setAttribute('style', firstTarget.style.cssText);
                    }
                    if (firstTarget.className) {
                        firstFragmentChild.className = firstTarget.className;
                    }
                    if (firstTarget.getAttribute('dir')) {
                        firstFragmentChild.setAttribute('dir', firstTarget.getAttribute('dir'));
                    }
                }
                firstTarget.replaceWith(fragment);
                // Remove remaining target paragraphs
                for (let i = 1; i < allTargetParagraphs.length; i++) {
                    allTargetParagraphs[i].remove();
                }
            } else {
                // Fallback: replace first candidate
                targetParagraph.replaceWith(fragment);
            }
            
            await browser.compose.setComposeDetails(tab.id, { body: currentDoc.body.innerHTML });
            replaced = true;
        }

    } catch (error) {
        console.error('Error replacing email text:', error);
        showNotification('Replace Failed', error.message || 'Could not replace email text.');
    } finally {
        pendingComposes.delete(actualTabId);
        extractedEmailStructures.delete(actualTabId);
    }
}

async function handleEditOriginal(tabId) {
    // Use tabId from parameter to get the correct entry
    const entry = tabId ? pendingComposes.get(tabId) : pendingComposes.values().next().value;
    if (!entry) {
        console.error('No pending compose tab');
        return;
    }

    const { tab } = entry;

    try {
        await browser.tabs.update(tab.id, { active: true });
        await browser.windows.update(tab.windowId, { focused: true });
    } catch (error) {
        console.error('Error returning to compose window:', error);
    } finally {

        pendingComposes.delete(tabId || tab.id);
        extractedEmailStructures.delete(tabId || tab.id);
    }
}

function showNotification(title, message) {
    browser.notifications.create({
        type: 'basic',
        iconUrl: browser.runtime.getURL('icons/icon-48.png'),
        title: title,
        message: message
    }).catch(error => {
        console.error('Error showing notification:', error);
    });
}

// Export functions for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        filterMozElements,
        filterQuotedReplies,
        isUnmodifiedForward,
        handleOnBeforeSend,
        extractEmailContent,
        openDialogWindow,
        extractEmailStructure,
        handleReplaceText,
        pendingComposes,
        extractedEmailStructures
    };
}
initialize();
