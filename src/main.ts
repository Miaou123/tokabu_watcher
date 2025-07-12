// src/main.ts
import { config, validateConfig } from './config/config';
import { logger } from './utils/logger';
import { WhaleAlertProcessor } from './processors/WhaleAlertProcessor';
import { AlertManager } from './services/AlertManager';
import { TwitterService } from './services/TwitterService';

class WhaleBot {
  private isRunning = false;
  private whaleAlertProcessor: WhaleAlertProcessor | null = null;
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
      logger.info('🐋 Starting Whale Bot...');
      
      // Validate configuration
      validateConfig();
      logger.info('✅ Configuration validated');

      // Ask user if they want to use Twitter
      const useTwitter = process.argv.includes('--twitter') || process.argv.includes('--with-twitter');
      this.useTwitter = useTwitter;

      if (useTwitter) {
        logger.info('🐦 Twitter mode enabled');
        // Initialize Twitter Service
        this.twitterService = new TwitterService();
        await this.twitterService.initialize();
        logger.success('✅ Twitter service initialized');
      } else {
        logger.info('📝 Mock mode enabled (use --twitter flag for real tweets)');
      }

      // Initialize Alert Manager with appropriate tweet sender
      const tweetSender = this.useTwitter 
        ? this.twitterService!.postTweet.bind(this.twitterService!)
        : this.mockTweetSender.bind(this);

      this.alertManager = new AlertManager(tweetSender);
      logger.success('✅ Alert Manager initialized');

      // Initialize Whale Alert Processor
      this.whaleAlertProcessor = new WhaleAlertProcessor(
        this.alertManager.processAlert.bind(this.alertManager)
      );

      // Test Whale Alert connection
      if (config.whaleAlert.apiKey) {
        logger.info('🔌 Testing Whale Alert connection...');
        const testResult = await this.whaleAlertProcessor.test();
        
        if (testResult) {
          logger.success('✅ Whale Alert connection test passed');
          
          // Connect to Whale Alert
          await this.whaleAlertProcessor.connect();
        } else {
          logger.error('❌ Whale Alert connection test failed');
          logger.warn('Bot will continue but Whale Alert features will not work');
        }
      } else {
        logger.warn('⚠️  No Whale Alert API key configured');
        logger.info('Get your API key from: https://developer.whale-alert.io/');
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
   * Mock tweet sender for testing (used when --twitter flag is not provided)
   */
  private async mockTweetSender(message: string): Promise<boolean> {
    logger.info('📝 MOCK TWEET:');
    logger.info('─'.repeat(50));
    logger.info(message);
    logger.info('─'.repeat(50));
    
    // Simulate tweet posting delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return true; // Always succeed for testing
  }

  private logStatus(): void {
    logger.info('📊 Bot Status:');
    logger.info(`   • Mode: ${this.useTwitter ? '🐦 Twitter' : '📝 Mock'}`);
    logger.info(`   • Whale Alert: ${this.whaleAlertProcessor?.getStatus().connected ? '🟢 Connected' : '🔴 Disconnected'}`);
    
    if (this.twitterService) {
      const twitterStatus = this.twitterService.getStatus();
      logger.info(`   • Twitter: ${twitterStatus.loggedIn ? '🟢 Logged in' : '🔴 Not logged in'}`);
    }
    
    if (this.alertManager) {
      const status = this.alertManager.getStatus();
      logger.info(`   • Queue Length: ${status.queueLength}`);
      logger.info(`   • Can Tweet: ${status.canTweet ? '✅' : '❌'}`);
      if (status.nextTweetTime) {
        logger.info(`   • Next Tweet: ${status.nextTweetTime.toISOString()}`);
      }
    }
  }

  private keepAlive(): void {
    const interval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(interval);
        return;
      }
      
      // Health check log every 5 minutes
      logger.debug('💓 Bot heartbeat - system running normally');
      
      // Log status every 30 minutes
      if (Date.now() % (30 * 60 * 1000) < 10000) {
        this.logStatus();
      }
    }, 5 * 60 * 1000);

    // Log status immediately and then every 15 minutes
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
    
    // Close connections
    if (this.whaleAlertProcessor) {
      this.whaleAlertProcessor.close();
    }

    if (this.twitterService) {
      await this.twitterService.close();
    }
    
    // Clear any pending alerts
    if (this.alertManager) {
      this.alertManager.clearQueue();
    }
    
    logger.success('✅ Whale Bot stopped gracefully');
    process.exit(0);
  }

  /**
   * Get current bot status
   */
  getStatus(): any {
    return {
      running: this.isRunning,
      mode: this.useTwitter ? 'twitter' : 'mock',
      whaleAlert: this.whaleAlertProcessor?.getStatus(),
      twitter: this.twitterService?.getStatus(),
      alertManager: this.alertManager?.getStatus(),
      config: {
        minValue: config.whaleAlert.minValue,
        tweetRateLimit: config.twitter.rateLimitMinutes
      }
    };
  }

  /**
   * Manual testing methods
   */
  async testWhaleAlert(): Promise<void> {
    if (!this.whaleAlertProcessor) {
      logger.error('Whale Alert processor not initialized');
      return;
    }

    logger.info('🧪 Testing Whale Alert connection...');
    const result = await this.whaleAlertProcessor.test();
    logger.info(`Test result: ${result ? '✅ Success' : '❌ Failed'}`);
  }

  async testTwitter(): Promise<void> {
    if (!this.twitterService) {
      this.twitterService = new TwitterService();
    }

    logger.info('🧪 Testing Twitter service...');
    const result = await this.twitterService.test();
    logger.info(`Test result: ${result ? '✅ Success' : '❌ Failed'}`);
  }

  async processAlertQueue(): Promise<void> {
    if (!this.alertManager) {
      logger.error('Alert manager not initialized');
      return;
    }

    logger.info('🔄 Processing alert queue manually...');
    await this.alertManager.processQueue();
  }
}

// CLI commands for testing
const args = process.argv.slice(2);
const command = args[0];

async function runCommand() {
  const bot = new WhaleBot();

  switch (command) {
    case 'test-whale-alert':
      validateConfig();
      await bot.testWhaleAlert();
      process.exit(0);
      break;

    case 'test-twitter':
      await bot.testTwitter();
      process.exit(0);
      break;
      
    case 'status':
      validateConfig();
      console.log(JSON.stringify(bot.getStatus(), null, 2));
      process.exit(0);
      break;
      
    case 'help':
      console.log('Available commands:');
      console.log('  npm run dev                     - Start bot in mock mode');
      console.log('  npm run dev -- --twitter        - Start bot with real Twitter posting');
      console.log('  npm run dev test-whale-alert    - Test Whale Alert connection');
      console.log('  npm run dev test-twitter        - Test Twitter connection');
      console.log('  npm run dev status              - Show bot status');
      console.log('  npm run dev help                - Show this help');
      process.exit(0);
      break;
      
    default:
      // Start the bot normally
      await bot.start();
      break;
  }
}

// Start the bot
runCommand().catch((error) => {
  logger.error('💥 Fatal error:', error);
  process.exit(1);
});