const { Queue } = require('bullmq');
const { CloudTasksClient } = require('@google-cloud/tasks');

class QueueAdapter {
    constructor() {
        this.isCloud = process.env.USE_GCP === 'true';
        this.bullQueues = {};
        
        if (this.isCloud) {
            this.tasksClient = new CloudTasksClient();
            this.projectId = process.env.GCP_PROJECT_ID;
            this.location = process.env.GCP_REGION || 'asia-south1';
        } else {
            // Local dev: setup BullMQ with Upstash Redis
            const Redis = require('ioredis');
            this.redisConnection = new Redis(process.env.UPSTASH_REDIS_URL, {
                maxRetriesPerRequest: null,
                tls: process.env.UPSTASH_REDIS_URL?.includes('upstash') ? { rejectUnauthorized: false } : undefined
            });
        }
    }

    _getBullQueue(queueName) {
        if (!this.bullQueues[queueName]) {
            this.bullQueues[queueName] = new Queue(queueName, { connection: this.redisConnection });
        }
        return this.bullQueues[queueName];
    }

    async enqueue(queueName, payload, options = {}) {
        if (this.isCloud) {
            return this._dispatchCloudTask(queueName, payload, options);
        } else {
            return this._dispatchBullMQ(queueName, payload, options);
        }
    }

    async _dispatchBullMQ(queueName, payload, options) {
        const queue = this._getBullQueue(queueName);
        console.log(`[Queue Adapter - BullMQ] Enqueueing to ${queueName}...`);
        
        const jobOptions = {
            attempts: options.retries || 3,
            backoff: {
                type: 'exponential',
                delay: options.backoffDelay || 5000
            }
        };

        if (options.delay) {
            jobOptions.delay = options.delay;
        }

        const job = await queue.add(queueName, payload, jobOptions);
        return { jobId: job.id, method: 'bullmq' };
    }

    async _dispatchCloudTask(queueName, payload, options) {
        console.log(`[Queue Adapter - Cloud Tasks] Enqueueing to ${queueName}...`);
        
        let gcpQueuePath;
        if (queueName === 'llm-process') gcpQueuePath = process.env.CLOUD_TASKS_QUEUE_LLM;
        else if (queueName === 'report-generate') gcpQueuePath = process.env.CLOUD_TASKS_QUEUE_REPORT;
        else if (queueName === 'bot-lifecycle') gcpQueuePath = process.env.CLOUD_TASKS_QUEUE_LIFECYCLE;
        else if (queueName === 'bot-dispatch') gcpQueuePath = process.env.CLOUD_TASKS_QUEUE_DISPATCH || this.tasksClient.queuePath(this.projectId, this.location, queueName);
        else if (queueName === 'bot-run-now') gcpQueuePath = process.env.CLOUD_TASKS_QUEUE_RUN_NOW || this.tasksClient.queuePath(this.projectId, this.location, queueName);
        
        if (!gcpQueuePath) {
            // Fallback default format if explicit env var missing
            gcpQueuePath = this.tasksClient.queuePath(this.projectId, this.location, queueName);
        }

        const task = {
            httpRequest: {
                httpMethod: 'POST',
                url: `${process.env.API_BASE_URL || 'http://localhost:8080'}/workers/${queueName}`,
                body: Buffer.from(JSON.stringify(payload)).toString('base64'),
                headers: {
                    'Content-Type': 'application/json',
                    // Secret token to verify request came from Cloud Tasks
                    'X-Worker-Token': process.env.WORKER_SECRET_TOKEN || '' 
                },
            },
        };

        if (options.delay) {
            task.scheduleTime = {
                seconds: Math.floor((Date.now() + options.delay) / 1000)
            };
        }

        const request = { parent: gcpQueuePath, task };
        const [response] = await this.tasksClient.createTask(request);
        
        return { jobId: response.name, method: 'cloud-tasks' };
    }
}

module.exports = new QueueAdapter();
