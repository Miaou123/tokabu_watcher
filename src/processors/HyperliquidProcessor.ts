// src/processors/HyperliquidProcessor.ts - WebSocket Version
import WebSocket from 'ws';
import axios from 'axios';
import { 
  LeaderboardEntry, 
  LeaderboardResponse, 
  HyperliquidPosition, 
  HyperliquidApiResponse,
  HyperliquidProcessorStatus
} from '../types';
import { logger } from '../utils/logger';
import { MessageFormatter } from '../utils/formatters';

interface UserFill {
  coin: string;
  side: string;
  px: string;
  sz: string;
  time: number;
  startPosition: string;
  dir: string;
  closedPnl?: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  tid: number;
  feeToken: string;
}

interface WebSocketMessage {
  channel: string;
  data: {
    fills?: UserFill[];
    user?: string;
    isSnapshot?: boolean;
  };
}

export class HyperliquidProcessor {
  private ws: WebSocket | null = null;
  private isRunning = false;
  private alertCallback?: (alert: any) => void;

  // Leaderboard management
  private topAddresses = new Set<string>();
  private leaderboardUpdateInterval: NodeJS.Timeout | null = null;
  private readonly LEADERBOARD_UPDATE_INTERVAL = 60 * 60 * 1000; // 1 hour
  private readonly TOP_TRADERS_COUNT = 100;

  // Position tracking
  private userPositions = new Map<string, Map<string, HyperliquidPosition>>();
  private activeSubscriptions = new Set<string>();
  private subscriptionQueue: string[] = [];
  private isSubscribing = false;

  // WebSocket connection
  private readonly HYPERLIQUID_WS = 'wss://api.hyperliquid.xyz/ws';
  private readonly HYPERLIQUID_API = 'https://api.hyperliquid.xyz/info';
  private readonly LEADERBOARD_API = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';

  // Rate limiting for subscriptions
  private readonly SUBSCRIPTION_BATCH_SIZE = 10;
  private readonly SUBSCRIPTION_DELAY = 100; // ms between batches

  // Criteria
  private readonly MIN_LEVERAGE = 30;
  private readonly MIN_POSITION_VALUE = 100000;

  private seenAlerts = new Set<string>();

  constructor(onAlert?: (alert: any) => void) {
    this.alertCallback = onAlert;
  }

  async startMonitoring(): Promise<void> {
    if (this.isRunning) {
      logger.warn('HyperliquidProcessor already running');
      return;
    }

    logger.info('🔌 Starting WebSocket-based Hyperliquid monitoring...');
    this.isRunning = true;

    // Initialize leaderboard
    await this.updateLeaderboard();

    // Connect to WebSocket
    await this.connectWebSocket();

    // Subscribe to all current addresses
    await this.subscribeToAllAddresses();

    // Schedule periodic leaderboard updates
    this.leaderboardUpdateInterval = setInterval(() => {
      this.updateLeaderboardAndAdjustSubscriptions();
    }, this.LEADERBOARD_UPDATE_INTERVAL);

    logger.success('✅ WebSocket monitoring started successfully!');
  }

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info('🔗 Connecting to Hyperliquid WebSocket...');
      
      this.ws = new WebSocket(this.HYPERLIQUID_WS);
      
      this.ws.on('open', () => {
        logger.success('✅ WebSocket connected');
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as WebSocketMessage;
          this.handleWebSocketMessage(message);
        } catch (error) {
          logger.error('Error parsing WebSocket message:', error);
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        logger.warn(`WebSocket closed: ${code} - ${reason.toString()}`);
        if (this.isRunning) {
          logger.info('Attempting to reconnect...');
          setTimeout(() => this.connectWebSocket(), 5000);
        }
      });

      this.ws.on('error', (error: Error) => {
        logger.error('WebSocket error:', error);
        reject(error);
      });

