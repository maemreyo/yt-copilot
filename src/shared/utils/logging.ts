// Comprehensive structured logging system with context, formatting, and external integrations

import { env, environment } from '../config/environment';

/**
 * Log levels enum
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
}

/**
 * Log level names
 */
export const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.FATAL]: 'FATAL',
};

/**
 * Log entry interface
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  levelName: string;
  message: string;
  context?: LogContext;
  metadata?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  performance?: {
    duration?: number;
    memory?: number;
    cpu?: number;
  };
  trace?: {
    traceId?: string;
    spanId?: string;
    parentSpanId?: string;
  };
}

/**
 * Log context interface
 */
export interface LogContext {
  requestId?: string;
  userId?: string;
  sessionId?: string;
  apiKeyId?: string;
  endpoint?: string;
  method?: string;
  userAgent?: string;
  ip?: string;
  module?: string;
  function?: string;
  environment?: string;
  version?: string;
  [key: string]: unknown;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableStructured: boolean;
  enableColors: boolean;
  includeStackTrace: boolean;
  maxMessageLength: number;
  sensitiveFields: string[];
  redactSensitiveData: boolean;
  timestampFormat: 'iso' | 'unix' | 'readable';
  outputs: LogOutput[];
}

/**
 * Log output interface
 */
export interface LogOutput {
  name: string;
  enabled: boolean;
  minLevel: LogLevel;
  write(entry: LogEntry): Promise<void>;
}

/**
 * Log formatter interface
 */
export interface LogFormatter {
  format(entry: LogEntry): string;
}

/**
 * Console log formatter
 */
export class ConsoleFormatter implements LogFormatter {
  private enableColors: boolean;
  private includeStackTrace: boolean;

  constructor(enableColors: boolean = true, includeStackTrace: boolean = true) {
    this.enableColors = enableColors && !environment.isProduction();
    this.includeStackTrace = includeStackTrace;
  }

  format(entry: LogEntry): string {
    const parts: string[] = [];

    // Timestamp
    parts.push(`[${entry.timestamp}]`);

    // Level with colors
    const levelName = this.enableColors
      ? this.colorizeLevel(entry.level, entry.levelName)
      : entry.levelName;
    parts.push(`[${levelName}]`);

    // Context
    if (entry.context) {
      const contextParts: string[] = [];

      if (entry.context.requestId) {
        contextParts.push(`req:${entry.context.requestId.substring(0, 8)}`);
      }

      if (entry.context.userId) {
        contextParts.push(`user:${entry.context.userId.substring(0, 8)}`);
      }

      if (entry.context.module) {
        contextParts.push(`${entry.context.module}`);
      }

      if (contextParts.length > 0) {
        parts.push(`[${contextParts.join('|')}]`);
      }
    }

    // Message
    parts.push(entry.message);

    // Metadata
    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      parts.push(`\n  Metadata: ${JSON.stringify(entry.metadata, null, 2)}`);
    }

    // Error details
    if (entry.error) {
      parts.push(`\n  Error: ${entry.error.name}: ${entry.error.message}`);

      if (this.includeStackTrace && entry.error.stack) {
        parts.push(`\n  Stack: ${entry.error.stack}`);
      }
    }

    // Performance data
    if (entry.performance) {
      const perfParts: string[] = [];

      if (entry.performance.duration !== undefined) {
        perfParts.push(`${entry.performance.duration}ms`);
      }

      if (entry.performance.memory !== undefined) {
        perfParts.push(
          `${Math.round(entry.performance.memory / 1024 / 1024)}MB`,
        );
      }

      if (perfParts.length > 0) {
        parts.push(`\n  Performance: ${perfParts.join(', ')}`);
      }
    }

