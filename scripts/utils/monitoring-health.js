#!/usr/bin/env node

/**
 * Pipeline Health Check
 *
 * Performs a quick health check of the data pipeline
 */

import { quickHealthCheck } from './monitoring.js';

async function main() {
  try {
    console.log('🏥 Checking Palestine Pulse Pipeline Health...');
    console.log('');

    const health = await quickHealthCheck();

    // Display health status
    const statusEmoji = {
      healthy: '✅',
      warning: '⚠️',
      error: '❌',
      critical: '🚨',
      degraded: '🟡',
    };

    console.log(`${statusEmoji[health.status] || '❓'} Pipeline Status: ${health.status.toUpperCase()}`);
    console.log('');

    if (health.lastRun) {
      console.log(`🕐 Last Run: ${health.lastRun.toISOString()}`);
    }

    if (health.successRate !== undefined) {
      const successPercent = (health.successRate * 100).toFixed(1);
      console.log(`📊 Success Rate: ${successPercent}%`);
    }

    if (health.activeAlerts !== undefined) {
      console.log(`🚨 Active Alerts: ${health.activeAlerts}`);
    }

    if (health.error) {
      console.log(`❌ Error: ${health.error}`);
    }

    console.log('');
    console.log('📋 For detailed health report, run: npm run monitor-health-report');

    // Exit with appropriate code
    const exitCodes = {
      healthy: 0,
      warning: 1,
      error: 2,
      critical: 3,
      degraded: 1,
    };

    process.exit(exitCodes[health.status] || 1);

  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    process.exit(1);
  }
}

main();
