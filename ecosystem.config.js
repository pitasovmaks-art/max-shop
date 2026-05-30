module.exports = {
  apps: [{
    name: 'max-shop',
    script: 'server/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    kill_timeout: 5000,
    listen_timeout: 10000,
    wait_ready: false,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
