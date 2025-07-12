// src/services/AlertManager.ts
import { WhaleAlert, ProcessedAlert } from '../types';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { MessageFormatter } from '../utils/formatters';

export class AlertManager {
  private recentAlerts: Map<string, number> = new Map();
  private alertQueue: ProcessedAlert[] = [];
  private lastTweetTime = 0;
  private readonly DEDUP_WINDOW = 300000; // 5 minutes
  private tweetCallback?: (message: string) => Promise<boolean>;

  constructor(onTweet?: (message: string) => Promise<boolean>) {
    this.tweetCallback = onTweet;
    this.startQueueProcessor();
    this.startCleanupTask();
  }

  /**
   * Process incoming whale alert
   */
  async processAlert(alert: WhaleAlert): Promise<void> {
    try {
      logger.info(`Processing alert: ${alert.symbol} worth ${MessageFormatter.formatUSD(alert.value_usd)}`);

      // Generate alert key for deduplication
      const alertKey = this.generateAlertKey(alert);

      // Check for duplicates
      if (this.isDuplicate(alertKey)) {
        logger.debug(`Duplicate alert filtered: ${alertKey}`);
        return;
      }

      // Check rate limiting
      if (!this.canSendTweet()) {
        const nextTime = new Date(this.getNextTweetTime());
        logger.warn(`Rate limited. Next tweet available at: ${nextTime.toISOString()}`);
        return;
      }

      // Format the message
      const message = this.formatAlertMessage(alert);

      // Validate message length
      if (!MessageFormatter.validateTweetLength(message, config.twitter.maxTweetLength)) {
        logger.warn('Tweet too long, truncating...');
        const truncatedMessage = MessageFormatter.truncateMessage(message, config.twitter.maxTweetLength);
        logger.debug(`Original: ${message.length} chars, Truncated: ${truncatedMessage.length} chars`);
      }

      // Create processed alert
      const processedAlert: ProcessedAlert = {
        id: alert.id,
        type: alert.type,
        message: MessageFormatter.validateTweetLength(message) ? message : MessageFormatter.truncateMessage(message),
        data: alert,
        priority: this.calculatePriority(alert),
        createdAt: new Date()
      };

      // Add to queue
      this.addToQueue(processedAlert);

      // Record for deduplication
      this.recordAlert(alertKey);

      logger.success(`Alert queued for posting: ${alert.symbol} ${MessageFormatter.formatUSD(alert.value_usd)}`);

    } catch (error) {
      logger.error('Error processing alert:', error);
    }
  }

  /**
   * Generate unique key for alert deduplication
   */
  private generateAlertKey(alert: WhaleAlert): string {
    // Use hash, amount, and symbol for uniqueness
    const components = [
      alert.hash || alert.id,
      alert.symbol,
      Math.floor(alert.value_usd / 1000) // Round to nearest 1k to catch similar amounts
    ];
    return components.join('_');
  }

  /**
   * Check if alert is duplicate
   */
  private isDuplicate(alertKey: string): boolean {
    const now = Date.now();
    const lastSeen = this.recentAlerts.get(alertKey);
    
    if (lastSeen && (now - lastSeen) < this.DEDUP_WINDOW) {
      return true;
    }
    
    return false;
  }

  /**
   * Record alert for deduplication
   */
  private recordAlert(alertKey: string): void {
    this.recentAlerts.set(alertKey, Date.now());
  }

  /**
   * Check if we can send a tweet (rate limiting)
   */
  private canSendTweet(): boolean {
    const now = Date.now();
    const minInterval = config.twitter.rateLimitMinutes * 60 * 1000;
    return (now - this.lastTweetTime) >= minInterval;
  }

  /**
   * Get next available tweet time
   */
  private getNextTweetTime(): number {
    const minInterval = config.twitter.rateLimitMinutes * 60 * 1000;
    return this.lastTweetTime + minInterval;
  }

  /**
   * Calculate alert priority (higher = more important)
   */
  private calculatePriority(alert: WhaleAlert): number {
    let priority = 0;

    // Base priority on USD value
    if (alert.value_usd >= 100000000) priority += 100; // $100M+
    else if (alert.value_usd >= 50000000) priority += 80; // $50M+
    else if (alert.value_usd >= 10000000) priority += 60; // $10M+
    else if (alert.value_usd >= 5000000) priority += 40;  // $5M+
    else if (alert.value_usd >= 1000000) priority += 20;  // $1M+

    // Bonus for popular coins
    const popularCoins = ['BTC', 'ETH', 'USDT', 'USDC', 'BNB'];
    if (popularCoins.includes(alert.symbol.toUpperCase())) {
      priority += 10;
    }

    // Bonus for known exchanges
    const knownExchanges = ['binance', 'coinbase', 'kraken', 'huobi', 'okex'];
    const fromExchange = knownExchanges.some(ex => alert.from.toLowerCase().includes(ex));
    const toExchange = knownExchanges.some(ex => alert.to.toLowerCase().includes(ex));
    
    if (fromExchange || toExchange) {
      priority += 15;
    }

    // Bonus for burns/mints
    if (alert.type === 'whale_alert' && (alert.from.includes('burn') || alert.to.includes('mint'))) {
      priority += 25;
    }

    return priority;
  }

