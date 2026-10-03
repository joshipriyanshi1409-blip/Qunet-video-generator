import type { Redis } from 'ioredis';
import { pingRedis } from '../lib/redis.js';
import { getFirebaseApp } from '../lib/firebase-admin.js';
import type { AppConfig } from '../config/index.js';
import type { HealthCheckStatus, HealthResponse, ReadinessResponse } from '@creatordna/shared';

export interface HealthService {
  check(): Promise<HealthResponse>;
  ready(): Promise<ReadinessResponse>;
}

export interface HealthServiceDeps {
  config: AppConfig;
  redis?: Redis | null;
}

export function createHealthService(deps: HealthServiceDeps): HealthService {
  const { config, redis = null } = deps;

  async function redisStatus(): Promise<HealthCheckStatus> {
    if (!config.env.REDIS_ENABLED) return 'disabled';
    if (redis === null) return 'not_configured';
    return (await pingRedis(redis)) ? 'ok' : 'error';
  }

  function firebaseStatus(): HealthCheckStatus {
    return getFirebaseApp() === null ? 'not_configured' : 'ok';
  }

  return {
    async check(): Promise<HealthResponse> {
      return {
        status: 'ok',
        service: config.serviceName,
        version: config.version,
        environment: config.env.NODE_ENV,
        uptimeSeconds: Math.round(process.uptime() * 100) / 100,
        timestamp: new Date().toISOString(),
        checks: {
          redis: await redisStatus(),
          firebase: firebaseStatus(),
        },
      };
    },

    async ready(): Promise<ReadinessResponse> {
      const checks = {
        redis: await redisStatus(),
        firebase: firebaseStatus(),
      };
      return {
        status: checks.redis === 'error' ? 'degraded' : 'ok',
        checks,
      };
    },
  };
}
