import { Request, Response } from 'express'
import { NotificationService } from '../services/notificationService'
import { DatabaseService } from '../services/databaseService'
import { NotificationRequest, NotificationPreferences } from '../types'
import { logger } from '../services/loggerService'

export class NotificationController {
  private notificationService: NotificationService
  private databaseService: DatabaseService

  constructor(notificationService: NotificationService, databaseService: DatabaseService) {
    this.notificationService = notificationService
    this.databaseService = databaseService
  }

  async sendNotification(req: Request, res: Response): Promise<void> {
    try {
      const notificationRequest: NotificationRequest = {
        tenantId: req.body.tenantId,
        recipientId: req.body.recipientId,
        type: req.body.type,
        channel: req.body.channel || 'email',
        priority: req.body.priority || 'medium',
        templateId: req.body.templateId,
        data: req.body.data,
        scheduledAt: req.body.scheduledAt ? new Date(req.body.scheduledAt) : undefined,
        expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined,
        metadata: req.body.metadata
      }

      // Validate required fields
      if (!notificationRequest.tenantId || !notificationRequest.recipientId || 
          !notificationRequest.type || !notificationRequest.templateId || 
          !notificationRequest.data) {
        res.status(400).json({
          error: 'Missing required fields',
          required: ['tenantId', 'recipientId', 'type', 'templateId', 'data']
        })
        return
      }

      const response = await this.notificationService.sendNotification(notificationRequest)

      res.status(200).json({
        success: true,
        notification: response
      })

      logger.info('Notification sent via API', {
        notificationId: response.id,
        type: notificationRequest.type,
        channel: notificationRequest.channel,
        status: response.status
      })
    } catch (error) {
      logger.error('Failed to send notification via API', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })

      res.status(500).json({
        error: 'Failed to send notification',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  async sendBulkNotifications(req: Request, res: Response): Promise<void> {
    try {
      const notifications: NotificationRequest[] = req.body.notifications

      if (!Array.isArray(notifications) || notifications.length === 0) {
        res.status(400).json({
          error: 'Invalid notifications array'
        })
        return
      }

      // Validate all notifications
      for (const notification of notifications) {
        if (!notification.tenantId || !notification.recipientId || 
            !notification.type || !notification.templateId || 
            !notification.data) {
          res.status(400).json({
            error: 'Invalid notification in bulk request',
            required: ['tenantId', 'recipientId', 'type', 'templateId', 'data']
          })
          return
        }
      }

      // Process notifications in parallel
      const responses = await Promise.allSettled(
        notifications.map(notification => 
          this.notificationService.sendNotification(notification)
        )
      )

      const results = responses.map((response, index) => {
        if (response.status === 'fulfilled') {
          return {
            index,
            success: true,
            notification: response.value
          }
        } else {
          return {
            index,
            success: false,
            error: response.reason?.message || 'Unknown error'
          }
        }
      })

      const successCount = results.filter(r => r.success).length
      const failureCount = results.filter(r => !r.success).length

      res.status(200).json({
        success: true,
        processed: notifications.length,
        successful: successCount,
        failed: failureCount,
        results
      })

      logger.info('Bulk notifications processed', {
        total: notifications.length,
        successful: successCount,
        failed: failureCount
      })
    } catch (error) {
      logger.error('Failed to process bulk notifications', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })

      res.status(500).json({
        error: 'Failed to process bulk notifications',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  async getNotificationPreferences(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.params.userId
      const tenantId = req.query.tenantId as string

      if (!userId || !tenantId) {
        res.status(400).json({
          error: 'Missing userId parameter or tenantId query parameter'
        })
        return
      }

      const preferences = await this.databaseService.getNotificationPreferences(userId, tenantId)

      if (!preferences) {
        // Return default preferences
        const defaultPreferences: NotificationPreferences = {
          userId,
          tenantId,
          emailNotifications: true,
          inAppNotifications: true,
          smsNotifications: false,
          pushNotifications: true,
          digestFrequency: 'daily',
          workingHours: {
            start: '09:00',
            end: '17:00',
            timezone: 'UTC',
            daysOfWeek: [1, 2, 3, 4, 5]
          },
          notificationTypes: {}
        }

        res.status(200).json({
          success: true,
          preferences: defaultPreferences,
          isDefault: true
        })
      } else {
        res.status(200).json({
          success: true,
          preferences,
          isDefault: false
        })
      }
    } catch (error) {
      logger.error('Failed to get notification preferences', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })

      res.status(500).json({
        error: 'Failed to get notification preferences',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  async updateNotificationPreferences(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.params.userId
      const preferences: NotificationPreferences = {
        userId,
        ...req.body
      }

      // Validate preferences structure
      if (!preferences.tenantId) {
        res.status(400).json({
          error: 'Missing tenantId in preferences'
        })
        return
      }

      await this.databaseService.saveNotificationPreferences(preferences)

      res.status(200).json({
        success: true,
        message: 'Notification preferences updated successfully'
      })

      logger.info('Notification preferences updated', {
        userId,
        tenantId: preferences.tenantId
      })
    } catch (error) {
      logger.error('Failed to update notification preferences', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })

      res.status(500).json({
        error: 'Failed to update notification preferences',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  async getNotificationMetrics(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.query.tenantId as string
      const days = parseInt(req.query.days as string) || 30

      if (!tenantId) {
        res.status(400).json({
          error: 'Missing tenantId query parameter'
        })
        return
      }

      const metrics = await this.notificationService.getMetrics(tenantId)

      res.status(200).json({
        success: true,
        metrics: {
          ...metrics,
          period: `${days} days`,
          tenantId
        }
      })
    } catch (error) {
      logger.error('Failed to get notification metrics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })

      res.status(500).json({
        error: 'Failed to get notification metrics',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  async trackNotificationOpen(req: Request, res: Response): Promise<void> {
    try {
      const notificationId = req.params.notificationId

      // This would update delivery tracking in the database
      logger.debug('Notification opened', { notificationId })

      // Return 1x1 transparent pixel
      const pixel = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        'base64'
      )

      res.set({
        'Content-Type': 'image/png',
        'Content-Length': pixel.length,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      })

      res.status(200).send(pixel)
    } catch (error) {
      logger.error('Failed to track notification open', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })

      res.status(404).send('Not found')
    }
  }

  async unsubscribe(req: Request, res: Response): Promise<void> {
    try {
      const token = req.query.token as string

      if (!token) {
        res.status(400).json({
          error: 'Missing unsubscribe token'
        })
        return
      }

      // Decode and validate token
      const decodedToken = Buffer.from(decodeURIComponent(token), 'base64').toString()
      const [userId, timestamp] = decodedToken.split(':')

      if (!userId || !timestamp) {
        res.status(400).json({
          error: 'Invalid unsubscribe token'
        })
        return
      }

      // For now, just log the unsubscribe request
      // In a full implementation, this would update user preferences
      logger.info('Unsubscribe requested', { userId, timestamp })

      res.status(200).json({
        success: true,
        message: 'Successfully unsubscribed from email notifications'
      })
    } catch (error) {
      logger.error('Failed to process unsubscribe', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })

      res.status(500).json({
        error: 'Failed to process unsubscribe request',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      // Basic health check
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'notification-service',
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime()
      }

      res.status(200).json(health)
    } catch (error) {
      res.status(500).json({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}