    return parts.join(' ');
  }

  private colorizeLevel(level: LogLevel, levelName: string): string {
    if (!this.enableColors) return levelName;

    const colors = {
      [LogLevel.DEBUG]: '\x1b[36m', // Cyan
      [LogLevel.INFO]: '\x1b[32m', // Green
      [LogLevel.WARN]: '\x1b[33m', // Yellow
      [LogLevel.ERROR]: '\x1b[31m', // Red
      [LogLevel.FATAL]: '\x1b[35m', // Magenta
    };

    const reset = '\x1b[0m';
    return `${colors[level]}${levelName}${reset}`;
  }
}

/**
 * JSON log formatter
 */
export class JsonFormatter implements LogFormatter {
  format(entry: LogEntry): string {
    return JSON.stringify(entry);
  }
}

/**
 * Console log output
 */
export class ConsoleOutput implements LogOutput {
  name = 'console';
  enabled = true;
  minLevel = LogLevel.DEBUG;
  private formatter: LogFormatter;

  constructor(formatter?: LogFormatter) {
    this.formatter = formatter || new ConsoleFormatter();
  }

  async write(entry: LogEntry): Promise<void> {
    const formatted = this.formatter.format(entry);

    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(formatted);
        break;
      case LogLevel.INFO:
        console.info(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(formatted);
        break;
    }
  }
}

/**
 * File log output (for server environments)
 */
export class FileOutput implements LogOutput {
  name = 'file';
  enabled = true;
  minLevel = LogLevel.INFO;
  private formatter: LogFormatter;
  private filepath: string;

  constructor(filepath: string, formatter?: LogFormatter) {
    this.filepath = filepath;
    this.formatter = formatter || new JsonFormatter();
  }

  async write(entry: LogEntry): Promise<void> {
    try {
      const formatted = this.formatter.format(entry) + '\n';

      // In Edge Functions/Deno environment, we might not have file system access
      // This would be implemented differently in a Node.js environment
      if (typeof Deno !== 'undefined' && Deno.writeTextFile) {
        await Deno.writeTextFile(this.filepath, formatted, { append: true });
      } else {
        // Fallback to console in environments without file system
        console.log(formatted.trim());
      }
    } catch (error: any) {
      console.error('Failed to write log to file:', error);
    }
  }
}

/**
 * External service output (e.g., Sentry, DataDog)
 */
export class ExternalServiceOutput implements LogOutput {
  name = 'external';
  enabled = true;
  minLevel = LogLevel.WARN;
  private serviceName: string;
  private apiKey?: string;
  private endpoint?: string;

  constructor(serviceName: string, apiKey?: string, endpoint?: string) {
    this.serviceName = serviceName;
    this.apiKey = apiKey;
    this.endpoint = endpoint;
  }

  async write(entry: LogEntry): Promise<void> {
    try {
      // Example integration with external logging service
      if (this.serviceName === 'sentry' && entry.level >= LogLevel.ERROR) {
        await this.sendToSentry(entry);
      } else if (this.endpoint) {
        await this.sendToCustomEndpoint(entry);
      }
    } catch (error: any) {
      console.error('Failed to send log to external service:', error);
    }
  }

  private async sendToSentry(entry: LogEntry): Promise<void> {
    // This would integrate with Sentry SDK
    // For now, just log the intent
    console.log(`[SENTRY] Would send error: ${entry.message}`);
  }

  private async sendToCustomEndpoint(entry: LogEntry): Promise<void> {
    if (!this.endpoint || !this.apiKey) return;

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(entry),
      });
    } catch (error: any) {
      console.error('Failed to send log to custom endpoint:', error);
    }
  }
}

/**
 * Data redactor for sensitive information
 */
export class DataRedactor {
  private sensitiveFields: Set<string>;
  private redactionValue: string;

  constructor(
    sensitiveFields: string[] = [],
    redactionValue: string = '[REDACTED]',
  ) {
    this.sensitiveFields = new Set([
      'password',
      'token',
      'secret',
      'key',
      'authorization',
      'cookie',
      'session',
      'credit_card',
      'ssn',
      'email',
      ...sensitiveFields,
    ]);
    this.redactionValue = redactionValue;
  }

