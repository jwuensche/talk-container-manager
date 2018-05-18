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
//
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
        req.url = req.params['1'];
	console.log('New url:', req.url);
        apiProxy.web(req, res, {
            target: 'http://' + ip + ':4123',
        });
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const handler = (req, res, next) => {
    console.log(req.params);
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
};

app.all(/^\/terminal\/([a-zA-Z0-9\-]*)(.*)$/, handler);

app.listen(8000);
