/*

  nc-multiplex.js
 
      This creates a node-based proxy server that will
      spin up individual NetCreate graph instances
      running on their own node processes.
    
      To start this manually:
        `node nc-multiplex.js`
    
      Or use `npm run start`
    
      Then go to `localhost` to view the manager.
      (NOTE: This runs on port 80, so need to add a port)
    
      The manager will list the running databases.
    
      To start a new graph:
        `http://localhost/graph/tacitus/`
    
      If the graph already exists, it will be loaded.
      Otherwise it will create a new graph.
    
      Refresh the manager to view running databases.
  
 
  # Setting IP or Google Analytics code
  
      Use the optional `--ip` or `--googlea` parameters if you need 
      to start the server with a specific IP address or google
      analytics code. e.g.: 
      
        `node nc-multiplex.js --ip=192.168.1.40`
        `node nc-multiplex.js --googlea=xxxxx`
      
      
  # Route Scheme
  
      /                            => localhost:80 Root: NetCreate Manager page
      /graph/<dbname>/#/edit/uid   => localhost:3x00/#/edit/uid
      /*.[js,css,html]             => localhost:3000/net-lib.js


  # Port scheme
 
      The proxy server runs on port 80.
      Defined in `port_router`
    
      Base application port is 3000
      Base websocket port is 4000
      
      When the app is started, we initialize a pool of ports
      indices basedon the PROCESS_MAX value.  
      
      When a process is spawned, we grab from the pool of port
      indices, then generate new port numbers based on the 
      index, where the app port and the websocket (net) port share
      the same basic index, e.g. 
      
      { 
        index: 2,
        appport: 3002,
        netport: 4002
      }
      
      When the process is killed, the port index is returned
      to the pool and re-used.
 
 
  # netcreate-config.js / NC_CONFIG
  
      NC_CONFIG is actually used by both the server-side scripts and
      client-side scripts to set the active database, ip, ports,
      netports, and google analytics code.
      
      As such, it is generated twice:
      1. server-side: nc-start.js will generate a local file version into /build/app/assets
         where it is used by brunch-server.js, brunch-config.js, and server-database.js 
         during the app start process.
      2. client-side: nc-multiplex.js will then dynamically generate netcreate-config.js
         for each graph's http request.
         
      REVIEW: There is a potential conflict server-side if two graphs
      are started up at the same time and the newly generated netcreate-config.js
      files cross each other.
      
      REVIEW: The dynamically generated client-side version should probably be cached.
      
*/

///////////////////////////////////////////////////////////////////////////////
//
//  CONSTANTS

const { createProxyMiddleware } = require("http-proxy-middleware");
const { fork } = require("child_process");
const fs = require("fs");
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const NCUTILS = require("./modules/nc-utils.js");

const PORT_ROUTER = 80;
const PORT_APP = 3000; // base port for nc apps
const PORT_WS = 4000; // base port for websockets

let childProcesses = []; // array of forked process + meta info = { db, port, netport, portindex, process };

const PRE = '...nc-multiplex: ';

// SETTINGS
let HOMEPAGE_EXISTS; // Flag for existence of home.html override
let PASSWORD; // Either default password or password in `SESAME` file
let PASSWORD_HASH; // Hash generated from password

// OPTIONS
const PROCESS_MAX = 30;  // Set this to limit the number of running processes
                         // in order to keep a rein on CPU and MEM loads
                         // If you set this higher than 100 you should make
                         // sure you open inbound ports higher than 3100 and 4100

const MEMORY_MIN = 256;  // in MegaBytes
                         // Don't start a new process if there is less than
                         // MEMORY_MIN memory remaining.  
                         // * Each node process is generally ~30 MB.
                         // * Servers would hant with less than 100 MB remaining.

const ALLOW_NEW = false; // default = false
                         // set to true to allow auto-spawning a new database via
                         // url.  e.g. going to `http://localhost/graph/newdb/` 
                         // would automatically create a new database if it
                         // didn't already exist

const DEFAULT_PASSWORD = 'kpop'; // override with SESAME file

// FIXME: Set to 1 min for testing
const AUTH_MINUTES = 1; // default = 30
                         // Number of minutes to authorize login cookie
                         // After AUTH_MINUTES, the user wil have to re-login.


