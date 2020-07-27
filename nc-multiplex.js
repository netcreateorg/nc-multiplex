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
 
*/

///////////////////////////////////////////////////////////////////////////////
//
//  CONSTANTS

const { createProxyMiddleware } = require("http-proxy-middleware");
const { fork } = require("child_process");
const fs = require("fs");
const path = require("path");
const express = require("express");
const app = express();

const DBUTILS = require("./modules/db-utils.js");

const PORT_ROUTER = 80;
const PORT_APP = 3000; // base port for nc apps
const PORT_WS = 4000; // base port for websockets

let childProcesses = []; // array of forked process + meta info = { db, port, netport, portindex, process };

const PRE = '...nc-multiplex: ';


// OPTIONS
const PROCESS_MAX = 100; // Set this to limit the number of running processes
                         // in order to keep a rein on CPU and MEM loads
                         // If you set this higher than 100 you should make
                         // sure you open inbound ports higher than 3100 and 4100

const MEMORY_MIN = 256;  // in MegaBytes
                         // Don't start a new process if there is less than
                         // MEMORY_MIN memory remaining.  
                         // * Each node process is generally ~30 MB.
                         // * Servers would hant with less than 100 MB remaining.


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
// CHECK HOME PAGE OVERRIDE
//
// If there's a 'home.html' file, serve that at '/'.
// 
let HOMEPAGE_EXISTS = false;
fs.access("home.html", fs.constants.R_OK, (err) => {
  if (!err) HOMEPAGE_EXISTS = true;
});



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

/**
 * Returns a list of databases in the runtime folder
 * formatted as HTML <LI>s, with a link to open each graph.
 */
function RenderDatabaseList() {
  let response = "<ul>";
  let dbs = DBUTILS.GetDatabaseNamesArray();
  dbs.forEach((db) => {
    // Don't list dbs that are already open
    if (!DBIsRunning(db))
      response += `<li><a href="/graph/${db}/">${db}</a></li>`;
  });
  response += `</ul>`;
  return response;
}

function RenderActiveGraphsList() {
  let response = `<div>`;
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
  response += `<p>"Stop" active graphs if you're not using them anymore.<br/>(Closing the window does not stop the graph.)</p>`;
  response += `</div>`;
  return response;  
}

function RenderSavedGraphsList() {
  let response = `<div>`;
  response += `<h3>Saved Graphs</h3>`;
  response += `<p>Graph/database files saved on server.  Click to open.</p>`;
  response += RenderDatabaseList();
  response += `</div>`;
  return response;
}

function RenderNewGraphForm() {
  return `
    <div>
      <h3>New Graph</h3>
      <input placeholder="Enter new graph name"> <button>Create New Database</button>  
    </div>`;
}

function RenderGenerateTokensForm() {
  let response = `<div>`;
  let dbnames = childProcesses.reduce(
    (acc, curr) =>
      acc + "<option value='" + curr.db + "'>" + curr.db + "</option>",
    ""
  );
  dbnames += DBUTILS.GetDatabaseNamesArray().reduce(
    (acc, curr) => acc + "<option value='" + curr + "'>" + curr + "</option>",
    ""
  );
  let response = `
<script>
  function makeTokens() {
    console.log('make tokens')
  }
</script>
<h3>Generate Tokens</h3>
<div>
  <select>
    ${items}
  </select>
  <input id="classid" placeholder="Class ID e.g. 'PER1'"> 
  <input id="projid" placeholder="Project ID e.g. 'ROME'"> 
  <input id="count" value="10">
  <button onclick="makeTokens()">Generate Tokens</button><br/>
  <textarea rows="10"></textarea>
  <p>Enter 1) a class id, 2) a project id, and 3) number of tokens to generate.  Then click "Generate Tokens".</p>
</div>
  `;
                                    
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
  } else {
    // c) Not defined yet, Create a new one.
    console.log(PRE + "--> not running yet, starting new", db);
    port = await SpawnApp(db);
  }
  return {
    protocol: "http:",
    host: "localhost",
    port: port,
  };
}


// ----------------------------------------------------------------------------
// ROUTES

// HANDLE `/graph/:graph/:file?
//
// If there's a missing trailing "/", the URL is malformed 
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

// HANDLE OUT OF PORTS -- RETURN ERROR
app.get('/error_out_of_ports', (req, res) => {
  console.log(PRE + '================== Handling ERROR OUT OF PORTS!')
  res.set("Content-Type", "text/html");
  res.send(
    `<p>Ran out of ports.  Can't start the graph.</p>
    <p><a href="/">Back to Multiplex</a></p>`
  );
});


// HANDLE OUT OF MEMORY -- RETURN ERROR
app.get('/error_out_of_memory', (req, res) => {
  console.log(PRE + '================== Handling ERROR OUT OF MEMORY!')
  res.set("Content-Type", "text/html");
  res.send(
    `<p>Ran out of Memory.  Can't start the graph.</p>
    <p><a href="/">Back to Multiplex</a></p>`
  );
});


// HANDLE MISSING TRAILING ".../" -- RETURN ERROR
app.get('/graph/:file', (req, res) => {
  console.log(PRE + '================== Handling BAD URL!')
  res.set("Content-Type", "text/html");
  res.send(
    `Bad URL. Missing trailing "/".
    Perhaps you meant <a href="${req.originalUrl}/">${req.originalUrl}/</a>`
  );
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


  
  
  
// -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -
// MANAGE


// HANDLE "/manage" -- MANAGER PAGE
app.get('/manage', (req, res) => {
  console.log(PRE + "================== Handling / MANAGE!");

  res.set("Content-Type", "text/html");
  let response = `<h1><img src="/images/netcreate-logo.svg" alt="NetCreate Logo" width="100px"> Multiplex</h1>`;
  
  response += `<div style="display: flex">`
  response += RenderActiveGraphsList();
  response += RenderSavedGraphsList();
  response += `</div><hr>`;
  response += `<div style="display: flex">`;
  response += RenderNewGraphForm() + `<hr>`; 
  response += RenderGenerateTokensForm();
  response += `</div><hr>`;
  response += RenderMemoryReport();
  response += `<p>Updated: ${new Date().toLocaleTimeString()}</p >`;

  res.send(response);
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
    let response = `<h1><img src="/images/netcreate-logo.svg" alt="NetCreate Logo" width="100px"> Multiplex</h1>`;
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