  /**
   * Format alert message for Twitter
   */
  private formatAlertMessage(alert: WhaleAlert): string {
    switch (alert.type) {
      case 'transfer':
      case 'mint':
      case 'burn':
        return MessageFormatter.formatWhaleAlert(alert);
      case 'swap':
        return MessageFormatter.formatSwapAlert(alert);
      case 'hyperliquid_trade':
        return MessageFormatter.formatHyperliquidAlert(alert);
      default:
        return `🐋 Whale Alert: ${alert.amount} ${alert.symbol} (${MessageFormatter.formatUSD(alert.value_usd)})`;
    }
  }

  /**
   * Add alert to processing queue
   */
  private addToQueue(alert: ProcessedAlert): void {
    this.alertQueue.push(alert);
    
    // Sort by priority (highest first)
    this.alertQueue.sort((a, b) => b.priority - a.priority);
    
    // Limit queue size to prevent memory issues
    if (this.alertQueue.length > 100) {
      this.alertQueue = this.alertQueue.slice(0, 100);
    }
  }

  /**
   * Process queued alerts
   */
  private startQueueProcessor(): void {
    setInterval(async () => {
      if (this.alertQueue.length === 0) return;
      if (!this.canSendTweet()) return;
      if (!this.tweetCallback) return;

      const alert = this.alertQueue.shift();
      if (!alert) return;

      try {
        logger.info(`Sending tweet: ${alert.message.substring(0, 50)}...`);
        const success = await this.tweetCallback(alert.message);
        
        if (success) {
          this.lastTweetTime = Date.now();
          logger.success(`Tweet sent successfully for ${alert.type} alert`);
        } else {
          logger.error('Failed to send tweet, adding back to queue');
          this.alertQueue.unshift(alert); // Add back to front of queue
        }
      } catch (error) {
        logger.error('Error sending tweet:', error);
        this.alertQueue.unshift(alert); // Add back to front of queue
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Clean up old alerts from deduplication map
   */
  private startCleanupTask(): void {
    setInterval(() => {
      const now = Date.now();
      const cutoff = now - this.DEDUP_WINDOW;
      
      let cleaned = 0;
      for (const [key, timestamp] of this.recentAlerts.entries()) {
        if (timestamp < cutoff) {
          this.recentAlerts.delete(key);
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        logger.debug(`Cleaned up ${cleaned} old alerts from deduplication cache`);
      }
    }, 60000); // Clean every minute
  }

  /**
   * Get current status
   */
  getStatus(): {
    queueLength: number;
    recentAlertsCount: number;
    canTweet: boolean;
    nextTweetTime?: Date;
  } {
    return {
      queueLength: this.alertQueue.length,
      recentAlertsCount: this.recentAlerts.size,
      canTweet: this.canSendTweet(),
      nextTweetTime: this.canSendTweet() ? undefined : new Date(this.getNextTweetTime())
    };
  }

  /**
   * Manually process queue (for testing)
   */
  async processQueue(): Promise<void> {
    if (this.alertQueue.length === 0) {
      logger.info('No alerts in queue');
      return;
    }

    logger.info(`Processing ${this.alertQueue.length} alerts in queue...`);
    
    while (this.alertQueue.length > 0 && this.canSendTweet()) {
      const alert = this.alertQueue.shift();
      if (!alert || !this.tweetCallback) continue;

      try {
        const success = await this.tweetCallback(alert.message);
        if (success) {
          this.lastTweetTime = Date.now();
          logger.success(`Processed alert: ${alert.type}`);
        } else {
          this.alertQueue.unshift(alert);
          break;
        }
      } catch (error) {
        logger.error('Error processing alert:', error);
        this.alertQueue.unshift(alert);
        break;
      }
    }
  }

  /**
   * Clear all queued alerts
   */
  clearQueue(): void {
    const count = this.alertQueue.length;
    this.alertQueue = [];
    logger.info(`Cleared ${count} alerts from queue`);
  }
}