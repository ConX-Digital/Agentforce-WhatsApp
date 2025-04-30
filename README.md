# Agentforce-WhatsApp Integration

A real-time WhatsApp voice message integration using Salesforce Marketing Cloud, Einstein Bot, Node.js, AWS S3, and AssemblyAI.

This solution allows Salesforce agents to receive and respond to WhatsApp messages (including voice messages) via Salesforce Agentforce using an intelligent middleware.

---

## 🧩 System Components

This integration consists of three coordinated services:

### 1. `ENS Handler.ssjs` (Marketing Cloud CloudPage)
- Listens to WhatsApp OTT events.
- Routes **text messages** directly to Agentforce.
- Routes **audio messages** to the Node.js server for transcription.

### 2. `index.js` (Node.js App)
- Downloads audio using OTT Media API.
- Converts `.ogg`/`.opus` audio to `.mp3` using FFmpeg.
- Uploads to AWS S3 and gets a public URL.
- Sends the URL to AssemblyAI for transcription.
- Logs transcription to Marketing Cloud Data Extension.
- Forwards transcribed text to Agentforce API.

### 3. `Agentforce.ssjs` (Marketing Cloud Script)
- Manages Salesforce Einstein Bot sessions.
- Sends messages to bots and handles responses.
- Sends WhatsApp replies back using OTT messaging via Marketing Cloud.

---

## 🧱 Project Structure

```plaintext
.
├── index.js               # Main Node.js server and audio handler
├── ENS Handler.ssjs       # Hosted on CloudPage (for OTT event ingestion)
├── Agentforce.ssjs        # Runs server-side in MC to talk to Einstein Bot
├── package.json           # Node.js dependencies
├── package-lock.json      # Locked versions of dependencies
```

---

## ⚙️ Environment Setup

### Node.js (.env file)
```env
# Marketing Cloud OAuth
MC_AUTH_URL=https://your-subdomain.auth.marketingcloudapis.com/v2/token
MC_CLIENT_ID=your_client_id
MC_CLIENT_SECRET=your_client_secret
MC_ACCOUNT_ID=your_account_id
MC_REST_URL=https://your-subdomain.rest.marketingcloudapis.com

# AWS S3
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_REGION=your_region
S3_BUCKET=your_bucket_name

# AssemblyAI
ASSEMBLYAI_API_KEY=your_assemblyai_key

# Agentforce Endpoint
DESTINATION_API=https://your-agentforce-endpoint.com/agentforce-api

PORT=3000
```

---

## ☁️ Deployment Notes

> ⚠️ **Note:** This repository only contains the Node.js server (`index.js`).
> The following files must be deployed manually to Salesforce Marketing Cloud:
> - `ENS Handler.ssjs` → hosted as a CloudPage or Script Activity (OTT Webhook)
> - `Agentforce.ssjs` → hosted as a CloudPage for routing to Einstein Bot
> These are not Node.js files and cannot run locally.

## 🚀 Running Locally

```bash
npm install
node index.js
```

Use a tool like **ngrok** to expose your local server if needed:
```bash
ngrok http 3000
```

---

## 🔄 End-to-End Flow

1. **User sends a voice/text message via WhatsApp**
2. **Marketing Cloud OTT webhook** triggers `ENS Handler.ssjs`
3. `ENS Handler.ssjs`:
   - Forwards audio messages to `/upload-audio` (Node.js)
   - Sends text messages directly to `Agentforce.ssjs`
4. `index.js`:
   - Downloads, converts, uploads, and transcribes the voice message
   - Logs to Marketing Cloud DE
   - Forwards transcription to Agentforce
5. `Agentforce.ssjs`:
   - Manages Einstein Bot sessions
   - Sends message to Bot and receives dynamic response
   - Sends back WhatsApp response using OTT messaging

---

## ✅ Data Extensions Required

- `Contact_Sessions` – stores `contactId` to `sessionId` mapping for Einstein Bot sessions.
- `TranscribedAudio_Log` – stores voice transcription logs.

---


## 👨‍💻 Maintainer

Developed and maintained by [ConX Digital](https://conx.digital).  
Need help or want a custom integration? Contact us for enterprise support.
