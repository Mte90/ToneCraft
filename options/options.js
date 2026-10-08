// DOM content loaded event listener
document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('saveBtn');
  const statusArea = document.getElementById('statusArea');
  const accountsContainer = document.getElementById('account-filter');

  // Load settings from browser.storage.local on page load
  loadSettings();

  loadAccountFilter();
  loadWhitelist();
  
  // Save button click handler
  saveBtn.addEventListener('click', () => {
    saveSettings();
  });

  // Add whitelist email button handler
  const addWhitelistBtn = document.getElementById('addWhitelistBtn');
  if (addWhitelistBtn) {
    addWhitelistBtn.addEventListener('click', addWhitelistEmail);
  }

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

  // Whitelist management functions
  async function loadWhitelist() {
    try {
      const { recipientWhitelist = [] } = await browser.storage.local.get({
        recipientWhitelist: []
      });
      renderWhitelist(recipientWhitelist);
    } catch (error) {
      console.error('Error loading whitelist:', error);
      showStatus('Error loading whitelist: ' + error.message, 'error');
    }
  }

  function renderWhitelist(recipientWhitelist) {
    const listContainer = document.getElementById('whitelistList');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    if (recipientWhitelist.length === 0) {
      listContainer.innerHTML = '<div class="help-text">No whitelisted recipients yet</div>';
      return;
    }

    recipientWhitelist.forEach((email) => {
      const item = document.createElement('div');
      item.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 4px 0;';
      
      const emailSpan = document.createElement('span');
      emailSpan.textContent = email;
      emailSpan.style.flex = '1';
      
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '✕';
      removeBtn.style.cssText = 'background: none; border: none; color: #dc3545; cursor: pointer; font-size: 16px; padding: 0 4px;';
      removeBtn.title = 'Remove from whitelist';
      removeBtn.addEventListener('click', () => removeWhitelistEmail(email));
      
      item.appendChild(emailSpan);
      item.appendChild(removeBtn);
      listContainer.appendChild(item);
    });
  }

  function addWhitelistEmail() {
    const input = document.getElementById('whitelistEmail');
    if (!input) return;

    const email = input.value.trim().toLowerCase();

    // Validate email
    if (!email) {
      showStatus('Please enter an email address', 'error');
      return;
    }

    if (!email.includes('@')) {
      showStatus('Invalid email format (must contain @)', 'error');
      return;
    }

    // Load current whitelist, add email if not present, save, re-render
    browser.storage.local.get({ recipientWhitelist: [] }).then(({ recipientWhitelist }) => {
      const whitelist = (recipientWhitelist || []).map(e => e.toLowerCase());
      
      // Dedupe
      if (whitelist.includes(email)) {
        showStatus('Email already in whitelist', 'error');
        return;
      }

      whitelist.push(email);
      
      browser.storage.local.set({ recipientWhitelist: whitelist }).then(() => {
        showStatus('Email added to whitelist', 'success');
        loadWhitelist();
        input.value = '';
      }).catch((error) => {
        showStatus('Error saving whitelist: ' + error.message, 'error');
      });
    });
  }

  async function removeWhitelistEmail(emailToRemove) {
    try {
      const { recipientWhitelist = [] } = await browser.storage.local.get({
        recipientWhitelist: []
      });
      
      const whitelist = recipientWhitelist.filter(
        (email) => email.toLowerCase() !== emailToRemove.toLowerCase()
      );
      
      await browser.storage.local.set({ recipientWhitelist: whitelist });
      showStatus('Email removed from whitelist', 'success');
      loadWhitelist();
    } catch (error) {
      showStatus('Error removing from whitelist: ' + error.message, 'error');
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
        customPrompt: customPrompt,
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
