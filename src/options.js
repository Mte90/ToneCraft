/**
 * Storage module for options/settings
 * Provides save/load functions for browser.storage.local
 */

/**
 * Load settings from browser.storage.local
 * @returns {Promise<Object>} - Settings object with apiKey, aiHost, modelName, customPrompt, checkedAccounts, defaultPrompt
 */
async function loadSettings() {
  try {
    const result = await browser.storage.local.get({
      apiKey: '',
      aiHost: '',
      modelName: '',
      customPrompt: '',
      checkedAccounts: [],
      defaultPrompt: ''
    });
    return result;
  } catch (error) {
    throw new Error(`Error loading settings: ${error.message}`);
  }
}

/**
 * Save settings to browser.storage.local
 * @param {Object} settings - Settings object to save
 * @param {string} settings.apiKey - OpenAI API key
 * @param {string} settings.aiHost - AI API host URL
 * @param {string} settings.modelName - Model name to use
 * @param {string} settings.customPrompt - Custom prompt for AI
 * @returns {Promise<void>}
 */
async function saveSettings(settings) {
  try {
    await browser.storage.local.set(settings)
  } catch (error) {
    throw new Error(`Error saving settings: ${error.message}`);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { loadSettings, saveSettings };
}
