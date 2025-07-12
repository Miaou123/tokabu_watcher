// src/services/TwitterService.ts
import puppeteer, { Browser, Page } from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger';

export class TwitterService {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private isLoggedIn = false;
  private cookiesPath = path.join(__dirname, '../data/twitter-cookies.json');
  private sessionPath = path.join(__dirname, '../data/twitter-session.json');

  constructor() {
    this.ensureDataDirectory();
  }

  private async ensureDataDirectory() {
    const dataDir = path.dirname(this.cookiesPath);
    try {
      await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
      // Directory already exists
    }
  }

  /**
   * Wait for a specified time
   */
  private async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Initialize browser and restore session
   */
  async initialize(): Promise<void> {
    logger.info('🐦 Initializing Twitter service...');
    
    this.browser = await puppeteer.launch({
      headless: false, // Set to true in production
      defaultViewport: null,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ]
    });

    this.page = await this.browser.newPage();
    
    // Set user agent to avoid detection
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Load saved session if exists
    await this.loadSession();
    
    // Navigate to Twitter
    await this.page.goto('https://twitter.com/home', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    // Check if we're logged in
    await this.checkLoginStatus();
    
    if (!this.isLoggedIn) {
      logger.warn('🔑 Not logged in to Twitter. Please complete manual login...');
      await this.waitForManualLogin();
    }

    logger.success('✅ Twitter service ready!');
  }

