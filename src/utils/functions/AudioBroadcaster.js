const axios = require('axios');
const { PassThrough } = require('stream');
const { createAudioResource } = require('@discordjs/voice');

// Advanced Broadcast System
class AudioBroadcaster {
  constructor() {
    /** @type {Map<string, PassThrough>} */
    this.broadcasts = new Map();
    /** @type {Map<string, number>} */
    this.connectionCounts = new Map();
  }

  async getBroadcastForURL(url) {
    // If the broadcast exists and is not destroyed, return the main PassThrough
    if (this.broadcasts.has(url)) {
      const broadcast = this.broadcasts.get(url);
      if (!broadcast.destroyed) {
        this.connectionCounts.set(url, (this.connectionCounts.get(url) || 0) + 1);
        return broadcast;
      }
    }

    // Create a new broadcast
    try {
      console.log(`Creating new broadcast for URL: ${url}`);
      const response = await axios.get(url, { responseType: 'stream' });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const originalStream = response.data;
      const broadcastStream = new PassThrough();

      // Connect the original stream to the broadcast
      originalStream.pipe(broadcastStream);
      this.broadcasts.set(url, broadcastStream);
      this.connectionCounts.set(url, 1);

      // Setup error handling and cleanup
      this.setupStreamHandlers(url, originalStream, broadcastStream);

      return broadcastStream;
    } catch (error) {
      console.error(`Error creating broadcast for ${url}:`, error);
      throw error;
    }
  }

  setupStreamHandlers(url, originalStream, broadcastStream) {
    originalStream.on('end', () => {
      console.log(`Original stream ended for: ${url}`);
      this.cleanupBroadcast(url);
    });

    originalStream.on('error', (error) => {
      console.error(`Original stream error for ${url}:`, error);
      this.cleanupBroadcast(url);
    });

    broadcastStream.on('error', (error) => {
      console.error(`Broadcast stream error for ${url}:`, error);
    });

    // Auto-cleanup if there are no listeners
    const checkCleanup = () => {
      setTimeout(() => {
        const count = this.connectionCounts.get(url) || 0;
        if (count === 0 && this.broadcasts.has(url)) {
          console.log(`Auto-cleaning unused broadcast: ${url}`);
          this.cleanupBroadcast(url);
        }
      }, 30000); // 30 seconds
    };

    checkCleanup();
  }

  createAudioResourceForGuild(url) {
    try {
      const broadcast = this.broadcasts.get(url);
      if (!broadcast || broadcast.destroyed) {
        return null;
      }

      // Create a new PassThrough for each guild
      const guildStream = new PassThrough();

      // Connect the main broadcast to the new guild
      broadcast.pipe(guildStream, { end: false });

      const resource = createAudioResource(guildStream);

      // Increment the connection counter
      this.connectionCounts.set(url, (this.connectionCounts.get(url) || 0) + 1);

      return resource;
    } catch (error) {
      console.error(`Error creating audio resource for guild:`, error);
      return null;
    }
  }

  releaseGuildConnection(url) {
    const currentCount = this.connectionCounts.get(url) || 0;
    if (currentCount > 0) {
      this.connectionCounts.set(url, currentCount - 1);
    }

    console.log(`Released connection for ${url}. Current connections: ${this.connectionCounts.get(url)}`);
  }

  cleanupBroadcast(url) {
    console.log(`Cleaning up broadcast for: ${url}`);
    const broadcast = this.broadcasts.get(url);
    if (broadcast && !broadcast.destroyed) {
      broadcast.destroy();
    }
    this.broadcasts.delete(url);
    this.connectionCounts.delete(url);
  }

  getStats() {
    return {
      activeBroadcasts: this.broadcasts.size,
      connectionCounts: Array.from(this.connectionCounts.entries()).map(([url, count]) => ({ url, count }))
    };
  }
}


module.exports = AudioBroadcaster;