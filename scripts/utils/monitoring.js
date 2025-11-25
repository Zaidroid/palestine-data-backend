/**
 * Pipeline Monitoring and Alerting System
 *
 * Monitors data pipeline health, detects failures, and provides alerting
 * capabilities for automated pipeline management.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../../public/data');
const LOG_DIR = path.join(__dirname, '../../logs');
const ALERTS_FILE = path.join(LOG_DIR, 'pipeline-alerts.json');

// Alert levels
const ALERT_LEVELS = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical',
};

// Monitoring thresholds
const THRESHOLDS = {
  MAX_EXECUTION_TIME: 30 * 60 * 1000, // 30 minutes
  MIN_SUCCESS_RATE: 0.8, // 80%
  MAX_FAILURE_STREAK: 3,
  DATA_STALENESS_HOURS: 24,
};

/**
 * Pipeline health status
 */
class PipelineMonitor {
  constructor() {
    this.alerts = [];
    this.metrics = {
      lastRun: null,
      successRate: 1.0,
      averageExecutionTime: 0,
      failureStreak: 0,
      dataFreshness: {},
    };
  }

  /**
   * Initialize monitoring system
   */
  async initialize() {
    try {
      await fs.mkdir(LOG_DIR, { recursive: true });

      // Load existing alerts
      try {
        const alertsData = await fs.readFile(ALERTS_FILE, 'utf-8');
        this.alerts = JSON.parse(alertsData);
      } catch {
        this.alerts = [];
      }

      console.log('📊 Pipeline monitoring initialized');
    } catch (error) {
      console.error('Failed to initialize monitoring:', error.message);
    }
  }

  /**
   * Record pipeline execution metrics
   */
  async recordExecution(executionData) {
    const {
      startTime,
      endTime,
      success,
      scripts,
      errors,
      dataCollection,
    } = executionData;

    const executionTime = endTime - startTime;
    const successfulScripts = scripts.filter(s => s.success).length;
    const successRate = successfulScripts / scripts.length;

    // Update metrics
    this.metrics.lastRun = new Date(endTime);
    this.metrics.successRate = successRate;
    this.metrics.averageExecutionTime = executionTime;

    if (success) {
      this.metrics.failureStreak = 0;
    } else {
      this.metrics.failureStreak++;
    }

    // Check for alerts
    await this.checkThresholds({
      executionTime,
      successRate,
      failureStreak: this.metrics.failureStreak,
      errors: errors.length,
    });

    // Log execution
    await this.logExecution(executionData);

    console.log(`📈 Execution recorded: ${successRate.toFixed(2) * 100}% success rate`);
  }

  /**
   * Check monitoring thresholds and generate alerts
   */
  async checkThresholds(metrics) {
    const { executionTime, successRate, failureStreak, errors } = metrics;

    // Execution time alert
    if (executionTime > THRESHOLDS.MAX_EXECUTION_TIME) {
      await this.createAlert(
        ALERT_LEVELS.WARNING,
        'EXECUTION_TIME_EXCEEDED',
        `Pipeline execution took ${(executionTime / 1000 / 60).toFixed(1)} minutes (threshold: ${THRESHOLDS.MAX_EXECUTION_TIME / 1000 / 60} minutes)`
      );
    }

    // Success rate alert
    if (successRate < THRESHOLDS.MIN_SUCCESS_RATE) {
      await this.createAlert(
        ALERT_LEVELS.ERROR,
        'LOW_SUCCESS_RATE',
        `Pipeline success rate: ${(successRate * 100).toFixed(1)}% (threshold: ${THRESHOLDS.MIN_SUCCESS_RATE * 100}%)`
      );
    }

    // Failure streak alert
    if (failureStreak >= THRESHOLDS.MAX_FAILURE_STREAK) {
      await this.createAlert(
        ALERT_LEVELS.CRITICAL,
        'FAILURE_STREAK',
        `Pipeline has failed ${failureStreak} times in a row`
      );
    }

    // Error count alert
    if (errors > 0) {
      await this.createAlert(
        ALERT_LEVELS.WARNING,
        'EXECUTION_ERRORS',
        `Pipeline completed with ${errors} errors`
      );
    }
  }