  redact(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'string') {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.redact(item));
    }

    if (typeof data === 'object') {
      const redacted: any = {};

      for (const [key, value] of Object.entries(data)) {
        const lowerKey = key.toLowerCase();

        if (
          this.sensitiveFields.has(lowerKey) ||
          this.containsSensitivePattern(lowerKey)
        ) {
          redacted[key] = this.redactionValue;
        } else {
          redacted[key] = this.redact(value);
        }
      }

      return redacted;
    }

    return data;
  }

  private containsSensitivePattern(key: string): boolean {
    const sensitivePatterns = [
      /password/i,
      /secret/i,
      /token/i,
      /key$/i,
      /auth/i,
      /credential/i,
    ];

    return sensitivePatterns.some((pattern) => pattern.test(key));
  }
}

/**
 * Performance tracker
 */
export class PerformanceTracker {
  private startTime: number;
  private startMemory?: number;

  constructor() {
    this.startTime = performance.now();

    // Get initial memory usage if available
    if (typeof performance !== 'undefined' && performance.memory) {
      this.startMemory = performance.memory.usedJSHeapSize;
    }
  }

  getMetrics(): { duration: number; memory?: number } {
    const duration = Math.round(performance.now() - this.startTime);

    let memory: number | undefined;
    if (this.startMemory !== undefined && performance.memory) {
      memory = performance.memory.usedJSHeapSize - this.startMemory;
    }

    return { duration, memory };
  }
}

/**
 * Main logger class
 */
