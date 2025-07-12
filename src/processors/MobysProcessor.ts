// src/processors/MobysProcessor.ts - Updated with AssetDash API
import axios from 'axios';
import { AssetDashTransaction, AssetDashResponse } from '../types';
import { logger } from '../utils/logger';
import { MessageFormatter } from '../utils/formatters';

export class MobysProcessor {
  private pollInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private alertCallback?: (alert: any) => void;
  
  private readonly API_URL = 'https://swap-api.assetdash.com/api/api_v5/whalewatch/transactions/list';
  private readonly POLL_INTERVAL = 60000; // 1 minute
  private readonly PAGE_LIMIT = 100;

  constructor(onAlert?: (alert: any) => void) {
    this.alertCallback = onAlert;
  }

  /**
   * Start polling for whale transactions
   */
  startPolling(): void {
    if (this.isRunning) {
      logger.warn('MobysProcessor already running');
      return;
    }

    logger.info('🔄 Starting MobysScreener polling...');
    logger.info(`📡 API Endpoint: ${this.API_URL}`);
    logger.info(`⏱️  Poll Interval: ${this.POLL_INTERVAL / 1000} seconds`);
    
    this.isRunning = true;
    
    // Poll immediately
    this.pollTransactions();
    
    // Then poll every minute
    this.pollInterval = setInterval(() => {
      this.pollTransactions();
    }, this.POLL_INTERVAL);

    logger.success('✅ MobysProcessor started successfully');
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
    logger.info('🛑 MobysProcessor stopped');
  }

  /**
   * Poll for new whale transactions
   */
  private async pollTransactions(): Promise<void> {
    try {
      const now = new Date();
      const oneMinuteAgo = new Date(now.getTime() - 60 * 1000).toISOString();
      
      logger.debug(`🔍 Polling for transactions after: ${oneMinuteAgo}`);
      
      const response = await this.fetchTransactionsAfter(oneMinuteAgo);
      
      if (response && response.transactions) {
        logger.info(`📊 Found ${response.transactions.length} transactions in the last minute`);
        await this.processAllTransactions(response.transactions);
      } else {
        logger.debug('📭 No transactions in the last minute');
      }
      
    } catch (error: any) {
      logger.error('❌ Error polling MobysScreener:', error.message);
    }
  }

