#!/usr/bin/env node
/**
 *  nc-start-ncjs.js
 * 
 *  This is a shell script that essentially just pases off
 *  new app parameters to the `nc.js` script.
 * 
 *  It is used in multi-db environments to start up
 *  multiple nc.js instances.
 * 
 *  As of 7/20/2020 it has been deprecated in favor of
 *  http-proxy-middleware in the new nc-start.js
 * 
 */


const shell = require("shelljs");

console.log("### nc-start-ncjs.js: Init.");

// Read Arguments
let argv = require("minimist")(process.argv.slice(2));
let dataset = argv["dataset"];
let googlea = argv["googlea"];
let port = argv["port"];
let netport = argv["netport"];
let ip = argv["ip"];

let netportDef = '';
let ipDef = ``;
let googleaDef = ``;

if (netport) {
  netportDef = ` --netport=${netport}`;
}
if (ip) {
  ipDef = ` --ip=${ip}`;
}
if (googlea) {
  googleaDef = ` --googlea=${googlea}`;
}

process.on('message', data => {
  // FIXME: we're foolishly ignoring the `data` passed here via
  // the fork parent and relying instead on
  // arguments passed to the shell.  duh.
  console.log('### nc-start.js: Starting nc.js script.')
  shell.cd("netcreate-2018/build");
  shell.exec(
    `./nc.js --dataset=${dataset} --port=${port}${netportDef}${ipDef}${googleaDef}`
  );
  console.log("### nc-start.js: nc.js started.");
  process.send('nc-start.js: Completed!');
});
