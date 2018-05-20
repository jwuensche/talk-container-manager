const {Docker} = require('node-docker-api');
const express = require('express');
const httpProxy = require('http-proxy');
const waitForPort = require('wait-for-port');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const app = express();
const apiProxy = httpProxy.createProxyServer();

// TODO:
//  - handle container exit
//  - dynamic container name

const wetty = {
    Image: 'git-wetty',
    name: 'git-wetty',
    Hostname: 'ovgu',
    ExposedPorts: {
        "4123/tcp": {}
    },
};

const users = new Map();
let shutdownRunning = false;
function shutdown(sig) {
    if (shutdownRunning) {
      return;
    }
    shutdownRunning = true;
    console.log("Quitting, please wait...", sig);

    // TODO: use promise.all or sth to prevent early exit after first container
    for (let [user, container] of users) {
        console.log('Stopping and removing container of user', user, '...');
        container.stop().then(container => container.delete()).then(_ => process.exit());
    }
}

function forward(req, res, user, status) {
    const ip = status.data.NetworkSettings.IPAddress;
    console.log('Waiting for container for user', user, 'to become available...');
    waitForPort(ip, 4123, (err) => {
        console.log('Container for user', user, 'is now running!');
        req.url = req.params['1'];
        apiProxy.web(req, res, {
            target: 'http://' + ip + ':4123',
        });
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function handler(req, res, next) {
    if (shutdownRunning) {
        res.status(404).send('Not found');
        return;
    }

    let user = req.params['0'];
    console.log(user);
    if (users.has(user)) {
        users.get(user).status().then(forward.bind(null, req, res, user));
    } else {
        console.log('Starting new container for user', user, '...');
        docker.container.create(wetty)
            .then(container => {
                users.set(user, container);
                return container.start();
            })
            .then(container => container.status())
            .then(forward.bind(null, req, res, user));
    }
}

app.all(/^\/terminal\/([^/]*)(.*)$/, handler);
app.all(/^\/wetty\/.*$/, (req, res, next) => {
    if (shutdownRunning) {
        res.status(404).send('Not found');
        return;
    }

    console.log(req.url, req.headers.referer);

    if (users.size <= 0) {
        res.status(404).send('Not found');
        return;
    }

    let initiator;
    if (!req.headers.referer) {
        initiator = users.keys().next().value;
    } else {
        initiator = decodeURI(/^http.*\/\/.*\/terminal\/([^/]*).*$/.exec(req.headers.referer)['1']);
    }
    const container = users.get(initiator);

    if (!container) {
        res.status(404).send('Not found');
        return;
    }

    container.status()
        .then(status => {
            const ip = status.data.NetworkSettings.IPAddress;
            waitForPort(ip, 4123, (err) => {
                apiProxy.web(req, res, {
                    target: 'http://' + ip + ':4123',
                });
            });
        });
});

app.listen(8000);
