// DOM content loaded event listener
document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('saveBtn');
  const statusArea = document.getElementById('statusArea');
  const accountsContainer = document.getElementById('account-filter');

  // Load settings from browser.storage.local on page load
  loadSettings();

  loadAccountFilter();
  
  // Save button click handler
  saveBtn.addEventListener('click', () => {
    saveSettings();
  });

  // Load stored account identifiers and populate text input
  async function loadAccountFilter() {
    try {
      // Retrieve stored checked account IDs
      const { checkedAccounts = [] } = await browser.storage.local.get({
        checkedAccounts: []
      });
      
      // Get the list of available accounts via Thunderbird API
      const accounts = await browser.accounts.list();
      
      // Replace the text input with a container for checkboxes
      const placeholder = document.getElementById('account-filter');
      if (!placeholder) {
        console.error('account-filter element not found!');
        return;
      }
      
      const container = document.createElement('div');
      container.id = 'account-filter';
      
      // Create a checkbox for each account
      accounts.forEach((account) => {
        const label = document.createElement('label');
        label.style.display = 'block';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = account.id;
        // Pre-select if stored
        checkbox.checked = checkedAccounts.includes(account.id);
        // Get name and email from first identity
        const name = account.identities && account.identities[0] ? account.identities[0].name : null;
        const email = account.identities && account.identities[0] ? account.identities[0].email : null;
        const labelText = name && email ? `${name} <${email}>` : (name || email || account.id);
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(' ' + labelText));
        container.appendChild(label);
      });
      
      placeholder.replaceWith(container);
      
      // Attach change listener to save selections
      container.addEventListener('change', saveCheckedAccounts);
    } catch (error) {
      console.error('Error loading account filter:', error);
      const statusArea = document.getElementById('statusArea');
      if (statusArea) {
        statusArea.textContent = 'Error loading account filter: ' + error.message;
        statusArea.className = 'error';
      }
    }
  }

  // Save account identifiers from text input to storage
  function saveCheckedAccounts() {
    try {
      const container = document.getElementById('account-filter');
      if (!container) return;
      const checkboxes = container.querySelectorAll('input[type=checkbox]');
      const checked = Array.from(checkboxes)
        .filter((cb) => cb.checked)
        .map((cb) => cb.value);
      // Save the selected account IDs
      browser.storage.local.set({ checkedAccounts: checked }).catch((error) => {
        showStatus('Error saving account filter: ' + error.message, 'error');
      });
    } catch (error) {
      showStatus('Error saving account filter: ' + error.message, 'error');
    }
  }

  // Load settings function
  function loadSettings() {
    try {
      browser.storage.local.get({
        apiKey: '',
        apiEndpoint: '',
        model: '',
        aiHost: '',
        modelName: '',
        customPrompt: ''
      }).then((result) => {
        // Use new keys if available, fallback to old keys
        const apiEndpoint = result.apiEndpoint || result.aiHost || '';
        const model = result.model || result.modelName || '';
        // Populate form fields with saved values
        document.getElementById('apiKey').value = result.apiKey || '';
        document.getElementById('apiEndpoint').value = apiEndpoint;
        document.getElementById('model').value = model;
        document.getElementById('customPrompt').value = result.customPrompt || '';
      }).catch((error) => {
        showStatus('Error loading settings: ' + error.message, 'error');
      });
    } catch (error) {
      showStatus('Error loading settings: ' + error.message, 'error');
    }
  }

  // Save settings function
  function saveSettings() {
    try {
      // Get form values
      const apiKey = document.getElementById('apiKey').value.trim();
      const apiEndpoint = document.getElementById('apiEndpoint').value.trim();
      const model = document.getElementById('model').value.trim();
      const customPrompt = document.getElementById('customPrompt').value.trim();

      // Save to browser.storage.local
      browser.storage.local.set({
        apiKey: apiKey,
        apiEndpoint: apiEndpoint,
        model: model,
      }).then(() => {
        showStatus('Settings saved successfully!', 'success');
      }).catch((error) => {
        showStatus('Error saving settings: ' + error.message, 'error');
      });
    } catch (error) {
      showStatus('Error saving settings: ' + error.message, 'error');
    }
  }

  // Show status message in status area
  function showStatus(message, type) {
    statusArea.textContent = message;
    statusArea.className = type;
    
    // Clear message after 3 seconds
    setTimeout(() => {
      statusArea.textContent = '';
      statusArea.className = '';
    }, 3000);
  }
});
