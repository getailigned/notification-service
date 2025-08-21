import nodemailer from 'nodemailer'
import { google } from 'googleapis'
import { GoogleWorkspaceConfig, EmailConfiguration, NotificationRequest, NotificationResponse } from '../types'
import { logger } from './loggerService'

export class GoogleWorkspaceEmailService {
  private transporter: nodemailer.Transporter | null = null
  private oauth2Client: any
  private config: GoogleWorkspaceConfig
  private emailConfig: EmailConfiguration

  constructor(config: GoogleWorkspaceConfig, emailConfig: EmailConfiguration) {
    this.config = config
    this.emailConfig = emailConfig
    this.oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    )
    
    this.oauth2Client.setCredentials({
      refresh_token: config.refreshToken,
      access_token: config.accessToken
    })
    
    this.initializeTransporter()
  }

  private async initializeTransporter(): Promise<void> {
    try {
      // Get fresh access token
      const accessToken = await this.getAccessToken()
      
      this.transporter = nodemailer.createTransporter({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user: this.emailConfig.from.email,
          clientId: this.config.clientId,
          clientSecret: this.config.clientSecret,
          refreshToken: this.config.refreshToken,
          accessToken: accessToken,
        },
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        rateDelta: 1000, // 1 second
        rateLimit: 5, // 5 emails per second
      })

      // Verify transporter configuration
      await this.transporter.verify()
      logger.info('Google Workspace email transporter initialized successfully')
      
    } catch (error) {
      logger.error('Failed to initialize Google Workspace email transporter', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  private async getAccessToken(): Promise<string> {
    try {
      const { credentials } = await this.oauth2Client.refreshAccessToken()
      
      if (credentials.access_token) {
        this.config.accessToken = credentials.access_token
        this.config.tokenExpiresAt = credentials.expiry_date ? new Date(credentials.expiry_date) : undefined
        return credentials.access_token
      }
      
      throw new Error('Failed to obtain access token')
    } catch (error) {
      logger.error('Failed to refresh Google Workspace access token', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  private async ensureValidToken(): Promise<void> {
    if (!this.config.accessToken || !this.config.tokenExpiresAt || 
        this.config.tokenExpiresAt <= new Date(Date.now() + 60000)) { // Refresh 1 minute before expiry
      await this.getAccessToken()
      await this.initializeTransporter()
    }
  }

  async sendEmail(notification: NotificationRequest, compiledTemplate: {
    subject: string
    htmlBody: string
    textBody: string
  }): Promise<NotificationResponse> {
    const startTime = Date.now()
    
    try {
      await this.ensureValidToken()
      
      if (!this.transporter) {
        throw new Error('Email transporter not initialized')
      }

      // Get recipient information
      const recipient = await this.getRecipientInfo(notification.recipientId, notification.tenantId)
      
      const mailOptions = {
        from: {
          name: this.emailConfig.from.name,
          address: this.emailConfig.from.email
        },
        to: recipient.email,
        subject: compiledTemplate.subject,
        html: compiledTemplate.htmlBody,
        text: compiledTemplate.textBody,
        headers: {
          'X-HTMA-Notification-ID': notification.id || 'unknown',
          'X-HTMA-Tenant-ID': notification.tenantId,
          'X-HTMA-Type': notification.type,
          'X-HTMA-Priority': notification.priority,
          'List-Unsubscribe': `<https://app.getailigned.com/unsubscribe?token=${this.generateUnsubscribeToken(notification.recipientId)}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        },
        messageId: `<${notification.id || Date.now()}.${notification.tenantId}@getailigned.com>`,
        date: new Date(),
        encoding: 'utf8'
      }

      // Add tracking pixel for delivery confirmation
      if (notification.priority === 'high' || notification.priority === 'critical') {
        const trackingPixel = `<img src="https://app.getailigned.com/api/notifications/track/open/${notification.id}" width="1" height="1" style="display:none;" alt="" />`
        mailOptions.html += trackingPixel
      }

      logger.info('Sending email via Google Workspace', {
        notificationId: notification.id,
        recipientId: notification.recipientId,
        type: notification.type,
        priority: notification.priority,
        subject: compiledTemplate.subject
      })

      const result = await this.transporter.sendMail(mailOptions)
      
      const deliveryTime = Date.now() - startTime
      
      logger.info('Email sent successfully', {
        notificationId: notification.id,
        messageId: result.messageId,
        deliveryTime,
        recipient: recipient.email
      })

      return {
        id: notification.id || result.messageId,
        status: 'sent',
        sentAt: new Date(),
        messageId: result.messageId,
        trackingId: result.messageId
      }

    } catch (error) {
      const deliveryTime = Date.now() - startTime
      
      logger.error('Failed to send email via Google Workspace', {
        notificationId: notification.id,
        recipientId: notification.recipientId,
        error: error instanceof Error ? error.message : 'Unknown error',
        deliveryTime
      })

      return {
        id: notification.id || 'unknown',
        status: 'failed',
        failedAt: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  async sendBulkEmails(notifications: NotificationRequest[], compiledTemplates: Map<string, {
    subject: string
    htmlBody: string
    textBody: string
  }>): Promise<NotificationResponse[]> {
    const startTime = Date.now()
    const results: NotificationResponse[] = []
    const batchSize = 10 // Process in batches to avoid rate limits
    
    logger.info('Starting bulk email send', {
      totalEmails: notifications.length,
      batchSize
    })

    try {
      await this.ensureValidToken()
      
      for (let i = 0; i < notifications.length; i += batchSize) {
        const batch = notifications.slice(i, i + batchSize)
        const batchPromises = batch.map(async (notification) => {
          const template = compiledTemplates.get(notification.templateId)
          if (!template) {
            logger.error('Template not found for notification', {
              notificationId: notification.id,
              templateId: notification.templateId
            })
            return {
              id: notification.id || 'unknown',
              status: 'failed' as const,
              failedAt: new Date(),
              error: 'Template not found'
            }
          }
          
          return this.sendEmail(notification, template)
        })
        
        const batchResults = await Promise.allSettled(batchPromises)
        
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push(result.value)
          } else {
            const notification = batch[index]
            logger.error('Batch email send failed', {
              notificationId: notification?.id,
              error: result.reason
            })
            results.push({
              id: notification?.id || 'unknown',
              status: 'failed',
              failedAt: new Date(),
              error: result.reason?.message || 'Unknown error'
            })
          }
        })
        
        // Rate limiting between batches
        if (i + batchSize < notifications.length) {
          await new Promise(resolve => setTimeout(resolve, 1000)) // 1 second delay
        }
      }
      
      const totalTime = Date.now() - startTime
      const successCount = results.filter(r => r.status === 'sent').length
      const failureCount = results.filter(r => r.status === 'failed').length
      
      logger.info('Bulk email send completed', {
        totalEmails: notifications.length,
        successCount,
        failureCount,
        totalTime,
        averageTimePerEmail: totalTime / notifications.length
      })
      
    } catch (error) {
      logger.error('Bulk email send failed catastrophically', {
        error: error instanceof Error ? error.message : 'Unknown error',
        totalEmails: notifications.length,
        processedEmails: results.length
      })
    }

    return results
  }

  private async getRecipientInfo(recipientId: string, tenantId: string): Promise<{
    email: string
    name: string
    preferences: any
  }> {
    // This would typically query the user service or database
    // For now, returning a mock implementation
    // TODO: Integrate with actual user service
    
    try {
      // Mock implementation - replace with actual user service call
      const mockUser = {
        email: `user-${recipientId}@example.com`,
        name: `User ${recipientId}`,
        preferences: {
          emailNotifications: true,
          digestFrequency: 'immediate'
        }
      }
      
      return mockUser
    } catch (error) {
      logger.error('Failed to get recipient info', {
        recipientId,
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  private generateUnsubscribeToken(recipientId: string): string {
    // Generate a secure unsubscribe token
    // In production, this should be a JWT or encrypted token
    const token = Buffer.from(`${recipientId}:${Date.now()}`).toString('base64')
    return encodeURIComponent(token)
  }

  async validateConfiguration(): Promise<boolean> {
    try {
      await this.ensureValidToken()
      
      if (!this.transporter) {
        return false
      }
      
      await this.transporter.verify()
      return true
    } catch (error) {
      logger.error('Google Workspace configuration validation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return false
    }
  }

  async getQuotaInfo(): Promise<{
    dailyQuota: number
    usedQuota: number
    remainingQuota: number
  }> {
    try {
      // Gmail API has daily sending limits
      // Free accounts: 500 emails/day
      // Google Workspace: 2000 emails/day per user
      const isWorkspace = this.emailConfig.from.email.includes('@') && 
                          !this.emailConfig.from.email.includes('@gmail.com')
      
      const dailyQuota = isWorkspace ? 2000 : 500
      
      // TODO: Implement actual quota tracking
      // This would require storing daily send counts in Redis or database
      const usedQuota = 0 // Placeholder
      const remainingQuota = dailyQuota - usedQuota
      
      return {
        dailyQuota,
        usedQuota,
        remainingQuota
      }
    } catch (error) {
      logger.error('Failed to get quota info', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return {
        dailyQuota: 0,
        usedQuota: 0,
        remainingQuota: 0
      }
    }
  }

  async close(): Promise<void> {
    if (this.transporter) {
      this.transporter.close()
      this.transporter = null
      logger.info('Google Workspace email service closed')
    }
  }
}
