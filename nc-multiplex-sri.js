/*///////////////////////////////// ABOUT \\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\*\

  NETCREATE MULTIPLEX SERVER - REMIX (2024)
  Reformatted for debugging by Sri, so new bugs are mine :-)

  --- original comments ---

  To start a new graph:
    http://localhost/graph/tacitus/

    If the graph already exists, it will be loaded. Otherwise it will create a new graph.
    You need to be logged into the manager for this to work.

  Manager runs on `http://localhost:80`

  proxied routes
    /                            => localhost:80 Root: NetCreate Manager page
    /graph/<dbname>/#/edit/uid   => localhost:3x00/#/edit/uid
    /*.[js,css,html]             => localhost:3000/net-lib.js

  flags

    node nc-multiplex.js --IP=192.168.1.40
    node nc-multiplex.js --GOOGLEA=xxxxx

\*\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\ * /////////////////////////////////////*/

const { createProxyMiddleware } = require('http-proxy-middleware');
const { fork, exec, execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
// session-related imports from netcreate subrepo
const { NC_SERVER_PATH, NC_URL_CONFIG } = require('./nc-launch-config');
const SESSION = require(`${NC_SERVER_PATH}/app/unisys/common-session.js`);
//
const NCUTILS = require('./modules/nc-utils.js');
const NCLOG = require('./modules/nc-logging-utils');

/// CONSTANTS & DECLARATIONS //////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
PRE = 'NC_MUX   -'; // console.log prefix, match length of netcreate output
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
const PORT_ROUTER = 80;
const PORT_APP = 3000; // base port for nc apps
const PORT_WS = 4000; // base port for websockets
const DEFAULT_PASSWORD = 'kpop'; // override with SESAME file
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
const PROCESS_MAX = 30; // Set this to limit the number of running processes
const MEMORY_MIN = 256; // MB. Each node process is generally ~30 MB.
const AUTO_NEW = false; // Set to true to allow auto-spawning a new database via url.
const AUTH_MINUTES = 2; // Minutes. Number of minutes to authorize login cookie
const HEARTBEAT = 15; // Minutes. Number of minutes between memory log heartbeats
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/// detected node version
let NVMRC;
/// command line flags
const argv = require('minimist')(process.argv.slice(2));
const GOOGLEA = argv['googlea'];
const IP = argv['ip'];
const m_proxy_pool = []; // array of available port indices, usu [1...100]
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
let HOMEPAGE_EXISTS; // Flag for existence of home.html override
let PASSWORD; // Either default password or password in `SESAME` file
let PASSWORD_HASH; // Hash generated from password
let m_child_processes = []; // array of forked process + meta info = { db, port, netport, portindex, process };
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
const CYN = '\x1b[96m'; // cyan
const CYNR = '\x1b[46m'; // reversed cyan
const RST = '\x1b[0m'; // reset
const RED = '\x1b[91m'; // red

/// SRI HACK IN TIMESTAMP /////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
const { strDateStamp, strTimeStamp } = NCLOG;
const $T = () => `${strDateStamp()} ${strTimeStamp()}`; // return timestamp string

/// HELPER METHODS ////////////////////////////////////////////////////////////
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
  const sysTotal = _fmt(Math.trunc(os.totalmem() / kb2mb));
  const sysFree = _fmt(Math.trunc(os.freemem() / kb2mb));

  const pids = m_GetInstancePIDs();
  return {
    unit,
    heapUsed: huse,
    heapTotal: htot,
    heapPercent: hpct,
    heapBuffer: hrem,
    pids,
    sysTotalMB: sysTotal,
    sysFreeMB: sysFree
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
/** get the output of ps matching nc-launch-instance.js entries */
function m_GetInstancePIDs() {
  const stdout = execSync('ps -e -o pid -o command | grep nc-launch-instance.js');
  const regex = /(\d+).+\/versions\/node\/(.+)/;
  const lines = stdout.toString().split('\n');
  let out = '';
  lines.forEach(line => {
    if (line.includes('/bin/node ./nc-launch-instance.js')) {
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
  console.log(PRE, $T(), 'error response:', msg);
  res.set('Content-Type', 'text/html');
  res.send(
    `<p>${msg}</p>
    <p><a href="/manage">Back to Multiplex Manager</a></p>`
  );
}

/// SESSION OPERATIONS ////////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** Generates a list of tokens using the NetCreate common-session module
 *  REVIEW: Requiring a module from the secondary netcreate-2018 repo
 *  is a little iffy.
 *  @param {string} clsId - classId
 *  @param {string} projId - projectId
 *  @param {string} dataset - database name
 *  @param {integer} numGroups - number of tokens to generate
 *  @return {string}
 */
function MakeToken(clsId, projId, dataset, numGroups) {
  // from nc-logic.js
  if (typeof clsId !== 'string')
    return 'args: str classId, str projId, str dataset, int numGroups';
  if (typeof projId !== 'string')
    return 'args: str classId, str projId, str dataset, int numGroups';
  if (typeof dataset !== 'string')
    return 'args: str classId, str projId, str dataset, int numGroups';
  if (clsId.length > 12) return 'classId arg1 should be 12 chars or less';
  if (projId.length > 12) return 'classId arg1 should be 12 chars or less';
  if (!Number.isInteger(numGroups)) return 'numGroups arg3 must be integer';
  if (numGroups < 1) return 'numGroups arg3 must be positive integer';

  let out = `TOKEN LIST for class '${clsId}' project '${projId}' dataset '${dataset}'\n\n`;
  let pad = String(numGroups).length;
  for (let i = 1; i <= numGroups; i++) {
    let id = String(i);
    id = id.padStart(pad, '0');
    out += `group ${id}\t${SESSION.MakeToken(clsId, projId, i, dataset)}\n`;
  }
  return out;
}
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
/** The proxy server runs on port 80, hosting various management routes as well
 *  as the /graph/<db>/ proxying
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
    setInterval( ()=> {
      if (!document.cookie.includes('nc-multiplex-auth')) {
        document.getElementById('login').style.display = 'block';
        document.getElementById('graphs').style.display = 'none';
        document.getElementById('forms').style.display = 'none';
      };
    }, 3000);
  </script>`;
  response += `<div id="login" style="display: none">` + RenderLoginForm() + `</div>`;
  response += `<style>.box { background-color: #EEF; padding: 20px; margin: 0 0 20px 20px}</style>`;
  response += `<div id="graphs" style="display: flex;">`;
  response += RenderActiveGraphsList();
  response += RenderSavedGraphsList();
  response += `</div>`;
  response += `<div id="forms" style="display: flex">`;
  response += RenderNewGraphForm();
  response += RenderGenerateTokensForm();
  response += `</div>`;
  response += RenderMemoryReport();
  response += `<p>Updated: ${new Date().toLocaleTimeString()}</p >`;
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
function RenderGenerateTokensForm() {
  let response = `<div class="box">`;
  let dbnames = NCUTILS.GetDatabaseNamesArray().reduce(
    (acc, curr) => acc + "<option value='" + curr + "'>" + curr + '</option>',
    ''
  );
  response += `
    <script>
      async function MakeTokens() {
        console.log('make tokens');
        const classid = document.getElementById('classid').value;
        const projid = document.getElementById('projid').value;
        const count = document.getElementById('count').value;
        const dataset = document.getElementById('datasets').value;
        let data = await fetch('./maketoken/'+classid+'/'+projid+'/'+dataset+'/'+count);
        let result = await data.text();
        const tokenDisplay = document.getElementById('tokenDisplay');
        tokenDisplay.value = result;
      }
    </script>
    <h3>Generate Tokens</h3>
    <div>
      <p>Select a database, enter a class id, a project id, and number of tokens to generate.  Then click "Generate Tokens".</p>
      <select id="datasets">
        ${dbnames}
      </select>
      <input id="classid" placeholder="Class ID e.g. 'PER1'">
      <input id="projid" placeholder="Project ID e.g. 'ROME'">
      <input id="count" placeholder="Num of tokens e.g. '10'">
      <button onclick="MakeTokens()">Generate Tokens</button><br/><br/>
      <textarea id="tokenDisplay" rows="10" cols="80" placeholder="Tokens will appear here..." readonly></textarea>
    </div>
  `;
  response += `</div>`;
  return response;
}
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
function RenderMemoryReport() {
  const mem = m_MemoryReport();
  const { unit, heapUsed, heapTotal, heapPercent, heapBuffer, pids } = mem;
  const { sysTotalGB, sysFreeGB } = mem;

  let response = `<p>MEMORY`;
  response += ` :: Used: ${heapUsed}${unit} / ${heapTotal}${unit} (${heapPercent}%) `;
  response += ` :: Remaining: ${heapBuffer}${unit}`;
  response += ` :: LowMem: ${OutOfMemory()}</p>`;
  const psOut = m_GetInstancePIDs();
  response += `<pre>DETECTED LAUNCH INSTANCES\n${psOut}</pre>`;
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
          GOOGLEA: GOOGLEA,
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
      IP,
      GOOGLEA
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
/** Used to check if we have enough memory to start a new node process
 *  This is used to prevent node from starting too many processes.
 */
function OutOfMemory() {
  let free = os.freemem() / 1024; // mb
  return free < MEMORY_MIN;
}

/// ROUTER UTILITY FUNCTIONS //////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/** RouterGraph used by http-proxy-middleware to route to the correct port
 *  @param {Express.Request} req
 *  The router function tries to route to the correct port by:
 *  a) if process is already running, use existing port
 *  b) if the process isn't running, spawn a new process
 *     and pass the port
 *  c) if no more ports are available, redirect back to the root.
 */
async function RouterGraph(req) {
  const db = req.params.graph;
  let port;
  let path = '';

  // Authenticate to allow spawning
  let ALLOW_SPAWN = false;
  if (CookieIsValid(req)) {
    ALLOW_SPAWN = true;
  }
  // Is it already running?
  let route = m_child_processes.find(route => route.db === db);
  if (route) {
    // a) Yes. Use existing route!
    console.log(PRE, $T(), `.. proxying /graph/${route.db}:80 to :${route.port}`);
    port = route.port;
  } else if (PortPoolIsEmpty()) {
    // b) No more ports available.
    console.log(PRE, $T(), '.. No more ports.  Not spawning', db);
    path = `/error_out_of_ports`;
  } else if (OutOfMemory()) {
    // c) Not enough memory to spawn new node instance
    console.log(PRE, $T(), '.. Out of memory.  Not spawning', db);
    path = `/error_out_of_memory`;
  } else if (AUTO_NEW || ALLOW_SPAWN) {
    // c) Not defined yet, Create a new one.
    let reason = ALLOW_SPAWN ? 'spawn=true ' : 'spawn=false ';
    reason += AUTO_NEW ? 'new=true' : 'new=false';
    console.log(PRE, $T(), `.. auto spawning (${reason})`, db);
    port = await SpawnApp(db);
  } else {
    // c) Not defined or running, and not allowed to spawn
    console.log(PRE, $T(), '.. not running (AUTO_NEW and ALLOW_SPAWN false)', db);
    path = `/error_no_database?graph=${db}`;
  }
  return {
    protocol: 'http:',
    host: 'localhost',
    port: port,
    path: path // if path is empty, it will be ignored
  };
}

/// RUNTIME: START LOGGING OUTPUT /////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
console.log(`\n\n\n`);
console.log('-'.repeat(80));
console.log(PRE, 'nc-multiplex started:', $T());
console.log(PRE);

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
  PASSWORD = sesame;
} catch (err) {
  PASSWORD = DEFAULT_PASSWORD; // no password, use default
}
PASSWORD_HASH = GetHash(PASSWORD);

/// EXPRESS STARTUP ///////////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
// START BASE APP
// This is needed to handle static file requests.
// Most imports/requires do not specify the db route /graph/dbname/
// so we need to provide a base app that responds to those static file
// requests.  This starts a generic "base" dataset at port 3000.

SpawnApp('base');

// start heartbeat timer and initial memory log
m_MemLog();
setInterval(m_MemLog, HEARTBEAT * 60 * 1000); // log memory usage every X minutes

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/// EXPRESS DEBUGGING ROUTES //////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
app.get(`/crash`, (req, res) => {
  console.log(PRE, $T(), 'crash route hit');
  res.send('crashing');
  process.exit(1);
});

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
      'returning graph-specific netcreate-config.js for',
      child.db
    );
    response += NCUTILS.GetNCConfig(child);
  } else {
    console.log(PRE, $T(), 'no graph-specific netcreate-config.js found for', db);
    response += 'ERROR: No database found to netcreate-config.js: ' + db;
  }
  res.set('Content-Type', 'application/javascript');
  res.send(response);
});
/** HANDLE /graph/:graph/:file?
 *  The intention is to proxy file requests from /graph/dbname/filename
 *  to localhost:3000/filename (e.g. `netcreate-config.js` requests).
 *  If there's a missing trailing "/", the redirects to
 */
