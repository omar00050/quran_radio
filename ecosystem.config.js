module.exports = {
  apps: [
    // Audio server for remote mode: streams OGG/Opus to shards over HTTP
    {
      name: "quran-audio",
      script: "audio-server.js",
      // pm2 sets no cwd by default, which leaves dotenv resolving .env against
      // whatever directory pm2 was invoked from. Pin it so both apps load the
      // SAME .env and AUDIO_SERVER_TOKEN / AUDIO_BITRATE agree.
      cwd: __dirname,
      exec_mode: "fork",
      instances: 1,
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 10000,    // wait 10s for ffmpeg children to shutdown
      max_memory_restart: "1G",
      out_file: "./logs/audio-out.log",
      error_file: "./logs/audio-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      env: {
        NODE_ENV: "production",
      },
    },
    // Discord bot sharding manager and shard processes
    {
      name: "quran",
      script: "shard.js",
      cwd: __dirname,
      exec_mode: "fork",
      instances: 1,
      watch: false,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 5000,     // wait 5s for graceful shutdown before force-kill
      max_memory_restart: "2G",
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
