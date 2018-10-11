const { Docker } = require('node-docker-api');
const express = require('express');
const httpProxy = require('http-proxy');
const waitForPort = require('wait-for-port');
const Logger = require('logplease');
const log = Logger.create('talk-container-manager');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const app = express();
const apiProxy = httpProxy.createProxyServer();

const ENV_PORT = 8000;
const ENV_DOCKER_IMAGE = 'git-wetty';

const wetty = {
    Image: ENV_DOCKER_IMAGE,
    name: 'to-be-filled',
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
    log.warn("Quitting, please wait...", sig);

    apiProxy.close();

    Promise.all(Array.from(users.entries()).map(entry => {
        let [user, container] = entry;
        log.info(`Stopping container of user ${user}...`);
        return container
            .stop()
            .then(container => {
                log.info(`Stopped container of user ${user}, removing now...`);
                return container.delete();
            })
            .then(_ => log.info(`Removed container of user ${user}!`));
    }))
        .then(_ => process.exit())
        .catch(_ => {
            log.error(`Process exited with errors!`);
            process.exit();
        });
}

function forward(req, res, user, status) {
    if (shutdownRunning) {
        res.status(404).send('Not found');
        return;
    }

    const ip = status.data.NetworkSettings.IPAddress;
    log.info(`Waiting for container for user ${user} to become available...`);
    waitForPort(ip, 4123, (err) => {
        log.info(`Container for user ${user} is now running!`);
        req.url = req.params['1'];
        apiProxy.web(req, res, {
            target: `http://${ip}:4123`,
        }, () => {
            log.info(`Container proxy closed for user ${user}!`);
        });
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.all(/^\/terminal\/([^/]*)(.*)$/, (req, res, next) => {
    if (shutdownRunning) {
        res.status(404).send('Not found');
        return;
    }

    let user = req.params['0'];
    if (users.has(user)) {
        users
            .get(user)
            .status()
            .then(forward.bind(null, req, res, user))
            .catch(_ => {
                log.error(`Container for user ${user} failed to forward!`);
                res.status(500).send('Internal Server Error');
            });
    } else {
        log.info(`Starting new container for user ${user}...`);
        docker.container.create({ ...wetty, name: `${wetty.Image}-${user}` })
            .then(container => {
                users.set(user, container);
                return container.start();
            })
            .then(container => container.status())
            .then(forward.bind(null, req, res, user))
            .catch(_ => {
                log.error(`Container for user ${user} failed to start!`);
                res.status(500).send('Internal Server Error');
            });
    }
});
app.all(/^\/wetty\/.*$/, (req, res, next) => {
    if (shutdownRunning) {
        res.status(404).send('Not found');
        return;
    }

    log.debug(req.url, req.headers.referer);

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
                    target: `http://${ip}:4123`,
                }, () => {});
            });
        });
});

app.use(express.static('assets'));

log.info(`Starting server on port ${ENV_PORT}...`);

app.listen(ENV_PORT);
