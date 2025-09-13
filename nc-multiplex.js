/*///////////////////////////////// ABOUT \\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\*\

  NETCREATE MULTIPLEX SERVER - REMIX (2024)
  Reformatted for debugging by Sri, so new bugs are mine :-)

  --- original comments ---

  To start a new graph:
    http://localhost/graph/tacitus/

    If the graph already exists, it will be loaded. Otherwise it will create a new graph.
    You need to be logged into the manager for this to work.

  Manager runs on `http://localhost:80` by default.  Can be overriden with --port=8080

  proxied routes
    /                            => localhost:80 Root: NetCreate Manager page
    /graph/<dbname>/#/edit/uid   => localhost:3x00/#/edit/uid
    /*.[js,css,html]             => localhost:3000/net-lib.js

  flags

    node nc-multiplex.js --IP=192.168.1.40 --port=8080

\*\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\ * /////////////////////////////////////*/

const { createProxyMiddleware } = require('http-proxy-middleware');
const { fork, exec, execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const archiver = require('archiver');

// session-related imports from netcreate subrepo
const { NC_SERVER_PATH, NC_RUNTIME_PATH, NC_LOGS_PATH, NC_BACKUPS_PATH, NC_URL_CONFIG, ScanForRepos } = require('./nc-launch-config');
const SESSION = require(`${NC_SERVER_PATH}/app/unisys/common-session.js`);
//
const NCUTILS = require('./modules/nc-utils.js');
const NCLOG = require('./modules/nc-logging-utils');

/// CONSTANTS & DECLARATIONS //////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
const PRE = 'NC_MUX   -'; // console.log prefix, match length of netcreate output
const SPC = ' '.repeat(PRE.length);
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
const DEFAULT_PORT = 80; // default port for the proxy server
const PORT_APP = 3000; // base port for nc apps
const PORT_WS = 4000; // base port for websockets
const DEFAULT_PASSWORD = 'kpop'; // override with SESAME file
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
const PROCESS_MAX = 30; // Set this to limit the number of running processes
const SYSMEM_MIN = 256; // MB. Each node process is generally ~30 MB.
const AUTO_NEW = false; // Set to true to allow auto-spawning a new database via url.
const AUTH_MINUTES = 2; // Minutes. Number of minutes to authorize login cookie
const HEARTBEAT = 15; // Minutes. Number of minutes between memory log heartbeats
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/// detected node version
let NVMRC;
/// command line flags
const argv = require('minimist')(process.argv.slice(2));
const argv_port = Number(argv['port'] || argv['p']);
let port_override;
if (argv_port && Number.isInteger(argv_port)
    && argv_port > 0 && argv_port < 65536
    && (argv_port < PORT_APP || argv_port > PORT_WS + 999)) // don't allow 3000-4999
      port_override = argv_port;
const PORT_ROUTER = port_override || DEFAULT_PORT;
const IP = argv['ip'];
/// local data structures
let m_proxy_pool = []; // array of available port indices, usu [1...100]
let m_child_processes = []; // array of forked process + meta info = { db, port, netport, portindex, process };
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
let HOMEPAGE_EXISTS; // Flag for existence of home.html override
let PASSWORD; // Either default password or password in `SESAME` file
let PASSWORD_HASH; // Hash generated from password
let SERVER_IP; // IP address of server.  Used to tag download filenames.
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
const CYN = '\x1b[96m'; // cyan
const CYNR = '\x1b[46m'; // reversed cyan
const GRN = '\x1b[92m'; // green
const GRNR = '\x1b[42m'; // green reversed
const RST = '\x1b[0m'; // reset
const RED = '\x1b[91m'; // red
const WARN = '\x1b[93m'; // yellow

/// SRI HACK IN TIMESTAMP /////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
const { strDateStamp, strTimeStamp } = NCLOG;
const $T = () => `${strDateStamp()} ${strTimeStamp()}`; // return timestamp string

/// HELPER METHODS ////////////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** return server IP address */
function m_GetServerIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip over internal (i.e., 127.0.0.1) and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost'; // fallback
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** return memory parameters */
function m_MemoryReport(unit = 'kb') {
  const _fmt = x => x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let cf;
  if (unit === 'kb') cf = 1024;
  if (unit === 'mb') cf = 1024 * 1024;
  const { heapUsed, heapTotal } = process.memoryUsage();
  const huse = _fmt(Math.trunc(heapUsed / cf));
  const htot = _fmt(Math.trunc(heapTotal / cf));
  const hpct = (100 * (heapUsed / heapTotal)).toFixed(2);
  const hrem = _fmt(Math.trunc((heapTotal - heapUsed) / cf));
  const kb2mb = 1024 * 1024;
  const osTotal = Math.trunc(os.totalmem() / kb2mb);
  const osFree = Math.trunc(os.freemem() / kb2mb);
  const osUsed = osTotal - osFree;
  const sysTotal = _fmt(osTotal);
  const sysFree = _fmt(osFree);
  const sysUsed = _fmt(osUsed);
  const sysPercent = (100 * (osUsed / osTotal)).toFixed(2);
  const sysLow = osFree < SYSMEM_MIN;

  const pids = m_GetInstancePIDs();
  return {
    unit, // kb or mb
    heapTotal: htot, // total allocated javascript heap (can grow)
    heapUsed: huse, // total used heap (can grow)
    heapPercent: hpct, // heap percentage used (percentage)
    heapBuffer: hrem, // heap remaining
    pids, // multi-line string of instance PIDs info
    sysTotalMB: sysTotal, // total system memory in MB
    sysFreeMB: sysFree, // free system memory in MB
    sysUsedMB: sysUsed, // used system memory in MB
    sysMinMem: SYSMEM_MIN, // minimum system memory in MB
    sysPercent: sysPercent, // percentage of system memory used
    warnLowMem: sysLow // true if system memory is below SYSMEM_MIN
  };
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** periodically log memory usage and running instances to console */
function m_MemLog() {
  let { heapUsed, heapTotal, heapPercent, sysFreeMB, unit, pids } = m_MemoryReport();
  console.log(
    PRE,
    '* MEMORY HEARTBEAT',
    $T(),
    `- nodeHeap ${heapUsed} / ${heapTotal}${unit} (${heapPercent}%)`,
    `- freeMem ${sysFreeMB}mb`
  );
  const out = pids.split('\n');
  if (out.length > 1)
    out.forEach(line => {
      if (line.trim().length > 0) console.log(PRE, '*', line.trim());
    });
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** Returns true if the db is currently running as a process
 * @param {string} db - database name
 */
function m_DatabaseIsRunning(db) {
  return m_child_processes.find(route => route.db === db);
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** get the output of ps matching nc-launch-instance.jssh entries */
function m_GetInstancePIDs() {
  const stdout = execSync('ps -e -o pid -o command | grep nc-launch-instance.jssh');
  const regex = /(\d+).+\/versions\/node\/(.+)/;
  const lines = stdout.toString().split('\n');
  let out = '';
  lines.forEach(line => {
    if (line.includes('/bin/node ./nc-launch-instance.jssh')) {
      const match = line.match(regex);
      if (match) {
        const [_, pid, cli] = match;
        const paddedPid = pid.padEnd(7, ' ');
        out += `  ${paddedPid} .nvm/versions/${cli}\n`;
      }
    }
  });
  return out;
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** express helper to return an error */
function m_SendErrorResponse(res, msg) {
  res.set('Content-Type', 'text/html');
  res.send(
    `<p>${msg}</p>
    <p><a href="/manage">Back to Multiplex Manager</a></p>`
  );
}

/// SESSION OPERATIONS ////////////////////////////////////////////////////////
// /// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// DEPRECATED MakeToken function -- keep in case we need it again
// /** Generates a list of tokens using the NetCreate common-session module
//  *  REVIEW: Requiring a module from the secondary netcreate-2018 repo
//  *  is a little iffy.
//  *  @param {string} clsId - classId
//  *  @param {string} projId - projectId
//  *  @param {string} dataset - database name
//  *  @param {integer} numGroups - number of tokens to generate
//  *  @return {string}
//  */
// function MakeToken(clsId, projId, dataset, numGroups) {
//   // from nc-logic.js
//   if (typeof clsId !== 'string')
//     return 'args: str classId, str projId, str dataset, int numGroups';
//   if (typeof projId !== 'string')
//     return 'args: str classId, str projId, str dataset, int numGroups';
//   if (typeof dataset !== 'string')
//     return 'args: str classId, str projId, str dataset, int numGroups';
//   if (clsId.length > 12) return 'classId arg1 should be 12 chars or less';
//   if (projId.length > 12) return 'classId arg1 should be 12 chars or less';
//   if (!Number.isInteger(numGroups)) return 'numGroups arg3 must be integer';
//   if (numGroups < 1) return 'numGroups arg3 must be positive integer';

//   let out = `TOKEN LIST for class '${clsId}' project '${projId}' dataset '${dataset}'\n\n`;
//   let pad = String(numGroups).length;
//   for (let i = 1; i <= numGroups; i++) {
//     let id = String(i);
//     id = id.padStart(pad, '0');
//     out += `group ${id}\t${SESSION.MakeToken(clsId, projId, i, dataset)}\n`;
//   }
//   return out;
// }
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** Used to generate a hashed password for use in the cookie
 *  so that password text is not visible in the cookie.
 *  @param {string} pw - plain text password
 *  @return {string} hash of password
 */
function GetHash(pw) {
  let hash = crypto.createHash('sha1').update(pw).digest('hex');
  return hash;
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** HASH is generated from the PASSWORD
 *  @param {string} pw
 */
function CookieIsValid(req) {
  if (!req || !req.cookies) return false;
  // check against hash
  let pw = req.cookies['nc-multiplex-auth'];
  return pw === PASSWORD_HASH;
}

/// PORT POOLING //////////////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** The proxy server runs on port 80 by default, hosting various management
 *  routes as well as the /graph/<db>/ proxying
 *
 *  - Base application port is 3000
 *  - Base websocket port is 4000
 *
 *  Launched NetCreate instances are reserved by m_proxy_pool. The entities
 *  in m_proxy_pool range from 0...PROCESS_MAX, are stored as offsets from the
 *  base ports. When an instance is killed through the management UI, the
 *  port index is returned to the pool. The UI prevents the base app from being
 *  reallocated.
 */
for (let i = 0; i <= PROCESS_MAX; i++) {
  m_proxy_pool.push(i);
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** Gets the next available port from the pool.
 *  @param {integer} index of route
 *  @return {object.index} index of port (eg. 3)
 *  @return {object.appport} port for app (e.g. 3003)
 *  @return {object.netport} port for websocket (e.g. 4003)
 *  or `undefined` if no items are left in the pool
 */
function PickPort() {
  if (m_proxy_pool.length < 1) return undefined;
  const index = m_proxy_pool.shift();
  const result = {
    index,
    appport: PORT_APP + index,
    netport: PORT_WS + index
  };
  // make sure that there are no duplicates in the pool
  const dpool = Array.from(new Set(m_proxy_pool));
  if (dpool.length !== m_proxy_pool.length) {
    console.log(
      PRE,
      $T(),
      'ERROR: Duplicate port indices in pool! This should not happen!'
    );
    console.log(PRE, $T(), 'Pool:', m_proxy_pool);
  }
  return result;
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** Returns the port index to the pool
 *  @param {integer} index - Port index to return to the pool
 */
function ReleasePort(index) {
  if (m_proxy_pool.find(port => port === index)) {
    console.log(
      PRE,
      $T(),
      'ERROR: Port already in pool! This should not happen!',
      index
    );
    // throw 'ERROR: Port already in pool! This should not happen! ' + index;
  }
  m_proxy_pool.push(index);
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** Returns true if there are no more port indices left in the pool
 *  Used by /graph/<db>/ route to check if it should spawn a new app
 */
function PortPoolIsEmpty() {
  return m_proxy_pool.length < 1;
}

/// RENDERERS /////////////////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
const logoHtml =
  '<h1><img src="/images/netcreate-logo.svg" alt="NetCreate Logo" width="100px"> Multiplex</h1>';
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
function RenderLoginForm() {
  return `
      <form action="/authorize" method="post">
        <label>Password: <input name="password" type="password" autofocus/></label>
        <input type="submit" />
      </form>
`;
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
function RenderManager() {
  let response = logoHtml;
  response += `<script>
    const startTime = new Date().getTime();
    setInterval( ()=> {
      if (!document.cookie.includes('nc-multiplex-auth')) {
        location.href='/login?expired';
      };
      const status = document.getElementById('status');
      let elapsed = (new Date().getTime() - startTime) / 1000;
      let remaining = ${AUTH_MINUTES * 60} - elapsed;
      let unit = 's';
      let out = '(' + remaining.toFixed(0) + unit + ' until auto logout)';
      if (remaining < 30) status.style.color = 'red';
      if (remaining < 0) location.href='/login?expired';
      if (remaining >= 0) status.innerHTML = out;
    }, 1000);
  </script>`;
  response += `<div id="login" style="display: none">` + RenderLoginForm() + `</div>`;
  response += `<style>.box { background-color: #EEF; padding: 20px; margin: 0 0 20px 20px}</style>`;
  response += `<div id="graphs" style="display: flex;">`;
  response += RenderActiveGraphsList();
  response += RenderSavedGraphsList();
  response += `</div>`;
  response += `<div id="forms" style="display: flex">`;
  response += RenderNewGraphForm();
  response += RenderDownloadLogs();
  // response += RenderGenerateTokensForm();
  response += `</div>`;
  response += RenderMemoryReport();
  response += `<p><i>page last loaded on: ${m_stat.refreshed.toLocaleTimeString()} <span id='status'></span></i></p >`;
  return response;
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** Returns a list of databases in the runtime folder
 *  formatted as HTML <LI>s, with a link to open each graph.
 */
function RenderDatabaseList() {
  let response = '<ul>';
  let dbs = NCUTILS.GetDatabaseNamesArray();
  dbs.forEach(db => {
    // Don't list dbs that are already open
    if (!m_DatabaseIsRunning(db))
      response += `<li><a target="_blank" href="/graph/${db}/">${db}</a></li>`;
  });
  response += `</ul>`;
  return response;
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
function RenderActiveGraphsList() {
  let response = `<div class="box">`;
  response += `<h3>Active Graphs</h3>
    <table>
      <thead>
        <tr>
          <td>Graph</td><td>Port</td><td>Websocket</td><td></td>
        </tr>
      </thead>
      <tbody>
  `;
  m_child_processes.forEach((route, index) => {
    if (index < 1) return; // Don't list the BASE database
    let kill = `<a href="/kill/${route.db}/">stop</a>`;
    response += `
      <tr>
        <td><a href="/graph/${route.db}/" target="${route.db}">${route.db}</a></td>
        <td>${route.port}</td><td>${route.netport}</td><td>${kill}<td>
      </tr>`;
  });
  response += `</tbody></table>`;
  response += `<p>Number of Active Graphs: ${
    m_child_processes.length - 1
  } / ${PROCESS_MAX} (max)`;
  response += `<p>Reload browser to refresh Active Graphs.</p>`;
  response += `<p>"Stop" active graphs if you're not using them anymore.<br/>(Closing the window does not stop the graph.)</p>`;
  response += `</div>`;
  return response;
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
function RenderSavedGraphsList() {
  let response = `<div class="box">`;
  response += `<h3>Saved Graphs</h3>`;
  response += `<p>Graph/database files saved on server.  Click to open.</p>`;
  response += RenderDatabaseList();
  response += `</div>`;
  return response;
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
function RenderNewGraphForm() {
  return `
    <div class="box">
      <h3>New Graph</h3>
      <script>
        function OpenGraph() {
          const regex = /^[a-zA-Z0-9]+$/;
          const db = document.getElementById('dbname').value;
          if (regex.test(db) === false) {
            alert('Please use only alphanumeric characters.  No spaces and no punctuation.');
          } else if (db.length < 1) {
            alert('No database name entered.');
          } else {
            window.open('graph/'+db+'/', '_blank');
          }
        }
      </script>
      <style>
        input:invalid {
          border: 2px solid red;
        }
      </style>
      <p>Add a template file with the same name to the /runtime folder.  Otherwise, the system
      will generate a copy from the default template.</p>
      <label>Enter a short alphanumeric name for the database.  No spaces, no punctuation.<br/>
        <form>
          <input id="dbname" placeholder="Enter new graph name" required pattern="^[a-zA-Z0-9]+$">
          <button onclick="OpenGraph()">Create New Graph</button>
        </form>
      </label>
   </div>`;
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
function RenderDownloadLogs() {
  return `
    <div class="box">
      <h3>Download Data</h3>
      <p>Download data for all graphs for ${SERVER_IP} as a zip file.
      This includes all data you need to completely restore a droplet
      (active graphs, loki, templates, logs)
      </p>
      <ul>
        <li><a href="/download_data">All Data</a></li>
      </ul>
    </div>`;
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// DEPRECATED RenderGenerateTokensForm function -- keep in case we need it again
// function RenderGenerateTokensForm() {
//   let response = `<div class="box">`;
//   let dbnames = NCUTILS.GetDatabaseNamesArray().reduce(
//     (acc, curr) => acc + "<option value='" + curr + "'>" + curr + '</option>',
//     ''
//   );
//   response += `
//     <script>
//       async function MakeTokens() {
//         console.log('make tokens');
//         const classid = document.getElementById('classid').value;
//         const projid = document.getElementById('projid').value;
//         const count = document.getElementById('count').value;
//         const dataset = document.getElementById('datasets').value;
//         let data = await fetch('./maketoken/'+classid+'/'+projid+'/'+dataset+'/'+count);
//         let result = await data.text();
//         const tokenDisplay = document.getElementById('tokenDisplay');
//         tokenDisplay.value = result;
//       }
//     </script>
//     <h3>Generate Tokens</h3>
//     <div>
//       <p>Select a database, enter a class id, a project id, and number of tokens to generate.  Then click "Generate Tokens".</p>
//       <select id="datasets">
//         ${dbnames}
//       </select>
//       <input id="classid" placeholder="Class ID e.g. 'PER1'">
//       <input id="projid" placeholder="Project ID e.g. 'ROME'">
//       <input id="count" placeholder="Num of tokens e.g. '10'">
//       <button onclick="MakeTokens()">Generate Tokens</button><br/><br/>
//       <textarea id="tokenDisplay" rows="10" cols="80" placeholder="Tokens will appear here..." readonly></textarea>
//     </div>
//   `;
//   response += `</div>`;
//   return response;
// }
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
function RenderMemoryReport() {
  const { sysUsedMB, sysFreeMB, sysTotalMB, sysPercent } = m_MemoryReport();
  let response = '';
  response += `<pre>SERVER STARTED AT  :: ${m_stat.start}</pre>`;
  response += `<pre>SERVER MEMORY LOAD`;
  response += ` :: Used: ${sysUsedMB}MB / ${sysTotalMB}MB (${sysPercent}%)`;
  response += ` :: Remaining: ${sysFreeMB}MB`;
  response += ` :: Status: ${MemoryReport()}`;
  response += `</pre>`;
  const psOut = m_GetInstancePIDs();
  response += `<pre>LAUNCHED PROCESSES ::\n\n${psOut}</pre>`;
  return response;
}

/// PROCESS MANAGERS //////////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** API: Use this to spawn a new node instance via m_PromiseApp.
 *  @param {string} db - dataset name
 *  @return {integer} port to be used by router function
 *         in app.use(`/graph/:graph/:file`...).
 */
async function SpawnApp(db) {
  try {
    const newProcessDef = await m_PromiseApp(db);
    AddChildProcess(newProcessDef);
    SaveProcessState();
    return newProcessDef.port;
  } catch (err) {
    console.error(PRE + 'SpawnApp Failed with error', err);
  }
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** UTILITY: Promises a new node NetCreate application process. This forks
 *  `nc-launch-instance.jssh`.
 *
 *  To initiate the launch process, m_PromiseApp() uses process.send to
 *  supply the parameters necessary to write its netcreate-config.js file
 *  and start the server using the supplied ports.
 *
 *  After the server has launched, the child process sends a message back
 *  to report success or faiure.
 *
 * @param {string} db - dataset name to use
 * @resolve {object} sends the forked process and meta info
 */
function m_PromiseApp(db) {
  return new Promise((resolve, reject) => {
    const ports = PickPort();
    if (ports === undefined) {
      reject(`Unable to find a free port. ${db} not created.`);
    }
    const { index, appport, netport } = ports;
    // 1. Define the fork
    const info = `${db}:${index}/${appport}/${netport}`; // ignored by launcher
    const forked = fork('./nc-launch-instance.jssh', [info]);
    // 2. Define fork success handler
    //    When the child node process is up and running, it will
    //    send a message back to this handler, which in turn
    //    sends the new spec back to SpawnApp
    forked.on('message', msg => {
      const { event } = msg;
      if (event === 'SUCCESS') {
        console.log(
          PRE,
          $T(),
          `${CYN}instance confirmed '${db}' has launched (port ${appport})`,
          RST
        );
        const newProcessDef = {
          db,
          port: ports.appport,
          netport: ports.netport,
          portindex: ports.index,
          process: forked
        };
        resolve(newProcessDef); // pass to SpawnApp
      } else {
        console.log(PRE, `${RED}instance '${db}' failed to start`, RST);
        reject(`Failed to start instance '${db}'`);
      }
    });

    // 3. Send message to start fork
    //    This sends the necessary startup prarameters to nc-start.js
    //    When nc-start is completed, it will call the message
    //    handler in #2 above
    const ncStartParams = {
      db,
      port: ports.appport,
      netport: ports.netport,
      process: forked,
      IP
    };
    console.log(
      PRE,
      `initializing launch of '${db}' on port:${ports.appport} netport:${ports.netport}`
    );
    forked.send(ncStartParams);
  });
}


/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** Add the newProcess to the array of m_child_processes
 *  but only if it doesn't already exist
 *  @param {object} route
 */
function AddChildProcess(newProcess) {
  if (m_child_processes.find(route => route.db === newProcess.db)) return;
  m_child_processes.push(newProcess);
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** Save the Process Datastructures from m_child_processes and m_proxy_pool
 * to a file.  This is used to save the state of the multiplex server */
function SaveProcessState() {
  const process_entries = m_child_processes.map(route => {
    return {
      db: route.db,
      port: route.port,
      netport: route.netport,
      portindex: route.portindex
    };
  });
  const ncmState = {
    child_processes: process_entries,
    proxy_pool: m_proxy_pool
  };
  fs.writeFileSync('.nc-process-state.json', JSON.stringify(ncmState));
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** Restore Process Datastructures, bypassing the m_PromiseApp() process
 *  Duplicated much of m_PromiseApp()
 */
async function LoadProcessState(child_processes, proxy_pool) {
  console.log(PRE, `${GRNR} <<< RESTORING DATASETS <<< ${RST}`);
  for (route of child_processes) {
    const { db, port, netport, portindex } = route;
    const info = `${db}:${port}/${netport}`;
    console.log(PRE, `${GRN}<<< restarting '${db}' on ${info} ${RST}`);
    await new Promise((resolve, reject) => {
      const forked = fork('./nc-launch-instance.jssh', [info]);
      // define success handler
      forked.on('message', msg => {
        const { event } = msg;
        if (event === 'SUCCESS') {
          console.log(PRE, $T(), `${GRN}<<< RESTORED '${db}' on (port ${port})`, RST);
          route.process = forked;
          resolve();
        } else {
          console.log(PRE, `${RED}<<< RESTORE '${db}' failed`, RST);
          reject(`Failed to restart instance '${db}'`);
        }
      }); // end forked.on
      const ncStartParams = {
        db,
        port,
        netport,
        portindex,
        process: forked
      };
      forked.send(ncStartParams);
    }); // end promise
  } // end for
  m_proxy_pool = proxy_pool;
  m_child_processes = child_processes;
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** checks the memory status and returns true if out of memory. Unlike the
 *  MemoryReport() function, this function returns a boolean and strictly
 *  checks the free memory against the SYSMEM_MIN constant.
 */
function m_OutOfMemory() {
  const bytesToMB = 1024 * 1024;
  let free = os.freemem() / bytesToMB; // mb
  return free < SYSMEM_MIN;
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** Return a string that reports the memory status of the server */
function MemoryReport() {
  const bytesToMB = 1024 * 1024;
  let free = os.freemem() / bytesToMB; // mb
  const warnMem = SYSMEM_MIN;
  const critMem = SYSMEM_MIN / 4;
  const low = free < critMem;
  const warn = free < warnMem;
  if (low) return `**CRITICAL** (< crit fail buffer ${critMem}MB)`;
  if (warn) return `**WARNING** (< mem buffer ${warnMem}MB`;
  return `OK (>${SYSMEM_MIN}MB free)`;
}

/*///////////////////////////// RUNTIME START \\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\*\


  Start of Server Execution on Module Load
  - emit console header timestamp
  - check .nvmrc and node version
  - detect home page availability
  - read management password from SESAME file


\*\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\ * /////////////////////////////////////*/

/// RUNTIME: START LOGGING OUTPUT /////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
const m_stat = {
  start: '', // timestamp of server start
  refreshed: '' // timestamp of last refresh
};
m_stat.start = $T();
fs.writeFileSync('.nc-server-start.txt', m_stat.start);
///
console.log(`\n\n\n`);
console.log('-'.repeat(80));
console.log(PRE, 'nc-multiplex started:', m_stat.start);
console.log(PRE);

if (port_override)
  console.log(PRE, `${RED}Using port override: ${PORT_ROUTER}${RST}`);
else
  console.log(PRE, `${GRN}Using default port: ${PORT_ROUTER}${RST}`);

/// RUNTIME: CHECK FOR BASE REPO //////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
const { primary, count } = ScanForRepos();
if (primary === undefined) {
  console.log(PRE, `${RED}ERROR: no primary NetCreate repo found${RST}`);
  console.log(SPC, `Make sure you installed a repo to launch from.`);
  console.log(SPC, `See ${WARN}ReadMe.md${RST} for details.`);
  process.exit(1);
}
if (count === 1) {
  console.log(PRE, `reference subrepo: ${primary.repo}`);
} else {
  console.log(PRE, `${WARN}WARNING: multiple NetCreate repos (${count}) found${RST}`);
  console.log(SPC, `defaulting to ${WARN}${primary.repo}${RST}`);
}

/// RUNTIME: CHECK NODE VERSION ///////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
try {
  NVMRC = fs.readFileSync('./.nvmrc', 'utf8').trim();
} catch (err) {
  console.error('could not read .nvmrc', err);
  throw Error(`Could not read .nvmrc ${err}`);
}
exec('node --version', (error, stdout, stderr) => {
  if (stdout) {
    stdout = stdout.trim();
    if (stdout !== NVMRC) {
      console.log('\x1b[97;41m');
      console.log(PRE, '*** NODE VERSION MISMATCH ***');
      console.log(PRE, '.. expected', NVMRC, 'got', stdout);
      console.log(PRE, '.. did you remember to run nvm use?\x1b[0m');
      console.log('');
    }
    console.log(PRE, 'NODE VERSION:', stdout, 'OK');
  }
});

/// RUNTIME: DETECT CUSTOM HOME PAGE //////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
try {
  fs.accessSync('home.html', fs.constants.R_OK);
  HOMEPAGE_EXISTS = true;
} catch (err) {
  // no home page, use default
  HOMEPAGE_EXISTS = false;
}

/// RUNTIME: SET PASSWORD /////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/// If 'SESAME' file exists, use the password in there instead of default
try {
  let sesame = fs.readFileSync('SESAME', 'utf8');
  PASSWORD = sesame.trim();
} catch (err) {
  PASSWORD = DEFAULT_PASSWORD; // no password, use default
}
PASSWORD_HASH = GetHash(PASSWORD);

/// RUNTIME: START HEARTBEAT TIMER ///////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
m_MemLog();
setInterval(m_MemLog, HEARTBEAT * 60 * 1000); // log memory usage every X minutes

/// EXPRESS CONFIGURATION /////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// START BASE APP
// This is needed to handle static file requests.
// Most imports/requires do not specify the db route /graph/dbname/
// so we need to provide a base app that responds to those static file
// requests.  This starts a generic "base" dataset at port 3000.

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/// EXPRESS DATA ACCESS ROUTES ////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** HANDLE /graph/:graph/netcreate-config.js
 *  The config file needs to be dynamically served for each node instance,
 *  otherwise they would share (and clobber) the same static file.
 *  This route has to go before /graph/:graph/:file? below
 */
app.get(`/graph/:graph/${NC_URL_CONFIG}`, (req, res) => {
  const db = req.params.graph;
  let response = '';
  const child = m_child_processes.find(child => child.db === db);
  if (child) {
    console.log(
      PRE,
      $T(),
      `GET /graph/${child.db}/${NC_URL_CONFIG} (client ${req.ip})`
    );
    response += NCUTILS.GetNCConfig(child);
  } else {
    console.log(PRE, $T(), 'no graph-specific netcreate-config.js found for', db);
    response += 'ERROR: No database found to netcreate-config.js: ' + db;
  }
  res.set('Content-Type', 'application/javascript');
  res.send(response);
});

/// PROXY GRAPH REDIRECT //////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** CONFIG FUNCTION: m_RouterLogic used by http-proxy-middleware to route to
 *  the correct port
 *  @param {Express.Request} req The router function tries to route to the
 *  correct port and path, checking whether it already exists. If flags allow,
 *  it will spawn a new process if able to.
 */
async function m_RouterLogic(req) {
  let port;
  let path = '';
  let db = '';
  let err='';

  // sri debug detect if req.params is undefined
  if (req === undefined) {
    console.log(PRE, $T(), 'ERROR in m_RouterLogic: req is undefined');
    err = '<undefined-req>';
  } else if (req.params === undefined) {
    console.log(PRE, $T(), 'ERROR in m_RouterLogic: req.params is undefined');
    console.log(PRE, $T(), 'req.ip:', req.ip);
    err = '<undefined-req-params>';
  } else if (req.params.graph === undefined) {
    console.log(PRE, $T(), 'ERROR in m_RouterLogic: req.params.graph is undefined');
    console.log(PRE, $T(), 'req.ip:', req.ip);
    err = '<undefined-req-params-graph>';
  } else {
    db = req.params.graph;
  }

  // Authenticate to allow spawning
  let ALLOW_SPAWN = false;
  if (CookieIsValid(req)) {
    ALLOW_SPAWN = true;
  }
  // Is it already running?
  let route = m_child_processes.find(route => route.db === db);
  if (route) {
    // a) Yes. Use existing route!
    console.log(
      PRE,
      $T(),
      `>>> proxying request /graph/${route.db}:${PORT_ROUTER} to :${route.port} (client ${req.ip})`
    );
    port = route.port;
  } else if (PortPoolIsEmpty()) {
    // b) No more ports available.
    console.log(PRE, $T(), '!!! no more ports. Not spawning', db);
    path = `/error_out_of_ports`;
  } else if (m_OutOfMemory()) {
    // c) Not enough memory to spawn new node instance
    console.log(PRE, $T(), '!!! out of memory. Not spawning', db);
    path = `/error_out_of_memory`;
  } else if (AUTO_NEW || ALLOW_SPAWN) {
    // c) Not defined yet, Create a new one.
    let reason = ALLOW_SPAWN ? 'spawn=true ' : 'spawn=false ';
    reason += AUTO_NEW ? 'new=true' : 'new=false';
    console.log(PRE, $T(), `*** auto spawning (${reason})`, db);
    port = await SpawnApp(db);
  } else {
    // c) Not defined or running, and not allowed to spawn
    console.log(
      PRE,
      $T(),
      `!!! /graph/${db} not allowed to spawn (AUTO_NEW=ALOW_SPAWN=false)`
    );
    path = `/error_no_database?graph=${db}`;
  }
  if (err) {
    console.log(PRE, $T(), '!!! m_RouterLogic error:', err);
    path = undefined;
  }
  return {
    protocol: 'http:',
    host: 'localhost',
    port: port,
    path: path // if path is empty, it will be ignored
  };
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** CONFIG FUNCTION: m_ProxyFilter nominally rewrites the /graph/{db} to
 *  localhost:{port}, but it also contains some debug code to detect if
 *  req.params is undefined as we have seen this on our servers and are trying
 *  to log the conditions when this happens.
 *  @param {string} rpath - route to check (remainder after any params)
 *  @param {Express.Request} req - request object
 */
function m_ProxyFilter(rpath, req) {
  // sri debug detect if req.params is undefined
  if (req === undefined) {
    console.log(PRE, $T(), `??? USE ${route} req is undefined`);
    return false;
  }
  // detect if this is a websocket connection
  if (req.headers && req.headers.upgrade) {
    const { upgrade } = req.headers;
    if (typeof upgrade === 'string' && upgrade.toLowerCase() === 'websocket') {
      const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      console.log(
        PRE,
        $T(),
        `${WARN}??? USE ${rpath} is a websocket connection attempt from ${ip}`,
        RST
      );
    }
  }
  if (req.params === undefined) {
    console.log(PRE, $T(), `${WARN}??? USE ${rpath} req.params is undefined`, RST);
    return false;
  }
  // pass if there is a file
  // (srinote: this param only contains the first segment, which may be a bug)
  if (req.params.file) return true; // only first segment of path (bug?)
  // check for missing originalUrl
  if (req.originalUrl===undefined) {
    console.log(PRE, $T(), '??? ProxyFilter req.originalUrl is undefined');
    return false;
  }
  // pass if there is a trailing '/'
  if (req.params.graph && req.originalUrl.endsWith('/')) return true; // legit graph
  return false;
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** CONFIG FUNCTION: m_ProxyRewrite rewrites the path to remove the /graph/db/
 *  prefix, used to reroute the calls to the correct port in the main proxy
 *  middleware for /graph/dbname/ requests.
 */
function m_ProxyRewrite(rpath, req) {
  // remove '/graph/db/' for the rerouted calls
  // e.g. localhost/graph/hawaii/#/edit/mop => localhost:3000/#/edit/mop

  if (req.originalUrl === undefined) {
    console.log(PRE, $T(), '??? ProxyRewrite req.originalUrl is undefined');
    return rpath;
  }
  const fullPath = req.originalUrl;

  /*/ srinote: in hpm 3, path is the remainder after the /graph/db/ prefix
      instead of the full path as before, so use req.originalUrl instead
  /*/

  // const rewrite = rpath.replace(`/graph/${req.params.graph}`, '');
  const rewrite = fullPath.replace(`/graph/${req.params.graph}/`, '/');
  return rewrite;
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** MAIN HANDLER /graph/:graph/:file?
 *  The intention is to proxy file requests from /graph/dbname/filename
 *  to localhost:3000/filename (e.g. `netcreate-config.js` requests).
 */
const proxy = createProxyMiddleware({
  // this is the actual proxy setup object
  router: m_RouterLogic,
  pathFilter: m_ProxyFilter,
  pathRewrite: m_ProxyRewrite,
  target: `http://localhost:3000`, // default fallback, router takes precedence
  ws: true,
  changeOrigin: true,
  on: {
    error: (err, req, res, target) => {
      console.log(PRE, $T(), '??? Proxy Error:', err);
      if (res.writeHead && !res.headersSent) {
        res.writeHead(500, {
          'Content-Type': 'text/plain'
        });
      }
      res.end('Something went wrong with the proxy.');
    },
    close: (proxyRes, proxySocket, proxyHead) => {
      console.log(PRE, $T(), '??? Proxy client closed');
    }
  }
});
app.use('/graph/:graph/:file?', proxy);

/// EXPRESS ERROR ROUTES //////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/// HANDLE NO DATABASE -- RETURN ERROR
app.get('/error_no_database', (req, res) => {
  // get the ?graph value the query string
  let db = '';
  if (req.query && req.query.graph) db = req.query.graph;
  // overblown pretty-print formating
  if (db.endsWith('/')) db = db.slice(0, -1);
  db = db.length > 0 ? ` '${db}' ` : ' ';
  m_SendErrorResponse(res, `Requested graph${db}is not currently open`);
});
/// HANDLE NOT AUTHORIZED -- RETURN ERROR
app.get('/error_not_authorized', (req, res) => {
  m_SendErrorResponse(res, 'Not Authorized.');
});
/// HANDLE OUT OF PORTS -- RETURN ERROR
app.get('/error_out_of_ports', (req, res) => {
  m_SendErrorResponse(res, "Ran out of ports.  Can't start the graph.");
});
/// HANDLE OUT OF MEMORY -- RETURN ERROR
app.get('/error_out_of_memory', (req, res) => {
  m_SendErrorResponse(res, "Ran out of Memory.  Can't start the graph.");
});
/// HANDLE MISSING TRAILING ".../" -- RETURN ERROR
app.get('/graph/:file', (req, res) => {
  m_SendErrorResponse(res, "Bad URL. Missing trailing '/'.");
});

// EXPRESS UTILITY ROUTES /////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// HANDLE "/kill/:graph" -- KILL REQUEST
app.get('/kill/:graph/', (req, res) => {
  if (req.params === undefined) {
    console.log(PRE, $T(), 'ERROR: req.params is undefined for /kill/:graph/');
    const fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
    console.log(PRE, `error url: ${fullUrl}`);
    console.log(PRE, `client ip: ${req.ip}`);
    return;
  }
  const db = req.params ? req.params.graph : '';
  console.log(PRE, $T(), `GET /kill/${db} (client ${req.ip})`);
  res.set('Content-Type', 'text/html');
  let response = `<h1>NetCreate Manager</h1>`;

  const child = m_child_processes.find(child => child.db === db);
  if (child) {
    try {
      child.process.kill();
      // Return the port index to the pool
      ReleasePort(child.portindex);
      // Remove child from m_child_processes
      m_child_processes = m_child_processes.filter(child => child.db !== db);
      SaveProcessState(); // save state after updating process data structure
      console.log(PRE, $T(), `/kill/${db} process killed`);
      response += `<p>Process ${db} killed.</p>`;
    } catch (e) {
      console.log(PRE, $T(), `/kill/${db} process failed with ${e}`);
      response += `<p>ERROR while trying to kill ${db}</p>`;
      response += `<p>${e}</p>`;
    }
  } else {
    console.log(PRE, $T(), `/kill/${db} database not found`);
    response += 'ERROR: No database found to kill: ' + db;
  }
  response += `<p><a href="/manage">Back to Multiplex Manager</a></p>`;
  res.send(response);
});
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// DEPRECATED RenderGenerateTokensForm function -- keep in case we need it again
// /// HANDLE "/maketoken" -- GENERATE TOKENS
// app.get('/maketoken/:clsid/:projid/:dataset/:numgroups', (req, res) => {
//   const { clsid, projid, dataset, numgroups } = req.params;
//   console.log(
//     PRE,
//     $T(),
//     'maketoken GET on /maketoken',
//     clsid,
//     projid,
//     dataset,
//     numgroups
//   );
//   let response = MakeToken(clsid, projid, dataset, parseInt(numgroups));
//   res.set('Content-Type', 'text/html');
//   res.send(response);
// });
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
function m_Archive(folderPath, fileExtensions, zipFilename, req, res) {
  if (!CookieIsValid(req)) {
      res.redirect(`/error_not_authorized`);
    return;
  }

  // Create a zip archive of the folder
  const archive = archiver('zip', {
    zlib: { level: 9 } // Compression level
  });

  archive.on('error', err => {
    const errmsg = `Error creating zip: ${err.message}`;
    console.log(PRE, errmsg);
    m_SendErrorResponse(res, errmsg);
    return;
  });

  archive.pipe(res);

  // Add all files from the folder
  fs.readdir(folderPath, (err, files) => {
    if (err) {
      const errmsg = `Error reading folder: ${err.message}`;
      console.log(PRE, errmsg);
      m_SendErrorResponse(res, errmsg);
      return;
    }

    // Ensure fileExtensions is an array
    if (!Array.isArray(fileExtensions)) {
      fileExtensions = [fileExtensions];
    }
    // Filter files by the specified extensions and add them to the archive
    fileExtensions.map(ext => {
      files.filter(file => file.endsWith(ext)).forEach(file => {
        const filePath = path.join(folderPath, file);
        archive.file(filePath, { name: file });
      });
    });

    res.setHeader('Content-Disposition', `attachment; filename=${zipFilename}`);
    res.setHeader('Content-Type', 'application/zip');
    archive.finalize(); // Finish zipping
  });
}

/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/// ARCHIVE MULTIPLE DISCRETE FILES AND FOLDERS
function m_ArchiveMultiple(items, zipFilename, req, res) {
  if (!CookieIsValid(req)) {
    console.log(PRE, 'DEBUG: Cookie validation failed');
    res.redirect(`/error_not_authorized`);
    return;
  }

  // Create a zip archive
  const archive = archiver('zip', {
    zlib: { level: 9 } // Compression level
  });

  archive.on('error', err => {
    const errmsg = `Error creating zip: ${err.message}`;
    console.log(PRE, errmsg);
    m_SendErrorResponse(res, errmsg);
    return;
  });

  archive.pipe(res);

  // Set response headers
  res.setHeader('Content-Disposition', `attachment; filename=${zipFilename}`);
  res.setHeader('Content-Type', 'application/zip');

  // Process each item and add to archive
  const validItems = items.filter(item => {
    if (!fs.existsSync(item.path)) {
      console.log(PRE, `Warning: ${item.path} does not exist, skipping`);
      return false;
    }
    return true;
  });

  if (validItems.length === 0) {
    console.log(PRE, 'No valid items to archive');
    archive.finalize();
    return;
  }

  // Add all valid items to the archive
  validItems.forEach((item) => {
    const itemPath = item.path;
    const archiveName = item.name || path.basename(itemPath);
    const stats = fs.statSync(itemPath);

    if (stats.isFile()) {
      archive.file(itemPath, { name: archiveName });
    } else if (stats.isDirectory()) {
      archive.directory(itemPath, archiveName);
    } else {
      console.log(PRE, `Warning: ${itemPath} is neither file nor directory, skipping`);
    }
  });

  // Use setImmediate to ensure all archive operations are queued before finalizing
  setImmediate(() => {
    console.log(PRE, `Downloading archived data..."${zipFilename}`);
    archive.finalize();
  });
}

// DEPRECATED: Use single file archive instead
//
// /// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// /// HANDLE "/download_all_networks" -- DOWNLOAD LOKI and TEMPLATES
// app.get('/download_all_networks', (req, res) => {
//   console.log(PRE, $T(), `GET /download_all_networks (client ${req})`);
//   const folderPath = path.join(NC_RUNTIME_PATH);
//   const zipFilename = `netcreate_networks_${SERVER_IP}_${$T()}.zip`;
//   return m_Archive(
//     folderPath,
//     ['.loki', '.template.toml'],
//     zipFilename,
//     req,
//     res
//   );
// });
// /// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// /// HANDLE "/download_logs" -- DOWNLOAD RESEARCH LOGS
// app.get('/download_logs', (req, res) => {
//   console.log(PRE, $T(), `GET /download_logs (client ${req})`);
//   const folderPath = path.join(NC_LOGS_PATH);
//   const zipFilename = `netcreate_logs_${SERVER_IP}_${$T()}.zip`;
//   return m_Archive(
//     folderPath,
//     '.txt',
//     zipFilename,
//     req,
//     res
//   );
// });
// /// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// /// HANDLE "/download_lokis" -- DOWNLOAD RESEARCH LOGS
// app.get('/download_lokis', (req, res) => {
//   console.log(PRE, $T(), `GET /download_lokis (client ${req.ip})`);
//   const folderPath = path.join(NC_RUNTIME_PATH);
//   const zipFilename = `netcreate_lokis_${SERVER_IP}_${$T()}.zip`;
//   return m_Archive(
//     folderPath,
//     '.loki',
//     zipFilename,
//     req,
//     res
//   );
// });
// /// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// /// HANDLE "/download_backups" -- DOWNLOAD RESEARCH LOGS
// app.get('/download_backups', (req, res) => {
//   console.log(PRE, $T(), `GET /download_backups (client ${req.ip})`);
//   const folderPath = path.join(NC_BACKUPS_PATH);
//   const zipFilename = `netcreate_backups_${SERVER_IP}_${$T()}.zip`;
//   return m_Archive(
//     folderPath,
//     '.loki',
//     zipFilename,
//     req,
//     res
//   );
// });
// /// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// /// HANDLE "/download_templates" -- DOWNLOAD RESEARCH LOGS
// app.get('/download_templates', (req, res) => {
//   console.log(PRE, $T(), `GET /download_templates (client ${req.ip})`);
//   const folderPath = path.join(NC_RUNTIME_PATH);
//   const zipFilename = `netcreate_templates_${SERVER_IP}_${$T()}.zip`;
//   return m_Archive(
//     folderPath,
//     '.template.toml',
//     zipFilename,
//     req,
//     res
//   );
// });

/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/// HANDLE "/download_data" -- DOWNLOAD CUSTOM DATA ARCHIVE
app.get('/download_data', (req, res) => {
  console.log(PRE, $T(), `GET /download_data (client ${req.ip})`);

  // Define the items to archive - customize this array as needed
  const itemsToArchive = [
    // nc-process-state.json -- active graphs
    { path: '.nc-process-state.json', name: '.nc-process-state.json' },
    // nc-server-start.txt -- log start time
    { path: '.nc-server-start.txt', name: '.nc-server-start.txt' },
    // nc-multiplex log file
    { path: 'log.txt', name: 'log.txt' },
    // netcreate-itest/runtime folder - will archive entire folder
    //   including loki, templates, template backups, loki, backup lokis, logs, etc.
    { path: NC_RUNTIME_PATH, name: 'runtime' }
  ];
  const zipFilename = `netcreate_data_${SERVER_IP}_${$T()}.zip`;
  return m_ArchiveMultiple(
    itemsToArchive,
    zipFilename,
    req,
    res
  );
});


/// EXPRESS MANAGEMENT ROUTES //////////////////////////////////////////////////
/* - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - *\
  Authentication uses a cookie with a hashed password.
  The cookie expires after AUTH_MINUTES

  1. /manage initially redirects to /login
  2. On the /login form, the administrator enters a password
  3. /login POSTS to /authorize
  4. /authorize checks the password against the PASSWORD
      If there's no match, the user is redirected to /error_not_authorized
  5. /authorize then sets a cookie with the PASSWORD_HASH and
    the user is redirected to /manage
  6. /manage checks the cookie against the PASSWORD_HASH
    If the cookie matches, the manage page is displayed
    If the cookie doesn't match, the user is redirected back to /login
  7. The cookie expires after AUTH_MINUTES
/* - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - */
/// HANDLE MANAGER PAGE
app.get('/manage', (req, res) => {
  m_stat.refreshed = new Date();
  console.log(PRE, $T(), `GET /manage (client ${req.ip})`);
  if (CookieIsValid(req)) {
    res.cookie('nc-multiplex-auth', PASSWORD_HASH, {
      maxAge: AUTH_MINUTES * 60 * 1000
    }); // ms
    res.set('Content-Type', 'text/html');
    res.send(RenderManager());
  } else {
    res.redirect(`/login`);
  }
});
/// 2. redirected from /manage
app.get('/login', (req, res) => {
  console.log(PRE, $T(), `GET /login (client ${req.ip})`);
  if (CookieIsValid(req)) {
    // Cookie already set, no need to log in, redirect to manage
    res.redirect(`/manage`);
  } else {
    // Show login form
    res.set('Content-Type', 'text/html');
    res.send(logoHtml + RenderLoginForm());
  }
});
/// 3. post from Login Form
app.post('/authorize', (req, res) => {
  console.log(PRE, $T(), `POST /authorize (client ${req.ip})`);
  let str = new String(req.body.password);
  if (req.body.password === PASSWORD) {
    res.cookie('nc-multiplex-auth', PASSWORD_HASH, {
      maxAge: AUTH_MINUTES * 60 * 1000
    }); // ms
    res.redirect(`/manage`);
  } else {
    res.redirect(`/error_not_authorized`);
  }
});

/// EXPRESS HOME PAGE ROUTES //////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/// HANDLE "/" -- HOME PAGE
app.get('/', (req, res) => {
  console.log(PRE, $T(), `GET / (client ${req.ip})`);
  if (HOMEPAGE_EXISTS) {
    console.log(PRE, '.. sending home.html');
    res.sendFile(path.join(__dirname, 'home.html'));
  } else {
    console.log(PRE, '.. no home.html, sending default');
    res.set('Content-Type', 'text/html');
    let response = logoHtml;
    response += `<p>Please contact Professor Kalani Craig, Institute for Digital Arts & Humanities at (812) 856-5721 (BH) or craigkl@indiana.edu with questions or concerns and/or to request information contained on this website in an accessible format.</p>`;
    res.send(response);
  }
});

/// EXPRESS STATIC FILE ROUTES /////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** Route Everything else to :3000
 *  :3000 is a "BASE" app that is actually a full NetCreate app
 *  but it does nothing but serve static files.
 *
 *  This is necessary to catch static page requests that do not have
 *  parameters, such as imports, requires, .js, .css, etc.
 *
 *  This HAS to be the last route!
 */
app.use(
  '/',
  createProxyMiddleware({
    target: `http://localhost:3000`,
    ws: true,
    changeOrigin: true
  })
);

/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** REQUEST PARAMETERS REFERENCE
 *
    console.log(`\n\nREQUEST: ${req.originalUrl}`)
    console.log("...pathname", pathname);               // `/hawaii/`
    console.log("...req.path", req.path);               // '/'
    console.log("...req.baseUrl", req.baseUrl);         // '/hawaii'
    console.log("...req.originalUrl", req.originalUrl); // '/hawaii/'
    console.log("...req.params", req.params);           // '{}'
    console.log("...req.query", req.query);             // '{}'
    console.log("...req.route", req.route);             // undefined
    console.log("...req.hostname", req.hostname);       // 'sub.localhost'
    console.log("...req.subdomains", req.subdomains);   // []
**/

/// EXPRESS START LISTENING ///////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
app.listen(PORT_ROUTER, () => {
  SERVER_IP = m_GetServerIp();
  console.log(PRE, $T());
  console.log(PRE, `NC-MULTIPLEX Express Server running on ${SERVER_IP} port ${PORT_ROUTER}.`);

  // if .nc-process-state.json exists, read and parse it
  if (!fs.existsSync('.nc-process-state.json')) {
    console.log(PRE, 'No .nc-process-state.json found. Starting fresh.');
    SpawnApp('base');
    SaveProcessState();
  } else {
    try {
      const text = fs.readFileSync('.nc-process-state.json', 'utf8');
      const json = JSON.parse(text);
      const { child_processes, proxy_pool } = json;
      if (child_processes.length > 0) {
        LoadProcessState(child_processes, proxy_pool);
      } else {
        SpawnApp('base');
        SaveProcessState();
      }
    } catch (err) {
      console.log(PRE, $T(), 'error loading .nc-process-state.json', err);
      console.log(
        PRE,
        $T(),
        'check contents of file, delete file, and restart manually'
      );
      process.exit(1);
    }
  }
});

/// PROCESS SIGNAL HANDLERS ///////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
process.on('SIGINT', () => {
  console.log(PRE, '*** SIGINT RECEIVED - EXITING ***');
  console.log(PRE);
  console.log(PRE, 'nc-multiplex stopped via SIGINT:', $T());
  process.exit(0);
});
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
process.on('SIGTERM', () => {
  console.log(PRE, '*** SIGTERM RECEIVED - EXITING ***');
  console.log(PRE);
  console.log(PRE, 'nc-multiplex stopped via SIGTERM:', $T());
  process.exit(0);
});
