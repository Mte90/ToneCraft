# ToneCraft

## Description
ToneCraft is a Thunderbird extension that detects (and blocks) unprofessional language in outgoing emails and suggests polite alternatives.
It helps you maintain a courteous tone and avoid accidental rudeness.

PS: Extension tested also manually but it was written by: qwen3-coder-next, qwen3.5-122 and GLM-4.7 on OpenCode.

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

### Manual installation in Thunderbird
1. Open Thunderbird → Add‑ons → Extensions → Install Add‑on From File.
2. Select the folder `dist` generated after `npm run build` or the XPI file.

### Installing from XPI file
1. Download `tonecraft.xpi` from the releases page.
2. In Thunderbird, go to Add‑ons → Extensions → Install Add‑on From File and choose the XPI.

## Configuration
Open the extension settings page via the gear icon in the Thunderbird toolbar.

### Set AI endpoint
Provide one of the following examples:
- OpenAI: `https://api.openai.com/v1/chat/completions`
- Ollama: `http://localhost:11434/api/chat`

### Enter API key
Paste your API key in the "API Key" field. The key is stored only in your local browser profile.

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
Your API key never leaves your computer. It is stored locally in the extension storage and is not sent to any third‑party server.