const u_mw_filter = (pathname, req) => {
  // sri debug detect if req.params is undefined
  if (req.params === undefined) {
    console.log(PRE, $T(), 'ERROR: req.params is undefined');
    const fullUrl = req.protocol + '://' + req.get('host') + req.originalUrl;
    console.log(PRE, `error on url: ${fullUrl}`);
    return false;
  }
  // only match if there is a trailing '/'
  if (req.params.file) return true; // legit file
  if (req.params.graph && req.originalUrl.endsWith('/')) return true; // legit graph
  return false;
};
app.use(
  '/graph/:graph/:file?',
  createProxyMiddleware(u_mw_filter, {
    // this is the actual proxy setup object
    router: RouterGraph,
    pathRewrite: function (path, req) {
      // remove '/graph/db/' for the rerouted calls
      // e.g. localhost/graph/hawaii/#/edit/mop => localhost:3000/#/edit/mop
      return (rewrite = path.replace(`/graph/${req.params.graph}`, ''));
    },
    target: `http://localhost:3000`, // default fallback, router takes precedence
    ws: true,
    changeOrigin: true
  })
);

/// EXPRESS ERROR ROUTES //////////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/// HANDLE NO DATABASE -- RETURN ERROR
app.get('/error_no_database', (req, res) => {
  // get the db name from the query string
  let db = '';
  if (req.query && req.query.graph) db = req.query.graph;
  if (db.endsWith('/')) db = db.slice(0, -1);
  db = `'${db}'`;
  m_SendErrorResponse(res, `Requested graph ${db} is not currently open.`);
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
  console.log(PRE, $T(), 'kill GET on /kill/:graph', req.params.graph);
  const db = req.params.graph;
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
/// HANDLE "/maketoken" -- GENERATE TOKENS
app.get('/maketoken/:clsid/:projid/:dataset/:numgroups', (req, res) => {
  const { clsid, projid, dataset, numgroups } = req.params;
  console.log(
    PRE,
    $T(),
    'maketoken GET on /maketoken',
    clsid,
    projid,
    dataset,
    numgroups
  );
  let response = MakeToken(clsid, projid, dataset, parseInt(numgroups));
  res.set('Content-Type', 'text/html');
  res.send(response);
});

/// EXPRESS MANAGEMENT ROUTES //////////////////////////////////////////////////
/// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
/*/ Authentication

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
/// HANDLE "/manage" -- MANAGER PAGE
app.get('/manage', (req, res) => {
  console.log(PRE, $T(), 'manage GET on /manage');
  if (CookieIsValid(req)) {
    res.set('Content-Type', 'text/html');
    res.send(RenderManager());
  } else {
    res.redirect(`/login`);
  }
});
/// 2. redirected from /manage
app.get('/login', (req, res) => {
  console.log(PRE, $T(), 'login GET on /login');
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
  console.log(PRE, $T(), 'authorization POST on /authorize');
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
  console.log(PRE, $T(), 'home page GET on /');
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
  createProxyMiddleware('/', {
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
  console.log(PRE, $T());
  console.log(PRE, `NC-MULTIPLEX Express Server running on port ${PORT_ROUTER}.`);
});
