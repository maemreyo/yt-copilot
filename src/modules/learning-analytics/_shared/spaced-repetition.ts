/**
 * Spaced Repetition Algorithm Implementation
 * Based on SM-2 (SuperMemo 2) algorithm
 * Compatible with Deno/Edge Functions runtime
 */

export interface RepetitionItem {
  interval: number;      // Interval in days until next review
  repetitions: number;   // Number of times reviewed
  ease_factor: number;   // Ease factor (minimum 1.3)
}

export interface ReviewQuality {
  quality: number;       // 0-5 scale (0=fail, 5=perfect)
  time_taken?: number;   // Time taken to recall (seconds)
}

/**
 * Calculate next review date based on SM-2 algorithm
 * @param item Current repetition state
 * @param quality Review quality (0-5)
 * @returns Updated repetition state
 */
export function calculateNextReview(
  item: RepetitionItem,
  quality: ReviewQuality
): RepetitionItem {
  const q = quality.quality;
  
  // Failed review - reset to beginning
  if (q < 3) {
    return {
      interval: 1,
      repetitions: 0,
      ease_factor: Math.max(1.3, item.ease_factor - 0.2)
    };
  }
  
  // Successful review
  let { interval, repetitions, ease_factor } = item;
  
  // Update ease factor
  ease_factor = ease_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  ease_factor = Math.max(1.3, ease_factor); // Minimum 1.3
  
  // Calculate new interval
  if (repetitions === 0) {
    interval = 1;
  } else if (repetitions === 1) {
    interval = 6;
  } else {
    interval = Math.round(interval * ease_factor);
  }
  
  // Consider time taken (optional optimization)
  if (quality.time_taken !== undefined) {
    // If took too long, reduce interval slightly
    if (quality.time_taken > 10) {
      interval = Math.max(1, Math.round(interval * 0.9));
    }
    // If very quick, increase interval slightly
    else if (quality.time_taken < 3 && q >= 4) {
      interval = Math.round(interval * 1.1);
    }
  }
  
  return {
    interval,
    repetitions: repetitions + 1,
    ease_factor
  };
}

/**
 * Get initial repetition state for new item
 * @param difficulty Initial difficulty assessment
 * @returns Initial repetition state
 */
export function getInitialState(difficulty?: 'beginner' | 'intermediate' | 'advanced'): RepetitionItem {
  // Adjust initial ease factor based on difficulty
  let ease_factor = 2.5;
  
  switch (difficulty) {
    case 'beginner':
      ease_factor = 2.8;
      break;
    case 'intermediate':
      ease_factor = 2.5;
      break;
    case 'advanced':
      ease_factor = 2.2;
      break;
  }
  
  return {
    interval: 1,
    repetitions: 0,
    ease_factor
  };
}

/**
 * Calculate next review date from current date and interval
 * @param interval Days until next review
 * @returns ISO date string for next review
 */
export function getNextReviewDate(interval: number): string {
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + interval);
  nextDate.setHours(0, 0, 0, 0); // Set to start of day
  return nextDate.toISOString();
}

/**
 * Check if item is due for review
 * @param nextReviewDate ISO date string
 * @returns Whether item is due for review
 */
export function isDueForReview(nextReviewDate: string): boolean {
  const reviewDate = new Date(nextReviewDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return reviewDate <= today;
}

/**
 * Get items due for review from a list
 * @param items Array of items with next_review_at field
 * @returns Filtered array of items due for review
 */
export function getDueItems<T extends { next_review_at?: string }>(items: T[]): T[] {
  return items.filter(item => 
    item.next_review_at && isDueForReview(item.next_review_at)
  );
}

/**
 * Calculate review statistics
 * @param items Array of items with review data
 * @returns Review statistics
 */
export function calculateReviewStats<T extends {
  review_count: number;
  success_rate: number;
  next_review_at?: string;
}>(items: T[]): {
  total_items: number;
  items_reviewed: number;
  items_due: number;
  average_success_rate: number;
  items_mastered: number; // >90% success rate
} {
  const total_items = items.length;
  const items_reviewed = items.filter(item => item.review_count > 0).length;
  const items_due = getDueItems(items).length;
  
  const totalSuccessRate = items.reduce((sum, item) => sum + item.success_rate, 0);
  const average_success_rate = total_items > 0 ? totalSuccessRate / total_items : 0;
  
  const items_mastered = items.filter(item => item.success_rate > 0.9).length;
  
  return {
    total_items,
    items_reviewed,
    items_due,
    average_success_rate,
    items_mastered
  };
}

/**
 * Get review schedule for upcoming days
 * @param items Array of items with next_review_at field
 * @param days Number of days to look ahead
 * @returns Review schedule by date
 */
export function getUpcomingReviews<T extends { 
  id: string;
  next_review_at?: string;
}>(items: T[], days: number = 7): Map<string, T[]> {
  const schedule = new Map<string, T[]>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Initialize dates
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    schedule.set(date.toISOString().split('T')[0], []);
  }
  
  // Assign items to dates
  items.forEach(item => {
    if (!item.next_review_at) return;
    
    const reviewDate = new Date(item.next_review_at);
    const dateKey = reviewDate.toISOString().split('T')[0];
    
    const existing = schedule.get(dateKey);
    if (existing) {
      existing.push(item);
    }
  });
  
  return schedule;
}

/**
 * Calculate optimal review time based on user's learning patterns
 * @param sessionHistory Array of past session times
 * @returns Optimal hour of day for reviews (0-23)
 */
export function calculateOptimalReviewTime(
  sessionHistory: Array<{ started_at: string; success_rate?: number }>
): number {
  if (sessionHistory.length === 0) return 9; // Default to 9 AM
  
  // Group sessions by hour and calculate average success rate
  const hourStats = new Map<number, { count: number; totalSuccess: number }>();
  
  sessionHistory.forEach(session => {
    const hour = new Date(session.started_at).getHours();
    const stats = hourStats.get(hour) || { count: 0, totalSuccess: 0 };
    stats.count++;
    stats.totalSuccess += session.success_rate || 0;
    hourStats.set(hour, stats);
  });
  
  // Find hour with best average success rate
  let bestHour = 9;
  let bestAverage = 0;
  
  hourStats.forEach((stats, hour) => {
    const average = stats.totalSuccess / stats.count;
    if (average > bestAverage) {
      bestAverage = average;
      bestHour = hour;
    }
  });
  
  return bestHour;
}