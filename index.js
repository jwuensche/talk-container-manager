const {Docker} = require('node-docker-api');
const express = require('express');
const httpProxy = require('http-proxy');
const waitForPort = require('wait-for-port');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const app = express();
const apiProxy = httpProxy.createProxyServer();

// TODO:
//  - handle container exit

const wetty = {
    Image: 'git-wetty',
    name: 'git-wetty',
    Hostname: 'ovgu',
    ExposedPorts: {
        "4123/tcp": {}
    },
};

const users = new Map();

function shutdown() {
    console.log("Quitting, please wait...");
    for (let [user, container] of users) {
        console.log('Stopping and removing container of user', user, '...');
        container.stop().then(container => container.delete()).then(_ => process.exit());
    }
}

function forward(req, res, user, status) {
    const ip = status.data.NetworkSettings.IPAddress;
    console.log('Waiting for container for user', user, 'to become available...');
    waitForPort(ip, 4123, (err) => {
        console.log('Container for user', user, 'is now running!:', ip, req.url);
        req.url = '';
        apiProxy.web(req, res, {
            target: 'http://' + ip + ':4123/index.html',
        });
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.all('/terminal/:user', (req, res, next) => {
    let user = req.params.user;

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
});

app.listen(8000);
