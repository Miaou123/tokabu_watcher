// src/processors/WhaleAlertProcessor.ts
import WebSocket from 'ws';
import { WhaleAlert, WhaleAlertWebSocketMessage } from '../types';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { MessageFormatter } from '../utils/formatters';

export class WhaleAlertProcessor {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private isConnecting = false;
  private alertCallback?: (alert: WhaleAlert) => void;

  constructor(onAlert?: (alert: WhaleAlert) => void) {
    this.alertCallback = onAlert;
  }

  /**
   * Connect to Whale Alert WebSocket
   */
  async connect(): Promise<void> {
    if (this.isConnecting) {
      logger.warn('Already attempting to connect to Whale Alert');
      return;
    }

    if (!config.whaleAlert.apiKey) {
      logger.error('Whale Alert API key not configured');
      return;
    }

    this.isConnecting = true;
    const url = `${config.whaleAlert.wsUrl}?api_key=${config.whaleAlert.apiKey}`;
    
    try {
      logger.info('Connecting to Whale Alert WebSocket...');
      this.ws = new WebSocket(url);
      
      this.ws.on('open', () => {
        logger.success('Connected to Whale Alert WebSocket');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.subscribe();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          logger.error('Error parsing WebSocket message:', error);
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        logger.warn(`Whale Alert WebSocket closed: ${code} - ${reason.toString()}`);
        this.isConnecting = false;
        this.ws = null;
        this.scheduleReconnect();
      });

      this.ws.on('error', (error: Error) => {
        logger.error('Whale Alert WebSocket error:', error);
        this.isConnecting = false;
        this.ws = null;
      });

    } catch (error) {
      logger.error('Failed to connect to Whale Alert:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  /**
   * Subscribe to whale alerts
   */
  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.error('Cannot subscribe: WebSocket not open');
      return;
    }

    const subscription = {
      type: "subscribe_alerts",
      id: "whale_bot_main",
      min_value_usd: config.whaleAlert.minValue,
      blockchains: ["ethereum", "bitcoin", "tron", "polygon", "solana"],
      tx_types: ["transfer", "mint", "burn"]
    };

    logger.info(`Subscribing to alerts with min value: ${MessageFormatter.formatNumber(config.whaleAlert.minValue)}`);
    logger.debug('Subscription details:', subscription);
    this.ws.send(JSON.stringify(subscription));
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(message: any): void {
    logger.debug('Received message:', message);

    // Handle subscription confirmation
    if (message.type === 'subscribed_alerts') {
      logger.success('Successfully subscribed to whale alerts');
      logger.info(`Subscription ID: ${message.id}`);
      return;
    }

    // Handle whale alerts
    if (message.type === 'alert' || message.text) {
      this.processAlert(message as WhaleAlertWebSocketMessage);
      return;
    }

    // Handle errors
    if (message.error) {
      logger.error('Whale Alert API error:', message.error);
      return;
    }

    logger.debug('Unknown message type:', message);
  }

  /**
   * Process a whale alert
   */
  private processAlert(alertData: WhaleAlertWebSocketMessage): void {
    try {
      logger.info('Processing whale alert:', alertData.text);

      // Convert to standardized format
      const alert: WhaleAlert = this.convertToStandardFormat(alertData);

      // Filter by value if needed (double-check)
      if (alert.value_usd < config.whaleAlert.minValue) {
        logger.debug(`Alert filtered out: value ${alert.value_usd} below minimum ${config.whaleAlert.minValue}`);
        return;
      }

      // Call the callback if provided
      if (this.alertCallback) {
        this.alertCallback(alert);
      }

      logger.success(`Whale alert processed: ${alert.value_usd} USD ${alert.symbol}`);
    } catch (error) {
      logger.error('Error processing whale alert:', error);
    }
  }

  /**
   * Convert WebSocket message to standard WhaleAlert format
   */
  private convertToStandardFormat(data: WhaleAlertWebSocketMessage): WhaleAlert {
    // Get the largest amount if multiple
    const primaryAmount = data.amounts.reduce((prev, current) => 
      current.value_usd > prev.value_usd ? current : prev
    );

    // Generate unique ID
    const id = `wa_${data.timestamp}_${data.transaction.hash}_${primaryAmount.symbol}`;

    // Determine transaction type from the WebSocket data
    let transactionType: 'transfer' | 'mint' | 'burn' = 'transfer';
    if (data.transaction_type === 'mint') {
      transactionType = 'mint';
    } else if (data.transaction_type === 'burn') {
      transactionType = 'burn';
    }

    return {
      id,
      type: transactionType,
      timestamp: data.timestamp,
      blockchain: data.blockchain,
      symbol: primaryAmount.symbol,
      amount: primaryAmount.amount.toString(),
      value_usd: primaryAmount.value_usd,
      from: data.from,
      to: data.to,
      hash: data.transaction.hash
    };
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(config.whaleAlert.reconnectDelay * this.reconnectAttempts, 60000);
    
    logger.info(`Reconnecting to Whale Alert in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Get connection status
   */
  getStatus(): { connected: boolean; reconnectAttempts: number } {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  /**
   * Manually trigger reconnection
   */
  reconnect(): void {
    if (this.ws) {
      this.ws.close();
    }
    this.reconnectAttempts = 0;
    this.connect();
  }

  /**
   * Close connection
   */
  close(): void {
    if (this.ws) {
      logger.info('Closing Whale Alert connection...');
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Test the connection without subscribing
   */
  async test(): Promise<boolean> {
    return new Promise((resolve) => {
      const testWs = new WebSocket(`${config.whaleAlert.wsUrl}?api_key=${config.whaleAlert.apiKey}`);
      
      const timeout = setTimeout(() => {
        testWs.close();
        resolve(false);
      }, 10000);

      testWs.on('open', () => {
        clearTimeout(timeout);
        testWs.close();
        resolve(true);
      });

      testWs.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }
}