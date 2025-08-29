// bucketUtils.js

// Start date of the system
export const START_DATE = new Date('2025-01-01T00:00:00Z');

// Number of buckets to keep (rolling window)
export const TOTAL_BUCKETS = 90;

/**
 * Get the bucket ID for a given date
 * Defaults to today if no date provided
 * Example output: "day240"
 */
export function getBucketForDate(date = new Date()) {
  const diffMs = date - START_DATE;
  const dayNumber = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
  return `day${dayNumber}`;
}

/**
 * Check if a bucket is still active (within the rolling 90-day window)
 * Example: day240 → true if today is day300
 */
export function isBucketActive(bucketName) {
  const bucketDay = parseInt(bucketName.replace('day', ''), 10);
  const latestDay = Math.floor((new Date() - START_DATE) / (1000 * 60 * 60 * 24)) + 1;
  return bucketDay > latestDay - TOTAL_BUCKETS;
}

/**
 * Get all active bucket IDs in the current rolling window
 * Returns an array like ["day211", "day212", ..., "day300"]
 */
export function getActiveBuckets() {
  const latestDay = Math.floor((new Date() - START_DATE) / (1000 * 60 * 60 * 24)) + 1;
  const startDay = Math.max(1, latestDay - TOTAL_BUCKETS + 1);
  const buckets = [];
  for (let i = startDay; i <= latestDay; i++) {
    buckets.push(`day${i}`);
  }
  return buckets;
}
