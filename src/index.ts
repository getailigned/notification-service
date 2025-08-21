import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import morgan from 'morgan'
import dotenv from 'dotenv'
import { NotificationService } from './services/notificationService'
import { DatabaseService } from './services/databaseService'
import { NotificationController } from './controllers/notificationController'
import { authMiddleware, requireRole, optionalAuth } from './middleware/authMiddleware'
import { logger } from './services/loggerService'

// Load environment variables
dotenv.config()

const app = express()
const port = process.env.PORT || 3007

// Global services
let notificationService: NotificationService
let databaseService: DatabaseService
let notificationController: NotificationController

// Middleware
app.use(helmet())
app.use(compression())
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// Logging middleware
app.use(morgan('combined', {
  stream: {
    write: (message: string) => logger.info(message.trim())
  }
}))

// Health check endpoint (public)
app.get('/health', (req, res) => {
  notificationController.healthCheck(req, res)
})

// Notification tracking endpoints (public)
app.get('/track/open/:notificationId', (req, res) => {
  notificationController.trackNotificationOpen(req, res)
})

app.get('/unsubscribe', (req, res) => {
  notificationController.unsubscribe(req, res)
})

// API Routes (authenticated)
const apiRouter = express.Router()

// Apply authentication middleware to all API routes
apiRouter.use(authMiddleware)

// Notification endpoints
apiRouter.post('/notifications/send', (req, res) => {
  notificationController.sendNotification(req, res)
})

apiRouter.post('/notifications/bulk', requireRole(['Manager', 'Director', 'VP', 'President', 'CEO']), (req, res) => {
  notificationController.sendBulkNotifications(req, res)
})

// User preference endpoints
apiRouter.get('/preferences/:userId', (req, res) => {
  notificationController.getNotificationPreferences(req, res)
})

apiRouter.put('/preferences/:userId', (req, res) => {
  notificationController.updateNotificationPreferences(req, res)
})

// Metrics endpoints (requires elevated permissions)
apiRouter.get('/metrics', requireRole(['Manager', 'Director', 'VP', 'President', 'CEO']), (req, res) => {
  notificationController.getNotificationMetrics(req, res)
})

// Mount API routes
app.use('/api', apiRouter)

// Webhook endpoints for external integrations (optional auth)
app.post('/webhooks/workflow', optionalAuth, async (req, res) => {
  try {
    logger.info('Received workflow webhook', {
      type: req.body.type,
      workItemId: req.body.workItemId
    })
    
    // Process webhook - this would typically trigger notifications
    // For now, just acknowledge receipt
    res.status(200).json({ 
      success: true, 
      message: 'Webhook received and will be processed' 
    })
  } catch (error) {
    logger.error('Webhook processing failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    res.status(500).json({ error: 'Webhook processing failed' })
  }
})

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  })
  
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  })
})

// 404 handler
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path
  })
})

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}, starting graceful shutdown`)
  
  try {
    if (notificationService) {
      await notificationService.close()
    }
    
    process.exit(0)
  } catch (error) {
    logger.error('Error during graceful shutdown', {
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    process.exit(1)
  }
}

// Setup signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  })
})

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack
  })
  process.exit(1)
})

// Initialize and start server
const startServer = async () => {
  try {
    logger.info('Starting HTMA Notification Service', {
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      port
    })

    // Initialize services
    notificationService = new NotificationService()
    databaseService = new DatabaseService()
    notificationController = new NotificationController(notificationService, databaseService)

    // Initialize notification service (this connects to all dependencies)
    await notificationService.initialize()

    // Start HTTP server
    const server = app.listen(port, () => {
      logger.info(`Notification Service started successfully`, {
        port,
        environment: process.env.NODE_ENV || 'development'
      })
    })

    // Handle server errors
    server.on('error', (error: Error) => {
      logger.error('Server error', { error: error.message })
      process.exit(1)
    })

    return server
  } catch (error) {
    logger.error('Failed to start notification service', {
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    process.exit(1)
  }
}

// Start the server
startServer().catch((error) => {
  logger.error('Failed to start server', {
    error: error instanceof Error ? error.message : 'Unknown error'
  })
  process.exit(1)
})
