import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { logger } from '../services/loggerService'

interface AuthRequest extends Request {
  user?: {
    id: string
    tenantId: string
    roles: string[]
    email: string
  }
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization
    
    if (!authHeader) {
      res.status(401).json({ error: 'Authorization header missing' })
      return
    }

    const token = authHeader.split(' ')[1] // Bearer <token>
    
    if (!token) {
      res.status(401).json({ error: 'Token missing' })
      return
    }

    const jwtSecret = process.env.JWT_SECRET || 'default-secret'
    
    try {
      const decoded = jwt.verify(token, jwtSecret) as any
      
      req.user = {
        id: decoded.sub || decoded.userId,
        tenantId: decoded.tenantId,
        roles: decoded.roles || [],
        email: decoded.email
      }
      
      next()
    } catch (jwtError) {
      logger.warn('Invalid JWT token', {
        error: jwtError instanceof Error ? jwtError.message : 'Unknown error',
        token: token.substring(0, 20) + '...' // Log only first 20 chars
      })
      
      res.status(401).json({ error: 'Invalid token' })
      return
    }
  } catch (error) {
    logger.error('Auth middleware error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    
    res.status(500).json({ error: 'Authentication error' })
  }
}

export const requireRole = (requiredRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'User not authenticated' })
      return
    }

    const userRoles = req.user.roles || []
    const hasRequiredRole = requiredRoles.some(role => userRoles.includes(role))
    
    if (!hasRequiredRole) {
      logger.warn('Access denied - insufficient role', {
        userId: req.user.id,
        userRoles,
        requiredRoles
      })
      
      res.status(403).json({ 
        error: 'Insufficient permissions',
        required: requiredRoles,
        current: userRoles
      })
      return
    }
    
    next()
  }
}

export const optionalAuth = (req: AuthRequest, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization
    
    if (!authHeader) {
      next() // Continue without authentication
      return
    }

    const token = authHeader.split(' ')[1]
    
    if (!token) {
      next() // Continue without authentication
      return
    }

    const jwtSecret = process.env.JWT_SECRET || 'default-secret'
    
    try {
      const decoded = jwt.verify(token, jwtSecret) as any
      
      req.user = {
        id: decoded.sub || decoded.userId,
        tenantId: decoded.tenantId,
        roles: decoded.roles || [],
        email: decoded.email
      }
    } catch (jwtError) {
      // Continue without authentication if token is invalid
      logger.debug('Optional auth failed, continuing without auth', {
        error: jwtError instanceof Error ? jwtError.message : 'Unknown error'
      })
    }
    
    next()
  } catch (error) {
    logger.error('Optional auth middleware error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    
    next() // Continue without authentication on error
  }
}
