const config = require('./config');

App({
  onLaunch() {
    if (!wx.cloud) {
      throw new Error('当前基础库不支持云开发。');
    }

    wx.cloud.init({
      env: config.envId,
      traceUser: true
    });
  }
});
