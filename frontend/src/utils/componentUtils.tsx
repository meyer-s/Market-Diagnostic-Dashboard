/**
 * Component Utilities
 * 
 * Shared logic for common component patterns.
 */
import PageState from "../components/ui/PageState";

/**
 * Loading state component pattern
 */
export function LoadingState({ message = "Waiting for current data." }: { message?: string }) {
  return (
    <PageState
      variant="loading"
      title="Loading current data"
      message={message}
    />
  );
}

/**
 * Error state component pattern
 */
export function ErrorState({ message }: { message: string }) {
  return (
    <PageState
      variant="error"
      title="Data could not be loaded"
      message={message}
    />
  );
}

/**
 * Empty state component pattern
 */
export function EmptyState({ message }: { message: string }) {
  return (
    <PageState
      variant="empty"
      title="No data available"
      message={message}
    />
  );
}

/**
 * Calculate days ago from a date
 */
export function getDaysAgo(date: Date | string): number {
  const targetDate = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  return Math.floor((now.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Calculate business days elapsed since a date (excludes weekends).
 */
export function getBusinessDaysAgo(date: Date | string): number {
  const targetDate = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(targetDate.getTime())) return 0;

  const now = new Date();
  const start = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  if (start >= end) return 0;

  let businessDays = 0;
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor < end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      businessDays += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return businessDays;
}

/**
 * Format date relative to now (Today, Yesterday, or date string)
 */
export function formatRelativeDate(date: Date | string): string {
  const daysAgo = getDaysAgo(date);
  const targetDate = typeof date === 'string' ? new Date(date) : date;
  
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  
  return targetDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Check if current day is a weekend
 */
export function isWeekend(date: Date = new Date()): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Calculate moving average for smoothing data
 */
export function calculateMovingAverage<T extends { [key: string]: unknown }>(
  data: T[],
  valueKey: string,
  windowSize: number = 7
): T[] {
  if (data.length < windowSize) return data;
  
  return data.map((point, index) => {
    const start = Math.max(0, index - Math.floor(windowSize / 2));
    const end = Math.min(data.length, start + windowSize);
    const window = data.slice(start, end);
    const avg = window.reduce((sum, p) => sum + ((p[valueKey] as number) || 0), 0) / window.length;
    
    return {
      ...point,
      [valueKey]: avg,
      [`raw_${valueKey}`]: point[valueKey], // Keep original
    };
  });
}

/**
 * Safe number formatting with fallback
 */
export function formatValue(value: number | string | null | undefined, decimals: number = 2): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === 'number') {
    return value.toFixed(decimals);
  }
  return String(value);
}
