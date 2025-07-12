// src/types/index.ts - UPDATED WITH CORRECT HYPERLIQUID API STRUCTURE
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

// UPDATED HYPERLIQUID TYPES TO MATCH ACTUAL API RESPONSE
export interface LeaderboardEntry {
  ethAddress?: string;
  user?: string;
  address?: string;
  accountValue?: string;
  windowPerformances?: any[];
  pnl?: number;
  rank?: number;
  [key: string]: any;
}

export interface LeaderboardResponse {
  leaderboardRows?: LeaderboardEntry[];
  leaderboard?: LeaderboardEntry[];
  [key: string]: any;
}

// CORRECTED: This is the actual structure from Hyperliquid API
export interface HyperliquidPosition {
  coin: string;
  szi: string;              // Position size (can be negative for shorts)
  positionValue: string;    // USD value of position
  marginUsed: string;       // Margin used for this position
  unrealizedPnl: string;    // Unrealized PnL
  entryPx: string;          // Entry price
  markPx?: string;          // Mark price
  liquidationPx?: string;   // Liquidation price
  leverage?: {              // Leverage object (new format)
    value: number;
    type: string;
    rawUsd?: string;
  };
  cumFunding?: {
    allTime: string;
    sinceChange: string;
    sinceOpen: string;
  };
  returnOnEquity?: string;
  maxLeverage?: number;
}

// This is what the actual API returns
export interface HyperliquidApiResponse {
  assetPositions?: Array<{
    position: HyperliquidPosition;
    type: string;
  }>;
  marginSummary?: {
    accountValue: string;
    totalMarginUsed: string;
    totalNtlPos: string;
    totalRawUsd: string;
  };
  crossMarginSummary?: {
    accountValue: string;
    totalMarginUsed: string;
    totalNtlPos: string;
    totalRawUsd: string;
  };
  crossMaintenanceMarginUsed?: string;
  withdrawable?: string;
  time?: number;
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

export interface AssetDashTransaction {
  id: string;
  created: string;
  timestamp: string;
  transaction_type: 'buy' | 'sell';
  swap_token_id: string;
  swap_whalewatch_list: {
    id: string;
    identifier: string;
    name: string;
    logo_url: string;
    swap_token: {
      symbol: string;
      name: string;
      token_address: string;
      platform: string;
      logo_url: string;
      decimals: number;
      is_pumpfun: boolean;
      rugcheck_status: string;
      [key: string]: any;
    };
    [key: string]: any;
  };
  swap_token: {
    id: string;
    symbol: string;
    name: string;
    token_address: string;
    platform: string;
    logo_url: string;
    decimals: number;
    is_pumpfun: boolean;
    rugcheck_status: string;
    [key: string]: any;
  };
  trade_size: 'low' | 'medium' | 'high';
  trade_amount_rounded: number;
  token_market_cap: number;
  is_token_first_seen: boolean;
  win_rate: number;
  [key: string]: any;
}

export interface AssetDashResponse {
  transactions: AssetDashTransaction[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    has_more: boolean;
  };
  [key: string]: any; // Allow additional fields
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