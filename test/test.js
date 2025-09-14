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

async function customTimeouts() {
    const srv = new ApiSrv({
        port: 12346,
        bodyReadTimeoutMs: 1234,
        callback: () => {}
    });

    try {
        if (srv.server.headersTimeout !== 1234) {
            throw new Error('headersTimeout not set');
        }
        if (srv.server.requestTimeout !== 1235) {
            throw new Error('requestTimeout not set');
        }
    } finally {
        srv.server.close();
    }
}

async function queryParsing() {
    const srv = new ApiSrv({
        port: 12347,
        callback: (r) => r.jsonResponse(r.params)
    });

    try {
        const getRes = await new Promise((resolve, reject) => {
            http.get({ port: 12347, path: '/?a=a+b' }, (res) => {
                let data = '';
                res.on('data', d => data += d);
                res.on('end', () => resolve({ status: res.statusCode, data }));
            }).on('error', reject);
        });
        if (getRes.status !== 200 || JSON.parse(getRes.data).a !== 'a b') {
            throw new Error('GET query parsing failed');
        }

        const postRes = await new Promise((resolve, reject) => {
            const req = http.request({
                port: 12347,
                method: 'POST',
                path: '/',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }, (res) => {
                let data = '';
                res.on('data', d => data += d);
                res.on('end', () => resolve({ status: res.statusCode, data }));
            });
            req.on('error', reject);
            req.end('a=a+b');
        });
        if (postRes.status !== 200 || JSON.parse(postRes.data).a !== 'a b') {
            throw new Error('POST query parsing failed');
        }
    } finally {
        srv.server.close();
    }
}

async function badCharset() {
    const srv = new ApiSrv({
        port: 12348,
        callback: () => {},
        debug: true
    });

    try {
        const res = await new Promise((resolve, reject) => {
            const req = http.request({
                port: 12348,
                method: 'POST',
                path: '/',
                headers: { 'Content-Type': 'application/json; charset=iso-8859-1' }
            }, (res) => {
                let data = '';
                res.on('data', d => data += d);
                res.on('end', () => resolve({ status: res.statusCode, data }));
            });
            req.on('error', reject);
            req.end('{');
        });
        if (res.status !== 400 || res.data !== 'Bad charset for JSON content type.\n') {
            throw new Error('Bad charset not handled correctly');
        }
    } finally {
        srv.server.close();
    }
}

async function main() {
    await unauthorizedUpgrade();
    await customTimeouts();
    await queryParsing();
    await badCharset();
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });

