import winston from 'winston'

const logLevel = process.env.LOG_LEVEL || 'info'
const logFormat = process.env.LOG_FORMAT || 'json'

const customFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
  logFormat === 'json' 
    ? winston.format.json()
    : winston.format.simple()
)

export const logger = winston.createLogger({
  level: logLevel,
  format: customFormat,
  defaultMeta: { 
    service: 'notification-service',
    version: process.env.npm_package_version || '1.0.0'
  },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
})

// Add file transport in production
if (process.env.NODE_ENV === 'production') {
  logger.add(new winston.transports.File({ 
    filename: '/var/log/htma/notification-service.log',
    maxsize: 10485760, // 10MB
    maxFiles: 5,
    tailable: true
  }))
}
