// src/config/config.ts
import dotenv from 'dotenv';
import { BotConfig } from '../types';

dotenv.config();

export const config: BotConfig = {
  whaleAlert: {
    apiKey: process.env.WHALE_ALERT_API_KEY || '',
    minValue: parseInt(process.env.MIN_WHALE_VALUE || '1000000'),
    reconnectDelay: 10000,
    wsUrl: 'wss://leviathan.whale-alert.io/ws'
  },
  
  twitter: {
    rateLimitMinutes: parseInt(process.env.TWEET_RATE_LIMIT_MINUTES || '1'),
    maxTweetLength: 280
  }
};

// Validate required environment variables
export function validateConfig(): void {
  const required = [
    'WHALE_ALERT_API_KEY'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.warn(`⚠️  Missing environment variables: ${missing.join(', ')}`);
    console.warn('Some features may not work until these are configured.');
  }
  
  // Validate API key format if provided
  if (config.whaleAlert.apiKey && config.whaleAlert.apiKey.length < 10) {
    console.warn('⚠️  WHALE_ALERT_API_KEY seems invalid (too short)');
  }
}