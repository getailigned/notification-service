import amqp from 'amqplib'
import { NotificationRequest } from '../types'
import { logger } from './loggerService'

export class MessageQueueService {
  private connection: amqp.Connection | null = null
  private channel: amqp.Channel | null = null
  private readonly rabbitMQUrl: string

  constructor() {
    this.rabbitMQUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672'
  }

  async connect(): Promise<void> {
    try {
      this.connection = await amqp.connect(this.rabbitMQUrl)
      this.channel = await this.connection.createChannel()

      // Setup exchanges and queues
      await this.setupExchangesAndQueues()
      
      // Handle connection events
      this.connection.on('error', (err) => {
        logger.error('RabbitMQ connection error', { error: err.message })
      })

      this.connection.on('close', () => {
        logger.warn('RabbitMQ connection closed')
        this.reconnect()
      })

      logger.info('Connected to RabbitMQ')
    } catch (error) {
      logger.error('Failed to connect to RabbitMQ', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  private async setupExchangesAndQueues(): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized')

    // Create exchanges
    await this.channel.assertExchange('htma.notifications', 'topic', { durable: true })
    await this.channel.assertExchange('htma.workflows', 'topic', { durable: true })
    await this.channel.assertExchange('htma.work-items', 'topic', { durable: true })

    // Create notification queues
    await this.channel.assertQueue('notifications.email', { durable: true })
    await this.channel.assertQueue('notifications.in-app', { durable: true })
    await this.channel.assertQueue('notifications.digest', { durable: true })
    await this.channel.assertQueue('notifications.escalation', { durable: true })

    // Bind queues to exchanges
    await this.channel.bindQueue('notifications.email', 'htma.notifications', 'notification.email.*')
    await this.channel.bindQueue('notifications.in-app', 'htma.notifications', 'notification.in-app.*')
    await this.channel.bindQueue('notifications.digest', 'htma.notifications', 'notification.digest.*')
    await this.channel.bindQueue('notifications.escalation', 'htma.notifications', 'notification.escalation.*')

    // Bind to workflow events
    await this.channel.bindQueue('notifications.email', 'htma.workflows', 'workflow.*')
    await this.channel.bindQueue('notifications.escalation', 'htma.workflows', 'workflow.escalation.*')

    // Bind to work item events
    await this.channel.bindQueue('notifications.email', 'htma.work-items', 'work-item.*')
    await this.channel.bindQueue('notifications.in-app', 'htma.work-items', 'work-item.*')

    logger.info('RabbitMQ exchanges and queues setup completed')
  }

  private async reconnect(): Promise<void> {
    try {
      await new Promise(resolve => setTimeout(resolve, 5000)) // Wait 5 seconds
      await this.connect()
    } catch (error) {
      logger.error('Failed to reconnect to RabbitMQ', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      setTimeout(() => this.reconnect(), 10000) // Retry in 10 seconds
    }
  }

  async subscribeToWorkflowEvents(callback: (event: any) => Promise<void>): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized')

    await this.channel.consume('notifications.email', async (msg) => {
      if (!msg) return

      try {
        const event = JSON.parse(msg.content.toString())
        logger.debug('Received workflow event', {
          routingKey: msg.fields.routingKey,
          eventType: event.type
        })

        await callback(event)
        this.channel!.ack(msg)
      } catch (error) {
        logger.error('Failed to process workflow event', {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        this.channel!.nack(msg, false, false) // Don't requeue
      }
    })

    logger.info('Subscribed to workflow events')
  }

  async subscribeToWorkItemEvents(callback: (event: any) => Promise<void>): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized')

    await this.channel.consume('notifications.in-app', async (msg) => {
      if (!msg) return

      try {
        const event = JSON.parse(msg.content.toString())
        logger.debug('Received work item event', {
          routingKey: msg.fields.routingKey,
          eventType: event.type
        })

        await callback(event)
        this.channel!.ack(msg)
      } catch (error) {
        logger.error('Failed to process work item event', {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        this.channel!.nack(msg, false, false) // Don't requeue
      }
    })

    logger.info('Subscribed to work item events')
  }

  async publishNotificationEvent(
    routingKey: string, 
    notification: NotificationRequest
  ): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized')

    try {
      const message = Buffer.from(JSON.stringify({
        ...notification,
        timestamp: new Date().toISOString(),
        source: 'notification-service'
      }))

      await this.channel.publish(
        'htma.notifications',
        routingKey,
        message,
        { 
          persistent: true,
          messageId: notification.id,
          timestamp: Date.now(),
          headers: {
            tenantId: notification.tenantId,
            type: notification.type,
            priority: notification.priority
          }
        }
      )

      logger.debug('Published notification event', {
        routingKey,
        notificationId: notification.id,
        type: notification.type
      })
    } catch (error) {
      logger.error('Failed to publish notification event', {
        routingKey,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  async publishWorkflowEvent(event: {
    type: string
    workItemId: string
    tenantId: string
    data: any
  }): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized')

    try {
      const routingKey = `workflow.${event.type}`
      const message = Buffer.from(JSON.stringify({
        ...event,
        timestamp: new Date().toISOString(),
        source: 'notification-service'
      }))

      await this.channel.publish(
        'htma.workflows',
        routingKey,
        message,
        { 
          persistent: true,
          timestamp: Date.now(),
          headers: {
            tenantId: event.tenantId,
            workItemId: event.workItemId,
            type: event.type
          }
        }
      )

      logger.debug('Published workflow event', {
        routingKey,
        workItemId: event.workItemId,
        type: event.type
      })
    } catch (error) {
      logger.error('Failed to publish workflow event', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  async startDigestProcessor(callback: (digestType: string) => Promise<void>): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized')

    await this.channel.consume('notifications.digest', async (msg) => {
      if (!msg) return

      try {
        const data = JSON.parse(msg.content.toString())
        logger.debug('Processing digest request', {
          digestType: data.digestType,
          tenantId: data.tenantId
        })

        await callback(data.digestType)
        this.channel!.ack(msg)
      } catch (error) {
        logger.error('Failed to process digest request', {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        this.channel!.nack(msg, false, true) // Requeue for retry
      }
    })

    logger.info('Digest processor started')
  }

  async startEscalationProcessor(callback: (escalation: any) => Promise<void>): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized')

    await this.channel.consume('notifications.escalation', async (msg) => {
      if (!msg) return

      try {
        const escalation = JSON.parse(msg.content.toString())
        logger.debug('Processing escalation', {
          workItemId: escalation.workItemId,
          escalationLevel: escalation.escalationLevel
        })

        await callback(escalation)
        this.channel!.ack(msg)
      } catch (error) {
        logger.error('Failed to process escalation', {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        this.channel!.nack(msg, false, true) // Requeue for retry
      }
    })

    logger.info('Escalation processor started')
  }

  async scheduleDigest(tenantId: string, digestType: 'daily' | 'weekly', scheduledTime: Date): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized')

    const delay = scheduledTime.getTime() - Date.now()
    
    if (delay <= 0) {
      // Schedule for immediate processing
      await this.publishDigestRequest(tenantId, digestType)
      return
    }

    // Use RabbitMQ delayed message plugin or implement delay logic
    const message = Buffer.from(JSON.stringify({
      tenantId,
      digestType,
      scheduledFor: scheduledTime.toISOString()
    }))

    await this.channel.publish(
      'htma.notifications',
      `notification.digest.${digestType}`,
      message,
      { 
        persistent: true,
        headers: {
          'x-delay': delay // If using rabbitmq-delayed-message-exchange plugin
        }
      }
    )

    logger.debug('Digest scheduled', {
      tenantId,
      digestType,
      scheduledFor: scheduledTime.toISOString(),
      delay
    })
  }

  private async publishDigestRequest(tenantId: string, digestType: string): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized')

    const message = Buffer.from(JSON.stringify({
      tenantId,
      digestType,
      timestamp: new Date().toISOString()
    }))

    await this.channel.sendToQueue('notifications.digest', message, { persistent: true })
  }

  async close(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close()
        this.channel = null
      }
      if (this.connection) {
        await this.connection.close()
        this.connection = null
      }
      logger.info('Message queue service closed')
    } catch (error) {
      logger.error('Error closing message queue service', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}
