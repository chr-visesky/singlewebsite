'use strict';

const crypto = require('crypto');
const os = require('os');

const token = crypto.randomBytes(24).toString('hex');

process.stdout.write(`READ_TOKEN:${os.EOL}${token}${os.EOL}${os.EOL}`);
process.stdout.write(`可直接填进桌面程序 config.json:${os.EOL}`);
process.stdout.write(
  `${JSON.stringify(
    {
      remoteSchedule: {
        url: 'https://your-http-service-domain/api/schedule',
        authToken: token,
        refreshMinutes: 3
      }
    },
    null,
    2
  )}${os.EOL}`
);