      // Timeout for connection
      setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          reject(new Error('WebSocket connection timeout'));
        }
      }, 10000);
    });
  }

  private async updateLeaderboard(): Promise<void> {
    try {
      logger.info('📊 Updating leaderboard...');

      const response = await axios.get(this.LEADERBOARD_API, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json, text/plain, */*',
        }
      });

      if (!response.data) {
        logger.warn('Empty leaderboard response');
        return;
      }

      let addresses: string[] = [];
      const data = response.data as LeaderboardResponse | LeaderboardEntry[] | any;

      // Parse leaderboard data (same logic as before)
      if (Array.isArray(data)) {
        addresses = data
          .filter((entry: any) => entry.user || entry.address || entry.ethAddress)
          .map((entry: any) => entry.user || entry.address || entry.ethAddress)
          .filter((addr: any): addr is string => !!addr)
          .slice(0, this.TOP_TRADERS_COUNT);
      } else if (data && data.leaderboard) {
        addresses = data.leaderboard
          .filter((entry: any) => entry.user || entry.address || entry.ethAddress)
          .map((entry: any) => entry.user || entry.address || entry.ethAddress)
          .filter((addr: any): addr is string => !!addr)
          .slice(0, this.TOP_TRADERS_COUNT);
      } else if (data && typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
          if (Array.isArray(value) && value.length > 0) {
            const testAddresses = value
              .filter((entry: any) => entry && (entry.user || entry.address || entry.wallet || entry.ethAddress))
              .map((entry: any) => entry.user || entry.address || entry.wallet || entry.ethAddress)
              .filter((addr: any): addr is string => !!addr);
            
            if (testAddresses.length > 0) {
              addresses = testAddresses.slice(0, this.TOP_TRADERS_COUNT);
              break;
            }
          }
        }
      }

      // Update the set
      this.topAddresses = new Set(addresses);

      logger.success(`📊 Leaderboard updated: ${this.topAddresses.size} addresses`);

      if (this.topAddresses.size < 100) {
        logger.warn('⚠️ Very few addresses from leaderboard, may need to check endpoint format');
      }

    } catch (error: any) {
      logger.error(`❌ Could not fetch leaderboard: ${error.message}`);
    }
  }

  private async updateLeaderboardAndAdjustSubscriptions(): Promise<void> {
    logger.info('🔄 Periodic leaderboard update and subscription adjustment...');
    
    const previousAddresses = new Set(this.topAddresses);
    await this.updateLeaderboard();
    
    // Find new addresses (in current top 1000 but not in previous)
    const newAddresses: string[] = [];
    for (const address of this.topAddresses) {
      if (!previousAddresses.has(address)) {
        newAddresses.push(address);
      }
    }

    // Find removed addresses (in previous but not in current top 1000)
    const removedAddresses: string[] = [];
    for (const address of previousAddresses) {
      if (!this.topAddresses.has(address)) {
        removedAddresses.push(address);
      }
    }

    // Unsubscribe from removed addresses
    for (const address of removedAddresses) {
      await this.unsubscribeFromAddress(address);
      this.userPositions.delete(address);
    }

    // Subscribe to new addresses
    for (const address of newAddresses) {
      await this.subscribeToAddress(address);
    }

    logger.success(
      `🔄 Subscription adjustment complete: ` +
      `+${newAddresses.length} new, -${removedAddresses.length} removed, ` +
      `${this.activeSubscriptions.size} total active`
    );
  }

  private async subscribeToAllAddresses(): Promise<void> {
    logger.info(`📡 Subscribing to ${this.topAddresses.size} addresses...`);
    
    const addresses = Array.from(this.topAddresses);
    this.subscriptionQueue = [...addresses];
    
    await this.processSubscriptionQueue();
  }

  private async processSubscriptionQueue(): Promise<void> {
    if (this.isSubscribing || this.subscriptionQueue.length === 0) {
      return;
    }

    this.isSubscribing = true;

    while (this.subscriptionQueue.length > 0) {
      const batch = this.subscriptionQueue.splice(0, this.SUBSCRIPTION_BATCH_SIZE);
      
      for (const address of batch) {
        await this.subscribeToAddress(address);
      }

      // Small delay between batches to avoid overwhelming the WebSocket
      if (this.subscriptionQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.SUBSCRIPTION_DELAY));
      }

      // Progress logging
      const remaining = this.subscriptionQueue.length;
      const total = this.topAddresses.size;
      const completed = total - remaining;
      
      if (completed % 100 === 0 || remaining === 0) {
        logger.info(`📡 Subscription progress: ${completed}/${total} (${((completed/total)*100).toFixed(1)}%)`);
      }
    }

    this.isSubscribing = false;
    logger.success(`✅ All subscriptions complete: ${this.activeSubscriptions.size} active`);
  }

  private async subscribeToAddress(address: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('WebSocket not ready for subscription');
      return;
    }

    if (this.activeSubscriptions.has(address)) {
      return; // Already subscribed
    }

    const subscription = {
      method: 'subscribe',
      subscription: {
        type: 'userFills',
        user: address
      }
    };

    this.ws.send(JSON.stringify(subscription));
    this.activeSubscriptions.add(address);
    
    logger.debug(`📡 Subscribed to ${address.slice(0, 8)}...`);

    // Initialize position tracking for this user
    if (!this.userPositions.has(address)) {
      await this.loadInitialPositions(address);
    }
  }

  private async unsubscribeFromAddress(address: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    if (!this.activeSubscriptions.has(address)) {
      return; // Not subscribed
    }

    const unsubscription = {
      method: 'unsubscribe',
      subscription: {
        type: 'userFills',
        user: address
      }
    };

    this.ws.send(JSON.stringify(unsubscription));
    this.activeSubscriptions.delete(address);
    
    logger.debug(`📡 Unsubscribed from ${address.slice(0, 8)}...`);
  }

  private async loadInitialPositions(address: string): Promise<void> {
    try {
      const response = await axios.post(this.HYPERLIQUID_API, {
        type: 'clearinghouseState',
        user: address
      }, {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' }
      });

      const data = response.data as HyperliquidApiResponse | any;
      
      if (data && data.assetPositions) {
        const positions = new Map<string, HyperliquidPosition>();
        
        const currentPositions: HyperliquidPosition[] = data.assetPositions
          .map((assetPos: any) => assetPos.position)
          .filter((position: any) => position && position.coin);

        for (const position of currentPositions) {
          positions.set(position.coin, position);
        }

        this.userPositions.set(address, positions);
        
        logger.debug(`📊 Loaded ${positions.size} initial positions for ${address.slice(0, 8)}...`);
      }
    } catch (error: any) {
      logger.debug(`Error loading initial positions for ${address.slice(0, 8)}...: ${error.message}`);
    }
  }

  private handleWebSocketMessage(message: WebSocketMessage): void {
    if (message.channel === 'subscriptionResponse') {
      // Handle subscription confirmations
      return;
    }

    if (message.data && message.data.fills && message.data.user) {
      this.processFills(message.data.user, message.data.fills, message.data.isSnapshot || false);
    }
  }

  private async processFills(userAddress: string, fills: UserFill[], isSnapshot: boolean): Promise<void> {
    if (isSnapshot) {
      // Skip snapshot data - we loaded initial positions separately
      return;
    }

    logger.debug(`📈 Processing ${fills.length} fills for ${userAddress.slice(0, 8)}...`);

    // For each fill, we need to check if it creates/modifies a qualifying position
    for (const fill of fills) {
      await this.handleFill(userAddress, fill);
    }
  }

  private async handleFill(userAddress: string, fill: UserFill): Promise<void> {
    const { coin, side, sz, dir } = fill;
    
    // Get current positions for this user
    let userPositions = this.userPositions.get(userAddress);
    if (!userPositions) {
      // If we don't have positions, fetch them
      await this.loadInitialPositions(userAddress);
      userPositions = this.userPositions.get(userAddress);
      if (!userPositions) return;
    }

    // After a fill, fetch updated position data to get accurate leverage/values
    try {
      const response = await axios.post(this.HYPERLIQUID_API, {
        type: 'clearinghouseState',
        user: userAddress
      }, {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' }
      });

      const data = response.data as HyperliquidApiResponse | any;
      
      if (data && data.assetPositions) {
        const previousPosition = userPositions.get(coin);
        
        // Find the updated position for this coin
        const updatedPositions: HyperliquidPosition[] = data.assetPositions
          .map((assetPos: any) => assetPos.position)
          .filter((position: any) => position && position.coin);

        const currentPosition = updatedPositions.find(p => p.coin === coin);

        if (currentPosition) {
          // Check if this is a new qualifying position
          const wasQualifying = previousPosition ? this.isQualifyingPosition(previousPosition) : false;
          const isQualifying = this.isQualifyingPosition(currentPosition);
          
          if (isQualifying && !wasQualifying) {
            // This is a NEW qualifying position!
            logger.success(`🆕 NEW QUALIFYING POSITION: ${coin} by ${userAddress.slice(0, 8)}...`);
            await this.emitPositionAlert(userAddress, currentPosition);
          }

          // Update our position tracking
          userPositions.set(coin, currentPosition);
        } else if (previousPosition) {
          // Position was closed
          userPositions.delete(coin);
        }

        // Update all positions for this user
        const newPositions = new Map<string, HyperliquidPosition>();
        for (const position of updatedPositions) {
          newPositions.set(position.coin, position);
        }
        this.userPositions.set(userAddress, newPositions);
      }
    } catch (error: any) {
      logger.debug(`Error fetching updated positions for ${userAddress.slice(0, 8)}...: ${error.message}`);
    }
  }

  private isQualifyingPosition(position: HyperliquidPosition): boolean {
    const positionSize = parseFloat(position.szi);
    const positionValue = Math.abs(parseFloat(position.positionValue));
    const leverage = this.calculateLeverage(position);

    const isLong = positionSize > 0;
    const meetsValue = positionValue >= this.MIN_POSITION_VALUE;
    const meetsLeverage = leverage >= this.MIN_LEVERAGE;

    return isLong && meetsValue && meetsLeverage;
  }

  private calculateLeverage(position: HyperliquidPosition): number {
    const positionValue = Math.abs(parseFloat(position.positionValue));
    
    // Handle both old format (marginUsed) and new format (leverage.value or leverage object)
    if (position.leverage && typeof position.leverage === 'object') {
      if ('value' in position.leverage) {
        return position.leverage.value || 0;
      }
    }
    
    // Fallback to calculating from marginUsed
    const marginUsed = parseFloat(position.marginUsed);
    return marginUsed > 0 ? positionValue / marginUsed : 0;
  }

  private async emitPositionAlert(address: string, position: HyperliquidPosition): Promise<void> {
    const leverage = this.calculateLeverage(position);
    const positionValue = Math.abs(parseFloat(position.positionValue));

    const alertId = `${address}_${position.coin}_${Math.floor(positionValue/10000)}_${Math.floor(leverage)}`;

    if (this.seenAlerts.has(alertId)) {
      return;
    }

    this.seenAlerts.add(alertId);

    const alert = {
      id: `hl_${address}_${Date.now()}`,
      type: 'hyperliquid_trade',
      timestamp: Date.now(),
      symbol: position.coin,
      amount: Math.abs(parseFloat(position.szi)).toString(),
      value_usd: positionValue,
      from: address,
      to: 'Hyperliquid',
      leverage: Math.round(leverage),
      side: 'long',
      platform: 'Hyperliquid'
    };

    if (this.alertCallback) {
      this.alertCallback(alert);
    }

    logger.success(
      `🔥 ${Math.round(leverage)}x LONG: ${position.coin} ` +
      `$${MessageFormatter.formatNumber(positionValue)} ` +
      `by ${address.slice(0,8)}... ` +
      `(Entry: $${parseFloat(position.entryPx).toFixed(2)})`
    );

    // Cleanup old alerts
    if (this.seenAlerts.size > 1000) {
      const alertsArray = Array.from(this.seenAlerts);
      this.seenAlerts = new Set(alertsArray.slice(-500));
    }
  }

  getStatus(): HyperliquidProcessorStatus {
    return {
      running: this.isRunning,
      monitoredAddresses: this.activeSubscriptions.size,
      strategy: `WebSocket: Real-time fills monitoring for top ${this.TOP_TRADERS_COUNT}`,
      criteria: {
        minLeverage: this.MIN_LEVERAGE,
        minValue: MessageFormatter.formatUSD(this.MIN_POSITION_VALUE),
        side: 'long'
      },
      recentAddresses: Array.from(this.topAddresses).slice(0, 5).map(addr => addr.slice(0,10) + '...'),
      cycleInfo: {
        currentPosition: this.activeSubscriptions.size,
        totalAddresses: this.topAddresses.size,
        fullCycleTime: 'Real-time via WebSocket',
        requestsPerMinute: 0
      }
    };
  }

  stop(): void {
    logger.info('🛑 Stopping WebSocket Hyperliquid monitoring...');
    this.isRunning = false;

    if (this.leaderboardUpdateInterval) {
      clearInterval(this.leaderboardUpdateInterval);
      this.leaderboardUpdateInterval = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.activeSubscriptions.clear();
    this.userPositions.clear();
    this.seenAlerts.clear();

    logger.success('✅ WebSocket monitoring stopped');
  }

  async test(): Promise<boolean> {
    try {
      logger.info('🧪 Testing WebSocket Hyperliquid monitoring...');

      // Test API connectivity
      const apiResponse = await axios.post(this.HYPERLIQUID_API, {
        type: 'meta'
      }, { timeout: 5000 });

      const apiSuccess = apiResponse.status === 200;
      logger.info(`📡 Hyperliquid API: ${apiSuccess ? '✅' : '❌'}`);

      // Test leaderboard
      let leaderboardSuccess = false;
      try {
        const leaderboardResponse = await axios.get(this.LEADERBOARD_API, {
          timeout: 5000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        leaderboardSuccess = leaderboardResponse.status === 200;
      } catch {
        leaderboardSuccess = false;
      }

      logger.info(`📊 Leaderboard API: ${leaderboardSuccess ? '✅' : '❌'}`);

      // Test WebSocket connection
      let wsSuccess = false;
      try {
        await this.connectWebSocket();
        wsSuccess = this.ws?.readyState === WebSocket.OPEN;
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
      } catch {
        wsSuccess = false;
      }

      logger.info(`🔌 WebSocket connection: ${wsSuccess ? '✅' : '❌'}`);

      const overallSuccess = apiSuccess && leaderboardSuccess && wsSuccess;

      if (overallSuccess) {
        logger.success('✅ WebSocket monitoring ready!');
        logger.info(`📊 Will monitor top ${this.TOP_TRADERS_COUNT} traders via real-time WebSocket`);
        logger.info(`🎯 Criteria: ${this.MIN_LEVERAGE}x+ leverage, $${this.MIN_POSITION_VALUE/1000}k+ value, longs only`);
      } else {
        logger.error('❌ Setup issues detected - cannot start WebSocket monitoring');
      }

      return overallSuccess;

    } catch (error: any) {
      logger.error('❌ WebSocket test failed:', error.message);
      return false;
    }
  }
}