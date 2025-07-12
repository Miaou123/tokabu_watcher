// src/types/index.ts
export interface WhaleAlert {
  id: string;
  type: 'whale_alert' | 'swap' | 'hyperliquid_trade' | 'transfer' | 'mint' | 'burn';
  timestamp: number;
  blockchain?: string;
  symbol: string;
  amount: string;
  value_usd: number;
  from: string;
  to: string;
  hash?: string;
  platform?: string;
  leverage?: number;
  side?: 'long' | 'short';
}

export interface WhaleAlertWebSocketMessage {
  type?: string;
  channel_id?: string;
  timestamp: number;
  blockchain: string;
  transaction_type: string;
  from: string;
  to: string;
  amounts: Array<{
    symbol: string;
    amount: number;
    value_usd: number;
  }>;
  text: string;
  transaction: {
    hash: string;
    height: number;
    index_in_block: number;
    timestamp: number;
    fee?: string;
    fee_symbol?: string;
    fee_symbol_price?: number;
    sub_transactions: Array<{
      symbol: string;
      unit_price_usd: number;
      transaction_type: string;
      inputs: Array<{
        amount: string;
        address: string;
        balance?: string;
        owner?: string;
        owner_type?: string;
        address_type?: string;
      }>;
      outputs: Array<{
        amount: string;
        address: string;
        balance?: string;
        owner?: string;
        owner_type?: string;
        address_type?: string;
      }>;
    }>;
  };
}

export interface TwitterConfig {
  rateLimitMinutes: number;
  maxTweetLength: number;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export interface BotConfig {
  whaleAlert: {
    apiKey: string;
    minValue: number;
    reconnectDelay: number;
    wsUrl: string;
  };
  twitter: TwitterConfig;
}

export interface ProcessedAlert {
  id: string;
  type: string;
  message: string;
  data: any;
  priority: number;
  createdAt: Date;
}

export interface SwapTransaction {
  hash: string;
  timestamp: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  value_usd: number;
  platform: string;
  wallet: string;
}

export interface HyperliquidTrade {
  user: string;
  symbol: string;
  side: 'long' | 'short';
  size: number;
  leverage: number;
  price: number;
  value_usd: number;
  timestamp: number;
}

// NEW HYPERLIQUID TYPES
export interface LeaderboardEntry {
  user?: string;
  address?: string;
  pnl?: number;
  accountValue?: number;
  rank?: number;
  [key: string]: any;
}

export interface LeaderboardResponse {
  leaderboard?: LeaderboardEntry[];
  [key: string]: any;
}

export interface HyperliquidPosition {
  coin: string;
  szi: string;
  positionValue: string;
  marginUsed: string;
  unrealizedPnl: string;
  entryPx: string;
  markPx: string;
  liquidationPx: string;
}

export interface HyperliquidApiResponse {
  assetPositions?: HyperliquidPosition[];
  marginSummary?: {
    accountValue: string;
    totalMarginUsed: string;
  };
  [key: string]: any;
}

export interface HyperliquidProcessorStatus {
  running: boolean;
  monitoredAddresses: number;
  strategy: string;
  criteria: {
    minLeverage: number;
    minValue: string;
    side: string;
  };
  recentAddresses: string[];
  cycleInfo?: {
    currentPosition: number;
    totalAddresses: number;
    fullCycleTime: string;
    requestsPerMinute: number;
  };
}

// Axios response types
export interface AxiosResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: any;
  config: any;
  request?: any;
}