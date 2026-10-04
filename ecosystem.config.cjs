// pm2 process for the partner app. Memory is capped: this shares the VPS with other sites.
module.exports = {
  apps: [{
    name: "shubhora-partner",
    cwd: "/opt/shubhora-partner/app",
    script: "node_modules/next/dist/bin/next",
    args: "start -p 3002 -H 127.0.0.1",
    env: { NODE_ENV: "production", NODE_OPTIONS: "--max-old-space-size=320" },
    max_memory_restart: "450M",
    time: true,
  }],
};
