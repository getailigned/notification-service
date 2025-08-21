import { NotificationRequest, NotificationResponse, GoogleWorkspaceConfig, EmailConfiguration, WorkflowNotificationContext, EscalationNotificationContext, ApprovalNotificationContext } from '../types'
import { GoogleWorkspaceEmailService } from './googleWorkspaceEmailService'
import { TemplateService } from './templateService'
import { DatabaseService } from './databaseService'
import { MessageQueueService } from './messageQueueService'
import { logger } from './loggerService'

export class NotificationService {
  private googleEmailService: GoogleWorkspaceEmailService | null = null
  private templateService: TemplateService
  private databaseService: DatabaseService
  private messageQueueService: MessageQueueService
  private processingInterval: NodeJS.Timeout | null = null

  constructor() {
    this.templateService = new TemplateService()
    this.databaseService = new DatabaseService()
    this.messageQueueService = new MessageQueueService()
  }

  async initialize(): Promise<void> {
    try {
      // Initialize database
      await this.databaseService.initialize()
      
      // Initialize message queue
      await this.messageQueueService.connect()
      
      // Initialize Google Workspace email if configured
      await this.initializeGoogleWorkspace()
      
      // Start event subscriptions
      await this.startEventSubscriptions()
      
      // Start notification processing
      this.startNotificationProcessor()
      
      logger.info('Notification service initialized successfully')
    } catch (error) {
      logger.error('Failed to initialize notification service', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  private async initializeGoogleWorkspace(): Promise<void> {
    const config = this.getGoogleWorkspaceConfig()
    const emailConfig = this.getEmailConfiguration()
    
    if (config && emailConfig) {
      try {
        this.googleEmailService = new GoogleWorkspaceEmailService(config, emailConfig)
        const isValid = await this.googleEmailService.validateConfiguration()
        
        if (!isValid) {
          logger.warn('Google Workspace configuration is invalid, email notifications will be disabled')
          this.googleEmailService = null
        } else {
          logger.info('Google Workspace email service initialized successfully')
        }
      } catch (error) {
        logger.error('Failed to initialize Google Workspace email service', {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        this.googleEmailService = null
      }
    } else {
      logger.info('Google Workspace not configured, email notifications will be disabled')
    }
  }

  private getGoogleWorkspaceConfig(): GoogleWorkspaceConfig | null {
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback'
    
    if (!clientId || !clientSecret || !refreshToken) {
      return null
    }
    
    return {
      clientId,
      clientSecret,
      refreshToken,
      redirectUri,
      scope: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.modify'
      ]
    }
  }

  private getEmailConfiguration(): EmailConfiguration | null {
    const fromEmail = process.env.NOTIFICATION_FROM_EMAIL
    const fromName = process.env.NOTIFICATION_FROM_NAME || 'HTMA Platform'
    
    if (!fromEmail) {
      return null
    }
    
    return {
      provider: 'gmail',
      auth: {
        type: 'oauth2',
        user: fromEmail
      },
      from: {
        email: fromEmail,
        name: fromName
      }
    }
  }

  private async startEventSubscriptions(): Promise<void> {
    // Subscribe to workflow events
    await this.messageQueueService.subscribeToWorkflowEvents(async (event) => {
      await this.handleWorkflowEvent(event)
    })
    
    // Subscribe to work item events
    await this.messageQueueService.subscribeToWorkItemEvents(async (event) => {
      await this.handleWorkItemEvent(event)
    })
    
    // Start digest processor
    await this.messageQueueService.startDigestProcessor(async (digestType) => {
      await this.processDigest(digestType)
    })
    
    // Start escalation processor
    await this.messageQueueService.startEscalationProcessor(async (escalation) => {
      await this.processEscalation(escalation)
    })
    
    logger.info('Event subscriptions started')
  }

  private startNotificationProcessor(): void {
    // Process pending notifications every 30 seconds
    this.processingInterval = setInterval(async () => {
      try {
        await this.processPendingNotifications()
      } catch (error) {
        logger.error('Error processing pending notifications', {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }, 30000)
    
    logger.info('Notification processor started')
  }

  async sendNotification(request: NotificationRequest): Promise<NotificationResponse> {
    try {
      // Save notification to database
      const notificationId = await this.databaseService.saveNotification(request)
      request.id = notificationId

      // Check user preferences
      const preferences = await this.databaseService.getNotificationPreferences(
        request.recipientId, 
        request.tenantId
      )
      
      // Skip if user has disabled this type of notification
      if (preferences && !this.shouldSendNotification(request, preferences)) {
        logger.debug('Notification skipped due to user preferences', {
          notificationId,
          type: request.type,
          channel: request.channel
        })
        
        const response: NotificationResponse = {
          id: notificationId,
          status: 'cancelled'
        }
        
        await this.databaseService.updateNotificationStatus(notificationId, response)
        return response
      }

      // Process notification based on channel
      let response: NotificationResponse
      
      switch (request.channel) {
        case 'email':
          response = await this.sendEmailNotification(request)
          break
        case 'in_app':
          response = await this.sendInAppNotification(request)
          break
        case 'sms':
          response = await this.sendSMSNotification(request)
          break
        default:
          throw new Error(`Unsupported notification channel: ${request.channel}`)
      }

      // Update database with response
      await this.databaseService.updateNotificationStatus(notificationId, response)
      
      // Publish notification event
      await this.messageQueueService.publishNotificationEvent(
        `notification.${request.channel}.${response.status}`,
        request
      )

      return response
    } catch (error) {
      logger.error('Failed to send notification', {
        type: request.type,
        channel: request.channel,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      
      const errorResponse: NotificationResponse = {
        id: request.id || 'unknown',
        status: 'failed',
        failedAt: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error'
      }
      
      if (request.id) {
        await this.databaseService.updateNotificationStatus(request.id, errorResponse)
      }
      
      return errorResponse
    }
  }

  private shouldSendNotification(request: NotificationRequest, preferences: any): boolean {
    // Check if the notification type is enabled
    const typePrefs = preferences.notificationTypes[request.type]
    if (typePrefs && !typePrefs.enabled) {
      return false
    }
    
    // Check if the channel is enabled for this type
    if (typePrefs && !typePrefs.channels.includes(request.channel)) {
      return false
    }
    
    // Check global channel preferences
    switch (request.channel) {
      case 'email':
        return preferences.emailNotifications
      case 'in_app':
        return preferences.inAppNotifications
      case 'sms':
        return preferences.smsNotifications
      case 'push':
        return preferences.pushNotifications
      default:
        return true
    }
  }

  private async sendEmailNotification(request: NotificationRequest): Promise<NotificationResponse> {
    if (!this.googleEmailService) {
      throw new Error('Google Workspace email service not configured')
    }
    
    // Compile template
    const compiledTemplate = await this.templateService.compileTemplate(
      request.templateId,
      request.data
    )
    
    // Send email
    return await this.googleEmailService.sendEmail(request, compiledTemplate)
  }

  private async sendInAppNotification(request: NotificationRequest): Promise<NotificationResponse> {
    // For in-app notifications, we would typically push to a real-time system
    // For now, we'll just mark as sent
    logger.debug('In-app notification would be sent', {
      recipientId: request.recipientId,
      type: request.type
    })
    
    return {
      id: request.id || 'unknown',
      status: 'sent',
      sentAt: new Date()
    }
  }

  private async sendSMSNotification(request: NotificationRequest): Promise<NotificationResponse> {
    // SMS implementation would go here (Twilio, etc.)
    logger.debug('SMS notification would be sent', {
      recipientId: request.recipientId,
      type: request.type
    })
    
    return {
      id: request.id || 'unknown',
      status: 'sent',
      sentAt: new Date()
    }
  }

  private async processPendingNotifications(): Promise<void> {
    try {
      const pendingNotifications = await this.databaseService.getPendingNotifications(50)
      
      if (pendingNotifications.length === 0) {
        return
      }
      
      logger.debug('Processing pending notifications', {
        count: pendingNotifications.length
      })
      
      // Process notifications in parallel (with concurrency limit)
      const concurrency = 5
      for (let i = 0; i < pendingNotifications.length; i += concurrency) {
        const batch = pendingNotifications.slice(i, i + concurrency)
        const promises = batch.map(notification => this.sendNotification(notification))
        await Promise.allSettled(promises)
      }
    } catch (error) {
      logger.error('Error processing pending notifications', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  private async handleWorkflowEvent(event: any): Promise<void> {
    logger.debug('Handling workflow event', {
      type: event.type,
      workItemId: event.workItemId
    })
    
    // Convert workflow events to notifications
    switch (event.type) {
      case 'approval_requested':
        await this.createApprovalRequestNotification(event.data)
        break
      case 'escalation_triggered':
        await this.createEscalationNotification(event.data)
        break
      case 'sla_breach':
        await this.createSLABreachNotification(event.data)
        break
      default:
        logger.debug('Unhandled workflow event type', { type: event.type })
    }
  }

  private async handleWorkItemEvent(event: any): Promise<void> {
    logger.debug('Handling work item event', {
      type: event.type,
      workItemId: event.workItemId
    })
    
    // Convert work item events to notifications
    switch (event.type) {
      case 'work_item_created':
        await this.createWorkItemCreatedNotification(event.data)
        break
      case 'work_item_assigned':
        await this.createWorkItemAssignedNotification(event.data)
        break
      case 'work_item_completed':
        await this.createWorkItemCompletedNotification(event.data)
        break
      default:
        logger.debug('Unhandled work item event type', { type: event.type })
    }
  }

  private async createApprovalRequestNotification(context: ApprovalNotificationContext): Promise<void> {
    const notification: NotificationRequest = {
      tenantId: context.workItemId, // This should be actual tenant ID
      recipientId: context.approverId!,
      type: 'approval_requested',
      channel: 'email',
      priority: 'high',
      templateId: 'approval_requested',
      data: context,
      expiresAt: context.approvalDeadline
    }
    
    await this.sendNotification(notification)
  }

  private async createEscalationNotification(context: EscalationNotificationContext): Promise<void> {
    const notification: NotificationRequest = {
      tenantId: context.workItemId, // This should be actual tenant ID
      recipientId: context.escalatedToEmail,
      type: 'escalation_triggered',
      channel: 'email',
      priority: 'critical',
      templateId: 'escalation_triggered',
      data: context
    }
    
    await this.sendNotification(notification)
  }

  private async createSLABreachNotification(context: WorkflowNotificationContext): Promise<void> {
    const notification: NotificationRequest = {
      tenantId: context.workItemId, // This should be actual tenant ID
      recipientId: context.assigneeId!,
      type: 'sla_breach',
      channel: 'email',
      priority: 'critical',
      templateId: 'escalation_triggered',
      data: context
    }
    
    await this.sendNotification(notification)
  }

  private async createWorkItemAssignedNotification(context: WorkflowNotificationContext): Promise<void> {
    const notification: NotificationRequest = {
      tenantId: context.workItemId, // This should be actual tenant ID
      recipientId: context.assigneeId!,
      type: 'work_item_assigned',
      channel: 'email',
      priority: context.priority === 'critical' ? 'high' : 'medium',
      templateId: 'work_item_assigned',
      data: context
    }
    
    await this.sendNotification(notification)
  }

  private async createWorkItemCreatedNotification(context: WorkflowNotificationContext): Promise<void> {
    // Notify relevant stakeholders about new work item
    logger.debug('Work item created notification', {
      workItemId: context.workItemId,
      type: context.workItemType
    })
  }

  private async createWorkItemCompletedNotification(context: WorkflowNotificationContext): Promise<void> {
    // Notify stakeholders about completion
    logger.debug('Work item completed notification', {
      workItemId: context.workItemId,
      type: context.workItemType
    })
  }

  private async processDigest(digestType: string): Promise<void> {
    logger.info('Processing digest', { digestType })
    // Digest processing logic would go here
  }

  private async processEscalation(escalation: any): Promise<void> {
    logger.info('Processing escalation', {
      workItemId: escalation.workItemId,
      level: escalation.escalationLevel
    })
    
    await this.createEscalationNotification(escalation)
  }

  async getMetrics(tenantId: string): Promise<any> {
    return await this.databaseService.getNotificationMetrics(tenantId)
  }

  async close(): Promise<void> {
    if (this.processingInterval) {
      clearInterval(this.processingInterval)
      this.processingInterval = null
    }
    
    if (this.googleEmailService) {
      await this.googleEmailService.close()
    }
    
    await this.messageQueueService.close()
    await this.databaseService.close()
    
    logger.info('Notification service closed')
  }
}
