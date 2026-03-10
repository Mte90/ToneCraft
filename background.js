/**
 * Background script for ToneCraft Thunderbird extension
 * Intercepts outgoing emails and checks tone using AI
 */

// Track consecutive API failures for graceful degradation
let consecutiveApiFailures = 0;

// Pending compose operations indexed by tab ID
const pendingComposes = new Map();
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

    try {

        const settings = await browser.storage.local.get({
            apiEndpoint: '',
            apiKey: '',
            model: '',
            enabled: true,
            checkedAccounts: [],
            customPrompt: ''
        });

        if (!settings.enabled || !settings.apiKey) {
            console.log('Tone check skipped - extension disabled or no API key');
            return undefined;
        }

        // Get sender account ID from compose details
        const composeDetails = await browser.compose.getComposeDetails(tab.id);
        const identityId = composeDetails.identityId;
        // Find the account that contains this identity
        const accounts = await browser.accounts.list();
        const senderAccountId = accounts.find(acc => acc.identities?.some(id => id.id === identityId))?.id;
        
        // Skip tone check if account is NOT in checkedAccounts (allowlist)
        // If checkedAccounts is empty, check all accounts (default behavior)
        if (settings.checkedAccounts.length > 0 && !settings.checkedAccounts.includes(senderAccountId)) {
            return undefined;
        }

        const emailContent = await extractEmailContent(tab, details, composeDetails);
        const result = await checkTone(emailContent, settings);

        if (!result.success) {
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
                
                await openDialogWindow();
                return { cancel: true };
            }
            
            // Account is not configured - graceful degradation with notification
            showNotification(
                'AI Check Failed',
                'AI check failed. Sending anyway. Error: ' + result.error
            );
            
            if (consecutiveApiFailures >= 2) {
                showNotification(
                    'AI Check Failed',
                    'Multiple API failures occurred. Check your API settings. Email will be sent without tone check.'
                );
            } else {
                showNotification(
                    'AI Check Failed',
                    'Could not check email tone: ' + result.error + '. Email will be sent without tone check.'
                );
            }
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
        const extractedStructure = window.extractedEmailStructure ? window.extractedEmailStructure[tab.id] : null;
        
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

        await openDialogWindow();

        return { cancel: true };

    } catch (error) {
        console.error('Error in onBeforeSend handler:', error);
        consecutiveApiFailures++;
        
            // If account is configured (in checkedAccounts), block send on error
            if (senderAccountId && settings.checkedAccounts.includes(senderAccountId)) {
                
                // Get extracted structure for this tab (if available)
                const extractedStructure = window.extractedEmailStructure ? window.extractedEmailStructure[tab.id] : null;
                
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
            
            await openDialogWindow();
            return { cancel: true };
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
                window.extractedEmailStructure = window.extractedEmailStructure || {};
                window.extractedEmailStructure[tab.id] = {
                    originalQuotedContent: quotedContent,
                    originalSignatureContent: signatureContent,
                    originalMainContent: mainContent
                };
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
        
        // Extract quoted content (blockquotes - handle nested quotes)
        const blockquotes = workingDoc.querySelectorAll('blockquote');
        let quotedContent = '';
        for (let i = 0; i < blockquotes.length; i++) {
            quotedContent += blockquotes[i].outerHTML;
        }
        
        // Extract signature content (moz- signature elements)
        const mozSignatures = workingDoc.querySelectorAll('[class^="moz-signature"]');
        let signatureContent = '';
        for (let i = 0; i < mozSignatures.length; i++) {
            signatureContent += mozSignatures[i].outerHTML;
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

async function openDialogWindow() {
    try {
        const windows = await browser.windows.getAll();
        const dialogWindow = windows.find(w => w.type === 'popup');

        if (dialogWindow) {
            await browser.windows.update(dialogWindow.id, { focused: true });
        } else {
            await browser.windows.create({
                url: 'dialog/dialog.html',
                type: 'popup',
                state: 'maximized'
            });
        }
    } catch (error) {
        console.error('Error opening dialog window:', error);
        showNotification(
            'Dialog Error',
            'Could not open tone analysis dialog.'
        );
    }
}

function handleMessage(message, sender, sendResponse) {
    if (message.action === 'getAnalysisData') {

        // Get the first (most recent) compose data
        const firstEntry = pendingComposes.values().next().value;
        sendResponse({ analysisData: firstEntry?.analysisData });
        return true;
    }

    if (message.action === 'replaceText') {
        handleReplaceText();
        return false;
    }

    if (message.action === 'ignoreAndSend') {
        handleIgnoreAndSend();
        return false;
    }

    return false;
}
async function handleIgnoreAndSend() {
    const firstEntry = pendingComposes.values().next().value;
    if (!firstEntry) {
        console.error('No pending compose tab');
        return;
    }

    const { tab } = firstEntry;

    // Add tab to set of tabs to skip tone check on next send
    tabsToSkipCheck.add(tab.id);

    await browser.tabs.update(tab.id, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });

    pendingComposes.delete(tab.id);
    await browser.compose.sendMessage(tab.id);

    showNotification(
        'Email Sent',
        'Email sent successfully.'
    );
}

async function handleReplaceText() {
    // Get the MOST RECENT entry (last added) instead of oldest
    const entries = Array.from(pendingComposes.entries());
    const lastEntry = entries.pop();
    if (!lastEntry) {
        console.error('No pending compose tab');
        return;
    }
    const [tabId, entry] = lastEntry;
    const { tab, analysisData } = entry;

    if (!analysisData || !analysisData.rewrittenEmail) {
        console.error('No rewritten email to replace');
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
        const { quotedContent: currentQuoted, signatureContent: currentSignature } = extractEmailStructure(currentBody);

        // Get the originalMainContent that was sent to AI
        const extractedStructure = window.extractedEmailStructure && window.extractedEmailStructure[tab.id];
        const originalMainContent = extractedStructure?.originalMainContent || '';

        // Clean the rewritten email
        const cleanRewrittenEmail = filterQuotedReplies(analysisData.rewrittenEmail);

        // Normalize for comparison (handle &nbsp; vs space)
        const normalizedOriginal = originalMainContent.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        const normalizedBody = currentBody.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

        // Try simple replace with regex to handle whitespace differences
        let reconstructedBody = currentBody;
        let replaced = false;

        if (originalMainContent && originalMainContent.trim().length > 0 && normalizedBody.includes(normalizedOriginal)) {
            // Extract text content from originalMainContent for matching
            const originalText = originalText = new DOMParser().parseFromString(originalMainContent, 'text/html').body.textContent || '';
            tempDiv.innerHTML = currentBody;
            const currentText =new DOMParser().parseFromString(currentBody, 'text/html').body.textContent || '';

            // Find position of original text in current body
            const textIndex = currentText.indexOf(originalText.trim());
            if (textIndex >= 0) {
                // Found it - now replace the HTML tag containing this text
                // Use a simpler approach: replace the entire tag block
                const tagRegex = /<p[^>]*>.*?<\/p>/is;
                reconstructedBody = currentBody.replace(tagRegex, '<p>' + cleanRewrittenEmail + '</p>');
                replaced = true;
            }
        }

        // Update the body
        await browser.compose.setComposeDetails(tab.id, { body: reconstructedBody });
    } catch (error) {
        console.error('Error replacing email text:', error);
    } finally {
        pendingComposes.delete(tab.id);
    }
}

async function handleEditOriginal() {
    const firstEntry = pendingComposes.values().next().value;
    if (!firstEntry) {
        console.error('No pending compose tab');
        return;
    }

    const { tab } = firstEntry;

    try {
        await browser.tabs.update(tab.id, { active: true });
        await browser.windows.update(tab.windowId, { focused: true });
    } catch (error) {
        console.error('Error returning to compose window:', error);
    } finally {
        pendingComposes.delete(tab.id);
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

async function checkTone(emailContent, settings, retryCount = 0) {
    if (!settings.apiEndpoint || !settings.apiKey || !settings.model) {
        return {
            success: false,
            error: 'Missing required settings: apiEndpoint, apiKey, or model'
        };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
        const response = await fetch(settings.apiEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${settings.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: settings.model,
                messages: [
                    {
                        role: 'system',
                        content: ((settings.customPrompt ? settings.customPrompt + '\n\n' : '') + 'Analyze the email text to determine its language, then respond in that same language. Provide ONLY email body content, NO signatures, NO closing clauses, NO placeholder signatures. Return your analysis as JSON with these fields: isProfessional (boolean), problems (array of strings), rewrittenEmail (string), suggestions (array of strings).'),
                    },
                    {
                        role: 'user',
                        content: `Analyze the tone of this email and suggest improvements:\n\n${emailContent}`
                    }
                ]
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            // Don't expose API key in error messages
            return {
                success: false,
                error: `API error ${response.status}: ${errorText || response.statusText}`
            };
        }

        let jsonResponse;
        try {
            jsonResponse = await response.json();
        } catch (parseError) {
            return {
                success: false,
                error: `Failed to parse JSON response: ${parseError.message}`
            };
        }

        // OpenAI format: response.choices[0].message.content
        // Some APIs return content directly
        let aiContent;
        if (jsonResponse.choices && jsonResponse.choices[0] && jsonResponse.choices[0].message) {
            aiContent = jsonResponse.choices[0].message.content;
        } else if (jsonResponse.content) {
            aiContent = jsonResponse.content;
        } else {
            return {
                success: false,
                error: 'Unexpected API response format'
            };
        }

        let parsedContent;
        try {
            const cleanContent = aiContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            parsedContent = JSON.parse(cleanContent);
        } catch (parseError) {
            return {
                success: false,
                error: `Failed to parse AI response content: ${parseError.message}`
            };
        }

        const requiredFields = ['isProfessional', 'problems', 'rewrittenEmail', 'suggestions'];
        for (const field of requiredFields) {
            if (!(field in parsedContent)) {
                return {
                    success: false,
                    error: `Missing required field in AI response: ${field}`
                };
            }
        }

        // Success - reset failure counter
        consecutiveApiFailures = 0;

        return {
            success: true,
            data: {
                isProfessional: parsedContent.isProfessional,
                problems: parsedContent.problems,
                rewrittenEmail: parsedContent.rewrittenEmail,
                suggestions: parsedContent.suggestions
            }
        };

    } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
            // Retry once on timeout
            if (retryCount === 0) {
                console.log('API timeout - retrying...');
                return checkTone(emailContent, settings, retryCount + 1);
            }
            return {
                success: false,
                error: 'Request timeout: API did not respond within 10 seconds',
                isTimeout: true
            };
        }

        if (error.name === 'TypeError' && (error.message.includes('fetch') || error.message.includes('Network'))) {
            return {
                success: false,
                error: 'Network error: Could not connect to API server',
                isNetworkError: true
            };
        }

        return {
            success: false,
            error: `Unexpected error: ${error.message}`
        };
    }
}

// Export functions for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        filterMozElements,
        filterQuotedReplies,
        handleOnBeforeSend,
        checkTone,
        extractEmailContent,
        openDialogWindow,
        extractEmailStructure,
        handleReplaceText,
        pendingComposes
    };
}
initialize();
