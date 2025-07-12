// src/utils/logger.ts
export enum LogLevel {
    ERROR = 0,
    WARN = 1,
    INFO = 2,
    DEBUG = 3
  }
  
  class Logger {
    private level: LogLevel;
  
    constructor() {
      const envLevel = process.env.LOG_LEVEL?.toLowerCase() || 'info';
      this.level = this.getLogLevel(envLevel);
    }
  
    private getLogLevel(level: string): LogLevel {
      switch (level) {
        case 'error': return LogLevel.ERROR;
        case 'warn': return LogLevel.WARN;
        case 'info': return LogLevel.INFO;
        case 'debug': return LogLevel.DEBUG;
        default: return LogLevel.INFO;
      }
    }
  
    private log(level: LogLevel, message: string, ...args: any[]): void {
      if (level <= this.level) {
        const timestamp = new Date().toISOString();
        const levelName = LogLevel[level];
        const emoji = this.getLevelEmoji(level);
        console.log(`${emoji} [${timestamp}] [${levelName}] ${message}`, ...args);
      }
    }
  
    private getLevelEmoji(level: LogLevel): string {
      switch (level) {
        case LogLevel.ERROR: return '❌';
        case LogLevel.WARN: return '⚠️';
        case LogLevel.INFO: return 'ℹ️';
        case LogLevel.DEBUG: return '🐛';
        default: return 'ℹ️';
      }
    }
  
    error(message: string, ...args: any[]): void {
      this.log(LogLevel.ERROR, message, ...args);
    }
  
    warn(message: string, ...args: any[]): void {
      this.log(LogLevel.WARN, message, ...args);
    }
  
    info(message: string, ...args: any[]): void {
      this.log(LogLevel.INFO, message, ...args);
    }
  
    debug(message: string, ...args: any[]): void {
      this.log(LogLevel.DEBUG, message, ...args);
    }
  
    success(message: string, ...args: any[]): void {
      const timestamp = new Date().toISOString();
      console.log(`✅ [${timestamp}] [SUCCESS] ${message}`, ...args);
    }
  }
  
  export const logger = new Logger();