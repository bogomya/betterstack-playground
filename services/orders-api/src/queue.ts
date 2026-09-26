import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { config } from './config.js';

export const QUEUE_NAME = 'orders';

const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

export const ordersQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});