// ----------------------------------------------------------------------------
// READ OPTIONAL ARGUMENTS
//
// To set ip address or google analytics code, call nc-multiplex with
// arguments, e.g.
//
//   `node nc-multiplex.js --ip=192.168.1.40`
//   `node nc-multiplex.js --googlea=xxxxx`
//

const argv = require("minimist")(process.argv.slice(2));
const googlea = argv["googlea"];
const ip = argv["ip"];


// ----------------------------------------------------------------------------
// SET HOME PAGE OVERRIDE
//
// If there's a 'home.html' file, serve that at '/'.
// 
try {
  fs.accessSync("home.html", fs.constants.R_OK, (err) => {
    if (!err) HOMEPAGE_EXISTS = true;
  });
} catch (err) {
  // no home page, use default
  HOMEPAGE_EXISTS = false;
}



// ----------------------------------------------------------------------------
// SET PASSWORD
//
// If there's a 'SESAME' file, use the password in there.
// Otherwise, fallback to default.
//
try {
  let sesame = fs.readFileSync("SESAME", "utf8");
  PASSWORD = sesame;
} catch (err) {
  // no password, use default
  PASSWORD = DEFAULT_PASSWORD;
}
// Make Hash
PASSWORD_HASH = GetHash(PASSWORD);


///////////////////////////////////////////////////////////////////////////////
//
//  UTILITIES

/**
 * Number formatter
 * From stackoverflow.com/questions/2901102/how-to-print-a-number-with-commas-as-thousands-separators-in-javascript
 * @param {integer} x 
 * @return {string} Number formatted with commas, e.g. 123,456
 */
function numberWithCommas(x) {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Returns true if the db is currently running as a process
 * @param {string} db
 */
function DBIsRunning(db) {
  return childProcesses.find((route) => route.db === db);
}

/**
 * Generates a list of tokens using the NetCreate commoon-session module
 * REVIEW: Requiring a module from the secondary netcreate-2018 repo
 * is a little iffy.
 * @param {string} clsId 
 * @param {string} projId 
 * @param {string} dataset 
 * @param {integer} numGroups 
 * @return {string}
 */
function MakeToken(clsId, projId, dataset, numGroups) {
  const SESSION = require("./netcreate-2018/build/app/unisys/common-session.js");
  // from nc-logic.js
  if (typeof clsId !== "string")
    return "args: str classId, str projId, str dataset, int numGroups";
  if (typeof projId !== "string")
    return "args: str classId, str projId, str dataset, int numGroups";
  if (typeof dataset !== "string")
    return "args: str classId, str projId, str dataset, int numGroups";
  if (clsId.length > 12) return "classId arg1 should be 12 chars or less";
  if (projId.length > 12) return "classId arg1 should be 12 chars or less";
  if (!Number.isInteger(numGroups)) return "numGroups arg3 must be integer";
  if (numGroups < 1) return "numGroups arg3 must be positive integer";

  let out = `TOKEN LIST for class '${clsId}' project '${projId}' dataset '${dataset}'\n\n`;
  let pad = String(numGroups).length;
  for (let i = 1; i <= numGroups; i++) {
    let id = String(i);
    id = id.padStart(pad, "0");
    out += `group ${id}\t${SESSION.MakeToken(clsId, projId, i, dataset)}\n`;
  }
  return out;
}

/**
 * Used to generate a hashed password for use in the cookie
 * so that password text is not visible in the cookie.
 * @param {string} pw 
 */
function GetHash(pw) {
  let hash = crypto.createHash('sha1').update(pw).digest('hex');
  return hash;
}

/**
 * HASH is generated from the PASSWORD
 * @param {string} pw 
 */
function CookieIsValid(req) {
  // check against hash
  let pw = req.cookies["nc-multiplex-auth"];
  return pw === PASSWORD_HASH;
}



///// PORT POOL ---------------------------------------------------------------

// Initialize port pool
//    port 0 is for the base app
const port_pool = []; // array of available port indices, usu [1...100]
for (let i = 0; i <= PROCESS_MAX; i++ ) {
  port_pool.push(i);
}
/**
 * Gets the next available port from the pool.
 * 
 * @param {integer} index of route
 * @return {object} JSON object definition, e.g.
 * {
 *   index: integer    // e.g. 3
 *   appport: integer  // e.g. 3003
 *   netport: integer  // e.g. 4003
 * }
 * or `undefined` if no items are left in the pool
 */
function PickPort() {
  if (port_pool.length < 1) return undefined;
  const index = port_pool.shift();
  const result = {
    index,
    appport: PORT_APP + index,
    netport: PORT_WS + index
  };
  return result;
}
/**
 * 
 * @param {integer} index -- Port index to return to the pool
 */
function ReleasePort(index) {
  if (port_pool.find((port) => port === index))
    throw "ERROR: Port already in pool! This should not happen! " + index; 
  port_pool.push(index);
}
/**
 * Returns true if there are no more port indices left in the pool
 * Used by /graph/<db>/ route to check if it should spawn a new app
 */
function PortPoolIsEmpty() {
  return port_pool.length < 1;
}




///////////////////////////////////////////////////////////////////////////////
//
//  RENDERERS

const logoHtml = '<h1><img src="/images/netcreate-logo.svg" alt="NetCreate Logo" width="100px"> Multiplex</h1>';

function RenderLoginForm() {
  return `
      <form action="/authorize" method="post">
        <label>Password: <input name="password" type="password" autofocus/></label>
        <input type="submit" />
      </form>
`;
}
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
  response += `<style>.box { background-color: #EEF; padding: 20px; margin: 0 0 20px 20px}</style>`
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

/**
 * Returns a list of databases in the runtime folder
 * formatted as HTML <LI>s, with a link to open each graph.
 */
function RenderDatabaseList() {
  let response = "<ul>";
  let dbs = NCUTILS.GetDatabaseNamesArray();
  dbs.forEach((db) => {
    // Don't list dbs that are already open
    if (!DBIsRunning(db))
      response += `<li><a href="/graph/${db}/">${db}</a></li>`;
  });
  response += `</ul>`;
  return response;
}

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
  childProcesses.forEach((route, index) => {
    let kill = `<a href="/kill/${route.db}/">stop</a>`;
    if (index < 1) kill = ""; // Don't allow BASE to be killed.
    response += `
      <tr>
        <td><a href="/graph/${route.db}/" target="${route.db}">${route.db}</a></td>
        <td>${route.port}</td><td>${route.netport}</td><td>${kill}<td>
      </tr>`;
  });
  response += `</tbody></table>`;
  response += `<p>Number of Active Graphs: ${childProcesses.length - 1} / ${PROCESS_MAX} (max)`;
  response += `<p>Reload browser to refresh Active Graphs.</p>`;
  response += `<p>"Stop" active graphs if you're not using them anymore.<br/>(Closing the window does not stop the graph.)</p>`;
  response += `</div>`;
  return response;  
}

