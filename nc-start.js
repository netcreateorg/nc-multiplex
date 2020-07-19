#!/usr/bin/env node
/**
 *  nc-starter.js
 * 
 *  This is a shell script that essentially just pases off
 *  new app parameters to the `nc.js` script.
 * 
 *  It is used in multi-db environments to start up
 *  multiple nc.js instances.
 * 
 */


const shell = require("shelljs");


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


shell.cd('netcreate-2018/build');
shell.exec(`./nc.js --dataset=${dataset} --port=${port}${netportDef}${ipDef}${googleaDef}`);