#!/usr/bin/env node

/**
 * Initialize Pipeline Monitoring
 *
 * Sets up the monitoring system for the data pipeline
 */

import { initializeMonitoring } from './monitoring.js';

async function main() {
  try {
    console.log('🚀 Initializing Palestine Pulse Pipeline Monitoring...');

    const monitor = await initializeMonitoring();

    // Generate initial health report
    await monitor.generateHealthReport();

    console.log('✅ Monitoring system initialized successfully');
    console.log('📊 Health reports will be available in logs/health-report.json');
    console.log('🚨 Alerts will be logged to logs/pipeline-alerts.json');

  } catch (error) {
    console.error('❌ Failed to initialize monitoring:', error.message);
    process.exit(1);
  }
}

main();