function RenderSavedGraphsList() {
  let response = `<div class="box">`;
  response += `<h3>Saved Graphs</h3>`;
  response += `<p>Graph/database files saved on server.  Click to open.</p>`;
  response += RenderDatabaseList();
  response += `</div>`;
  return response;
}

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

function RenderGenerateTokensForm() {
  let response = `<div class="box">`;
  let dbnames = childProcesses.reduce(
    (acc, curr) =>
      acc + "<option value='" + curr.db + "'>" + curr.db + "</option>",
    ""
  );
  dbnames += NCUTILS.GetDatabaseNamesArray().reduce(
    (acc, curr) => acc + "<option value='" + curr + "'>" + curr + "</option>",
    ""
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

function RenderMemoryReport() {
  const mem = process.memoryUsage();
  let response = `<p>MEMORY :: Used: 
    ${numberWithCommas(Math.trunc(mem.heapUsed / 1024))}mb / 
    ${numberWithCommas(mem.heapTotal / 1024)}mb 
    (${(mem.heapUsed / mem.heapTotal).toFixed(2)}%) `;
  response += ` :: Remaining: ${numberWithCommas( Math.trunc((mem.heapTotal-mem.heapUsed)/1024) )}mb`;
  response += ` :: Out of memory: ${OutOfMemory()}</p>`;
  return response;  
}


///////////////////////////////////////////////////////////////////////////////
//
//  PROCESS MANAGERS

/**
 * Use this to spawn a new node instance
 * Calls PromiseApp.
 * 
 * @param {string} db 
 * @return {integer} port to be used by router function
 *         in app.use(`/graph/:graph/:file`...).
 */
async function SpawnApp(db) {
  try {
    const newProcessDef = await PromiseApp(db);
    AddChildProcess(newProcessDef);
    return newProcessDef.port;
  } catch (err) {
    console.error(PRE + "SpawnApp Failed with error", err);
  }
}

/**
 * Promises a new node NetCreate application process
 * 
 * In general, don't call this directly.  Use SpawnApp.
 * 
 * This starts `nc-start.js` via a fork.
 * `nc-start.js` will generate the `netcreate-config.js` 
 * configuration file, and then start the brunch server.
 * 
 * When `nc-start.js` has completed, it sends a message back
 * via fork messaging, at which point this promise is resolved
 * and then we redirect the user to the new port.
 * 
 * @param {string} db 
 * @resolve {object} sends the forked process and meta info
 * 
 */
function PromiseApp(db) {
  return new Promise((resolve, reject) => {
    const ports = PickPort();
    if (ports === undefined) {
      reject(`Unable to find a free port.  ${db} not created.`);
    }

    // 1. Define the fork
    const forked = fork("./nc-start.js");
    
    // 2. Define fork success handler
    //    When the child node process is up and running, it will
    //    send a message back to this handler, which in turn
    //    sends the new spec back to SpawnApp
    forked.on("message", (msg) => {
      console.log(PRE + "Received message from spawned fork:", msg);
      console.log(PRE);
      console.log(PRE + `${db} STARTED!`);
      console.log(PRE);
      const newProcessDef = {
        db,
        port: ports.appport,
        netport: ports.netport,
        portindex: ports.index,
        googlea: googlea,
        process: forked
      };
      resolve(newProcessDef); // pass to SpawnApp
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
      ip,
      googlea
    };
    forked.send(ncStartParams);
  });
}

/**
 * Add the newProcess to the array of childProcesses
 * but only if it doesn't already exist
 * @param {object} route 
 */
function AddChildProcess(newProcess) {
  if (childProcesses.find(route => route.db === newProcess.db)) return;
  childProcesses.push(newProcess);
}


/**
 * Used to check if we have enough memory to start a new node process
 * This is used to prevent node from starting too many processes.
 */
function OutOfMemory() {
  let mem = process.memoryUsage();
  return mem.heapTotal / 1024 - mem.heapUsed / 1024 < MEMORY_MIN;
}




///////////////////////////////////////////////////////////////////////////////
//
//  HTTP-PROXY-MIDDLEWARE ROUTING
//

// ----------------------------------------------------------------------------
// INIT
console.log(`\n\n\n`);
console.log(PRE);
console.log(PRE + "STARTED!");
console.log(PRE);


// START BASE APP
// This is needed to handle static file requests.
// Most imports/requires do not specify the db route /graph/dbname/
// so we need to provide a base app that responds to those static file
// requests.  This starts a generic "base" dataset at port 3000.
SpawnApp('base');

// ----------------------------------------------------------------------------
// ROUTE FUNCTIONS

/**
 * RouterGraph
 * @param {object} req 
 * 
 * The router function tries to route to the correct port by:
 * a) if process is already running, use existing port
 * b) if the process isn't running, spawn a new process
 *    and pass the port
 * c) if no more ports are available, redirect back to the root.
 * 
 */
async function RouterGraph (req) {
  const db = req.params.graph;
  let port;
  
  // Authenticate to allow spawning
  let ALLOW_SPAWN = false;
  if (CookieIsValid(req)) {
    ALLOW_SPAWN = true;
  }
  
  // Is it already running?
  let route = childProcesses.find(route => route.db === db);
  if (route) {
    // a) Yes. Use existing route!
    console.log(PRE + '--> mapping to ', route.db, route.port);
    port = route.port;
  } else if (PortPoolIsEmpty()) {
    console.log(PRE + "--> No more ports.  Not spawning", db);
    // b) No more ports available.  
    return `http://localhost:${PORT_ROUTER}/error_out_of_ports`;
  } else if (OutOfMemory()) {
    // c) Not enough memory to spawn new node instance
    return `http://localhost:${PORT_ROUTER}/error_out_of_memory`;
  } else if (ALLOW_NEW || ALLOW_SPAWN) {
    // c) Not defined yet, Create a new one.
    console.log(PRE + "--> not running yet, starting new", db);
    port = await SpawnApp(db);
  } else {
    // c) Not defined yet.  Report error.
    return `http://localhost:${PORT_ROUTER}/error_no_database`;
  }
  return {
    protocol: "http:",
    host: "localhost",
    port: port,
  };
}


// ----------------------------------------------------------------------------
// ROUTES


// HANDLE `/graph/:graph/netcreate-config.js`
// 
// The config file needs to be dynamically served for each node instance,
// otherwise they would share (and clobber) the same static file.
//
// This has to go before `/graph/:graph/:file?` or it won't get triggered
//
app.get('/graph/:graph/netcreate-config.js', (req, res) => {
  const db = req.params.graph;
  let response = '';
  console.log('############ returning netcreate-config.js for', db);
  const child = childProcesses.find((child) => child.db === db);
  if (child) {
    response += NCUTILS.GetNCConfig(child);
  } else {
    response += "ERROR: No database found to netcreate-config.js: " + db;
  }
  res.set("Content-Type", "application/javascript");
  res.send(response);
});

// HANDLE `/graph/:graph/:file?`
//
// * `:file` is optional.  It catches db-specific file requests, 
//   for example, the`netcreate-config.js` request.
// * If there's a missing trailing "/", the URL is malformed 
//
app.use(
  '/graph/:graph/:file?',
  createProxyMiddleware(
    (pathname, req) => {
      // only match if there is a trailing '/'
      if (req.params.file) return true; // legit file
      if (req.params.graph && req.originalUrl.endsWith("/")) return true; // legit graph
      return false;
    },
    {
      router: RouterGraph,
      pathRewrite: function (path, req) {
        // remove '/graph/db/' for the rerouted calls
        // e.g. localhost/graph/hawaii/#/edit/mop => localhost:3000/#/edit/mop
        return rewrite = path.replace(`/graph/${req.params.graph}`, '');
      },
      target: `http://localhost:3000`, // default fallback, router takes precedence
      ws: true,
      changeOrigin: true,
    }
  )
);


// -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -
// ERROR HANDLERS

function SendErrorResponse(res, msg) {
  res.set("Content-Type", "text/html");
  res.send(
    `<p>${msg}</p>
    <p><a href="/">Back to Multiplex</a></p>`
  );  
}

// HANDLE NO DATABASE -- RETURN ERROR
app.get('/error_no_database', (req, res) => {
  console.log(PRE + '================== Handling ERROR NO DATABASE!')
  SendErrorResponse(res, 'This graph is not currently open.')
});

// HANDLE NOT AUTHORIZED -- RETURN ERROR
app.get('/error_not_authorized', (req, res) => {
  console.log(PRE + "================== Handling ERROR NOT AUTHORIZED!");
  SendErrorResponse(res, "Not Authorized.");
});

// HANDLE OUT OF PORTS -- RETURN ERROR
app.get('/error_out_of_ports', (req, res) => {
  console.log(PRE + '================== Handling ERROR OUT OF PORTS!')
  SendErrorResponse(res, "Ran out of ports.  Can't start the graph.");
});

// HANDLE OUT OF MEMORY -- RETURN ERROR
app.get('/error_out_of_memory', (req, res) => {
  console.log(PRE + '================== Handling ERROR OUT OF MEMORY!')
  SendErrorResponse(res, "Ran out of Memory.  Can't start the graph.");
});

// HANDLE MISSING TRAILING ".../" -- RETURN ERROR
app.get('/graph/:file', (req, res) => {
  console.log(PRE + '================== Handling BAD URL!')
  SendErrorResponse(res, "Bad URL. Missing trailing '/'.");
});


// -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -
// UTILITIES

// HANDLE "/kill/:graph" -- KILL REQUEST
app.get('/kill/:graph/', (req, res) => {
  console.log(PRE + "================== Handling / KILL!");
  const db = req.params.graph;
  res.set("Content-Type", "text/html");
  let response = `<h1>NetCreate Manager</h1>`;
  const child = childProcesses.find(child => child.db === db);
  if (child) {
    try {
      child.process.kill();
      // Return the port index to the pool
      ReleasePort(child.portindex);
      // Remove child from childProcesses
      childProcesses = childProcesses.filter(child => child.db !== db);
      response += `<p>Process ${db} killed.`;
    } catch (e) {
      response += `<p>ERROR while trying to kill ${db}</p>`;
      response += `<p>${e}</p>`;
    }
  } else {
    response += "ERROR: No database found to kill: " + db;
  }
  response += `<p><a href="/">Back to Multiplex</a></p>`;  
  
  res.send(response);
});



// HANDLE "/maketoken" -- GENERATE TOKENS
app.get('/maketoken/:clsid/:projid/:dataset/:numgroups', (req, res) => {
  console.log(PRE + "================== Handling / MAKE TOKEN!");
  const { clsid, projid, dataset, numgroups } = req.params;
  let response = MakeToken(clsid, projid, dataset, parseInt(numgroups));
  res.set("Content-Type", "text/html");
  res.send(response);
});
  
  
  
// -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -
// MANAGE
//
// Authentication
//
// Authentication uses a cookie with a hashed password.
// The cookie expires after AUTH_MINUTES
//
// 1. /manage initially redirects to /login
// 2. On the /login form, the administrator enters a password
// 3. /login POSTS to /authorize
// 4. /authorize checks the password against the PASSWORD
//    If there's no match, the user is redirected to /error_not_authorized
// 5. /authorize then sets a cookie with the PASSWORD_HASH and
//    the user is redirected to /manage
// 6. /manage checks the cookie against the PASSWORD_HASH
//    If the cookie matches, the manage page is displayed
//    If the cookie doesn't match, the user is redirected back to /login
// 7. The cookie expires after AUTH_MINUTES
//

// HANDLE "/manage" -- MANAGER PAGE
app.get('/manage', (req, res) => {
  console.log(PRE + "================== Handling / MANAGE!");
  if (CookieIsValid(req) ) {
    res.set("Content-Type", "text/html");
    res.send( RenderManager() );
  } else {
    res.redirect(`http://localhost:${PORT_ROUTER}/login`);
  }
});

app.get('/login', (req, res) => {
  console.log(PRE + "================== Handling / LOGIN!");
  if (CookieIsValid(req)) {
    // Cookie already set, no need to log in, redirect to manage
    res.redirect(`http://localhost:${PORT_ROUTER}/manage`);
  } else {
    // Show login form
    res.set("Content-Type", "text/html");
    res.send(logoHtml + RenderLoginForm());
  }
});

app.post('/authorize', (req, res) => {
  console.log(PRE + "================== Handling / AUTHORIZE!");
  let str = new String(req.body.password);
  if ( req.body.password === PASSWORD ) {
    res.cookie("nc-multiplex-auth", PASSWORD_HASH, {
      maxAge: AUTH_MINUTES * 60 * 1000,
    }); // ms
    res.redirect(`http://localhost:${PORT_ROUTER}/manage`);
  } else {
    res.redirect(`http://localhost:${PORT_ROUTER}/error_not_authorized`);
  }
});



// -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -
// HOME

// HANDLE "/" -- HOME PAGE
app.get('/', (req, res) => {
  console.log(PRE + "================== Handling / ROOT!");
  if (HOMEPAGE_EXISTS) {
    res.sendFile(path.join(__dirname, 'home.html'));
  } else {
    res.set("Content-Type", "text/html");
    let response = logoHtml;
    response += `<p>Please contact Professor Kalani Craig, Institute for Digital Arts & Humanities at (812) 856-5721 (BH) or craigkl@indiana.edu with questions or concerns and/or to request information contained on this website in an accessible format.</p>`;
    res.send(response);
  }
});


// -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -
// HANDLE STATIC FILES
//
// Route Everything else to :3000
// :3000 is a "BASE" app that is actually a full NetCreate app
// but it does nothing but serve static files.
//
// This is necessary to catch static page requests that do not have 
// parameters, such as imports, requires, .js, .css, etc.
//
// This HAS to come LAST!
// 
app.use(
  createProxyMiddleware("/", {
    target: `http://localhost:3000`,
    ws: true,
    changeOrigin: true,
  })
);


// ----------------------------------------------------------------------------

// `request` parameters reference
//
// console.log(`\n\nREQUEST: ${req.originalUrl}`)
// console.log("...pathname", pathname);               // `/hawaii/`
// console.log("...req.path", req.path);               // '/'
// console.log("...req.baseUrl", req.baseUrl);         // '/hawaii'
// console.log("...req.originalUrl", req.originalUrl); // '/hawaii/'
// console.log("...req.params", req.params);           // '{}'
// console.log("...req.query", req.query);             // '{}'
// console.log("...req.route", req.route);             // undefined
// console.log("...req.hostname", req.hostname);       // 'sub.localhost'
// console.log("...req.subdomains", req.subdomains);   // []



///////////////////////////////////////////////////////////////////////////////
//
//  START PROXY

app.listen(PORT_ROUTER, () =>
  console.log(PRE + `running on port ${PORT_ROUTER}.`)
);
