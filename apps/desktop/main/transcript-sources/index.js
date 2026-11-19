const TranscriptSourceCoordinator = require('./coordinator');
const { SOURCES, PLATFORMS } = require('./constants');
const { ladderFor, detectPlatform } = require('./ladders');
const HealthMonitor = require('./health-monitor');

module.exports = TranscriptSourceCoordinator;
module.exports.TranscriptSourceCoordinator = TranscriptSourceCoordinator;
module.exports.SOURCES = SOURCES;
module.exports.PLATFORMS = PLATFORMS;
module.exports.ladderFor = ladderFor;
module.exports.detectPlatform = detectPlatform;
module.exports.HealthMonitor = HealthMonitor;