  /**
   * Fetch transactions from AssetDash API after a specific timestamp
   */
  private async fetchTransactionsAfter(afterTimestamp: string): Promise<AssetDashResponse | null> {
    try {
      const url = new URL(this.API_URL);
      url.searchParams.set('page', '1');
      url.searchParams.set('limit', this.PAGE_LIMIT.toString());
      url.searchParams.set('after_timestamp', afterTimestamp);

      logger.debug(`🌐 Fetching: ${url.toString()}`);

      const bearerToken = process.env.ASSETDASH_BEARER_TOKEN;
      if (!bearerToken) {
        logger.error('❌ ASSETDASH_BEARER_TOKEN not configured in .env');
        throw new Error('Bearer token not configured');
      }

      const response = await axios.get(url.toString(), {
        timeout: 15000,
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Origin': 'https://swap.assetdash.com',
          'Referer': 'https://swap.assetdash.com/',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });

      if (response.status === 200 && response.data) {
        const data = response.data as any;
        
        if (data.transactions && Array.isArray(data.transactions)) {
          logger.debug(`📊 Received ${data.transactions.length} transactions`);
          return data as AssetDashResponse;
        } else {
          logger.warn(`⚠️ No transactions array in response`);
          logger.debug('Response structure:', Object.keys(data));
          return null;
        }
      } else {
        logger.warn(`⚠️ Unexpected response status: ${response.status}`);
        logger.debug('Response data:', response.data);
        return null;
      }

    } catch (error: any) {
      if (error.response) {
        logger.error(`❌ API Error ${error.response.status}: ${error.response.statusText}`);
        if (error.response.status === 401) {
          logger.error('🔐 Bearer token expired or invalid!');
        }
        if (error.response.data) {
          logger.debug('Response data:', error.response.data);
        }
      } else if (error.request) {
        logger.error('❌ Network error: No response received');
      } else {
        logger.error(`❌ Request error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Process all transactions (no deduplication needed since we only get last minute)
   */
  private async processAllTransactions(transactions: AssetDashTransaction[]): Promise<void> {
    if (transactions.length === 0) {
      logger.debug('📭 No transactions to process');
      return;
    }

    logger.info(`🔄 Processing ${transactions.length} transactions from the last minute`);

    for (const transaction of transactions) {
      // Log transaction details
      this.logTransactionDetails(transaction);
      
      // Emit alert
      await this.emitTransactionAlert(transaction);
    }
  }

  /**
   * Log detailed transaction information
   */
  private logTransactionDetails(tx: AssetDashTransaction): void {
    const traderInfo = tx.swap_whalewatch_list;
    const tokenInfo = tx.swap_token;
    
    logger.info('🐋 NEW WHALE TRANSACTION:');
    logger.info('─'.repeat(60));
    logger.info(`📋 ID: ${tx.id}`);
    logger.info(`📅 Timestamp: ${tx.timestamp}`);
    logger.info(`🔄 Type: ${tx.transaction_type.toUpperCase()}`);
    logger.info(`💰 Token: ${tokenInfo.symbol} (${tokenInfo.name})`);
    logger.info(`💵 Trade Amount: ~${tx.trade_amount_rounded}`);
    logger.info(`📊 Trade Size: ${tx.trade_size}`);
    logger.info(`📈 Market Cap: ${MessageFormatter.formatUSD(tx.token_market_cap)}`);
    logger.info(`🎯 Platform: ${tokenInfo.platform}`);
    logger.info(`👤 Trader: ${traderInfo.name} (${traderInfo.identifier})`);
    logger.info(`🏆 Win Rate: ${tx.win_rate.toFixed(1)}%`);
    logger.info(`🔗 Token Address: ${tokenInfo.token_address}`);
    logger.info(`⚠️ Rugcheck: ${tokenInfo.rugcheck_status}`);
    if (tokenInfo.is_pumpfun) {
      logger.info(`🚀 PumpFun Token: Yes`);
    }
    if (tx.is_token_first_seen) {
      logger.info(`🆕 First Time Seen: Yes`);
    }
    logger.info('─'.repeat(60));
  }

  /**
   * Emit transaction alert
   */
  private async emitTransactionAlert(tx: AssetDashTransaction): Promise<void> {
    const alert = {
      id: `mobys_${tx.id}`,
      type: 'swap',
      timestamp: new Date(tx.timestamp).getTime(),
      blockchain: 'solana', // AssetDash seems to focus on Solana
      symbol: tx.swap_token.symbol,
      amount: tx.trade_amount_rounded.toString(),
      value_usd: tx.trade_amount_rounded,
      from: tx.swap_whalewatch_list.identifier,
      to: tx.swap_token.symbol,
      hash: '',
      platform: 'AssetDash/MobysScreener',
      transaction_type: tx.transaction_type,
      trader_name: tx.swap_whalewatch_list.name,
      trade_size: tx.trade_size,
      token_market_cap: tx.token_market_cap,
      win_rate: tx.win_rate,
      is_pumpfun: tx.swap_token.is_pumpfun,
      rugcheck_status: tx.swap_token.rugcheck_status,
      raw_data: tx // Include raw data for debugging
    };

    if (this.alertCallback) {
      this.alertCallback(alert);
    }

    logger.success(
      `📢 Alert emitted: ${tx.transaction_type.toUpperCase()} ${tx.swap_token.symbol} ` +
      `~${tx.trade_amount_rounded} by ${tx.swap_whalewatch_list.name} ` +
      `(${tx.win_rate.toFixed(1)}% win rate)`
    );
  }

  /**
   * Test the API endpoint
   */
  async test(): Promise<boolean> {
    try {
      logger.info('🧪 Testing MobysScreener API...');
      
      // Test with last 5 minutes to ensure we see some transactions
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      logger.debug(`🕐 Testing with timestamp from 5 minutes ago: ${fiveMinutesAgo}`);
      
      const response = await this.fetchTransactionsAfter(fiveMinutesAgo);
      
      if (response && response.transactions) {
        logger.success(`✅ API test successful!`);
        logger.info(`📊 Retrieved ${response.transactions.length} transactions from last 5 minutes`);
        
        if (response.pagination) {
          logger.info(`📄 Pagination: Page ${response.pagination.page}, Total: ${response.pagination.total}`);
        }
        
        // Show first transaction as example
        if (response.transactions.length > 0) {
          logger.info('📋 Sample transaction:');
          this.logTransactionDetails(response.transactions[0]);
        } else {
          logger.info('ℹ️ No transactions in last 5 minutes (this is normal during quiet periods)');
        }
        
        return true;
      } else {
        logger.error('❌ API test failed: No transaction data received');
        return false;
      }
      
    } catch (error: any) {
      logger.error(`❌ API test failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Get current status
   */
  getStatus(): { 
    running: boolean; 
    apiUrl: string;
    pollInterval: number;
  } {
    return {
      running: this.isRunning,
      apiUrl: this.API_URL,
      pollInterval: this.POLL_INTERVAL / 1000
    };
  }

  /**
   * Manual trigger for testing
   */
  async triggerPoll(): Promise<void> {
    logger.info('🔧 Manual poll triggered...');
    await this.pollTransactions();
  }
}