// src/processors/HyperliquidProcessor.ts
import axios from 'axios';
import { HyperliquidTrade } from '../types';
import { logger } from '../utils/logger';

export class HyperliquidProcessor {
  private whaleAddresses: Set<string> = new Set();
  private monitorInterval: NodeJS.Timeout | null = null;
  private discoveryInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private alertCallback?: (alert: any) => void;
  private readonly API_URL = 'https://api.hyperliquid.xyz';

  constructor(onAlert?: (alert: any) => void) {
    this.alertCallback = onAlert;
  }

  /**
   * Start monitoring Hyperliquid
   */
  async startMonitoring(): Promise<void> {
    if (this.isRunning) {
      logger.warn('HyperliquidProcessor already running');
      return;
    }

    logger.info('⚡ Starting Hyperliquid monitoring...');
    this.isRunning = true;

    // Discover whales immediately
    await this.discoverWhales();

    // Monitor whale activity every minute
    this.monitorInterval = setInterval(() => {
      this.monitorWhaleActivity();
    }, 60000);

    // Rediscover whales every hour
    this.discoveryInterval = setInterval(() => {
      this.discoverWhales();
    }, 3600000);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }
    
    this.isRunning = false;
    logger.info('HyperliquidProcessor stopped');
  }

  /**
   * Discover whale addresses
   */
  private async discoverWhales(): Promise<void> {
    try {
      logger.debug('Discovering Hyperliquid whales...');

      // Method 1: Get whale positions from CoinGlass API (if available)
      await this.getWhalesFromCoinGlass();

      // Method 2: Get large traders from Hyperliquid leaderboard
      await this.getWhalesFromLeaderboard();

      logger.info(`Found ${this.whaleAddresses.size} whale addresses to monitor`);

    } catch (error) {
      logger.error('Error discovering whales:', error);
    }
  }

  /**
   * Get whales from CoinGlass API
   */
  private async getWhalesFromCoinGlass(): Promise<void> {
    try {
      // This would require a CoinGlass API key
      // For now, we'll add some placeholder addresses
      logger.debug('Would fetch whales from CoinGlass API (requires API key)');
      
    } catch (error) {
      logger.debug('CoinGlass API not available:', error);
    }
  }

  /**
   * Get whales from Hyperliquid leaderboard
   */
  private async getWhalesFromLeaderboard(): Promise<void> {
    try {
      const response = await axios.post(`${this.API_URL}/info`, {
        type: 'globalStats'
      }, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data) {
        // Process leaderboard data to find whale addresses
        // This would need to be implemented based on actual API response
        logger.debug('Processing Hyperliquid global stats');
      }

    } catch (error) {
      logger.debug('Error fetching Hyperliquid leaderboard:', error);
    }
  }

  /**
   * Monitor whale activity
   */
  private async monitorWhaleActivity(): Promise<void> {
    if (this.whaleAddresses.size === 0) {
      logger.debug('No whale addresses to monitor');
      return;
    }

    try {
      for (const address of this.whaleAddresses) {
        await this.checkWhalePosition(address);
        
        // Small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      logger.error('Error monitoring whale activity:', error);
    }
  }

  /**
   * Check specific whale position
   */
  private async checkWhalePosition(address: string): Promise<void> {
    try {
      const response = await axios.post(`${this.API_URL}/info`, {
        type: 'clearinghouseState',
        user: address
      }, {
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data && (response.data as any).assetPositions) {
        this.processPositions(address, (response.data as any).assetPositions);
      }

    } catch (error: any) {
      logger.debug(`Error checking position for ${address}:`, error?.message || 'Unknown error');
    }
  }

  /**
   * Process whale positions
   */
  private processPositions(address: string, positions: any[]): void {
    for (const position of positions) {
      if (this.isSignificantPosition(position)) {
        this.emitHyperliquidAlert(address, position);
      }
    }
  }

  /**
   * Check if position is significant enough to alert
   */
  private isSignificantPosition(position: any): boolean {
    // Check for high leverage (>30x) and high value (>$100k)
    const leverage = Math.abs(position.leverage || 0);
    const notionalValue = Math.abs(position.notionalValue || 0);
    
    return leverage >= 30 && notionalValue >= 100000;
  }

  /**
   * Emit Hyperliquid alert
   */
  private emitHyperliquidAlert(address: string, position: any): void {
    const alert = {
      id: `hl_${address}_${Date.now()}`,
      type: 'hyperliquid_trade',
      timestamp: Date.now(),
      symbol: position.coin || 'UNKNOWN',
      amount: Math.abs(position.szi || 0).toString(),
      value_usd: Math.abs(position.notionalValue || 0),
      from: address,
      to: 'Hyperliquid',
      leverage: Math.abs(position.leverage || 0),
      side: (position.szi || 0) > 0 ? 'long' : 'short',
      platform: 'Hyperliquid'
    };

    if (this.alertCallback) {
      this.alertCallback(alert);
    }

    logger.info(`Hyperliquid alert: ${position.leverage}x ${alert.side} ${position.coin} ($${alert.value_usd})`);
  }

  /**
   * Add whale address manually
   */
  addWhaleAddress(address: string): void {
    this.whaleAddresses.add(address);
    logger.info(`Added whale address: ${address}`);
  }

  /**
   * Remove whale address
   */
  removeWhaleAddress(address: string): void {
    this.whaleAddresses.delete(address);
    logger.info(`Removed whale address: ${address}`);
  }

  /**
   * Get current status
   */
  getStatus(): { 
    running: boolean; 
    whaleCount: number; 
    addresses: string[] 
  } {
    return {
      running: this.isRunning,
      whaleCount: this.whaleAddresses.size,
      addresses: Array.from(this.whaleAddresses).slice(0, 5) // Show first 5
    };
  }

  /**
   * Test Hyperliquid API connection
   */
  async test(): Promise<boolean> {
    try {
      const response = await axios.post(`${this.API_URL}/info`, {
        type: 'meta'
      }, {
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      return response.status === 200 && !!response.data;
    } catch (error: any) {
      logger.error('Hyperliquid API test failed:', error?.message || 'Unknown error');
      return false;
    }
  }
}