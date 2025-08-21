#!/usr/bin/env node

/**
 * Google Workspace OAuth2 Setup Script
 * 
 * This script helps setup Google Workspace OAuth2 credentials for the notification service.
 * It guides you through the process of obtaining the necessary tokens for Gmail SMTP access.
 * 
 * Prerequisites:
 * 1. Google Cloud Project with Gmail API enabled
 * 2. OAuth2 credentials (Client ID and Client Secret)
 * 3. Authorized redirect URI configured in Google Cloud Console
 * 
 * Usage: node scripts/setup-google-oauth.js
 */

const { google } = require('googleapis')
const readline = require('readline')
const fs = require('fs')
const path = require('path')

// OAuth2 scopes required for Gmail SMTP
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify'
]

const CREDENTIALS_FILE = path.join(__dirname, '..', '.google-credentials.json')
const TOKEN_FILE = path.join(__dirname, '..', '.google-tokens.json')

class GoogleOAuth2Setup {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })
  }

  async prompt(question) {
    return new Promise((resolve) => {
      this.rl.question(question, resolve)
    })
  }

  async setup() {
    console.log('🔧 Google Workspace OAuth2 Setup for HTMA Notification Service\n')
    
    try {
      // Check if credentials already exist
      if (fs.existsSync(CREDENTIALS_FILE)) {
        console.log('✅ Found existing Google credentials file')
        const useExisting = await this.prompt('Use existing credentials? (y/n): ')
        
        if (useExisting.toLowerCase() !== 'y') {
          await this.getCredentials()
        }
      } else {
        await this.getCredentials()
      }

      // Load credentials
      const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'))
      
      // Setup OAuth2 client
      const oauth2Client = new google.auth.OAuth2(
        credentials.client_id,
        credentials.client_secret,
        credentials.redirect_uri
      )

      // Check if tokens already exist
      if (fs.existsSync(TOKEN_FILE)) {
        console.log('✅ Found existing tokens file')
        const useExisting = await this.prompt('Use existing tokens? (y/n): ')
        
        if (useExisting.toLowerCase() === 'y') {
          const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
          oauth2Client.setCredentials(tokens)
          await this.testConnection(oauth2Client)
          await this.generateEnvConfig(credentials, tokens)
          this.rl.close()
          return
        }
      }

      // Get authorization URL
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent' // Force consent to get refresh token
      })

      console.log('\n📋 Steps to authorize the application:')
      console.log('1. Open the following URL in your browser:')
      console.log(`   ${authUrl}`)
      console.log('2. Sign in with your Google Workspace account')
      console.log('3. Grant the requested permissions')
      console.log('4. Copy the authorization code from the redirect URL\n')

      const code = await this.prompt('Enter the authorization code: ')

      // Exchange code for tokens
      console.log('🔄 Exchanging authorization code for tokens...')
      const { tokens } = await oauth2Client.getToken(code)
      
      oauth2Client.setCredentials(tokens)

      // Save tokens
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2))
      console.log('✅ Tokens saved successfully')

      // Test connection
      await this.testConnection(oauth2Client)

      // Generate environment configuration
      await this.generateEnvConfig(credentials, tokens)

      console.log('\n🎉 Google Workspace OAuth2 setup completed successfully!')
      console.log('📄 Your environment configuration has been generated.')
      console.log('📧 The notification service is now ready to send emails via Gmail SMTP.')

    } catch (error) {
      console.error('❌ Setup failed:', error.message)
      
      if (error.code === 'invalid_grant') {
        console.log('\n💡 Tip: The authorization code may have expired. Please try again with a fresh code.')
      }
    } finally {
      this.rl.close()
    }
  }

  async getCredentials() {
    console.log('\n📋 Google Cloud Console Setup Required:')
    console.log('1. Go to: https://console.cloud.google.com/')
    console.log('2. Enable the Gmail API for your project')
    console.log('3. Create OAuth2 credentials (Desktop application type)')
    console.log('4. Add authorized redirect URI: http://localhost:3000/auth/google/callback')
    console.log('5. Download the credentials JSON file\n')

    const clientId = await this.prompt('Enter your Google Client ID: ')
    const clientSecret = await this.prompt('Enter your Google Client Secret: ')
    const redirectUri = await this.prompt('Enter your redirect URI (default: http://localhost:3000/auth/google/callback): ') 
      || 'http://localhost:3000/auth/google/callback'

    const credentials = {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri
    }

    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2))
    console.log('✅ Credentials saved to .google-credentials.json')
  }

  async testConnection(oauth2Client) {
    try {
      console.log('🔄 Testing Gmail API connection...')
      
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client })
      const profile = await gmail.users.getProfile({ userId: 'me' })
      
      console.log(`✅ Connection successful! Email: ${profile.data.emailAddress}`)
      console.log(`📊 Messages in mailbox: ${profile.data.messagesTotal}`)
    } catch (error) {
      console.error('❌ Connection test failed:', error.message)
      throw error
    }
  }

  async generateEnvConfig(credentials, tokens) {
    const fromEmail = await this.prompt('Enter the "From" email address for notifications: ')
    const fromName = await this.prompt('Enter the "From" name for notifications (default: HTMA Platform): ') 
      || 'HTMA Platform'

    const envConfig = `
# Google Workspace Configuration for Notification Service
# Add these variables to your .env file

# Google OAuth2 Credentials
GOOGLE_CLIENT_ID="${credentials.client_id}"
GOOGLE_CLIENT_SECRET="${credentials.client_secret}"
GOOGLE_REDIRECT_URI="${credentials.redirect_uri}"
GOOGLE_REFRESH_TOKEN="${tokens.refresh_token}"

# Email Configuration
NOTIFICATION_FROM_EMAIL="${fromEmail}"
NOTIFICATION_FROM_NAME="${fromName}"

# Optional: Access token (will be refreshed automatically)
GOOGLE_ACCESS_TOKEN="${tokens.access_token || ''}"
`

    const envFile = path.join(__dirname, '..', 'google-workspace.env')
    fs.writeFileSync(envFile, envConfig.trim())
    
    console.log(`\n✅ Environment configuration saved to: ${envFile}`)
    console.log('\n📋 Next steps:')
    console.log('1. Copy the variables from google-workspace.env to your main .env file')
    console.log('2. Restart the notification service')
    console.log('3. Test email sending via the API')
    
    // Also append to main .env if it exists
    const mainEnvFile = path.join(__dirname, '..', '.env')
    if (fs.existsSync(mainEnvFile)) {
      const appendConfig = await this.prompt('\nAppend configuration to .env file? (y/n): ')
      if (appendConfig.toLowerCase() === 'y') {
        fs.appendFileSync(mainEnvFile, '\n' + envConfig)
        console.log('✅ Configuration appended to .env file')
      }
    }
  }
}

// Run the setup if this script is executed directly
if (require.main === module) {
  const setup = new GoogleOAuth2Setup()
  setup.setup().catch(console.error)
}

module.exports = GoogleOAuth2Setup
