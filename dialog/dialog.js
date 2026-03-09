// dialog/dialog.js - Dialog UI logic for tone analysis results

let analysisData = null;

// Receive analysis data from background script
browser.runtime.sendMessage({ action: 'getAnalysisData' }, (response) => {
  if (browser.runtime.lastError) {
    console.error('Error receiving analysis data:', browser.runtime.lastError.message);
    return;
  }
  
  analysisData = response.analysisData;
  renderDialog(analysisData);
});

// Render the dialog with analysis data
function renderDialog(data) {
  if (!data) return;
  
  // Handle API error case
  if (data.status === 'ApiError') {
    renderApiError(data);
    return;
  }
  
  // Display status section
  const statusSection = document.getElementById('statusSection');
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  
  if (statusSection) {
    statusSection.className = 'status-area ' + (data.status === 'Professional' ? 'professional' : 'unprofessional');
  }
  
  if (statusText) {
    if (data.status === 'Professional') {
      statusText.textContent = '✅ Professional';
    } else if (data.status === 'Unprofessional') {
      statusText.textContent = '😟 Unprofessional';
    } else {
      statusText.textContent = data.status;
    }
  }
  
  // Render problems list
  const problemsList = document.getElementById('problems');
  if (problemsList && data.problems && data.problems.length > 0) {
    problemsList.innerHTML = '';
    data.problems.forEach(problem => {
      const li = document.createElement('li');
      li.textContent = problem;
      problemsList.appendChild(li);
    });
  } else if (problemsList) {
    problemsList.innerHTML = '';
    const li = document.createElement('li');
    li.textContent = 'No problems detected';
    problemsList.appendChild(li);
  }
  
  // Display rewritten email
  const rewrittenDiv = document.getElementById('rewritten');
  if (rewrittenDiv && data.rewrittenEmail) {
    rewrittenDiv.textContent = data.rewrittenEmail;
  } else if (rewrittenDiv) {
    rewrittenDiv.textContent = 'No rewritten email available';
  }
}

// Render API error dialog
function renderApiError(data) {
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const problemsList = document.getElementById('problems');
  const rewrittenDiv = document.getElementById('rewritten');
  const sectionTitles = document.querySelectorAll('.section-title');
  const replaceButton = document.getElementById('replaceButton');
  const ignoreButton = document.getElementById('ignoreButton');
  
  // Update status to show error
  if (statusIndicator) {
    statusIndicator.textContent = 'API Error';
    statusIndicator.className = 'unprofessional';
  }
  
  // Update status text
  if (statusText) {
    statusText.textContent = 'API Check Failed';
  }
  
  // Show error message in problems list
  if (problemsList) {
    problemsList.innerHTML = '';
    const li = document.createElement('li');
    li.textContent = data.error || 'Unknown error occurred during tone check';
    problemsList.appendChild(li);
  }
  
  // Clear rewritten email section
  if (rewrittenDiv) {
    rewrittenDiv.textContent = 'No rewritten email available due to API error';
  }
  
  // Update section titles
  if (sectionTitles.length >= 2) {
    sectionTitles[0].textContent = 'Error Details';
    sectionTitles[1].textContent = 'Status';
  }
  
  // Hide replace button for API errors, only show Send Anyway
  if (replaceButton) {
    replaceButton.style.display = 'none';
  }
  
  // Update ignore button text for clarity
  if (ignoreButton) {
    ignoreButton.textContent = 'Send Anyway';
  }
}

// Copy rewritten email to clipboard
function copyToClipboard() {
  if (!analysisData || !analysisData.rewrittenEmail) {
    console.warn('No rewritten email to copy');
    return;
  }
  
  navigator.clipboard.writeText(analysisData.rewrittenEmail).then(() => {
    console.log('Copied rewritten email to clipboard');
  }).catch(err => {
    console.error('Failed to copy to clipboard:', err);
  });
}

// Signal to return to compose (edit original)
function signalEditOriginal() {
  browser.runtime.sendMessage({ action: 'editOriginal' }).then(() => {
    window.close();
  }).catch(err => {
    console.error('Error sending editOriginal signal:', err);
    window.close();
  });
}

// Signal to send email anyway (ignore warnings)
function signalIgnoreAndSend() {
  browser.runtime.sendMessage({ action: 'ignoreAndSend' }).then(() => {
    window.close();
  }).catch(err => {
    console.error('Error sending ignoreAndSend signal:', err);
    window.close();
  });
}

// Close the dialog window
function closeDialog() {
  window.close();
}

// Event listeners for buttons
// Replace Text button - send rewritten text to compose window
document.getElementById('replaceButton').addEventListener('click', () => {
  browser.runtime.sendMessage({ action: 'replaceText' }).then(() => {
    window.close();
  }).catch(err => {
    console.error('Error sending replaceText signal:', err);
    window.close();
  });
});
// Send Anyway button - send email without modifications
document.getElementById('ignoreButton').addEventListener('click', () => {
  browser.runtime.sendMessage({ action: 'ignoreAndSend' }).then(() => {
    window.close();
  }).catch(err => {
    console.error('Error sending ignoreAndSend signal:', err);
    window.close();
  });
});

