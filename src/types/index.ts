export interface NotificationRequest {
  id?: string
  tenantId: string
  recipientId: string
  type: NotificationType
  channel: NotificationChannel
  priority: NotificationPriority
  templateId: string
  data: Record<string, any>
  scheduledAt?: Date
  expiresAt?: Date
  metadata?: Record<string, any>
}

export interface NotificationResponse {
  id: string
  status: NotificationStatus
  sentAt?: Date
  deliveredAt?: Date
  failedAt?: Date
  error?: string
  messageId?: string
  trackingId?: string
}

export interface NotificationTemplate {
  id: string
  name: string
  subject: string
  htmlBody: string
  textBody: string
  type: NotificationType
  variables: TemplateVariable[]
  metadata?: Record<string, any>
}

export interface TemplateVariable {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'url'
  required: boolean
  description?: string
  defaultValue?: any
}

export interface EmailConfiguration {
  provider: 'gmail' | 'outlook' | 'smtp'
  host?: string
  port?: number
  secure?: boolean
  auth: {
    type: 'oauth2' | 'password'
    user: string
    pass?: string
    clientId?: string
    clientSecret?: string
    refreshToken?: string
    accessToken?: string
  }
  from: {
    name: string
    email: string
  }
}

export interface WorkflowNotificationContext {
  workItemId: string
  workItemTitle: string
  workItemType: 'objective' | 'strategy' | 'initiative' | 'task' | 'subtask'
  action: 'created' | 'updated' | 'approved' | 'rejected' | 'escalated' | 'completed'
  assigneeId?: string
  assigneeName?: string
  assigneeEmail?: string
  approverId?: string
  approverName?: string
  approverEmail?: string
  dueDate?: Date
  priority: 'low' | 'medium' | 'high' | 'critical'
  organizationName: string
  dashboardUrl: string
  workItemUrl: string
}

export interface EscalationNotificationContext extends WorkflowNotificationContext {
  escalationLevel: number
  escalationReason: string
  originalAssignee: string
  slaBreachDuration: number
  escalatedToRole: string
  escalatedToName: string
  escalatedToEmail: string
}

export interface ApprovalNotificationContext extends WorkflowNotificationContext {
  approvalType: 'creation' | 'status_change' | 'budget_approval' | 'strategic_alignment'
  requestedBy: string
  requestedByEmail: string
  businessJustification?: string
  impactAssessment?: string
  approvalDeadline: Date
  approvalUrl: string
}

export type NotificationType = 
  | 'work_item_created'
  | 'work_item_updated' 
  | 'work_item_assigned'
  | 'work_item_completed'
  | 'approval_requested'
  | 'approval_approved'
  | 'approval_rejected'
  | 'escalation_triggered'
  | 'sla_breach'
  | 'deadline_reminder'
  | 'daily_digest'
  | 'weekly_report'
  | 'system_alert'

export type NotificationChannel = 
  | 'email'
  | 'in_app'
  | 'sms'
  | 'push'
  | 'slack'
  | 'teams'
  | 'webhook'

export type NotificationPriority = 
  | 'low'
  | 'medium' 
  | 'high'
  | 'critical'

export type NotificationStatus = 
  | 'pending'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'expired'
  | 'cancelled'

export interface NotificationPreferences {
  userId: string
  tenantId: string
  emailNotifications: boolean
  inAppNotifications: boolean
  smsNotifications: boolean
  pushNotifications: boolean
  digestFrequency: 'immediate' | 'hourly' | 'daily' | 'weekly'
  workingHours: {
    start: string // HH:mm format
    end: string   // HH:mm format
    timezone: string
    daysOfWeek: number[] // 0-6, Sunday=0
  }
  notificationTypes: {
    [key in NotificationType]: {
      enabled: boolean
      channels: NotificationChannel[]
      immediateDelivery: boolean
    }
  }
}

export interface NotificationMetrics {
  totalSent: number
  totalDelivered: number
  totalFailed: number
  deliveryRate: number
  averageDeliveryTime: number
  bounceRate: number
  openRate: number
  clickRate: number
  unsubscribeRate: number
  byChannel: Record<NotificationChannel, {
    sent: number
    delivered: number
    failed: number
    deliveryRate: number
  }>
  byType: Record<NotificationType, {
    sent: number
    delivered: number
    failed: number
    deliveryRate: number
  }>
}

export interface GoogleWorkspaceConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  refreshToken: string
  accessToken?: string
  tokenExpiresAt?: Date
  scope: string[]
}

export interface SMTPConfig {
  host: string
  port: number
  secure: boolean
  auth: {
    user: string
    pass: string
  }
  pool?: boolean
  maxConnections?: number
  maxMessages?: number
  rateDelta?: number
  rateLimit?: number
}
