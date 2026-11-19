const mongoose = require('mongoose');

async function connectDB() {
    if (mongoose.connection.readyState >= 1) return;

    try {
        const uri = process.env.MONGODB_URI;
        if (!uri) {
            console.warn('[MongoDB] WARNING: MONGODB_URI is not defined. Skipping connection.');
            return;
        }

        console.log('[MongoDB] Connecting to Atlas...');
        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 5000
        });
        console.log('[MongoDB] Connected successfully.');
    } catch (error) {
        console.error('[MongoDB] Connection error:', error.message);
    }
}

module.exports = connectDB;
