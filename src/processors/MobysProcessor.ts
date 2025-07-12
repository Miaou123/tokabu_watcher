// src/processors/MobysProcessor.ts
import axios from 'axios';
import { SwapTransaction } from '../types';
import { logger } from '../utils/logger';

export class MobysProcessor {
  private lastTimestamp: string = new Date().toISOString();
  private pollInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private alertCallback?: (alert: any) => void;

  constructor(onAlert?: (alert: any) => void) {
    this.alertCallback = onAlert;
  }

  /**
   * Start polling for swap data
   */
  startPolling(): void {
    if (this.isRunning) {
      logger.warn('MobysProcessor already running');
      return;
    }

    logger.info('🔄 Starting MobysScreener polling...');
    this.isRunning = true;
    
    // Poll immediately
    this.pollSwaps();
    
    // Then poll every 30 seconds
    this.pollInterval = setInterval(() => {
      this.pollSwaps();
    }, 30000);
  }

  /**
   * Stop polling
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
    logger.info('MobysProcessor stopped');
  }

  /**
   * Poll for new swap transactions
   */
  private async pollSwaps(): Promise<void> {
    try {
      // Try direct API call first
      const success = await this.tryDirectAPI();
      
      if (!success) {
        // Fallback to scraping (implement later)
        logger.debug('Direct API failed, would fallback to scraping');
      }
      
    } catch (error) {
      logger.error('Error polling MobysScreener:', error);
    }
  }

  /**
   * Try to access MobysScreener API directly
   */
  private async tryDirectAPI(): Promise<boolean> {
    try {
      const url = `https://swap-api.assetdash.com/api/api_v5/whalewatch/transactions/list`;
      const params = {
        page: 1,
        limit: 100,
        after_timestamp: this.lastTimestamp
      };

      logger.debug('Attempting MobysScreener API call...');
      
      const response = await axios.get(url, { 
        params,
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (response.status === 200 && response.data) {
        this.processSwapData(response.data);
        return true;
      }

      return false;
      
    } catch (error: any) {
      if (error.response?.status === 403 || error.response?.status === 401) {
        logger.warn('MobysScreener API requires authentication');
      } else if (error.code === 'ECONNREFUSED') {
        logger.debug('MobysScreener API connection refused');
      } else {
        logger.debug('MobysScreener API error:', error.message);
      }
      return false;
    }
  }

  /**
   * Process swap transaction data
   */
  private processSwapData(data: any): void {
    // TODO: Implement based on actual API response structure
    logger.debug('Processing MobysScreener data:', data);
    
    // Update timestamp for next request
    this.lastTimestamp = new Date().toISOString();
    
    // Example processing (update based on real data structure)
    if (data.transactions && Array.isArray(data.transactions)) {
      for (const tx of data.transactions) {
        if (tx.value_usd >= 10000) {
          this.emitSwapAlert(tx);
        }
      }
    }
  }

  /**
   * Emit swap alert
   */
  private emitSwapAlert(tx: any): void {
    const alert = {
      id: `mobys_${tx.hash || Date.now()}`,
      type: 'swap',
      timestamp: Date.now(),
      symbol: tx.token_out || 'UNKNOWN',
      amount: tx.amount_out || '0',
      value_usd: tx.value_usd || 0,
      from: tx.token_in || 'Unknown',
      to: tx.token_out || 'Unknown',
      hash: tx.hash,
      platform: 'MobysScreener'
    };

    if (this.alertCallback) {
      this.alertCallback(alert);
    }

    logger.info(`Swap alert: ${tx.token_in} → ${tx.token_out} ($${tx.value_usd})`);
  }

  /**
   * Get current status
   */
  getStatus(): { running: boolean; lastPoll: string } {
    return {
      running: this.isRunning,
      lastPoll: this.lastTimestamp
    };
  }
}