  /**
   * Save browser session (cookies + local storage)
   */
  async saveSession(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    // Save cookies
    const cookies = await this.page.cookies();
    await fs.writeFile(this.cookiesPath, JSON.stringify(cookies, null, 2));

    // Save local storage and session storage
    const sessionData = await this.page.evaluate(() => {
      const localStorageData: Record<string, string> = {};
      const sessionStorageData: Record<string, string> = {};
      
      // Get localStorage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          localStorageData[key] = localStorage.getItem(key) || '';
        }
      }
      
      // Get sessionStorage
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key) {
          sessionStorageData[key] = sessionStorage.getItem(key) || '';
        }
      }
      
      return {
        localStorage: localStorageData,
        sessionStorage: sessionStorageData,
        url: window.location.href
      };
    });

    await fs.writeFile(this.sessionPath, JSON.stringify(sessionData, null, 2));
    logger.success('💾 Twitter session saved');
  }

  /**
   * Load saved browser session
   */
  async loadSession(): Promise<void> {
    if (!this.page) return;

    try {
      // Load cookies
      const cookiesData = await fs.readFile(this.cookiesPath, 'utf8');
      const cookies = JSON.parse(cookiesData);
      await this.page.setCookie(...cookies);
      logger.debug('🍪 Cookies loaded');

      // Load session data
      const sessionData = await fs.readFile(this.sessionPath, 'utf8');
      const session = JSON.parse(sessionData);
      
      // Set local storage and session storage
      await this.page.evaluateOnNewDocument((sessionData: any) => {
        for (const [key, value] of Object.entries(sessionData.localStorage)) {
          localStorage.setItem(key, value as string);
        }
        for (const [key, value] of Object.entries(sessionData.sessionStorage)) {
          sessionStorage.setItem(key, value as string);
        }
      }, session);

      logger.debug('📦 Session data loaded');
    } catch (error) {
      logger.debug('No saved session found');
    }
  }

  /**
   * Check if user is logged in to Twitter
   */
  async checkLoginStatus(): Promise<boolean> {
    if (!this.page) return false;

    try {
      // Wait a bit for page to load
      await this.wait(3000);

      // Check for login indicators
      const loginCheck = await this.page.evaluate(() => {
        // Check for compose tweet button or user avatar
        const composeButton = document.querySelector('[data-testid="SideNav_NewTweet_Button"]');
        const userAvatar = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
        const tweetButton = document.querySelector('[data-testid="tweetButtonInline"]');
        
        return !!(composeButton || userAvatar || tweetButton);
      });

      this.isLoggedIn = loginCheck;
      logger.info(`🔐 Twitter login status: ${this.isLoggedIn ? 'Logged in' : 'Not logged in'}`);
      return this.isLoggedIn;
    } catch (error) {
      logger.error('Error checking login status:', error);
      return false;
    }
  }

  /**
   * Wait for user to manually log in
   */
  async waitForManualLogin(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    logger.warn('⚠️  MANUAL LOGIN REQUIRED ⚠️');
    logger.warn('Please log in to Twitter in the browser window that opened.');
    logger.warn('The bot will automatically detect when you\'re logged in...');

    // Poll for login status every 5 seconds
    while (!this.isLoggedIn) {
      await this.wait(5000);
      await this.checkLoginStatus();
      
      if (this.isLoggedIn) {
        logger.success('✅ Login detected! Saving session...');
        await this.saveSession();
        break;
      }
    }
  }

  /**
   * Post a tweet
   */
  async postTweet(content: string): Promise<boolean> {
    if (!this.page || !this.isLoggedIn) {
      logger.error('❌ Twitter service not ready or not logged in');
      return false;
    }

    try {
      logger.info(`🐦 Posting tweet: ${content.substring(0, 50)}...`);

      // Navigate to home if not already there
      const currentUrl = this.page.url();
      if (!currentUrl.includes('twitter.com/home')) {
        await this.page.goto('https://twitter.com/home', { waitUntil: 'networkidle2' });
      }

      // Wait for and click the compose tweet button
      await this.page.waitForSelector('[data-testid="tweetTextarea_0"]', { timeout: 10000 });
      
      // Click on the tweet compose area
      await this.page.click('[data-testid="tweetTextarea_0"]');
      await this.wait(1000);

      // Clear any existing content
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('KeyA');
      await this.page.keyboard.up('Control');
      await this.page.keyboard.press('Delete');

      // Type the tweet content
      await this.page.type('[data-testid="tweetTextarea_0"]', content);
      await this.wait(1000);

      // Find and click the Tweet button
      const tweetButton = await this.page.waitForSelector('[data-testid="tweetButtonInline"]', { timeout: 5000 });
      
      if (!tweetButton) {
        logger.error('❌ Could not find tweet button');
        return false;
      }

      // Check if button is enabled (not disabled)
      const isDisabled = await this.page.evaluate((btn) => {
        return btn.getAttribute('aria-disabled') === 'true';
      }, tweetButton);

      if (isDisabled) {
        logger.error('❌ Tweet button is disabled - content might be too long or empty');
        return false;
      }

      // Click the tweet button
      await tweetButton.click();

      // Wait for tweet to be posted (look for success indicators)
      await this.wait(3000);

      // Verify tweet was posted by checking if compose area is cleared
      const isCleared = await this.page.evaluate(() => {
        const textarea = document.querySelector('[data-testid="tweetTextarea_0"]') as HTMLElement;
        return !textarea?.innerText || textarea.innerText.trim() === '';
      });

      if (isCleared) {
        logger.success('✅ Tweet posted successfully!');
        return true;
      } else {
        logger.warn('⚠️  Tweet may not have been posted');
        return false;
      }

    } catch (error: any) {
      logger.error('❌ Error posting tweet:', error?.message || 'Unknown error');
      
      // Try to recover session
      await this.checkLoginStatus();
      if (!this.isLoggedIn) {
        logger.warn('🔑 Session expired, manual login required');
        await this.waitForManualLogin();
      }
      
      return false;
    }
  }

  /**
   * Get current status
   */
  getStatus(): { connected: boolean; loggedIn: boolean } {
    return {
      connected: !!this.browser && !!this.page,
      loggedIn: this.isLoggedIn
    };
  }

  /**
   * Close browser and cleanup
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      logger.info('🐦 Twitter service closed');
    }
  }

  /**
   * Test the service
   */
  async test(): Promise<boolean> {
    try {
      await this.initialize();
      
      const testTweet = `🤖 Bot test - ${new Date().toISOString()}`;
      const success = await this.postTweet(testTweet);
      
      if (success) {
        logger.success('✅ Twitter service test passed!');
      } else {
        logger.error('❌ Twitter service test failed!');
      }
      
      return success;
    } catch (error: any) {
      logger.error('❌ Twitter test error:', error?.message || 'Unknown error');
      return false;
    }
  }
}