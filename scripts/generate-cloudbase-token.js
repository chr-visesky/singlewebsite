'use strict';

const crypto = require('crypto');
const os = require('os');

const readToken = crypto.randomBytes(24).toString('hex');
const studentWriteToken = crypto.randomBytes(24).toString('hex');

process.stdout.write(`READ_TOKEN:${os.EOL}${readToken}${os.EOL}${os.EOL}`);
process.stdout.write(`STUDENT_WRITE_TOKEN:${os.EOL}${studentWriteToken}${os.EOL}${os.EOL}`);
process.stdout.write(`可直接填进桌面程序 config.json:${os.EOL}`);
process.stdout.write(
  `${JSON.stringify(
    {
      remoteSchedule: {
        url: 'https://your-http-service-domain/api/schedule',
        authToken: readToken,
        studentWriteToken,
        refreshMinutes: 3
      }
    },
    null,
    2
  )}${os.EOL}`
);
