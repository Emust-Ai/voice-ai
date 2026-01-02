# GPT Realtime Voice Agent on Azure

A real-time voice assistant that connects phone calls via Twilio to OpenAI's GPT-4o Realtime API, hosted on Azure.

## Architecture

```
Phone Call → Twilio → Azure App Service (WebSocket Server) → OpenAI Realtime API
                              ↓
                    Real-time Audio Streaming (bidirectional)
```

## Prerequisites

| Requirement | Details |
|-------------|---------|
| Twilio Account | With a purchased phone number |
| OpenAI API Key | With access to Realtime API (gpt-4o-realtime-preview) |
| Azure Account | For hosting |
| Node.js 18+ | Runtime for the server |
| Domain/SSL | Required for WebSocket (wss://) |

## Quick Start

### 1. Clone and Install

```bash
git clone <your-repo>
cd gpt-realtime-voice-agent
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your OpenAI API key
```

### 3. Run Locally

```bash
npm run dev
```

### 4. Test with ngrok (for local development)

```bash
ngrok http 8080
```

Use the ngrok HTTPS URL for Twilio webhook configuration.

## Deployment to Azure

### Option 1: Azure App Service (Recommended)

#### Prerequisites
- Azure CLI installed
- Azure subscription

#### Step-by-Step Deployment

1. **Login to Azure**
   ```bash
   az login
   ```

2. **Create Resource Group**
   ```bash
   az group create --name gpt-voice-agent-rg --location eastus
   ```

3. **Create App Service Plan (B1 or higher for WebSocket support)**
   ```bash
   az appservice plan create \
     --name gpt-voice-agent-plan \
     --resource-group gpt-voice-agent-rg \
     --sku B1 \
     --is-linux
   ```

4. **Create Web App**
   ```bash
   az webapp create \
     --name your-unique-app-name \
     --resource-group gpt-voice-agent-rg \
     --plan gpt-voice-agent-plan \
     --runtime "NODE:18-lts"
   ```

5. **Enable WebSockets**
   ```bash
   az webapp config set \
     --name your-unique-app-name \
     --resource-group gpt-voice-agent-rg \
     --web-sockets-enabled true
   ```

6. **Configure Environment Variables**
   ```bash
   az webapp config appsettings set \
     --name your-unique-app-name \
     --resource-group gpt-voice-agent-rg \
     --settings OPENAI_API_KEY="your-api-key" PORT="8080"
   ```

7. **Deploy Code**
   ```bash
   # Using ZIP deployment
   zip -r deploy.zip . -x "node_modules/*" -x ".git/*"
   az webapp deployment source config-zip \
     --name your-unique-app-name \
     --resource-group gpt-voice-agent-rg \
     --src deploy.zip
   ```

   Or configure GitHub Actions for CI/CD (see `.github/workflows/azure-deploy.yml`)

### Option 2: Azure Container Apps

1. **Build Docker Image**
   ```bash
   docker build -t gpt-voice-agent .
   ```

2. **Push to Azure Container Registry**
   ```bash
   az acr create --name yourregistry --resource-group gpt-voice-agent-rg --sku Basic
   az acr login --name yourregistry
   docker tag gpt-voice-agent yourregistry.azurecr.io/gpt-voice-agent
   docker push yourregistry.azurecr.io/gpt-voice-agent
   ```

3. **Deploy to Container Apps**
   ```bash
   az containerapp create \
     --name gpt-voice-agent \
     --resource-group gpt-voice-agent-rg \
     --image yourregistry.azurecr.io/gpt-voice-agent \
     --target-port 8080 \
     --ingress external \
     --env-vars OPENAI_API_KEY=your-api-key
   ```

## Twilio Configuration

1. **Purchase a Phone Number**
   - Go to Twilio Console → Phone Numbers → Buy a Number

2. **Configure Webhook**
   - Go to Phone Number settings
   - Under "Voice & Fax", set:
     - **A CALL COMES IN**: Webhook
     - **URL**: `https://your-app-name.azurewebsites.net/incoming-call`
     - **HTTP Method**: POST

3. **Enable Media Streams (if not auto-enabled)**
   - Voice Configuration should support Media Streams

## Project Structure

```
├── src/
│   ├── server.js              # Main server entry point
│   ├── handlers/
│   │   └── twilioHandler.js   # WebSocket handler for Twilio
│   ├── config/
│   │   └── openai.js          # OpenAI configuration & prompts
│   └── utils/
│       └── twiml.js           # TwiML response generators
├── .env.example               # Environment variables template
├── .gitignore
├── Dockerfile                 # For container deployment
├── package.json
├── web.config                 # Azure App Service IIS config
└── README.md
```

## Configuration

### Voice Options

Edit `src/config/openai.js` to change the voice:

```javascript
export const OPENAI_CONFIG = {
  voice: 'alloy', // Options: alloy, echo, fable, onyx, nova, shimmer
  temperature: 0.8,
};
```

### Agent Personality

Customize the agent's behavior by editing `VOICE_AGENT_INSTRUCTIONS` in `src/config/openai.js`.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/health` | GET | Azure health probe |
| `/incoming-call` | POST | Twilio webhook for incoming calls |
| `/media-stream` | WebSocket | Twilio Media Stream connection |

## Monitoring & Debugging

### View Logs (Azure App Service)
```bash
az webapp log tail --name your-app-name --resource-group gpt-voice-agent-rg
```

### Enable Application Insights
```bash
az monitor app-insights component create \
  --app gpt-voice-agent-insights \
  --location eastus \
  --resource-group gpt-voice-agent-rg
```

## Troubleshooting

### Common Issues

1. **WebSocket Connection Fails**
   - Ensure WebSockets are enabled in Azure App Service
   - Verify SSL certificate is valid
   - Check that you're using `wss://` not `ws://`

2. **No Audio Response**
   - Verify OpenAI API key has Realtime API access
   - Check audio format settings (g711_ulaw for Twilio)
   - Review logs for OpenAI connection errors

3. **Twilio Not Connecting**
   - Verify webhook URL is correct and accessible
   - Check Twilio console for error logs
   - Ensure TwiML response is valid XML

4. **High Latency**
   - Choose Azure region closest to your users
   - Consider upgrading App Service plan
   - Monitor OpenAI API response times

## Cost Considerations

- **Azure App Service**: ~$13-55/month (B1-B3 plans)
- **Twilio**: ~$1/month per number + $0.0085/min for calls
- **OpenAI Realtime API**: Check current pricing at openai.com

## Security Best Practices

1. Never commit `.env` files
2. Use Azure Key Vault for production secrets
3. Enable Twilio request validation
4. Implement rate limiting for production
5. Use managed identity where possible

## License

MIT
