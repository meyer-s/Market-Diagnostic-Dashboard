/**
 * Utility functions for processing chart data
 */

export interface DateRange {
  startTime: number;
  endTime: number;
}

/**
 * Calculate date range for charts
 * @param daysBack Number of days to go back from today
 * @returns Object with start and end timestamps
 */
export function calculateDateRange(daysBack: number): DateRange {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - daysBack);
  startDate.setHours(0, 0, 0, 0);
  
  return {
    startTime: startDate.getTime(),
    endTime: today.getTime()
  };
}

/**
 * Deduplicate data by date field
 * @param data Array of data items with a date field
 * @param dateField Name of the date field (default: 'date')
 * @returns Deduplicated and sorted array
 */
export function deduplicateByDate<T extends Record<string, unknown> & { dateNum?: number }>(
  data: T[],
  dateField: string = 'date'
): T[] {
  const dateMap = new Map<string, T>();
  data.forEach(item => {
    dateMap.set(item[dateField] as string, item);
  });

  return Array.from(dateMap.values()).sort((a, b) => (a.dateNum ?? 0) - (b.dateNum ?? 0));
}

/**
 * Add numeric timestamp to data items
 * @param data Array of data items
 * @param dateField Name of the date field (default: 'date')
 * @returns Array with dateNum field added
 */
export function addTimestampNumber<T extends Record<string, unknown>>(
  data: T[],
  dateField: string = 'date'
): (T & { dateNum: number })[] {
  return data.map(item => ({
    ...item,
    dateNum: new Date(item[dateField] as string).getTime()
  }));
}

/**
 * Filter data by date range
 * @param data Array with dateNum field
 * @param startTime Start timestamp
 * @returns Filtered array
 */
export function filterByDateRange<T extends { dateNum: number }>(
  data: T[],
  startTime: number
): T[] {
  return data.filter(item => item.dateNum >= startTime);
}

/**
 * Get maximum date from data array
 * @param data Array with dateNum field
 * @param fallback Fallback date if array is empty
 * @returns Maximum timestamp
 */
export function getMaxDate(data: { dateNum: number }[], fallback: number): number {
  if (data.length === 0) return fallback;
  return Math.max(...data.map(d => d.dateNum));
}

/**
 * Extend stale data to current date with monthly points
 * For indicators that haven't updated recently, this creates
 * intermediate points to extend the chart to today
 * 
 * @param history Original history data
 * @param today Today's date
 * @returns Extended history with monthly points to today
 */
export function extendStaleData<T extends { timestamp: string; timestampNum?: number }>(
  history: T[],
  today: Date
): (T & { timestampNum: number })[] {
  if (history.length === 0) return [];
  
  const lastPoint = history[history.length - 1];
  const lastDate = new Date(lastPoint.timestamp);
  
  // Create monthly points from last data to today
  const intermediatePoints: (T & { timestampNum: number })[] = [];
  const currentDate = new Date(lastDate);
  currentDate.setMonth(currentDate.getMonth() + 1);
  currentDate.setDate(1);
  
  while (currentDate <= today) {
    intermediatePoints.push({
      ...lastPoint,
      timestamp: currentDate.toISOString(),
      timestampNum: currentDate.getTime()
    });
    currentDate.setMonth(currentDate.getMonth() + 1);
  }
  
  // Add today if not already included
  if (intermediatePoints.length === 0 || 
      intermediatePoints[intermediatePoints.length - 1].timestampNum < today.getTime()) {
    intermediatePoints.push({
      ...lastPoint,
      timestamp: today.toISOString(),
      timestampNum: today.getTime()
    });
  }
  
  // Combine original data with intermediate points
  const originalWithTimestamp = history.map(item => ({
    ...item,
    timestampNum: new Date(item.timestamp).getTime()
  }));
  
  return [...originalWithTimestamp, ...intermediatePoints];
}

/**
 * Process component breakdown data for charts
 * Adds timestamps, deduplicates, filters by range
 * 
 * @param components Raw component data
 * @param daysBack Number of days to display
 * @param dateField Name of date field
 * @returns Processed data ready for charting
 */
export function processComponentData<T extends Record<string, any>>(
  components: T[],
  daysBack: number,
  dateField: string = 'date'
): { data: (T & { dateNum: number })[]; dateRange: DateRange } {
  const dateRange = calculateDateRange(daysBack);
  
  const withTimestamps = addTimestampNumber(components, dateField);
  const filtered = filterByDateRange(withTimestamps, dateRange.startTime);
  const deduplicated = deduplicateByDate(filtered, dateField);
  
  // Update end time to max date if data exists
  const maxDate = getMaxDate(deduplicated, dateRange.endTime);
  
  return {
    data: deduplicated,
    dateRange: {
      ...dateRange,
      endTime: maxDate
    }
  };
}
