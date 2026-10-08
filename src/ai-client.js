/**
 * AI Client for tone checking
 * Makes HTTP requests to OpenAI-compatible API endpoints
 */

/**
 * Check the tone of an email content
 * @param {string} emailContent - The email text to analyze
 * @param {Object} settings - Configuration object with:
 *   - {string} apiEndpoint - The AI API endpoint URL
 *   - {string} apiKey - The API authentication key
 *   - {string} model - The model name to use
 * @param {number} retryCount - Current retry count (internal use)
 * @returns {Promise<Object>} - Result object with:
 *   - {boolean} success - Whether the request succeeded
 *   - {Object} data - Parsed response data if successful
 *   - {string} error - Error message if failed
 *   - {boolean} isTimeout - True if timeout error
 *   - {boolean} isNetworkError - True if network error
 */
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
            
            // HTTP 4xx - no retry, return immediately
            if (response.status >= 400 && response.status < 500) {
                return {
                    success: false,
                    error: `API error ${response.status}: ${errorText || response.statusText}`
                };
            }
            
            // HTTP 5xx - retry once after 3 seconds
            if (response.status >= 500 && retryCount === 0) {
                console.log(`API server error ${response.status} - retrying after 3s...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
                return checkTone(emailContent, settings, retryCount + 1);
            }
            
            // HTTP 5xx with retryCount === 1, or other unexpected status
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
            // Retry once on timeout after 3 seconds
            if (retryCount === 0) {
                console.log('API timeout - retrying after 3s...');
                await new Promise(resolve => setTimeout(resolve, 3000));
                return checkTone(emailContent, settings, retryCount + 1);
            }
            return {
                success: false,
                error: 'Request timeout: API did not respond within 10 seconds',
                isTimeout: true
            };
        }

        if (error.name === 'TypeError' && (error.message.includes('fetch') || error.message.includes('Network'))) {
            // Retry once on network error after 3 seconds
            if (retryCount === 0) {
                console.log('Network error - retrying after 3s...');
                await new Promise(resolve => setTimeout(resolve, 3000));
                return checkTone(emailContent, settings, retryCount + 1);
            }
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

// Dual export for both module and browser environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { checkTone };
} else {
    globalThis.checkTone = checkTone;
}