/**
 * Specialized helpers for rendering component breakdown charts in IndicatorDetail
 */
import { processComponentData } from './chartDataUtils';

interface ExtendedDataOptions<T> {
  components: T[];
  chartRangeDays: number;
  dateField?: string;
  extendToToday?: boolean; // For stale data like Consumer Health
}

/**
 * Prepare component data for charts, optionally extending stale data to today
 */
export function prepareExtendedComponentData<T extends Record<string, any>>(
  options: ExtendedDataOptions<T>
): { data: (T & { dateNum: number })[]; dateRange: { startTime: number; endTime: number } } {
  const { components, chartRangeDays, dateField = 'date', extendToToday = false } = options;
  
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const daysBack = new Date(today);
  daysBack.setDate(today.getDate() - chartRangeDays);
  daysBack.setHours(0, 0, 0, 0);
  
  if (!extendToToday) {
    // Simple case: just process normally
    return processComponentData(components, chartRangeDays, dateField);
  }
  
  // Complex case for Consumer Health: extend to today with flat line
  const lastPoint = components[components.length - 1];
  const lastDate = new Date(lastPoint[dateField] + 'T00:00:00');
  
  // Create monthly points from last data to today
  const intermediatePoints: (T & { dateNum: number })[] = [];
  const currentDate = new Date(lastDate);
  currentDate.setMonth(currentDate.getMonth() + 1);
  currentDate.setDate(1);
  
  while (currentDate <= today) {
    intermediatePoints.push({
      ...lastPoint,
      [dateField]: currentDate.toISOString().split('T')[0],
      dateNum: currentDate.getTime()
    } as T & { dateNum: number });
    currentDate.setMonth(currentDate.getMonth() + 1);
  }
  
  // Add today as final point
  if (intermediatePoints.length === 0 || 
      intermediatePoints[intermediatePoints.length - 1].dateNum < today.getTime()) {
    intermediatePoints.push({
      ...lastPoint,
      [dateField]: today.toISOString().split('T')[0],
      dateNum: today.getTime()
    } as T & { dateNum: number });
  }
  
  // Combine and deduplicate
  const allData = [
    ...components.map(item => ({
      ...item,
      dateNum: new Date(item[dateField] + 'T00:00:00').getTime()
    })),
    ...intermediatePoints
  ];
  
  const dateMap = new Map<string, T & { dateNum: number }>();
  allData.forEach(item => dateMap.set(item[dateField], item));
  const deduplicated = Array.from(dateMap.values())
    .sort((a, b) => a.dateNum - b.dateNum)
    .filter(item => item.dateNum >= daysBack.getTime());
  
  return {
    data: deduplicated,
    dateRange: {
      startTime: daysBack.getTime(),
      endTime: today.getTime()
    }
  };
}
