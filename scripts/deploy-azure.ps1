# PowerShell script for Azure deployment
# Run this script to deploy the GPT Voice Agent to Azure App Service

param(
    [Parameter(Mandatory=$true)]
    [string]$AppName,
    
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroup,
    
    [Parameter(Mandatory=$true)]
    [string]$OpenAIApiKey,
    
    [string]$Location = "eastus",
    [string]$Sku = "B1"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "GPT Realtime Voice Agent - Azure Deploy" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Check if Azure CLI is installed
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Azure CLI is not installed. Please install it first." -ForegroundColor Red
    Write-Host "Download from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli" -ForegroundColor Yellow
    exit 1
}

# Login check
Write-Host "`nChecking Azure login status..." -ForegroundColor Yellow
$account = az account show 2>$null | ConvertFrom-Json
if (-not $account) {
    Write-Host "Not logged in. Please login to Azure..." -ForegroundColor Yellow
    az login
}
Write-Host "Logged in as: $($account.user.name)" -ForegroundColor Green

# Create Resource Group
Write-Host "`nCreating Resource Group: $ResourceGroup..." -ForegroundColor Yellow
az group create --name $ResourceGroup --location $Location --output none
Write-Host "Resource Group created!" -ForegroundColor Green

# Create App Service Plan
$planName = "$AppName-plan"
Write-Host "`nCreating App Service Plan: $planName (SKU: $Sku)..." -ForegroundColor Yellow
az appservice plan create `
    --name $planName `
    --resource-group $ResourceGroup `
    --sku $Sku `
    --is-linux `
    --output none
Write-Host "App Service Plan created!" -ForegroundColor Green

# Create Web App
Write-Host "`nCreating Web App: $AppName..." -ForegroundColor Yellow
az webapp create `
    --name $AppName `
    --resource-group $ResourceGroup `
    --plan $planName `
    --runtime "NODE:18-lts" `
    --output none
Write-Host "Web App created!" -ForegroundColor Green

# Enable WebSockets
Write-Host "`nEnabling WebSockets..." -ForegroundColor Yellow
az webapp config set `
    --name $AppName `
    --resource-group $ResourceGroup `
    --web-sockets-enabled true `
    --output none
Write-Host "WebSockets enabled!" -ForegroundColor Green

# Configure App Settings
Write-Host "`nConfiguring environment variables..." -ForegroundColor Yellow
az webapp config appsettings set `
    --name $AppName `
    --resource-group $ResourceGroup `
    --settings `
        OPENAI_API_KEY="$OpenAIApiKey" `
        PORT="8080" `
        WEBSITE_NODE_DEFAULT_VERSION="~18" `
    --output none
Write-Host "Environment variables configured!" -ForegroundColor Green

# Deploy code
Write-Host "`nPreparing deployment package..." -ForegroundColor Yellow
$deployZip = "deploy.zip"
if (Test-Path $deployZip) { Remove-Item $deployZip }

# Create zip excluding unnecessary files
Compress-Archive -Path * -DestinationPath $deployZip -Force
# Note: This includes node_modules. For production, use npm ci on Azure or exclude node_modules

Write-Host "Deploying to Azure..." -ForegroundColor Yellow
az webapp deployment source config-zip `
    --name $AppName `
    --resource-group $ResourceGroup `
    --src $deployZip `
    --output none

# Cleanup
Remove-Item $deployZip -ErrorAction SilentlyContinue

# Get the URL
$webappUrl = "https://$AppName.azurewebsites.net"

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "Deployment Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "`nYour app is available at:" -ForegroundColor Cyan
Write-Host "  $webappUrl" -ForegroundColor White
Write-Host "`nTwilio Webhook URL:" -ForegroundColor Cyan
Write-Host "  $webappUrl/incoming-call" -ForegroundColor White
Write-Host "`nWebSocket URL:" -ForegroundColor Cyan
Write-Host "  wss://$AppName.azurewebsites.net/media-stream" -ForegroundColor White
Write-Host "`nNext Steps:" -ForegroundColor Yellow
Write-Host "1. Go to your Twilio Console" -ForegroundColor White
Write-Host "2. Select your phone number" -ForegroundColor White
Write-Host "3. Set the Voice webhook to: $webappUrl/incoming-call" -ForegroundColor White
Write-Host "4. Make a test call!" -ForegroundColor White
