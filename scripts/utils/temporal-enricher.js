/**
 * Temporal Enricher
 * 
 * Enriches data with temporal context including baseline comparisons,
 * conflict phases, and time periods
 */

export class TemporalEnricher {
  constructor(baselineDate = '2023-10-07') {
    this.baselineDate = baselineDate;
  }

  /**
   * Enrich record with temporal context
   */
  enrichTemporal(record, allData = []) {
    if (!record.date) return {};

    const date = new Date(record.date);
    const baseline = new Date(this.baselineDate);
    const daysSinceBaseline = Math.floor((date - baseline) / (1000 * 60 * 60 * 24));

    return {
      temporal_context: {
        days_since_baseline: daysSinceBaseline,
        baseline_period: date < baseline ? 'before_baseline' : 'after_baseline',
        conflict_phase: this.determineConflictPhase(record.date),
        season: this.getSeason(record.date),
      },
    };
  }

  /**
   * Determine conflict phase based on date
   */
  determineConflictPhase(date) {
    const recordDate = new Date(date);
    const baseline = new Date(this.baselineDate);

    if (recordDate < baseline) {
      return 'pre-escalation';
    } else if (recordDate < new Date('2024-01-01')) {
      return 'active-conflict';
    } else {
      return 'ongoing-conflict';
    }
  }

  /**
   * Get season from date
   */
  getSeason(date) {
    const month = new Date(date).getMonth();

    if (month >= 2 && month <= 4) return 'spring';
    if (month >= 5 && month <= 7) return 'summer';
    if (month >= 8 && month <= 10) return 'autumn';
    return 'winter';
  }

  /**
   * Calculate period (day, week, month, quarter, year)
   */
  calculatePeriod(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const quarter = Math.floor(d.getMonth() / 3) + 1;
    const week = this.getWeekNumber(d);

    return {
      day: date,
      week: `${year}-W${week.toString().padStart(2, '0')}`,
      month: `${year}-${month.toString().padStart(2, '0')}`,
      quarter: `${year}-Q${quarter}`,
      year: year.toString(),
    };
  }

  /**
   * Get ISO week number
   */
  getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }

  /**
   * Calculate days since a reference date
   */
  calculateDaysSince(date, referenceDate) {
    const d1 = new Date(date);
    const d2 = new Date(referenceDate);
    return Math.floor((d1 - d2) / (1000 * 60 * 60 * 24));
  }

  /**
   * Classify period relative to baseline
   */
  classifyPeriod(date, baselineDate) {
    const recordDate = new Date(date);
    const baseline = new Date(baselineDate);

    if (recordDate < baseline) {
      return 'before_baseline';
    } else if (recordDate.getTime() === baseline.getTime()) {
      return 'baseline';
    } else {
      return 'after_baseline';
    }
  }
}

export default TemporalEnricher;