export class Logger {
  private config: Required<LoggerConfig>;
  private context: LogContext = {};
  private redactor: DataRedactor;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: this.parseLogLevel(env.LOG_LEVEL) || LogLevel.INFO,
      enableConsole: config.enableConsole ?? true,
      enableStructured: config.enableStructured ?? environment.isProduction(),
      enableColors: config.enableColors ?? !environment.isProduction(),
      includeStackTrace: config.includeStackTrace ??
        !environment.isProduction(),
      maxMessageLength: config.maxMessageLength ?? 10000,
      sensitiveFields: config.sensitiveFields ?? [],
      redactSensitiveData: config.redactSensitiveData ?? true,
      timestampFormat: config.timestampFormat ?? 'iso',
      outputs: config.outputs ?? this.createDefaultOutputs(),
    };

    this.redactor = new DataRedactor(this.config.sensitiveFields);
  }

  private parseLogLevel(levelStr: string): LogLevel | null {
    const mapping: Record<string, LogLevel> = {
      debug: LogLevel.DEBUG,
      info: LogLevel.INFO,
      warn: LogLevel.WARN,
      error: LogLevel.ERROR,
      fatal: LogLevel.FATAL,
    };

    return mapping[levelStr?.toLowerCase()] || null;
  }

  private createDefaultOutputs(): LogOutput[] {
    const outputs: LogOutput[] = [];

    // Console output
    if (this.config.enableConsole) {
      const formatter = this.config.enableStructured
        ? new JsonFormatter()
        : new ConsoleFormatter(
          this.config.enableColors,
          this.config.includeStackTrace,
        );

      outputs.push(new ConsoleOutput(formatter));
    }

    // External service output for production
    if (environment.isProduction() && env.SENTRY_DSN) {
      outputs.push(new ExternalServiceOutput('sentry'));
    }

    return outputs;
  }

  /**
   * Set global context for all log entries
   */
  setContext(context: Partial<LogContext>): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Create child logger with additional context
   */
  child(context: Partial<LogContext>): Logger {
    const childLogger = new Logger(this.config);
    childLogger.setContext({ ...this.context, ...context });
    return childLogger;
  }

  /**
   * Log a message at specified level
   */
  async log(
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>,
    error?: Error,
    performance?: { duration?: number; memory?: number },
  ): Promise<void> {
    // Check if level is enabled
    if (level < this.config.level) {
      return;
    }

    // Truncate message if too long
    const truncatedMessage = message.length > this.config.maxMessageLength
      ? message.substring(0, this.config.maxMessageLength) + '...'
      : message;

    // Redact sensitive data
    const redactedMetadata = this.config.redactSensitiveData && metadata
      ? this.redactor.redact(metadata)
      : metadata;

    // Create log entry
    const entry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level,
      levelName: LOG_LEVEL_NAMES[level],
      message: truncatedMessage,
      context: Object.keys(this.context).length > 0 ? this.context : undefined,
      metadata: redactedMetadata,
      error: error
        ? {
          name: error.name,
          message: error.message,
          stack: this.config.includeStackTrace ? error.stack : undefined,
          code: (error as any).code,
        }
        : undefined,
      performance,
    };

    // Write to all enabled outputs
    const writePromises = this.config.outputs
      .filter((output) => output.enabled && level >= output.minLevel)
      .map((output) =>
        output.write(entry).catch((err) => {
          console.error(`Failed to write to output ${output.name}:`, err);
        })
      );

    await Promise.all(writePromises);
  }

  private formatTimestamp(): string {
    const now = new Date();

    switch (this.config.timestampFormat) {
      case 'unix':
        return Math.floor(now.getTime() / 1000).toString();
      case 'readable':
        return now.toLocaleString();
      case 'iso':
      default:
        return now.toISOString();
    }
  }

  /**
   * Debug level logging
   */
  async debug(
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.log(LogLevel.DEBUG, message, metadata);
  }

  /**
   * Info level logging
   */
  async info(
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.log(LogLevel.INFO, message, metadata);
  }

  /**
   * Warning level logging
   */
  async warn(
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.log(LogLevel.WARN, message, metadata);
  }

  /**
   * Error level logging
   */
  async error(
    message: string,
    error?: Error,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.log(LogLevel.ERROR, message, metadata, error);
  }

  /**
   * Fatal level logging
   */
  async fatal(
    message: string,
    error?: Error,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.log(LogLevel.FATAL, message, metadata, error);
  }

  /**
   * Time a function execution
   */
  async time<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>,
  ): Promise<T> {
    const tracker = new PerformanceTracker();

    try {
      await this.debug(`Starting ${operation}`, metadata);
      const result = await fn();
      const metrics = tracker.getMetrics();

      await this.info(`Completed ${operation}`, {
        ...metadata,
        duration: metrics.duration,
        memory: metrics.memory,
      });

      return result;
    } catch (error: any) {
      const metrics = tracker.getMetrics();

      await this.error(`Failed ${operation}`, error as Error, {
        ...metadata,
        duration: metrics.duration,
        memory: metrics.memory,
      });

      throw error;
    }
  }
}

/**
 * Global logger instance
 */
export const logger = new Logger();

/**
 * Logging utilities
 */
export const loggingUtils = {
  /**
   * Create logger with custom configuration
   */
  createLogger: (config?: Partial<LoggerConfig>) => new Logger(config),

  /**
   * Create performance tracker
   */
  createPerformanceTracker: () => new PerformanceTracker(),

  /**
   * Create data redactor
   */
  createRedactor: (sensitiveFields?: string[]) =>
    new DataRedactor(sensitiveFields),

  /**
   * Log levels
   */
  levels: LogLevel,
  levelNames: LOG_LEVEL_NAMES,

  /**
   * Formatters
   */
  formatters: {
    console: ConsoleFormatter,
    json: JsonFormatter,
  },

  /**
   * Outputs
   */
  outputs: {
    console: ConsoleOutput,
    file: FileOutput,
    external: ExternalServiceOutput,
  },
};

/**
 * Default export
 */
export default {
  Logger,
  logger,
  LogLevel,
  utils: loggingUtils,
};
