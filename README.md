# ToneCraft
[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](http://www.gnu.org/licenses/gpl-3.0)   

## Description
ToneCraft is a Thunderbird extension that detects (and blocks) unprofessional language in outgoing emails and suggests polite alternatives.
It helps you maintain a courteous tone and avoid accidental rudeness.

PS: Extension tested (also manually) but it was written by: qwen3-coder-next, qwen3.5-122 and GLM-4.7 on OpenCode.

<img width="1236" height="578" alt="Image" src="https://github.com/user-attachments/assets/05c88753-4ee8-4678-9b58-9ce5e3e3a4eb" />

Download: [https://addons.thunderbird.net/thunderbird/addon/tonecraft/](https://addons.thunderbird.net/thunderbird/addon/tonecraft/)

## Features
- Detect unprofessional tone in outgoing emails
- Provide suggested rewrites that are more polite
- "Ignore and Send Anyway" button to bypass the suggestion

## Installation

### Development with `web-ext`
```bash
git clone <repo-url>
cd ToneCraft
npm install
web-ext run
```

### Build and install
1. Run `npm run build` to produce `dist/tonecraft-1.0.2.xpi`.
2. Open Thunderbird → Add‑ons → Extensions → Install Add‑on From File.
3. Select the XPI file from the `dist` folder.

### Installing the published release
1. Open [the add-ons page](https://addons.thunderbird.net/thunderbird/addon/tonecraft/).
2. In Thunderbird, go to Add‑ons → Extensions → Install Add‑on From File and choose the downloaded XPI.

## Configuration
Open the extension settings page via the gear icon in the Thunderbird toolbar.

### Set AI endpoint
Provide one of the following examples:
- OpenAI: `https://api.openai.com/v1/chat/completions`
- Ollama: `http://localhost:11434/api/chat`

### Enter API key
Paste your API key in the "API Key" field. The key is stored only in your local browser profile.

**Note:** A non-empty API key is required. For local models like Ollama that do not require authentication, use a placeholder value (e.g., `ollama`).

### Choose model and prompt
Select a model (e.g., `gpt-4o`, `claude-3-sonnet`, `llama3`) and optionally edit the prompt that guides the tone suggestions.

## Usage
When you compose a new email and click **Send**, the extension analyses the text.

- If the tone is unprofessional, a warning appears with a suggested rewrite.
- You can click **Ignore and Send Anyway** to bypass the suggestion.

## Troubleshooting
- **Invalid API key** – Double‑check the key and the endpoint URL.
- **Timeout** – Ensure your network allows outgoing requests to the AI service.
- **No response** – Verify the model name is correct and the service is reachable.

## Privacy
Your API key is stored only in your local browser profile and is sent only to the AI endpoint you configure.
The text of the email message being analyzed is transmitted to that AI endpoint for processing.
The extension requests network permissions (`http://*/*`, `https://*/*`) to enable communication with your chosen AI service.
