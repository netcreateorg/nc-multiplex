#!/usr/bin/env node
/**
 *  nc-start.js
 *
 *  This is a shell script will start NetCreate
 *  brunch server directly, bypassing nc.js
 * 
 *  It does however, create the same netcreate-config.js
 *  file that the brunch-server uses for configuration.
 *  
 *  It assums that the app has been built.
 *
 *  It is used in multi-db environments to start up
 *  multiple nc.js instances.
 * 
 *  Generally it is not called directly, but 
 *  is called by `nc-multiplex.js`.
 *
 */

const shell = require("shelljs");

const pathToNetcreate = './netcreate-2018/build';

const PRE = '.......nc-start: ';

function writeConfig(data) {
  const { db, port, netport, ip, googlea } = data;
  
  const dataset = db;
  const netportDef = netport ? `\n  netport: "${netport}",` : '';
  const ipDef = ip ? `\n  ip: "${ip}",` : '';

  let script = `
// this file auto-generated by "nc-start.js"
const NC_CONFIG = {
  dataset: "${dataset}",
  port: "${port}",${netportDef}${ipDef}
  googlea: "${googlea}"
};
if (typeof process === "object") module.exports = NC_CONFIG;
if (typeof window === "object") window.NC_CONFIG = NC_CONFIG;
`;
  shell.ShellString(script).to(`${pathToNetcreate}/app/assets/netcreate-config.js`);
}

function promiseServer(port) {
  shell.cd('netcreate-2018/build');
  const server = require(`${pathToNetcreate}/brunch-server`);
  return new Promise((resolve, reject) => {
    server({ port }, () => resolve());
  });
}

process.on("message", (data) => {
  console.log(PRE);
  console.log(PRE + "STARTING DB", data.db);
  console.log(PRE);

  console.log(PRE + "1. Setting netcreate-config.js.");
  writeConfig(data);

  console.log(PRE + "2. Starting server");
  startServer(data.port);
});

async function startServer(port) {
  await promiseServer(port);
  console.log(`${PRE} 3. Server started on port ${port}!`);
  process.send("nc-start.js: Completed!");  
}

