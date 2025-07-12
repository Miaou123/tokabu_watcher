// src/main.ts - Updated with Hyperliquid and MobysProcessor Integration
import { config, validateConfig } from './config/config';
import { logger } from './utils/logger';
import { WhaleAlertProcessor } from './processors/WhaleAlertProcessor';
import { HyperliquidProcessor } from './processors/HyperliquidProcessor';
import { MobysProcessor } from './processors/MobysProcessor';
import { AlertManager } from './services/AlertManager';
import { TwitterService } from './services/TwitterService';

class WhaleBot {
  private isRunning = false;
  private whaleAlertProcessor: WhaleAlertProcessor | null = null;
  private hyperliquidProcessor: HyperliquidProcessor | null = null;
  private mobysProcessor: MobysProcessor | null = null;
  private alertManager: AlertManager | null = null;
  private twitterService: TwitterService | null = null;
  private useTwitter = false;

  constructor() {
    this.setupErrorHandlers();
  }

  private setupErrorHandlers(): void {
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    process.on('SIGINT', () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      this.stop();
    });

    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      this.stop();
    });
  }

  async start(): Promise<void> {
    try {
      logger.info('🐋 Starting Whale Bot with Hyperliquid & MobysScreener Support...');
      
      // Validate configuration
      validateConfig();
      logger.info('✅ Configuration validated');

      // Check for Twitter mode
      const useTwitter = process.argv.includes('--twitter') || process.argv.includes('--with-twitter');
      this.useTwitter = useTwitter;

      if (useTwitter) {
        logger.info('🐦 Twitter mode enabled');
        this.twitterService = new TwitterService();
        await this.twitterService.initialize();
        logger.success('✅ Twitter service initialized');
      } else {
        logger.info('📝 Mock mode enabled (use --twitter flag for real tweets)');
      }

      // Initialize Alert Manager
      const tweetSender = this.useTwitter 
        ? this.twitterService!.postTweet.bind(this.twitterService!)
        : this.mockTweetSender.bind(this);

      this.alertManager = new AlertManager(tweetSender);
      logger.success('✅ Alert Manager initialized');

      // Initialize MobysProcessor (AssetDash API)
      this.mobysProcessor = new MobysProcessor(
        this.alertManager.processAlert.bind(this.alertManager)
      );

      logger.info('🔌 Testing MobysScreener connection...');
      const mobysTestResult = await this.mobysProcessor.test();
      
      if (mobysTestResult) {
        logger.success('✅ MobysScreener connection test passed');
        this.mobysProcessor.startPolling();
        logger.success('🚀 MobysScreener whale monitoring started');
      } else {
        logger.error('❌ MobysScreener connection test failed');
      }

      // Initialize Whale Alert Processor
      if (config.whaleAlert.apiKey) {
        this.whaleAlertProcessor = new WhaleAlertProcessor(
          this.alertManager.processAlert.bind(this.alertManager)
        );

        logger.info('🔌 Testing Whale Alert connection...');
        const testResult = await this.whaleAlertProcessor.test();
        
        if (testResult) {
          logger.success('✅ Whale Alert connection test passed');
          await this.whaleAlertProcessor.connect();
        } else {
          logger.error('❌ Whale Alert connection test failed');
        }
      } else {
        logger.warn('⚠️  No Whale Alert API key configured');
      }

      // Initialize Hyperliquid Processor (Leaderboard + Direct API)
      this.hyperliquidProcessor = new HyperliquidProcessor(
        this.alertManager.processAlert.bind(this.alertManager)
      );

      logger.info('⚡ Testing Hyperliquid leaderboard monitoring...');
      const hyperliquidTest = await this.hyperliquidProcessor.test();
      
      if (hyperliquidTest) {
        logger.success('✅ Hyperliquid leaderboard monitoring test passed');
        await this.hyperliquidProcessor.startMonitoring();
        logger.success('🚀 Hyperliquid 30x+ long monitoring started');
      } else {
        logger.error('❌ Hyperliquid leaderboard monitoring test failed');
        logger.info('Check if leaderboard endpoint is accessible: https://stats-data.hyperliquid.xyz/Mainnet/leaderboard');
      }
      
      this.isRunning = true;
      logger.success('🚀 Whale Bot started successfully!');
      
      // Log current status
      this.logStatus();
      
      // Keep the process running
      this.keepAlive();
      
    } catch (error) {
      logger.error('❌ Failed to start bot:', error);
      process.exit(1);
    }
  }

  /**
   * Mock tweet sender for testing
   */
  private async mockTweetSender(message: string): Promise<boolean> {
    logger.info('📝 MOCK TWEET:');
    logger.info('─'.repeat(50));
    logger.info(message);
    logger.info('─'.repeat(50));
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    return true;
  }

  private logStatus(): void {
    logger.info('📊 Bot Status:');
    logger.info(`   • Mode: ${this.useTwitter ? '🐦 Twitter' : '📝 Mock'}`);
    
    if (this.mobysProcessor) {
      const mobysStatus = this.mobysProcessor.getStatus();
      logger.info(`   • MobysScreener: ${mobysStatus.running ? '🟢 Running' : '🔴 Stopped'}`);
      logger.info(`   • Poll Interval: ${mobysStatus.pollInterval}s`);
    }
    
    if (this.whaleAlertProcessor) {
      const waStatus = this.whaleAlertProcessor.getStatus();
      logger.info(`   • Whale Alert: ${waStatus.connected ? '🟢 Connected' : '🔴 Disconnected'}`);
    }
    
    if (this.hyperliquidProcessor) {
      const hlStatus = this.hyperliquidProcessor.getStatus();
      logger.info(`   • Hyperliquid: ${hlStatus.running ? '🟢 Running' : '🔴 Stopped'}`);
      logger.info(`   • Monitored Addresses: ${hlStatus.monitoredAddresses}`);
      logger.info(`   • Criteria: ${hlStatus.criteria.minLeverage}x leverage, ${hlStatus.criteria.minValue}, ${hlStatus.criteria.side}s only`);
    }
    
    if (this.twitterService) {
      const twitterStatus = this.twitterService.getStatus();
      logger.info(`   • Twitter: ${twitterStatus.loggedIn ? '🟢 Logged in' : '🔴 Not logged in'}`);
    }
    
    if (this.alertManager) {
      const status = this.alertManager.getStatus();
      logger.info(`   • Queue Length: ${status.queueLength}`);
      logger.info(`   • Can Tweet: ${status.canTweet ? '✅' : '❌'}`);
    }
  }

  private keepAlive(): void {
    const interval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(interval);
        return;
      }
      
      logger.debug('💓 Bot heartbeat - monitoring whale transactions & Hyperliquid 30x+ longs');
    }, 5 * 60 * 1000);

    const statusInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(statusInterval);
        return;
      }
      this.logStatus();
    }, 15 * 60 * 1000);
  }

  async stop(): Promise<void> {
    logger.info('🛑 Stopping Whale Bot...');
    this.isRunning = false;
    
    if (this.mobysProcessor) {
      this.mobysProcessor.stop();
    }

    if (this.whaleAlertProcessor) {
      this.whaleAlertProcessor.close();
    }

    if (this.hyperliquidProcessor) {
      this.hyperliquidProcessor.stop();
    }

    if (this.twitterService) {
      await this.twitterService.close();
    }
    
    if (this.alertManager) {
      this.alertManager.clearQueue();
    }
    
    logger.success('✅ Whale Bot stopped gracefully');
    process.exit(0);
  }

  getStatus(): any {
    return {
      running: this.isRunning,
      mode: this.useTwitter ? 'twitter' : 'mock',
      mobysScreener: this.mobysProcessor?.getStatus(),
      whaleAlert: this.whaleAlertProcessor?.getStatus(),
      hyperliquid: this.hyperliquidProcessor?.getStatus(),
      twitter: this.twitterService?.getStatus(),
      alertManager: this.alertManager?.getStatus()
    };
  }

  // Testing methods
  async testMobysScreener(): Promise<void> {
    if (!this.mobysProcessor) {
      this.mobysProcessor = new MobysProcessor();
    }

    logger.info('🧪 Testing MobysScreener monitoring...');
    const result = await this.mobysProcessor.test();
    logger.info(`Test result: ${result ? '✅ Success' : '❌ Failed'}`);
  }

  async testHyperliquid(): Promise<void> {
    if (!this.hyperliquidProcessor) {
      this.hyperliquidProcessor = new HyperliquidProcessor();
    }

    logger.info('🧪 Testing Hyperliquid monitoring...');
    const result = await this.hyperliquidProcessor.test();
    logger.info(`Test result: ${result ? '✅ Success' : '❌ Failed'}`);
  }
}

// CLI commands
const args = process.argv.slice(2);
const command = args[0];

async function runCommand() {
  const bot = new WhaleBot();

  switch (command) {
    case 'test-mobys':
    case 'test-mobyscreener':
      validateConfig();
      await bot.testMobysScreener();
      process.exit(0);
      break;

    case 'test-hyperliquid':
      validateConfig();
      await bot.testHyperliquid();
      process.exit(0);
      break;

    case 'test-whale-alert':
      validateConfig();
      logger.info('Use test-hyperliquid or test-mobys for specific testing');
      process.exit(0);
      break;
      
    case 'status':
      validateConfig();
      console.log(JSON.stringify(bot.getStatus(), null, 2));
      process.exit(0);
      break;
      
    case 'help':
      console.log('Whale Bot - Multi-Source Whale Transaction Monitor');
      console.log('');
      console.log('Available commands:');
      console.log('  npm run dev                     - Start bot in mock mode');
      console.log('  npm run dev -- --twitter        - Start bot with real Twitter posting');
      console.log('  npm run dev test-mobys          - Test MobysScreener API connection');
      console.log('  npm run dev test-hyperliquid    - Test Hyperliquid leaderboard monitoring');
      console.log('  npm run dev status              - Show bot status');
      console.log('  npm run dev help                - Show this help');
      console.log('');
      console.log('Data Sources:');
      console.log('  1. MobysScreener (AssetDash API) - All whale transactions');
      console.log('  2. Hyperliquid - 30x+ leverage long positions over $100k');
      console.log('  3. Whale Alert - General whale movements (optional)');
      console.log('');
      console.log('How it works:');
      console.log('  • MobysScreener: Polls every 60 seconds for new whale transactions');
      console.log('  • Hyperliquid: Real-time WebSocket monitoring of top trader positions');
      console.log('  • Combines all sources and posts to Twitter with rate limiting');
      console.log('');
      console.log('Requirements:');
      console.log('  • Internet connection to access APIs');
      console.log('  • WHALE_ALERT_API_KEY in .env (optional)');
      process.exit(0);
      break;
      
    default:
      await bot.start();
      break;
  }
}

runCommand().catch((error) => {
  logger.error('💥 Fatal error:', error);
  process.exit(1);
});