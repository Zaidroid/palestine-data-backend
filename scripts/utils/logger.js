/**
 * Logging Utility
 * 
 * Provides configurable logging with multiple log levels and file output
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Log levels
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

class Logger {
  constructor(options = {}) {
    this.logLevel = options.logLevel || 'INFO';
    this.logFile = options.logFile || path.join(__dirname, '../../data-collection.log');
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile !== false;
    this.context = options.context || 'DataCollection';
    
    // Operation tracking
    this.operations = {
      total: 0,
      success: 0,
      failed: 0,
      warnings: 0,
    };
    
    this.startTime = Date.now();
  }
  
  /**
   * Get current timestamp in ISO format
   */
  getTimestamp() {
    return new Date().toISOString();
  }
  
  /**
   * Format log message with timestamp and context
   */
  formatMessage(level, message, data = null) {
    const timestamp = this.getTimestamp();
    let formatted = `[${timestamp}] [${level}] [${this.context}] ${message}`;
    
    if (data) {
      if (data instanceof Error) {
        formatted += `\n  Error: ${data.message}`;
        if (data.stack) {
          formatted += `\n  Stack: ${data.stack}`;
        }
      } else if (typeof data === 'object') {
        formatted += `\n  Data: ${JSON.stringify(data, null, 2)}`;
      } else {
        formatted += `\n  Data: ${data}`;
      }
    }
    
    return formatted;
  }
  
  /**
   * Check if message should be logged based on log level
   */
  shouldLog(level) {
    return LOG_LEVELS[level] <= LOG_LEVELS[this.logLevel];
  }
  
  /**
   * Write log to file
   */
  async writeToFile(message) {
    if (!this.enableFile) return;
    
    try {
      await fs.appendFile(this.logFile, message + '\n', 'utf-8');
    } catch (error) {
      // Fallback to console if file write fails
      console.error('Failed to write to log file:', error.message);
    }
  }
  
  /**
   * Log error message
   */
  async error(message, data = null) {
    if (!this.shouldLog('ERROR')) return;
    
    const formatted = this.formatMessage('ERROR', message, data);
    
    if (this.enableConsole) {
      console.error(formatted);
    }
    
    await this.writeToFile(formatted);
    this.operations.failed++;
  }
  
  /**
   * Log warning message
   */
  async warn(message, data = null) {
    if (!this.shouldLog('WARN')) return;
    
    const formatted = this.formatMessage('WARN', message, data);
    
    if (this.enableConsole) {
      console.warn(formatted);
    }
    
    await this.writeToFile(formatted);
    this.operations.warnings++;
  }
  
  /**
   * Log info message
   */
  async info(message, data = null) {
    if (!this.shouldLog('INFO')) return;
    
    const formatted = this.formatMessage('INFO', message, data);
    
    if (this.enableConsole) {
      console.log(formatted);
    }
    
    await this.writeToFile(formatted);
  }
  
  /**
   * Log debug message
   */
  async debug(message, data = null) {
    if (!this.shouldLog('DEBUG')) return;
    
    const formatted = this.formatMessage('DEBUG', message, data);
    
    if (this.enableConsole) {
      console.log(formatted);
    }
    
    await this.writeToFile(formatted);
  }
  
  /**
   * Log operation success
   */
  async success(message, data = null) {
    await this.info(`✓ ${message}`, data);
    this.operations.success++;
    this.operations.total++;
  }
  
  /**
   * Log operation failure
   */
  async failure(message, data = null) {
    await this.error(`✗ ${message}`, data);
    this.operations.total++;
  }
  
  /**
   * Get operation summary
   */
  getSummary() {
    const duration = Date.now() - this.startTime;
    const durationSeconds = (duration / 1000).toFixed(2);
    
    return {
      context: this.context,
      duration: `${durationSeconds}s`,
      operations: {
        total: this.operations.total,
        success: this.operations.success,
        failed: this.operations.failed,
        warnings: this.operations.warnings,
        successRate: this.operations.total > 0 
          ? `${((this.operations.success / this.operations.total) * 100).toFixed(1)}%`
          : '0%',
      },
      timestamp: this.getTimestamp(),
    };
  }
  
  /**
   * Log operation summary
   */
  async logSummary() {
    const summary = this.getSummary();
    
    const message = `
========================================
Operation Summary: ${summary.context}
========================================
Duration: ${summary.duration}
Total Operations: ${summary.operations.total}
Successful: ${summary.operations.success}
Failed: ${summary.operations.failed}
Warnings: ${summary.operations.warnings}
Success Rate: ${summary.operations.successRate}
Completed: ${summary.timestamp}
========================================`;
    
    if (this.enableConsole) {
      console.log(message);
    }
    
    await this.writeToFile(message);
    
    return summary;
  }
  
  /**
   * Create child logger with different context
   */
  child(context) {
    return new Logger({
      logLevel: this.logLevel,
      logFile: this.logFile,
      enableConsole: this.enableConsole,
      enableFile: this.enableFile,
      context: `${this.context}:${context}`,
    });
  }
}

/**
 * Create a new logger instance
 */
export function createLogger(options = {}) {
  return new Logger(options);
}

/**
 * Default logger instance
 */
export const logger = createLogger();

export default Logger;
