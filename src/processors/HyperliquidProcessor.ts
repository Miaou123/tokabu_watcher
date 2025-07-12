// src/processors/HyperliquidProcessor.ts
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

export class HyperliquidProcessor {
private leaderboardAddresses = new Set<string>();
private previousPositions = new Map<string, HyperliquidPosition[]>();
private seenAlerts = new Set<string>();

private monitorInterval: NodeJS.Timeout | null = null;
private leaderboardUpdateInterval: NodeJS.Timeout | null = null;
private isRunning = false;
private alertCallback?: (alert: any) => void;

private readonly MIN_LEVERAGE = 30;
private readonly MIN_POSITION_VALUE = 100000;
private readonly HYPERLIQUID_API = 'https://api.hyperliquid.xyz/info';
private readonly LEADERBOARD_API = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';

// Simple rate-limited monitoring configuration  
private readonly TOP_TRADERS_COUNT = 1000; // Monitor top 1000
private readonly REQUESTS_PER_MINUTE = 600; // 600 × weight 2 = 1200 weight (exactly at limit)
private readonly CHECK_INTERVAL = 100; // 100ms between requests
private readonly LEADERBOARD_UPDATE_INTERVAL = 60 * 60 * 1000; // 1 hour

private addressQueue: string[] = [];
private currentIndex = 0;

constructor(onAlert?: (alert: any) => void) {
this.alertCallback = onAlert;
}

async startMonitoring(): Promise<void> {
if (this.isRunning) {
logger.warn('HyperliquidProcessor already running');
return;
}

logger.info('⚡ Starting Hyperliquid leaderboard monitoring...');
this.isRunning = true;

await this.updateLeaderboard();

// Simple rate-limited monitoring: 600 requests per minute (every 100ms)
this.monitorInterval = setInterval(() => {
this.checkNextAddress();
}, this.CHECK_INTERVAL);

// Update leaderboard every hour
this.leaderboardUpdateInterval = setInterval(() => {
this.updateLeaderboard();
}, this.LEADERBOARD_UPDATE_INTERVAL);

logger.success(`✅ Rate-limited monitoring: ${this.leaderboardAddresses.size} addresses at 600 req/min`);
logger.info(`🔄 Queue initialized with ${this.addressQueue.length} addresses`);

// Test immediately by checking one address
if (this.addressQueue.length > 0) {
logger.info('🧪 Testing with first address...');
await this.checkNextAddress();
}
}

private async updateLeaderboard(): Promise<void> {
try {
logger.debug('📊 Updating leaderboard addresses...');

const response = await axios.get(this.LEADERBOARD_API, {
timeout: 15000,
headers: {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json, text/plain, */*',
}
});

if (response.data) {
// DEBUG: Log the actual response structure
logger.debug('Raw leaderboard response:', JSON.stringify(response.data).slice(0, 500) + '...');
logger.debug('Response keys:', Object.keys(response.data));

let addresses: string[] = [];
const data = response.data as LeaderboardResponse | LeaderboardEntry[] | any;

if (Array.isArray(data)) {
  logger.debug('Leaderboard data is an array with length:', data.length);
  if (data.length > 0) {
    logger.debug('First entry:', JSON.stringify(data[0]));
  }
  addresses = data
    .filter((entry: any) => entry.user || entry.address)
    .map((entry: any) => entry.user || entry.address)
    .filter((addr: any): addr is string => !!addr)
    .slice(0, 100);
} else if (data && data.leaderboard) {
  logger.debug('Leaderboard data has leaderboard property');
  addresses = data.leaderboard
    .filter((entry: any) => entry.user || entry.address)
    .map((entry: any) => entry.user || entry.address)
    .filter((addr: any): addr is string => !!addr)
    .slice(0, 100);
} else if (data && typeof data === 'object') {
  // Try to find addresses in any property
  logger.debug('Searching for addresses in object properties...');
  for (const [key, value] of Object.entries(data)) {
    logger.debug(`Property "${key}":`, Array.isArray(value) ? `Array[${value.length}]` : typeof value);
    if (Array.isArray(value) && value.length > 0) {
      logger.debug(`First item in ${key}:`, JSON.stringify(value[0]));
      // Check if this array contains address-like objects
      const testAddresses = value
        .filter((entry: any) => entry && (entry.user || entry.address || entry.wallet || entry.ethAddress))
        .map((entry: any) => entry.user || entry.address || entry.wallet || entry.ethAddress)
        .filter((addr: any): addr is string => !!addr);
      
      if (testAddresses.length > 0) {
        logger.debug(`Found ${testAddresses.length} addresses in property "${key}"`);
        addresses = testAddresses.slice(0, this.TOP_TRADERS_COUNT); // Top 1000
        break;
      }
    }
  }
}

let newAddresses = 0;
addresses.forEach(address => {
  if (!this.leaderboardAddresses.has(address)) {
    this.leaderboardAddresses.add(address);
    newAddresses++;
  }
});

logger.success(`📊 Leaderboard updated: ${addresses.length} total, ${newAddresses} new addresses`);

if (this.leaderboardAddresses.size < 5) {
  logger.warn('⚠️ Very few addresses from leaderboard, may need to check endpoint format');
}

} else {
logger.warn('⚠️ Empty leaderboard response');
return;
}

} catch (error: any) {
logger.error(`❌ Could not fetch leaderboard: ${error.message}`);
return;
}
}

/**
* 🎯 SIMPLE RATE-LIMITED MONITORING - Check one address every 100ms
*/
private async checkNextAddress(): Promise<void> {
if (this.addressQueue.length === 0) {
logger.debug('📭 No addresses in queue to check');
return;
}

// Get next address
const address = this.addressQueue[this.currentIndex];

logger.debug(`🔍 Checking address ${this.currentIndex + 1}/${this.addressQueue.length}: ${address.slice(0,8)}...`);

// Check this address
await this.checkAddressPositions(address);

// Move to next address (cycle back to 0 when we reach the end)
this.currentIndex = (this.currentIndex + 1) % this.addressQueue.length;

// Log progress every 50 addresses
if (this.currentIndex % 50 === 0) {
logger.info(`📍 Progress: ${this.currentIndex}/${this.addressQueue.length} addresses checked (${((this.currentIndex / this.addressQueue.length) * 100).toFixed(1)}%)`);
}

// Log when we complete a full cycle
if (this.currentIndex === 0 && this.addressQueue.length > 0) {
logger.success(`🔄 Completed full cycle of ${this.addressQueue.length} addresses`);
}
}

private async checkAddressPositions(address: string): Promise<void> {
try {
const response = await axios.post(this.HYPERLIQUID_API, {
type: 'clearinghouseState',
user: address
}, {
timeout: 5000,
headers: {
  'Content-Type': 'application/json'
}
});

const data = response.data as HyperliquidApiResponse | any;

if (data && data.assetPositions) {
const currentPositions: HyperliquidPosition[] = data.assetPositions;
const previousPositions = this.previousPositions.get(address) || [];

// LOG ALL POSITIONS for debugging
if (currentPositions.length > 0) {
  logger.debug(`👤 ${address.slice(0,8)}... has ${currentPositions.length} positions:`);
  currentPositions.forEach(pos => {
    const leverage = this.calculateLeverage(pos);
    const positionValue = Math.abs(parseFloat(pos.positionValue));
    const positionSize = parseFloat(pos.szi);
    const isLong = positionSize > 0;
    const side = isLong ? 'LONG' : 'SHORT';
    
    logger.debug(`   📊 ${pos.coin}: ${leverage.toFixed(1)}x ${side} ${(positionValue/1000).toFixed(1)}k (size: ${Math.abs(positionSize).toFixed(4)})`);
  });
}

for (const position of currentPositions) {
  const isQualifying = this.isQualifyingPosition(position);
  const leverage = this.calculateLeverage(position);
  const positionValue = Math.abs(parseFloat(position.positionValue));
  const positionSize = parseFloat(position.szi);
  const isLong = positionSize > 0;
  
  // LOG ALL QUALIFYING CHECKS
  if (isLong && positionValue >= this.MIN_POSITION_VALUE) {
    if (leverage >= this.MIN_LEVERAGE) {
      logger.info(`✅ QUALIFYING: ${position.coin} ${leverage.toFixed(1)}x LONG ${(positionValue/1000).toFixed(1)}k by ${address.slice(0,8)}...`);
    } else {
      logger.debug(`❌ Low leverage: ${position.coin} ${leverage.toFixed(1)}x LONG ${(positionValue/1000).toFixed(1)}k by ${address.slice(0,8)}... (need ${this.MIN_LEVERAGE}x+)`);
    }
  }
  
  if (isQualifying) {
    const isNewPosition = this.isNewPosition(address, position, previousPositions);
    
    if (isNewPosition) {
      logger.success(`🆕 NEW QUALIFYING POSITION detected!`);
      await this.emitPositionAlert(address, position);
    } else {
      logger.debug(`🔄 Existing qualifying position: ${position.coin} ${leverage.toFixed(1)}x by ${address.slice(0,8)}...`);
    }
  }
}

this.previousPositions.set(address, currentPositions);
} else {
// Log when addresses have no positions
logger.debug(`💤 ${address.slice(0,8)}... has no positions`);
}

} catch (error: any) {
if (error.response?.status !== 404) {
logger.debug(`❌ Error checking ${address.slice(0,8)}...: ${error.message}`);
}
}
}

private isQualifyingPosition(position: HyperliquidPosition): boolean {
const positionSize = parseFloat(position.szi);
const positionValue = Math.abs(parseFloat(position.positionValue));
const marginUsed = parseFloat(position.marginUsed);

const isLong = positionSize > 0;
const meetsValue = positionValue >= this.MIN_POSITION_VALUE;
const leverage = marginUsed > 0 ? positionValue / marginUsed : 0;
const meetsLeverage = leverage >= this.MIN_LEVERAGE;

return isLong && meetsValue && meetsLeverage;
}

private isNewPosition(address: string, currentPosition: HyperliquidPosition, previousPositions: HyperliquidPosition[]): boolean {
const previousPosition = previousPositions.find(p => p.coin === currentPosition.coin);

if (!previousPosition) {
return true;
}

const currentSize = Math.abs(parseFloat(currentPosition.szi));
const previousSize = Math.abs(parseFloat(previousPosition.szi));
const sizeIncrease = currentSize > (previousSize * 1.5);

const currentLeverage = this.calculateLeverage(currentPosition);
const previousLeverage = this.calculateLeverage(previousPosition);
const leverageIncrease = currentLeverage > (previousLeverage * 1.2);

return sizeIncrease || leverageIncrease;
}

private calculateLeverage(position: HyperliquidPosition): number {
const positionValue = Math.abs(parseFloat(position.positionValue));
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

if (this.seenAlerts.size > 1000) {
const alertsArray = Array.from(this.seenAlerts);
this.seenAlerts = new Set(alertsArray.slice(-500));
}
}

getStatus(): HyperliquidProcessorStatus {
return {
running: this.isRunning,
monitoredAddresses: this.leaderboardAddresses.size,
strategy: `Rate-limited: 1 address every ${this.CHECK_INTERVAL}ms (600/min)`,
criteria: {
minLeverage: this.MIN_LEVERAGE,
minValue: MessageFormatter.formatUSD(this.MIN_POSITION_VALUE),
side: 'long'
},
recentAddresses: Array.from(this.leaderboardAddresses).slice(0, 5).map(addr => addr.slice(0,10) + '...'),
cycleInfo: {
currentPosition: this.currentIndex + 1,
totalAddresses: this.addressQueue.length,
fullCycleTime: `${Math.ceil(this.addressQueue.length * this.CHECK_INTERVAL / 1000 / 60)} minutes`,
requestsPerMinute: Math.floor(60000 / this.CHECK_INTERVAL)
}
};
}

stop(): void {
if (this.monitorInterval) {
clearInterval(this.monitorInterval);
this.monitorInterval = null;
}

if (this.leaderboardUpdateInterval) {
clearInterval(this.leaderboardUpdateInterval);
this.leaderboardUpdateInterval = null;
}

this.isRunning = false;
logger.info('Hyperliquid processor stopped');
}

async test(): Promise<boolean> {
try {
logger.info('🧪 Testing Hyperliquid monitoring setup...');

const apiResponse = await axios.post(this.HYPERLIQUID_API, {
type: 'meta'
}, { timeout: 5000 });

const apiSuccess = apiResponse.status === 200;
logger.info(`📡 Hyperliquid API: ${apiSuccess ? '✅' : '❌'}`);

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

if (!leaderboardSuccess) {
logger.error('❌ Leaderboard API is required but not accessible');
return false;
}

let positionCheckSuccess = false;
try {
const testAddress = '0x677d831aef5328190852e24f13c46cac05f984e7';
const positionResponse = await axios.post(this.HYPERLIQUID_API, {
  type: 'clearinghouseState',
  user: testAddress
}, { timeout: 5000 });

positionCheckSuccess = positionResponse.status === 200;
logger.info(`👤 Position check: ${positionCheckSuccess ? '✅' : '❌'}`);

if (positionCheckSuccess) {
  const data = positionResponse.data as HyperliquidApiResponse | any;
  if (data && data.assetPositions) {
    const positions = data.assetPositions;
    logger.info(`   Found ${positions.length} positions for test address`);
  } else {
    logger.info(`   Test address has no active positions`);
  }
}
} catch (error: any) {
logger.info(`👤 Position check: ❌ (${error.message})`);
}

const overallSuccess = apiSuccess && leaderboardSuccess;

if (overallSuccess) {
logger.success('✅ Hyperliquid monitoring ready!');
logger.info(`📊 Will monitor ${this.leaderboardAddresses.size} addresses from leaderboard`);
logger.info(`🎯 Criteria: ${this.MIN_LEVERAGE}x+ leverage, $${this.MIN_POSITION_VALUE/1000}k+ value, longs only`);
} else {
logger.error('❌ Setup issues detected - cannot start monitoring');
}

return overallSuccess;

} catch (error: any) {
logger.error('❌ Test failed:', error.message);
return false;
}
}
}