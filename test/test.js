'use strict';

const ApiSrv = require('../index');
const http = require('http');

async function unauthorizedUpgrade() {
    const logs = [];
    const origLog = console.log;
    console.log = (msg) => logs.push(msg);

    const srv = new ApiSrv({
        port: 12345,
        callback: () => {},
        authCallback: () => false,
        upgradeCallback: () => true,
        debug: true
    });

    try {
        await new Promise((resolve, reject) => {
            const req = http.request({
                port: 12345,
                hostname: '127.0.0.1',
                headers: {
                    Connection: 'Upgrade',
                    Upgrade: 'websocket'
                }
            });
            req.on('upgrade', (res, socket, head) => {
                socket.destroy();
                resolve();
            });
            req.on('error', resolve);
            req.end();
        });
        await new Promise(r => setTimeout(r, 50));
    } finally {
        console.log = origLog;
        srv.server.close();
    }

    if (logs.some(l => l.includes('Upgrade successfully processed'))) {
        throw new Error('Unauthorized upgrade logged success');
    }
}

unauthorizedUpgrade()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });

