import Handlebars from 'handlebars'
import juice from 'juice'
import { convert } from 'html-to-text'
import { NotificationTemplate, TemplateVariable, WorkflowNotificationContext, EscalationNotificationContext, ApprovalNotificationContext } from '../types'
import { logger } from './loggerService'

export class TemplateService {
  private templates: Map<string, NotificationTemplate> = new Map()
  private compiledTemplates: Map<string, HandlebarsTemplateDelegate> = new Map()

  constructor() {
    this.initializeDefaultTemplates()
    this.registerHelpers()
  }

  private registerHelpers(): void {
    // Register Handlebars helpers for common formatting
    Handlebars.registerHelper('formatDate', (date: Date | string) => {
      if (!date) return ''
      const d = typeof date === 'string' ? new Date(date) : date
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    })

    Handlebars.registerHelper('formatDateTime', (date: Date | string) => {
      if (!date) return ''
      const d = typeof date === 'string' ? new Date(date) : date
      return d.toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short'
      })
    })

    Handlebars.registerHelper('priorityColor', (priority: string) => {
      const colors = {
        low: '#28a745',
        medium: '#ffc107',
        high: '#fd7e14',
        critical: '#dc3545'
      }
      return colors[priority as keyof typeof colors] || '#6c757d'
    })

    Handlebars.registerHelper('priorityLabel', (priority: string) => {
      const labels = {
        low: 'Low Priority',
        medium: 'Medium Priority',
        high: 'High Priority',
        critical: 'Critical Priority'
      }
      return labels[priority as keyof typeof labels] || 'Unknown Priority'
    })

    Handlebars.registerHelper('workItemTypeIcon', (type: string) => {
      const icons = {
        objective: '🎯',
        strategy: '📋',
        initiative: '🚀',
        task: '✅',
        subtask: '📝'
      }
      return icons[type as keyof typeof icons] || '📄'
    })

    Handlebars.registerHelper('eq', (a: any, b: any) => a === b)
    Handlebars.registerHelper('ne', (a: any, b: any) => a !== b)
    Handlebars.registerHelper('gt', (a: number, b: number) => a > b)
    Handlebars.registerHelper('lt', (a: number, b: number) => a < b)
  }

  private initializeDefaultTemplates(): void {
    // Work Item Assignment Template
    this.addTemplate({
      id: 'work_item_assigned',
      name: 'Work Item Assignment',
      subject: '{{workItemTypeIcon workItemType}} New {{workItemType}} assigned: {{workItemTitle}}',
      htmlBody: this.getWorkItemAssignedHTMLTemplate(),
      textBody: this.getWorkItemAssignedTextTemplate(),
      type: 'work_item_assigned',
      variables: [
        { name: 'assigneeName', type: 'string', required: true, description: 'Name of the assignee' },
        { name: 'workItemTitle', type: 'string', required: true, description: 'Title of the work item' },
        { name: 'workItemType', type: 'string', required: true, description: 'Type of work item' },
        { name: 'priority', type: 'string', required: true, description: 'Priority level' },
        { name: 'dueDate', type: 'date', required: false, description: 'Due date' },
        { name: 'workItemUrl', type: 'url', required: true, description: 'Link to work item' },
        { name: 'organizationName', type: 'string', required: true, description: 'Organization name' }
      ]
    })

    // Approval Request Template
    this.addTemplate({
      id: 'approval_requested',
      name: 'Approval Request',
      subject: '🔔 Approval Required: {{workItemTitle}}',
      htmlBody: this.getApprovalRequestHTMLTemplate(),
      textBody: this.getApprovalRequestTextTemplate(),
      type: 'approval_requested',
      variables: [
        { name: 'approverName', type: 'string', required: true, description: 'Name of the approver' },
        { name: 'requestedBy', type: 'string', required: true, description: 'Person requesting approval' },
        { name: 'workItemTitle', type: 'string', required: true, description: 'Title of the work item' },
        { name: 'workItemType', type: 'string', required: true, description: 'Type of work item' },
        { name: 'approvalType', type: 'string', required: true, description: 'Type of approval' },
        { name: 'businessJustification', type: 'string', required: false, description: 'Business justification' },
        { name: 'approvalDeadline', type: 'date', required: true, description: 'Approval deadline' },
        { name: 'approvalUrl', type: 'url', required: true, description: 'Link to approve/reject' },
        { name: 'organizationName', type: 'string', required: true, description: 'Organization name' }
      ]
    })

    // Escalation Notification Template
    this.addTemplate({
      id: 'escalation_triggered',
      name: 'Escalation Notification',
      subject: '⚠️ ESCALATION: {{workItemTitle}} - SLA Breach',
      htmlBody: this.getEscalationHTMLTemplate(),
      textBody: this.getEscalationTextTemplate(),
      type: 'escalation_triggered',
      variables: [
        { name: 'escalatedToName', type: 'string', required: true, description: 'Name of escalation recipient' },
        { name: 'workItemTitle', type: 'string', required: true, description: 'Title of the work item' },
        { name: 'originalAssignee', type: 'string', required: true, description: 'Original assignee' },
        { name: 'escalationReason', type: 'string', required: true, description: 'Reason for escalation' },
        { name: 'slaBreachDuration', type: 'number', required: true, description: 'Hours past SLA' },
        { name: 'escalationLevel', type: 'number', required: true, description: 'Escalation level' },
        { name: 'workItemUrl', type: 'url', required: true, description: 'Link to work item' },
        { name: 'organizationName', type: 'string', required: true, description: 'Organization name' }
      ]
    })

    // Daily Digest Template
    this.addTemplate({
      id: 'daily_digest',
      name: 'Daily Digest',
      subject: '📊 Daily Portfolio Digest - {{organizationName}}',
      htmlBody: this.getDailyDigestHTMLTemplate(),
      textBody: this.getDailyDigestTextTemplate(),
      type: 'daily_digest',
      variables: [
        { name: 'recipientName', type: 'string', required: true, description: 'Recipient name' },
        { name: 'totalWorkItems', type: 'number', required: true, description: 'Total work items' },
        { name: 'completedToday', type: 'number', required: true, description: 'Items completed today' },
        { name: 'overdueItems', type: 'number', required: true, description: 'Overdue items' },
        { name: 'criticalItems', type: 'number', required: true, description: 'Critical items' },
        { name: 'dashboardUrl', type: 'url', required: true, description: 'Dashboard link' },
        { name: 'organizationName', type: 'string', required: true, description: 'Organization name' }
      ]
    })

    logger.info('Default email templates initialized', {
      templateCount: this.templates.size
    })
  }

  async compileTemplate(templateId: string, data: Record<string, any>): Promise<{
    subject: string
    htmlBody: string
    textBody: string
  }> {
    try {
      const template = this.templates.get(templateId)
      if (!template) {
        throw new Error(`Template not found: ${templateId}`)
      }

      // Validate required variables
      this.validateTemplateData(template, data)

      // Compile templates if not already cached
      if (!this.compiledTemplates.has(`${templateId}_subject`)) {
        this.compiledTemplates.set(`${templateId}_subject`, Handlebars.compile(template.subject))
      }
      if (!this.compiledTemplates.has(`${templateId}_html`)) {
        this.compiledTemplates.set(`${templateId}_html`, Handlebars.compile(template.htmlBody))
      }
      if (!this.compiledTemplates.has(`${templateId}_text`)) {
        this.compiledTemplates.set(`${templateId}_text`, Handlebars.compile(template.textBody))
      }

      // Compile subject, HTML, and text
      const subject = this.compiledTemplates.get(`${templateId}_subject`)!(data)
      let htmlBody = this.compiledTemplates.get(`${templateId}_html`)!(data)
      const textBody = this.compiledTemplates.get(`${templateId}_text`)!(data)

      // Inline CSS for email clients
      htmlBody = juice(htmlBody, {
        removeStyleTags: true,
        preserveMediaQueries: false,
        preserveFontFaces: false
      })

      logger.debug('Template compiled successfully', {
        templateId,
        subjectLength: subject.length,
        htmlBodyLength: htmlBody.length,
        textBodyLength: textBody.length
      })

      return {
        subject: subject.trim(),
        htmlBody,
        textBody: textBody.trim()
      }
    } catch (error) {
      logger.error('Template compilation failed', {
        templateId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  private validateTemplateData(template: NotificationTemplate, data: Record<string, any>): void {
    const missingVariables: string[] = []
    
    template.variables.forEach(variable => {
      if (variable.required && (data[variable.name] === undefined || data[variable.name] === null)) {
        missingVariables.push(variable.name)
      }
    })

    if (missingVariables.length > 0) {
      throw new Error(`Missing required template variables: ${missingVariables.join(', ')}`)
    }
  }

  addTemplate(template: NotificationTemplate): void {
    this.templates.set(template.id, template)
    
    // Clear compiled template cache for this template
    this.compiledTemplates.delete(`${template.id}_subject`)
    this.compiledTemplates.delete(`${template.id}_html`)
    this.compiledTemplates.delete(`${template.id}_text`)
    
    logger.info('Template added', {
      templateId: template.id,
      templateName: template.name,
      type: template.type
    })
  }

  getTemplate(templateId: string): NotificationTemplate | undefined {
    return this.templates.get(templateId)
  }

  getAllTemplates(): NotificationTemplate[] {
    return Array.from(this.templates.values())
  }

  private getWorkItemAssignedHTMLTemplate(): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Work Item Assignment</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f8f9fa; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; }
        .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; }
        .content { padding: 30px; }
        .work-item { background-color: #f8f9fa; border-left: 4px solid {{priorityColor priority}}; padding: 20px; margin: 20px 0; border-radius: 4px; }
        .work-item-title { font-size: 18px; font-weight: 600; color: #333; margin-bottom: 10px; }
        .work-item-meta { color: #6c757d; font-size: 14px; margin-bottom: 15px; }
        .priority-badge { display: inline-block; background-color: {{priorityColor priority}}; color: white; padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: 500; margin-right: 10px; }
        .cta-button { display: inline-block; background-color: #007bff; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500; margin: 20px 0; }
        .cta-button:hover { background-color: #0056b3; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>{{workItemTypeIcon workItemType}} New Assignment</h1>
        </div>
        <div class="content">
            <p>Hello {{assigneeName}},</p>
            <p>You have been assigned a new {{workItemType}} that requires your attention.</p>
            
            <div class="work-item">
                <div class="work-item-title">{{workItemTitle}}</div>
                <div class="work-item-meta">
                    <span class="priority-badge">{{priorityLabel priority}}</span>
                    Type: {{workItemType}}
                    {{#if dueDate}}
                    | Due: {{formatDate dueDate}}
                    {{/if}}
                </div>
                <p>This {{workItemType}} has been assigned to you and is ready for your action.</p>
            </div>
            
            <a href="{{workItemUrl}}" class="cta-button">View Work Item</a>
            
            <p>If you have any questions about this assignment, please contact your manager or visit the HTMA dashboard for more details.</p>
        </div>
        <div class="footer">
            <p>This email was sent by {{organizationName}} via HTMA Platform</p>
            <p><a href="{{{unsubscribeUrl}}}">Unsubscribe</a> | <a href="{{dashboardUrl}}">Dashboard</a></p>
        </div>
    </div>
</body>
</html>
    `
  }

  private getWorkItemAssignedTextTemplate(): string {
    return `
{{workItemTypeIcon workItemType}} New Assignment - {{organizationName}}

Hello {{assigneeName}},

You have been assigned a new {{workItemType}} that requires your attention.

Work Item Details:
- Title: {{workItemTitle}}
- Type: {{workItemType}}
- Priority: {{priorityLabel priority}}
{{#if dueDate}}
- Due Date: {{formatDate dueDate}}
{{/if}}

View work item: {{workItemUrl}}

If you have any questions about this assignment, please contact your manager or visit the HTMA dashboard for more details.

---
This email was sent by {{organizationName}} via HTMA Platform
Unsubscribe: {{{unsubscribeUrl}}}
Dashboard: {{dashboardUrl}}
    `
  }

  private getApprovalRequestHTMLTemplate(): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Approval Request</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f8f9fa; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background: linear-gradient(135deg, #fd7e14 0%, #dc3545 100%); padding: 30px; text-align: center; }
        .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; }
        .content { padding: 30px; }
        .approval-box { background-color: #fff3cd; border: 1px solid #ffc107; padding: 20px; margin: 20px 0; border-radius: 6px; }
        .approval-actions { text-align: center; margin: 30px 0; }
        .approve-btn { display: inline-block; background-color: #28a745; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500; margin: 0 10px; }
        .reject-btn { display: inline-block; background-color: #dc3545; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500; margin: 0 10px; }
        .deadline { color: #dc3545; font-weight: 600; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔔 Approval Required</h1>
        </div>
        <div class="content">
            <p>Hello {{approverName}},</p>
            <p>{{requestedBy}} has requested your approval for the following {{workItemType}}:</p>
            
            <div class="approval-box">
                <h3>{{workItemTitle}}</h3>
                <p><strong>Approval Type:</strong> {{approvalType}}</p>
                <p><strong>Requested By:</strong> {{requestedBy}}</p>
                <p><strong>Deadline:</strong> <span class="deadline">{{formatDateTime approvalDeadline}}</span></p>
                {{#if businessJustification}}
                <p><strong>Business Justification:</strong></p>
                <p>{{businessJustification}}</p>
                {{/if}}
            </div>
            
            <div class="approval-actions">
                <a href="{{approvalUrl}}?action=approve" class="approve-btn">✅ Approve</a>
                <a href="{{approvalUrl}}?action=reject" class="reject-btn">❌ Reject</a>
            </div>
            
            <p><a href="{{workItemUrl}}">View full details</a> in the HTMA dashboard.</p>
            
            <p><strong>Important:</strong> Please review and respond by {{formatDateTime approvalDeadline}} to avoid escalation.</p>
        </div>
        <div class="footer">
            <p>This email was sent by {{organizationName}} via HTMA Platform</p>
            <p><a href="{{{unsubscribeUrl}}}">Unsubscribe</a> | <a href="{{dashboardUrl}}">Dashboard</a></p>
        </div>
    </div>
</body>
</html>
    `
  }

  private getApprovalRequestTextTemplate(): string {
    return `
🔔 Approval Required - {{organizationName}}

Hello {{approverName}},

{{requestedBy}} has requested your approval for the following {{workItemType}}:

{{workItemTitle}}

Approval Details:
- Type: {{approvalType}}
- Requested By: {{requestedBy}}
- Deadline: {{formatDateTime approvalDeadline}}
{{#if businessJustification}}
- Business Justification: {{businessJustification}}
{{/if}}

ACTIONS:
- Approve: {{approvalUrl}}?action=approve
- Reject: {{approvalUrl}}?action=reject
- View Details: {{workItemUrl}}

IMPORTANT: Please review and respond by {{formatDateTime approvalDeadline}} to avoid escalation.

---
This email was sent by {{organizationName}} via HTMA Platform
Unsubscribe: {{{unsubscribeUrl}}}
Dashboard: {{dashboardUrl}}
    `
  }

  private getEscalationHTMLTemplate(): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Escalation Notification</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f8f9fa; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background: linear-gradient(135deg, #dc3545 0%, #6f42c1 100%); padding: 30px; text-align: center; }
        .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; }
        .content { padding: 30px; }
        .escalation-box { background-color: #f8d7da; border: 1px solid #dc3545; padding: 20px; margin: 20px 0; border-radius: 6px; }
        .escalation-level { background-color: #dc3545; color: white; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600; display: inline-block; margin-bottom: 15px; }
        .breach-duration { color: #dc3545; font-weight: 600; font-size: 18px; }
        .cta-button { display: inline-block; background-color: #dc3545; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500; margin: 20px 0; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⚠️ ESCALATION ALERT</h1>
        </div>
        <div class="content">
            <p>Hello {{escalatedToName}},</p>
            
            <div class="escalation-box">
                <div class="escalation-level">Level {{escalationLevel}} Escalation</div>
                <h3>{{workItemTitle}}</h3>
                <p><strong>Original Assignee:</strong> {{originalAssignee}}</p>
                <p><strong>Escalation Reason:</strong> {{escalationReason}}</p>
                <p><strong>SLA Breach Duration:</strong> <span class="breach-duration">{{slaBreachDuration}} hours overdue</span></p>
            </div>
            
            <p>This work item has been escalated to you due to an SLA breach. Immediate attention is required to prevent further delays and potential impact on organizational objectives.</p>
            
            <a href="{{workItemUrl}}" class="cta-button">Take Action Now</a>
            
            <p><strong>Next Steps:</strong></p>
            <ul>
                <li>Review the work item details</li>
                <li>Determine the appropriate course of action</li>
                <li>Reassign if necessary or take direct action</li>
                <li>Update stakeholders on resolution plan</li>
            </ul>
        </div>
        <div class="footer">
            <p>This email was sent by {{organizationName}} via HTMA Platform</p>
            <p><a href="{{{unsubscribeUrl}}}">Unsubscribe</a> | <a href="{{dashboardUrl}}">Dashboard</a></p>
        </div>
    </div>
</body>
</html>
    `
  }

  private getEscalationTextTemplate(): string {
    return `
⚠️ ESCALATION ALERT - {{organizationName}}

Hello {{escalatedToName}},

LEVEL {{escalationLevel}} ESCALATION

Work Item: {{workItemTitle}}
Original Assignee: {{originalAssignee}}
Escalation Reason: {{escalationReason}}
SLA Breach Duration: {{slaBreachDuration}} hours overdue

This work item has been escalated to you due to an SLA breach. Immediate attention is required to prevent further delays and potential impact on organizational objectives.

Take Action: {{workItemUrl}}

Next Steps:
- Review the work item details
- Determine the appropriate course of action  
- Reassign if necessary or take direct action
- Update stakeholders on resolution plan

---
This email was sent by {{organizationName}} via HTMA Platform
Unsubscribe: {{{unsubscribeUrl}}}
Dashboard: {{dashboardUrl}}
    `
  }

  private getDailyDigestHTMLTemplate(): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Daily Portfolio Digest</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f8f9fa; }
        .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
        .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); padding: 30px; text-align: center; }
        .header h1 { color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; }
        .content { padding: 30px; }
        .metrics { display: flex; justify-content: space-between; margin: 20px 0; }
        .metric { text-align: center; flex: 1; margin: 0 10px; padding: 20px; background-color: #f8f9fa; border-radius: 8px; }
        .metric-value { font-size: 32px; font-weight: 700; color: #333; }
        .metric-label { font-size: 14px; color: #6c757d; margin-top: 5px; }
        .cta-button { display: inline-block; background-color: #007bff; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500; margin: 20px 0; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; font-size: 12px; }
        @media (max-width: 600px) {
            .metrics { flex-direction: column; }
            .metric { margin: 10px 0; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Daily Portfolio Digest</h1>
        </div>
        <div class="content">
            <p>Good morning {{recipientName}},</p>
            <p>Here's your daily portfolio summary for {{formatDate today}}:</p>
            
            <div class="metrics">
                <div class="metric">
                    <div class="metric-value">{{totalWorkItems}}</div>
                    <div class="metric-label">Total Items</div>
                </div>
                <div class="metric">
                    <div class="metric-value" style="color: #28a745;">{{completedToday}}</div>
                    <div class="metric-label">Completed Today</div>
                </div>
                <div class="metric">
                    <div class="metric-value" style="color: #dc3545;">{{overdueItems}}</div>
                    <div class="metric-label">Overdue</div>
                </div>
                <div class="metric">
                    <div class="metric-value" style="color: #fd7e14;">{{criticalItems}}</div>
                    <div class="metric-label">Critical</div>
                </div>
            </div>
            
            {{#if gt overdueItems 0}}
            <div style="background-color: #f8d7da; border: 1px solid #dc3545; padding: 15px; border-radius: 6px; margin: 20px 0;">
                <strong>⚠️ Attention Required:</strong> You have {{overdueItems}} overdue item{{#if gt overdueItems 1}}s{{/if}} that need immediate attention.
            </div>
            {{/if}}
            
            {{#if gt criticalItems 0}}
            <div style="background-color: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 6px; margin: 20px 0;">
                <strong>🔥 Critical Items:</strong> {{criticalItems}} critical priority item{{#if gt criticalItems 1}}s{{/if}} require your focus today.
            </div>
            {{/if}}
            
            <a href="{{dashboardUrl}}" class="cta-button">View Dashboard</a>
            
            <p>Have a productive day!</p>
        </div>
        <div class="footer">
            <p>This email was sent by {{organizationName}} via HTMA Platform</p>
            <p><a href="{{{unsubscribeUrl}}}">Unsubscribe</a> | <a href="{{dashboardUrl}}">Dashboard</a></p>
        </div>
    </div>
</body>
</html>
    `
  }

  private getDailyDigestTextTemplate(): string {
    return `
📊 Daily Portfolio Digest - {{organizationName}}

Good morning {{recipientName}},

Here's your daily portfolio summary for {{formatDate today}}:

PORTFOLIO METRICS:
- Total Items: {{totalWorkItems}}
- Completed Today: {{completedToday}}
- Overdue: {{overdueItems}}
- Critical: {{criticalItems}}

{{#if gt overdueItems 0}}
⚠️ ATTENTION REQUIRED: You have {{overdueItems}} overdue item{{#if gt overdueItems 1}}s{{/if}} that need immediate attention.
{{/if}}

{{#if gt criticalItems 0}}
🔥 CRITICAL ITEMS: {{criticalItems}} critical priority item{{#if gt criticalItems 1}}s{{/if}} require your focus today.
{{/if}}

View Dashboard: {{dashboardUrl}}

Have a productive day!

---
This email was sent by {{organizationName}} via HTMA Platform
Unsubscribe: {{{unsubscribeUrl}}}
Dashboard: {{dashboardUrl}}
    `
  }
}
