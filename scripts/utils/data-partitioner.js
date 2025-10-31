/**
 * Data Partitioner
 * 
 * Partitions large datasets by quarter for better performance
 */

import fs from 'fs/promises';
import path from 'path';

export class DataPartitioner {
  constructor(options = {}) {
    this.chunkSize = options.chunkSize || 10000;
    this.recentDays = options.recentDays || 90;
  }

  /**
   * Partition dataset by quarter
   */
  async partitionDataset(data, datasetName, outputDir) {
    if (data.length < this.chunkSize) {
      return {
        partitioned: false,
        partitionCount: 0,
        totalRecords: data.length,
      };
    }

    // Partition by quarter
    const partitions = this.partitionByQuarter(data);

    // Create partitions directory
    const partitionsDir = path.join(outputDir, 'partitions');
    await fs.mkdir(partitionsDir, { recursive: true });

    // Save each partition
    for (const [quarter, records] of partitions.entries()) {
      const fileName = `${quarter}.json`;
      const filePath = path.join(partitionsDir, fileName);
      
      await fs.writeFile(
        filePath,
        JSON.stringify({
          quarter,
          recordCount: records.length,
          dateRange: this.getDateRange(records),
          data: records,
        }, null, 2),
        'utf-8'
      );
    }

    // Generate recent data file
    const recentData = this.generateRecentData(data, this.recentDays);
    if (recentData.length > 0) {
      await fs.writeFile(
        path.join(outputDir, 'recent.json'),
        JSON.stringify({
          description: `Last ${this.recentDays} days of data`,
          recordCount: recentData.length,
          dateRange: this.getDateRange(recentData),
          data: recentData,
        }, null, 2),
        'utf-8'
      );
    }

    // Create partition index
    const index = this.createPartitionIndex(partitions, datasetName);
    await fs.writeFile(
      path.join(partitionsDir, 'index.json'),
      JSON.stringify(index, null, 2),
      'utf-8'
    );

    return {
      partitioned: true,
      partitionCount: partitions.size,
      totalRecords: data.length,
      recentRecords: recentData.length,
    };
  }

  /**
   * Partition data by quarter
   */
  partitionByQuarter(data, dateField = 'date') {
    const partitions = new Map();

    for (const record of data) {
      const dateValue = record[dateField];
      if (!dateValue) continue;

      try {
        const date = new Date(dateValue);
        const year = date.getFullYear();
        const quarter = Math.floor(date.getMonth() / 3) + 1;
        const quarterKey = `${year}-Q${quarter}`;

        if (!partitions.has(quarterKey)) {
          partitions.set(quarterKey, []);
        }
        partitions.get(quarterKey).push(record);
      } catch (error) {
        // Skip records with invalid dates
        continue;
      }
    }

    return partitions;
  }

  /**
   * Generate recent data (last N days)
   */
  generateRecentData(data, days = 90, dateField = 'date') {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    return data.filter(record => {
      const dateValue = record[dateField];
      if (!dateValue) return false;

      try {
        const recordDate = new Date(dateValue);
        return recordDate >= cutoffDate;
      } catch (error) {
        return false;
      }
    });
  }

  /**
   * Create partition index
   */
  createPartitionIndex(partitions, datasetName) {
    const partitionList = Array.from(partitions.entries()).map(([quarter, records]) => ({
      quarter,
      recordCount: records.length,
      dateRange: this.getDateRange(records),
      fileName: `${quarter}.json`,
    }));

    // Sort by quarter
    partitionList.sort((a, b) => a.quarter.localeCompare(b.quarter));

    const totalRecords = Array.from(partitions.values()).reduce(
      (sum, records) => sum + records.length,
      0
    );

    return {
      dataset: datasetName,
      totalPartitions: partitionList.length,
      totalRecords,
      partitions: partitionList,
      hasRecentFile: true,
      recentFileName: 'recent.json',
      generated_at: new Date().toISOString(),
    };
  }

  /**
   * Get date range from records
   */
  getDateRange(records, dateField = 'date') {
    if (records.length === 0) return { start: null, end: null };

    const dates = records
      .map(r => r[dateField])
      .filter(d => d)
      .map(d => new Date(d))
      .filter(d => !isNaN(d.getTime()))
      .sort((a, b) => a - b);

    if (dates.length === 0) return { start: null, end: null };

    return {
      start: dates[0].toISOString().split('T')[0],
      end: dates[dates.length - 1].toISOString().split('T')[0],
    };
  }
}

export default DataPartitioner;
