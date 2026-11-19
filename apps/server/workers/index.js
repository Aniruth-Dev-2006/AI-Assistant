const { Worker } = require('bullmq');
const express = require('express');

const llmWorker = require('./llm-worker');
const reportWorker = require('./report-worker');
const botDispatcher = require('./bot-dispatcher');

const router = express.Router();
const isCloud = process.env.USE_GCP === 'true';

// Common job processor wrapper
const processJob = async (queueName, jobData) => {
    switch(queueName) {
        case 'llm-process':
            await llmWorker.processJob(jobData);
            break;
        case 'report-generate':
            await reportWorker.processJob(jobData);
            break;
        case 'bot-lifecycle':
            const botRunner = require('./bot-runner');
            await botRunner.processJob(jobData);
            break;
        case 'bot-dispatch':
            await botDispatcher.processJob(jobData);
            break;
        case 'bot-run-now':
            console.log('[Worker] Running bot directly via HTTP bot-run-now...');
            const fetch = require('node-fetch'); // assuming it's available, if not native fetch is available in node 20
            const response = await fetch(`${process.env.API_BASE_URL || 'http://localhost:8080'}/bot/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...jobData, blocking: true })
            });
            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Failed to run bot via API: ${response.status} - ${text}`);
            }
            break;
        default:
            console.error(`[Worker] Unknown queue name: ${queueName}`);
    }
};

// 1. Cloud Tasks Setup (Express Routes)
if (isCloud) {
    // Cloud Tasks sends HTTP POST requests to these endpoints
    router.post('/:queueName', async (req, res) => {
        const queueName = req.params.queueName;
        
        // Security check
        const workerToken = req.headers['x-worker-token'];
        if (workerToken !== process.env.WORKER_SECRET_TOKEN) {
            return res.status(403).send('Unauthorized worker token');
        }

        try {
            await processJob(queueName, req.body);
            res.status(200).send('Job processed');
        } catch (e) {
            // Returning 500 tells Cloud Tasks to retry
            res.status(500).send(e.message);
        }
    });
} 
// 2. Local Dev Setup (BullMQ Workers)
else {
    const Redis = require('ioredis');
    const redisConnection = new Redis(process.env.UPSTASH_REDIS_URL, {
        maxRetriesPerRequest: null,
        tls: process.env.UPSTASH_REDIS_URL?.includes('upstash') ? { rejectUnauthorized: false } : undefined
    });

    if (process.env.UPSTASH_REDIS_URL) {
        console.log('[Workers] Starting local BullMQ workers...');
        
        ['llm-process', 'report-generate', 'bot-lifecycle', 'bot-dispatch', 'bot-run-now'].forEach(queueName => {
            const workerConnection = new Redis(process.env.UPSTASH_REDIS_URL, {
                maxRetriesPerRequest: null,
                tls: process.env.UPSTASH_REDIS_URL?.includes('upstash') ? { rejectUnauthorized: false } : undefined
            });
            const worker = new Worker(queueName, async (job) => {
                await processJob(queueName, job.data);
            }, { connection: workerConnection });
            
            worker.on('failed', (job, err) => {
                console.error(`[Worker] Job ${job?.id} in ${queueName} failed:`, err);
            });
            worker.on('error', err => {
                console.error(`[Worker] Queue ${queueName} error:`, err);
            });
        });
    } else {
        console.warn('[Workers] UPSTASH_REDIS_URL not set. Local workers not started.');
    }
}

module.exports = router;
