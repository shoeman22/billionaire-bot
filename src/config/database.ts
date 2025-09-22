/**
 * Database Configuration
 * TypeORM configuration for position tracking and bot persistence
 */

import { DataSource, DataSourceOptions } from 'typeorm';
import { Position } from '../entities/Position';
import { logger } from '../utils/logger';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module dirname replacement
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Database configuration based on environment
export const getDatabaseConfig = (): DataSourceOptions => {
  const isProduction = process.env.NODE_ENV === 'production';
  const isDevelopment = process.env.NODE_ENV === 'development';

  // For development and testing, use SQLite for simplicity
  if (isDevelopment || !process.env.DATABASE_URL) {
    return {
      type: 'sqlite',
      database: path.join(__dirname, '../../data/billionaire-bot.db'),
      entities: [Position],
      synchronize: true, // Auto-create tables in development
      logging: process.env.LOG_LEVEL === 'debug',
      migrations: [path.join(__dirname, '../migrations/*.ts')],
      migrationsRun: true,
    };
  }

  // Production database configuration
  if (process.env.DATABASE_URL) {
    return {
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [Position],
      synchronize: false, // Never auto-sync in production
      logging: false,
      migrations: [path.join(__dirname, '../migrations/*.ts')],
      migrationsRun: true,
      ssl: isProduction ? { rejectUnauthorized: false } : false,
    };
  }

  // Fallback to environment variables
  return {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'billionaire_bot',
    entities: [Position],
    synchronize: false,
    logging: process.env.LOG_LEVEL === 'debug',
    migrations: [path.join(__dirname, '../migrations/*.ts')],
    migrationsRun: true,
    ssl: isProduction ? { rejectUnauthorized: false } : false,
  };
};

// Create and initialize the data source
let dataSource: DataSource | null = null;

export const getDataSource = async (): Promise<DataSource> => {
  if (!dataSource) {
    const config = getDatabaseConfig();
    dataSource = new DataSource(config);

    try {
      await dataSource.initialize();
      logger.info(`✅ Database connected successfully (${config.type})`);

      // Ensure data directory exists for SQLite
      if (config.type === 'sqlite') {
        const fs = await import('fs');
        const dataDir = path.dirname(config.database as string);
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }
      }

    } catch (error) {
      logger.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  return dataSource;
};

// Close database connection
export const closeDatabase = async (): Promise<void> => {
  if (dataSource && dataSource.isInitialized) {
    await dataSource.destroy();
    dataSource = null;
    logger.info('Database connection closed');
  }
};

// Repository helpers
export const getPositionRepository = async () => {
  const ds = await getDataSource();
  return ds.getRepository(Position);
};

// Database health check
export const checkDatabaseHealth = async (): Promise<boolean> => {
  try {
    const ds = await getDataSource();
    await ds.query('SELECT 1');
    return true;
  } catch (error) {
    logger.error('Database health check failed:', error);
    return false;
  }
};

// Initialize database on import (for convenience)
export const initializeDatabase = async (): Promise<void> => {
  try {
    await getDataSource();
    logger.info('Database initialization complete');
  } catch (error) {
    logger.error('Database initialization failed:', error);
    throw error;
  }
};

// Export configuration for testing
export { DataSource } from 'typeorm';