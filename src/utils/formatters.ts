// src/utils/formatters.ts - FIXED VERSION
import { WhaleAlert, WhaleAlertWebSocketMessage } from '../types';

export class MessageFormatter {
  /**
   * Format a number to a readable string with commas
   */
  static formatNumber(num: number): string {
    if (num >= 1e9) {
      return (num / 1e9).toFixed(2) + 'B';
    } else if (num >= 1e6) {
      return (num / 1e6).toFixed(2) + 'M';
    } else if (num >= 1e3) {
      return (num / 1e3).toFixed(2) + 'K';
    }
    return num.toLocaleString();
  }

  /**
   * Format USD value with proper currency symbol
   */
  static formatUSD(amount: number): string {
    return '$' + this.formatNumber(amount);
  }

  /**
   * Format crypto amount (remove trailing zeros)
   */
  static formatCryptoAmount(amount: number | string, decimals: number = 2): string {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    
    if (num >= 1) {
      return num.toLocaleString(undefined, { 
        minimumFractionDigits: 0, 
        maximumFractionDigits: decimals 
      });
    } else {
      // For small amounts, show more precision
      return num.toFixed(6).replace(/\.?0+$/, '');
    }
  }

  /**
   * Shorten wallet address for display - FIXED to handle undefined
   */
  static shortenAddress(address: string | undefined | null): string {
    if (!address || typeof address !== 'string') {
      return 'Unknown';
    }
    
    if (address.length <= 10) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  /**
   * Get emoji for blockchain
   */
  static getBlockchainEmoji(blockchain: string): string {
    const emojis: { [key: string]: string } = {
      'bitcoin': '₿',
      'ethereum': '⟠',
      'tron': '🟥',
      'polygon': '🟣',
      'solana': '🌞',
      'cardano': '🔵',
      'avalanche': '🔺',
      'bsc': '🟨',
      'arbitrum': '🔷',
      'ripple': '💧'
    };
    return emojis[blockchain.toLowerCase()] || '🔗';
  }

  /**
   * Get emoji for transaction type
   */
  static getTransactionEmoji(type: string): string {
    const emojis: { [key: string]: string } = {
      'transfer': '💸',
      'mint': '🖨️',
      'burn': '🔥',
      'swap': '🔄',
      'deposit': '📥',
      'withdrawal': '📤'
    };
    return emojis[type.toLowerCase()] || '💰';
  }

  /**
   * Get special emoji for specific tokens
   */
  static getTokenEmoji(symbol: string): string {
    const tokenEmojis: { [key: string]: string } = {
      'BTC': '₿',
      'ETH': '⟠', 
      'SOL': '🌞',
      'BONK': '🐕',
      'WIF': '🐕',
      'RAY': '🌊',
      'USDT': '💚',
      'USDC': '🔵',
      'DOGE': '🐕',
      'SHIB': '🐕'
    };
    return tokenEmojis[symbol.toUpperCase()] || '';
  }

  /**
   * Format whale alert for Twitter (matching official Whale Alert style)
   */
  static formatWhaleAlert(alert: WhaleAlert): string {
    let alertEmojis: string;
    
    // Special handling for mints (use money emojis)
    if (alert.type === 'mint') {
      alertEmojis = this.getMintEmojis();
    } else {
      alertEmojis = this.getAlertEmojis(alert.value_usd);
    }
    
    // Main alert line (matching official style)
    let message = `${alertEmojis} ${this.formatCryptoAmount(alert.amount)} #${alert.symbol.toUpperCase()} `;
    message += `(${this.formatUSD(alert.value_usd)}) `;
    
    // Transaction type
    if (alert.type === 'mint') {
      message += `minted at ${this.formatEntity(alert.to)}`;
    } else if (alert.type === 'burn') {
      message += `burned at ${this.formatEntity(alert.from)}`;
    } else {
      message += `transferred from ${this.formatEntity(alert.from)} to ${this.formatEntity(alert.to)}`;
    }
    
    // Add transaction link if hash is available
    if (alert.hash && alert.blockchain) {
      message += `\n\nhttps://whale-alert.io/tx/${alert.blockchain}/${alert.hash}`;
    }
    
    return message;
  }

  /**
   * Format Hyperliquid trade for Twitter - FIXED VERSION
   */
  static formatHyperliquidAlert(alert: WhaleAlert): string {
    const leverageEmoji = this.getLeverageEmoji(alert.leverage || 1);
    const tokenEmoji = this.getTokenEmoji(alert.symbol);
    
    let message = `${leverageEmoji} HIGH LEVERAGE ALERT!\n\n`;
    message += `${alert.leverage || 1}x ${alert.side?.toUpperCase() || 'LONG'} ${tokenEmoji}${alert.symbol}\n`;
    message += `Size: ${this.formatUSD(alert.value_usd)}\n`;
    message += `Trader: ${this.shortenAddress(alert.from)}\n\n`;
    message += `#Hyperliquid #Leverage #${alert.symbol}`;
    
    return message;
  }

  /**
   * Get leverage emoji based on leverage amount
   */
  static getLeverageEmoji(leverage: number): string {
    if (leverage >= 50) return '🚨🚨🚨';
    if (leverage >= 40) return '🚨🚨';
    if (leverage >= 30) return '🚨';
    if (leverage >= 20) return '⚡';
    return '📈';
  }

  /**
   * Get alert emojis based on value (matching official Whale Alert pattern)
   */
  private static getAlertEmojis(valueUsd: number): string {
    if (valueUsd >= 500000000) {
      // $500M+ - 10 emojis
      return '🚨 🚨 🚨 🚨 🚨 🚨 🚨 🚨 🚨 🚨';
    } else if (valueUsd >= 300000000) {
      // $300M+ - 8 emojis  
      return '🚨 🚨 🚨 🚨 🚨 🚨 🚨 🚨';
    } else if (valueUsd >= 200000000) {
      // $200M+ - 6 emojis
      return '🚨 🚨 🚨 🚨 🚨 🚨';
    } else if (valueUsd >= 100000000) {
      // $100M+ - 5 emojis
      return '🚨 🚨 🚨 🚨 🚨';
    } else if (valueUsd >= 75000000) {
      // $75M+ - 4 emojis
      return '🚨 🚨 🚨 🚨';
    } else {
      // $50M+ - 3 emojis
      return '🚨 🚨 🚨';
    }
  }

  /**
   * Get special emoji for minting (matching official style)
   */
  private static getMintEmojis(): string {
    return '💵 💵 💵 💵 💵 💵 💵 💵 💵 💵';
  }

  /**
   * Format entity name (exchange or wallet address)
   */
  private static formatEntity(entity: string | undefined | null): string {
    if (!entity || typeof entity !== 'string') {
      return 'Unknown';
    }
    
    // If it's a known exchange/entity name, capitalize it
    const knownEntities = [
      'binance', 'coinbase', 'kraken', 'huobi', 'okex', 'kucoin', 
      'bitfinex', 'bithumb', 'bitstamp', 'gemini', 'ftx', 'bybit'
    ];
    
    const lowerEntity = entity.toLowerCase();
    const knownEntity = knownEntities.find(e => lowerEntity.includes(e));
    
    if (knownEntity) {
      return knownEntity.charAt(0).toUpperCase() + knownEntity.slice(1);
    }
    
    // If it looks like an address, shorten it
    if (entity.match(/^0x[a-fA-F0-9]{40}$/) || entity.match(/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/)) {
      return this.shortenAddress(entity);
    }
    
    // Handle "unknown wallet" or similar
    if (entity.toLowerCase().includes('unknown')) {
      return 'Unknown Wallet';
    }
    
    return entity;
  }

  /**
   * Format swap transaction for Twitter
   */
  static formatSwapAlert(data: any): string {
    const message = `🔄 LARGE SWAP DETECTED!\n\n` +
      `${this.formatUSD(data.value_usd)} swap\n` +
      `${data.tokenIn} → ${data.tokenOut}\n` +
      `Platform: ${data.platform}\n\n` +
      `#DeFi #Swap #${data.tokenIn} #${data.tokenOut}`;
    
    return message;
  }

  /**
   * Validate tweet length
   */
  static validateTweetLength(message: string, maxLength: number = 280): boolean {
    return message.length <= maxLength;
  }

  /**
   * Truncate message if too long
   */
  static truncateMessage(message: string, maxLength: number = 280): string {
    if (message.length <= maxLength) return message;
    
    // Try to truncate at a word boundary
    const truncated = message.substring(0, maxLength - 3);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > maxLength * 0.8) {
      return truncated.substring(0, lastSpace) + '...';
    }
    
    return truncated + '...';
  }
}