  /**
   * Check data freshness
   */
  async checkDataFreshness() {
    const sources = ['hdx', 'tech4palestine', 'goodshepherd', 'worldbank', 'who', 'pcbs', 'unrwa'];

    for (const source of sources) {
      try {
        const metadataPath = path.join(DATA_DIR, source, 'metadata.json');
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));

        if (metadata.last_updated) {
          const lastUpdated = new Date(metadata.last_updated);
          const hoursSinceUpdate = (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60);

          this.metrics.dataFreshness[source] = {
            lastUpdated,
            hoursSinceUpdate,
            isStale: hoursSinceUpdate > THRESHOLDS.DATA_STALENESS_HOURS,
          };

          if (hoursSinceUpdate > THRESHOLDS.DATA_STALENESS_HOURS) {
            await this.createAlert(
              ALERT_LEVELS.WARNING,
              'STALE_DATA',
              `${source} data is ${hoursSinceUpdate.toFixed(1)} hours old (threshold: ${THRESHOLDS.DATA_STALENESS_HOURS} hours)`
            );
          }
        }
      } catch (error) {
        await this.createAlert(
          ALERT_LEVELS.ERROR,
          'DATA_CHECK_FAILED',
          `Failed to check freshness for ${source}: ${error.message}`
        );
      }
    }
  }

  /**
   * Create an alert
   */
  async createAlert(level, type, message, metadata = {}) {
    const alert = {
      id: this.generateAlertId(),
      timestamp: new Date().toISOString(),
      level,
      type,
      message,
      metadata,
      acknowledged: false,
    };

    this.alerts.unshift(alert); // Add to beginning

    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(0, 100);
    }

    // Save alerts
    await fs.writeFile(ALERTS_FILE, JSON.stringify(this.alerts, null, 2));

    // Log alert
    const levelEmoji = {
      [ALERT_LEVELS.INFO]: 'ℹ️',
      [ALERT_LEVELS.WARNING]: '⚠️',
      [ALERT_LEVELS.ERROR]: '❌',
      [ALERT_LEVELS.CRITICAL]: '🚨',
    };

    console.log(`${levelEmoji[level]} [${level.toUpperCase()}] ${type}: ${message}`);

    // Send external notification if critical
    if (level === ALERT_LEVELS.CRITICAL) {
      await this.sendExternalAlert(alert);
    }
  }

  /**
   * Generate unique alert ID
   */
  generateAlertId() {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Send external alert (email, Slack, etc.)
   */
  async sendExternalAlert(alert) {
    // Placeholder for external alerting
    // In a real implementation, this would integrate with:
    // - Email services (SendGrid, AWS SES)
    // - Slack webhooks
    // - PagerDuty
    // - SMS services

    console.log(`📤 External alert would be sent: ${alert.message}`);

    // For now, just log to a separate file
    const externalAlertsFile = path.join(LOG_DIR, 'external-alerts.log');
    const logEntry = `[${alert.timestamp}] ${alert.level.toUpperCase()}: ${alert.message}\n`;

    try {
      await fs.appendFile(externalAlertsFile, logEntry);
    } catch (error) {
      console.error('Failed to log external alert:', error.message);
    }
  }

  /**
   * Log execution details
   */
  async logExecution(executionData) {
    const logFile = path.join(LOG_DIR, 'pipeline-executions.log');
    const logEntry = {
      timestamp: new Date().toISOString(),
      ...executionData,
    };

    try {
      await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n');
    } catch (error) {
      console.error('Failed to log execution:', error.message);
    }
  }

  /**
   * Get current health status
   */
  getHealthStatus() {
    const now = Date.now();
    const lastRunHours = this.metrics.lastRun ?
      (now - this.metrics.lastRun.getTime()) / (1000 * 60 * 60) : null;

    return {
      status: this.determineOverallStatus(),
      metrics: this.metrics,
      activeAlerts: this.alerts.filter(a => !a.acknowledged).length,
      lastRunHours,
      dataFreshness: this.metrics.dataFreshness,
    };
  }

  /**
   * Determine overall pipeline health status
   */
  determineOverallStatus() {
    const activeAlerts = this.alerts.filter(a => !a.acknowledged);

    if (activeAlerts.some(a => a.level === ALERT_LEVELS.CRITICAL)) {
      return 'critical';
    }
    if (activeAlerts.some(a => a.level === ALERT_LEVELS.ERROR)) {
      return 'error';
    }
    if (activeAlerts.some(a => a.level === ALERT_LEVELS.WARNING)) {
      return 'warning';
    }
    if (this.metrics.successRate < THRESHOLDS.MIN_SUCCESS_RATE) {
      return 'degraded';
    }

    return 'healthy';
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(alertId) {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = new Date().toISOString();
      await fs.writeFile(ALERTS_FILE, JSON.stringify(this.alerts, null, 2));
      return true;
    }
    return false;
  }

  /**
   * Get alerts summary
   */
  getAlertsSummary() {
    const active = this.alerts.filter(a => !a.acknowledged);
    const byLevel = {};

    for (const level of Object.values(ALERT_LEVELS)) {
      byLevel[level] = active.filter(a => a.level === level).length;
    }

    return {
      total: this.alerts.length,
      active: active.length,
      acknowledged: this.alerts.length - active.length,
      byLevel,
      recent: active.slice(0, 5), // Last 5 active alerts
    };
  }

  /**
   * Generate health report
   */
  async generateHealthReport() {
    const health = this.getHealthStatus();
    const alerts = this.getAlertsSummary();

    const report = {
      generated_at: new Date().toISOString(),
      health,
      alerts,
      recommendations: this.generateRecommendations(health, alerts),
    };

    const reportPath = path.join(LOG_DIR, 'health-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

    return report;
  }

  /**
   * Generate health recommendations
   */
  generateRecommendations(health, alerts) {
    const recommendations = [];

    if (health.status === 'critical') {
      recommendations.push('🚨 IMMEDIATE ACTION REQUIRED: Critical pipeline failures detected');
    }

    if (alerts.byLevel.critical > 0) {
      recommendations.push('Investigate critical alerts immediately');
    }

    if (health.metrics.failureStreak > 0) {
      recommendations.push(`Address ${health.metrics.failureStreak} consecutive pipeline failures`);
    }

    if (health.metrics.successRate < THRESHOLDS.MIN_SUCCESS_RATE) {
      recommendations.push('Improve pipeline success rate - investigate frequent failures');
    }

    if (health.lastRunHours && health.lastRunHours > 24) {
      recommendations.push('Pipeline has not run recently - schedule regular executions');
    }

    const staleSources = Object.entries(health.dataFreshness)
      .filter(([, freshness]) => freshness.isStale)
      .map(([source]) => source);

    if (staleSources.length > 0) {
      recommendations.push(`Update stale data sources: ${staleSources.join(', ')}`);
    }

    if (recommendations.length === 0) {
      recommendations.push('✅ Pipeline is healthy - no action required');
    }

    return recommendations;
  }
}

// Singleton instance
let monitorInstance = null;

/**
 * Get monitoring instance
 */
export function getMonitor() {
  if (!monitorInstance) {
    monitorInstance = new PipelineMonitor();
  }
  return monitorInstance;
}

/**
 * Initialize monitoring
 */
export async function initializeMonitoring() {
  const monitor = getMonitor();
  await monitor.initialize();
  return monitor;
}

/**
 * Quick health check
 */
export async function quickHealthCheck() {
  const monitor = getMonitor();

  try {
    await monitor.checkDataFreshness();
    const health = monitor.getHealthStatus();

    return {
      status: health.status,
      lastRun: health.metrics.lastRun,
      successRate: health.metrics.successRate,
      activeAlerts: health.activeAlerts,
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message,
    };
  }
}

export { ALERT_LEVELS, THRESHOLDS };
export default PipelineMonitor;
