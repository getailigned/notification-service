import { Pool } from 'pg'
import { NotificationRequest, NotificationResponse, NotificationTemplate, NotificationPreferences } from '../types'
import { logger } from './loggerService'

export class DatabaseService {
  private pool: Pool

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/htma',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    })
  }

  async initialize(): Promise<void> {
    try {
      await this.createTables()
      logger.info('Database service initialized')
    } catch (error) {
      logger.error('Failed to initialize database service', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  private async createTables(): Promise<void> {
    const client = await this.pool.connect()
    
    try {
      // Create notifications table
      await client.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id UUID NOT NULL,
          recipient_id UUID NOT NULL,
          type VARCHAR(50) NOT NULL,
          channel VARCHAR(20) NOT NULL,
          priority VARCHAR(20) NOT NULL,
          template_id VARCHAR(100) NOT NULL,
          data JSONB NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          scheduled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          sent_at TIMESTAMP WITH TIME ZONE,
          delivered_at TIMESTAMP WITH TIME ZONE,
          failed_at TIMESTAMP WITH TIME ZONE,
          expires_at TIMESTAMP WITH TIME ZONE,
          error_message TEXT,
          message_id VARCHAR(255),
          tracking_id VARCHAR(255),
          metadata JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `)

      // Create notification preferences table
      await client.query(`
        CREATE TABLE IF NOT EXISTS notification_preferences (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL UNIQUE,
          tenant_id UUID NOT NULL,
          email_notifications BOOLEAN DEFAULT true,
          in_app_notifications BOOLEAN DEFAULT true,
          sms_notifications BOOLEAN DEFAULT false,
          push_notifications BOOLEAN DEFAULT true,
          digest_frequency VARCHAR(20) DEFAULT 'daily',
          working_hours_start TIME DEFAULT '09:00',
          working_hours_end TIME DEFAULT '17:00',
          timezone VARCHAR(50) DEFAULT 'UTC',
          days_of_week INTEGER[] DEFAULT ARRAY[1,2,3,4,5],
          notification_types JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `)

      // Create notification templates table
      await client.query(`
        CREATE TABLE IF NOT EXISTS notification_templates (
          id VARCHAR(100) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          subject TEXT NOT NULL,
          html_body TEXT NOT NULL,
          text_body TEXT NOT NULL,
          type VARCHAR(50) NOT NULL,
          variables JSONB NOT NULL,
          metadata JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `)

      // Create indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_notifications_tenant_recipient 
        ON notifications(tenant_id, recipient_id)
      `)
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_notifications_status_scheduled 
        ON notifications(status, scheduled_at)
      `)
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_notifications_type_created 
        ON notifications(type, created_at)
      `)

      logger.info('Database tables created/verified successfully')
    } finally {
      client.release()
    }
  }

  async saveNotification(notification: NotificationRequest): Promise<string> {
    const client = await this.pool.connect()
    
    try {
      const query = `
        INSERT INTO notifications (
          tenant_id, recipient_id, type, channel, priority, template_id, 
          data, scheduled_at, expires_at, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
      `
      
      const values = [
        notification.tenantId,
        notification.recipientId,
        notification.type,
        notification.channel,
        notification.priority,
        notification.templateId,
        JSON.stringify(notification.data),
        notification.scheduledAt || new Date(),
        notification.expiresAt,
        JSON.stringify(notification.metadata || {})
      ]
      
      const result = await client.query(query, values)
      const notificationId = result.rows[0].id
      
      logger.debug('Notification saved to database', {
        notificationId,
        type: notification.type,
        channel: notification.channel
      })
      
      return notificationId
    } finally {
      client.release()
    }
  }

  async updateNotificationStatus(
    notificationId: string, 
    response: NotificationResponse
  ): Promise<void> {
    const client = await this.pool.connect()
    
    try {
      const query = `
        UPDATE notifications 
        SET status = $1, sent_at = $2, delivered_at = $3, failed_at = $4, 
            error_message = $5, message_id = $6, tracking_id = $7, updated_at = NOW()
        WHERE id = $8
      `
      
      const values = [
        response.status,
        response.sentAt,
        response.deliveredAt,
        response.failedAt,
        response.error,
        response.messageId,
        response.trackingId,
        notificationId
      ]
      
      await client.query(query, values)
      
      logger.debug('Notification status updated', {
        notificationId,
        status: response.status
      })
    } finally {
      client.release()
    }
  }

  async getPendingNotifications(limit: number = 100): Promise<Array<NotificationRequest & { id: string }>> {
    const client = await this.pool.connect()
    
    try {
      const query = `
        SELECT id, tenant_id, recipient_id, type, channel, priority, template_id, 
               data, scheduled_at, expires_at, metadata
        FROM notifications 
        WHERE status = 'pending' 
          AND scheduled_at <= NOW()
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY priority DESC, scheduled_at ASC
        LIMIT $1
      `
      
      const result = await client.query(query, [limit])
      
      return result.rows.map(row => ({
        id: row.id,
        tenantId: row.tenant_id,
        recipientId: row.recipient_id,
        type: row.type,
        channel: row.channel,
        priority: row.priority,
        templateId: row.template_id,
        data: row.data,
        scheduledAt: row.scheduled_at,
        expiresAt: row.expires_at,
        metadata: row.metadata
      }))
    } finally {
      client.release()
    }
  }

  async getNotificationPreferences(userId: string, tenantId: string): Promise<NotificationPreferences | null> {
    const client = await this.pool.connect()
    
    try {
      const query = `
        SELECT user_id, tenant_id, email_notifications, in_app_notifications, 
               sms_notifications, push_notifications, digest_frequency,
               working_hours_start, working_hours_end, timezone, days_of_week, 
               notification_types
        FROM notification_preferences 
        WHERE user_id = $1 AND tenant_id = $2
      `
      
      const result = await client.query(query, [userId, tenantId])
      
      if (result.rows.length === 0) {
        return null
      }
      
      const row = result.rows[0]
      return {
        userId: row.user_id,
        tenantId: row.tenant_id,
        emailNotifications: row.email_notifications,
        inAppNotifications: row.in_app_notifications,
        smsNotifications: row.sms_notifications,
        pushNotifications: row.push_notifications,
        digestFrequency: row.digest_frequency,
        workingHours: {
          start: row.working_hours_start,
          end: row.working_hours_end,
          timezone: row.timezone,
          daysOfWeek: row.days_of_week
        },
        notificationTypes: row.notification_types
      }
    } finally {
      client.release()
    }
  }

  async saveNotificationPreferences(preferences: NotificationPreferences): Promise<void> {
    const client = await this.pool.connect()
    
    try {
      const query = `
        INSERT INTO notification_preferences (
          user_id, tenant_id, email_notifications, in_app_notifications,
          sms_notifications, push_notifications, digest_frequency,
          working_hours_start, working_hours_end, timezone, days_of_week,
          notification_types
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (user_id) DO UPDATE SET
          email_notifications = EXCLUDED.email_notifications,
          in_app_notifications = EXCLUDED.in_app_notifications,
          sms_notifications = EXCLUDED.sms_notifications,
          push_notifications = EXCLUDED.push_notifications,
          digest_frequency = EXCLUDED.digest_frequency,
          working_hours_start = EXCLUDED.working_hours_start,
          working_hours_end = EXCLUDED.working_hours_end,
          timezone = EXCLUDED.timezone,
          days_of_week = EXCLUDED.days_of_week,
          notification_types = EXCLUDED.notification_types,
          updated_at = NOW()
      `
      
      const values = [
        preferences.userId,
        preferences.tenantId,
        preferences.emailNotifications,
        preferences.inAppNotifications,
        preferences.smsNotifications,
        preferences.pushNotifications,
        preferences.digestFrequency,
        preferences.workingHours.start,
        preferences.workingHours.end,
        preferences.workingHours.timezone,
        preferences.workingHours.daysOfWeek,
        JSON.stringify(preferences.notificationTypes)
      ]
      
      await client.query(query, values)
      
      logger.debug('Notification preferences saved', {
        userId: preferences.userId,
        tenantId: preferences.tenantId
      })
    } finally {
      client.release()
    }
  }

  async getNotificationMetrics(tenantId: string, days: number = 30): Promise<any> {
    const client = await this.pool.connect()
    
    try {
      const query = `
        SELECT 
          COUNT(*) as total_sent,
          COUNT(*) FILTER (WHERE status = 'delivered') as total_delivered,
          COUNT(*) FILTER (WHERE status = 'failed') as total_failed,
          COUNT(*) FILTER (WHERE channel = 'email') as email_sent,
          COUNT(*) FILTER (WHERE channel = 'email' AND status = 'delivered') as email_delivered,
          AVG(EXTRACT(EPOCH FROM (delivered_at - sent_at))) as avg_delivery_time
        FROM notifications 
        WHERE tenant_id = $1 
          AND created_at >= NOW() - INTERVAL '$2 days'
          AND status IN ('sent', 'delivered', 'failed')
      `
      
      const result = await client.query(query, [tenantId, days])
      return result.rows[0]
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
    logger.info('Database service closed')
  }
}
