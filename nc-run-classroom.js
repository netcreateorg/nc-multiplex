#!/usr/bin/env node
/**
 *  Script to run a pre-compiled NetCreate server
 * 
 *  You need to run `npm run classroom` before this to compile.
 *  
 */

const shell = require("shelljs");
const server = require("./netcreate-2018/build/brunch-server");

shell.cd("netcreate-2018/build");

return new Promise((resolve, reject) => {
  server({ port: 3000 }, function () {
    console.log(`\n*** NetCreate is running (classroom mode) ***\n`);
    resolve();
  });
});
