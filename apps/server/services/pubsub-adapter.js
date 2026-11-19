const { PubSub } = require('@google-cloud/pubsub');
const Redis = require('ioredis');

class PubSubAdapter {
    constructor() {
        this.isCloud = process.env.USE_GCP === 'true';
        
        if (this.isCloud) {
            this.pubsubClient = new PubSub();
        } else {
            // Local dev: setup Redis Pub/Sub with Upstash Redis
            this.redisPublisher = new Redis(process.env.UPSTASH_REDIS_URL, {
                tls: process.env.UPSTASH_REDIS_URL?.includes('upstash') ? { rejectUnauthorized: false } : undefined
            });
            this.redisSubscriber = new Redis(process.env.UPSTASH_REDIS_URL, {
                tls: process.env.UPSTASH_REDIS_URL?.includes('upstash') ? { rejectUnauthorized: false } : undefined,
                enableReadyCheck: false
            });
            
            // Map of channel name to array of listener callbacks
            this.listeners = new Map();
            
            this.redisSubscriber.on('message', (channel, message) => {
                if (this.listeners.has(channel)) {
                    try {
                        const data = JSON.parse(message);
                        const callbacks = this.listeners.get(channel);
                        callbacks.forEach(cb => cb(data));
                    } catch (e) {
                        console.error(`[PubSub Adapter - Redis] Error parsing message on ${channel}:`, e);
                    }
                }
            });
        }
    }

    async publish(topicName, data) {
        if (this.isCloud) {
            return this._publishCloud(topicName, data);
        } else {
            return this._publishRedis(topicName, data);
        }
    }

    async subscribe(topicName, callback) {
        if (this.isCloud) {
            return this._subscribeCloud(topicName, callback);
        } else {
            return this._subscribeRedis(topicName, callback);
        }
    }

    async _publishRedis(topicName, data) {
        // console.log(`[PubSub Adapter - Redis] Publishing to ${topicName}...`);
        const messageString = JSON.stringify(data);
        await this.redisPublisher.publish(topicName, messageString);
        return true;
    }

    async _subscribeRedis(topicName, callback) {
        console.log(`[PubSub Adapter - Redis] Subscribing to ${topicName}...`);
        
        if (!this.listeners.has(topicName)) {
            this.listeners.set(topicName, []);
            await this.redisSubscriber.subscribe(topicName);
        }
        this.listeners.get(topicName).push(callback);
        
        // Return unsubscribe function
        return () => {
            const callbacks = this.listeners.get(topicName);
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
            if (callbacks.length === 0) {
                this.listeners.delete(topicName);
                this.redisSubscriber.unsubscribe(topicName);
            }
        };
    }

    async _publishCloud(topicName, data) {
        // console.log(`[PubSub Adapter - Cloud] Publishing to ${topicName}...`);
        const dataBuffer = Buffer.from(JSON.stringify(data));
        const messageId = await this.pubsubClient.topic(topicName).publishMessage({ data: dataBuffer });
        return messageId;
    }

    async _subscribeCloud(topicName, callback) {
        console.log(`[PubSub Adapter - Cloud] Subscribing to ${topicName}...`);
        // Cloud Run APIs don't typically use persistent subscriptions in process.
        // Instead, Pub/Sub pushes events via HTTP to a Cloud Run endpoint.
        // But for consistency with the local pattern (e.g. WebSocket Hub listening), 
        // we can set up a pull subscription if needed, or simply warn that it should be Push.
        
        // For our architecture, the API Server actually receives Push events from Pub/Sub via a webhook route.
        // So `subscribe` might not be heavily used in Prod Cloud Run, 
        // but if it is (for testing), here is a basic Pull subscription:
        
        const subscriptionName = `${topicName}-sub-${Math.random().toString(36).substring(7)}`;
        const subscription = this.pubsubClient.subscription(subscriptionName);
        
        const messageHandler = (message) => {
            try {
                const data = JSON.parse(message.data.toString());
                callback(data);
            } catch (e) {
                console.error(`[PubSub Adapter - Cloud] Error parsing message:`, e);
            }
            message.ack();
        };

        subscription.on('message', messageHandler);
        
        return () => {
            subscription.removeListener('message', messageHandler);
        };
    }
}

module.exports = new PubSubAdapter();
