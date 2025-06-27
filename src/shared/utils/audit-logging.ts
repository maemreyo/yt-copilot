/**
 * Audit Logger for tracking security and compliance events
 */
import { Logger, LogLevel } from './logging';

export class AuditLogger {
  private logger: Logger;

  constructor() {
    this.logger = new Logger({
      service: 'audit-service',
      level: LogLevel.INFO,
      enablePerformanceTracking: false,
    });
  }

  /**
   * Log an audit event
   */
  async log(
    eventType: string,
    userId: string,
    details: Record<string, any>,
    requestId?: string,
  ): Promise<void> {
    this.logger.info(`AUDIT: ${eventType}`, {
      userId,
      eventType,
      details,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Log a security event
   */
  async logSecurityEvent(
    eventType: string,
    userId: string,
    details: Record<string, any>,
    requestId?: string,
  ): Promise<void> {
    this.logger.warn(`SECURITY: ${eventType}`, {
      userId,
      eventType,
      details,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Log a data access event
   */
  async logDataAccess(
    resourceType: string,
    resourceId: string,
    userId: string,
    action: 'read' | 'create' | 'update' | 'delete',
    details: Record<string, any>,
    requestId?: string,
  ): Promise<void> {
    this.logger.info(`DATA_ACCESS: ${action}`, {
      userId,
      resourceType,
      resourceId,
      action,
      details,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
