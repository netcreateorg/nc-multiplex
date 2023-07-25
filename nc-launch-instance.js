#!/usr/bin/env node
/**
 *  nc-launch-instance.js
 *
 *  This shell script will start NetCreate
 *  brunch server directly, bypassing nc.js
 *
 *  It is used in multi-db environments to start up
 *  multiple nc.js instances.
 *
 *  Generally it is not called directly, but
 *  is called by `nc-multiplex.js`.
 *
 *  It assumes that the app has been built.
 *
 */

const shell = require('shelljs');
const NCUTILS = require('./modules/nc-utils');
const { NC_SERVER_PATH, NC_CONFIG_PATH } = require('./nc-launch-config');

console.log('***', NC_SERVER_PATH, NC_CONFIG_PATH);

const PRE = '...nc-launch-instance:';

function writeConfig(data) {
  let script = NCUTILS.GetNCConfig(data);
  shell.ShellString(script).to(`./${NC_CONFIG_PATH}/netcreate-config.js`);
}

function promiseServer(port) {
  shell.cd('netcreate-itest');
  const server = require(`./${NC_SERVER_PATH}/brunch-server`);
  return new Promise((resolve, reject) => {
    server({ port }, () => resolve());
  });
}

process.on('message', data => {
  console.log(PRE);
  console.log(PRE, 'STARTING DB', data.db);
  console.log(PRE);

  console.log(PRE, '1. Setting netcreate-config.js.');
  writeConfig(data);

  console.log(PRE, '2. Starting server');
  startServer(data.port);
});

async function startServer(port) {
  await promiseServer(port);
  console.log(`${PRE} 3. Server started on port ${port}!`);
  process.send('nc-launch-instance.js: Completed!');
}
