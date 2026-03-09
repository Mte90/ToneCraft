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
 * @returns {Promise<Object>} - Result object with:
 *   - {boolean} success - Whether the request succeeded
 *   - {Object} data - Parsed response data if successful
 *   - {string} error - Error message if failed
 */
async function checkTone(emailContent, settings) {
    // Validate settings
    if (!settings.apiEndpoint || !settings.apiKey || !settings.model) {
        return errorResponse('Missing required settings: apiEndpoint, apiKey, or model');
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
                        content: 'You are a helpful assistant that analyzes email tone. Return your analysis as JSON with these fields: isProfessional (boolean), problems (array of strings), rewrittenEmail (string), suggestions (array of strings).'
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
            return errorResponse(`HTTP error ${response.status}: ${errorText || response.statusText}`);
        }

        let jsonResponse;
        try {
            jsonResponse = await response.json();
        } catch (parseError) {
            return errorResponse(`Failed to parse JSON response: ${parseError.message}`);
        }

        const aiContent = extractAIContent(jsonResponse);
        
        let parsedContent;
        try {
            parsedContent = parseAIResponse(aiContent);
        } catch (parseError) {
            return errorResponse(`Failed to parse AI response content: ${parseError.message}`);
        }

        return {
            success: true,
            data: parsedContent
        };

    } catch (error) {
        clearTimeout(timeoutId);
        return handleFetchError(error);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { checkTone };
}

// Helper for consistent error responses
const errorResponse = (message) => ({ success: false, error: message });

// Helper to handle fetch errors with proper timeout/network handling
const handleFetchError = (error) => {
    if (error.name === 'AbortError') {
        return errorResponse('Request timeout: API did not respond within 10 seconds');
    }

    if (error.name === 'TypeError' && error.message.includes('fetch')) {
        return errorResponse(`Network error: ${error.message}`);
    }

    return errorResponse(`Unexpected error: ${error.message}`);
};

// Helper to extract AI content from various response formats
const extractAIContent = (response) => {
    if (response.choices?.[0]?.message?.content) {
        return response.choices[0].message.content;
    }
    if (response.content) return response.content;
    throw new Error('Unexpected API response format');
};

// Helper to parse and validate AI response
const parseAIResponse = (content) => {
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    
    const requiredFields = ['isProfessional', 'problems', 'rewrittenEmail', 'suggestions'];
    const missing = requiredFields.find(field => !(field in parsed));
    if (missing) {
        throw new Error(`Missing required field: ${missing}`);
    }
    
    return parsed;
};
