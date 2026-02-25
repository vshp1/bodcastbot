module.exports = {
  PORT: Number(process.env.PORT || process.env.DASHBOARD_PORT || ''),
  HOST: process.env.HOST || '0.0.0.0',
  PUBLIC_URL: process.env.DASHBOARD_PUBLIC_URL || process.env.PUBLIC_URL || process.env.BASE_URL || '',
  MONGO_URI: process.env.MONGO_URI || '',
  BOT_STATUS_TEXT: process.env.BOT_STATUS_TEXT || 'oiforever',
  BOT_STATUS_TYPE: process.env.BOT_STATUS_TYPE || 'STREAMING',
  STREAMING_URL: process.env.STREAMING_URL || 'https://www.instagram.com/v.shp1/',
  BOT_TOKENS: process.env.BOT_TOKENS ? process.env.BOT_TOKENS.split(',').map(t => t.trim()).filter(Boolean) : [],
  MESSAGES_PER_BURST: parseInt(process.env.MESSAGES_PER_BURST || '10', 10),
  BURST_INTERVAL: parseInt(process.env.BURST_INTERVAL || '6000', 10),
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'change-me-now'
};
