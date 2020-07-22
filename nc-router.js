/*

  nc-router.js
 
      This creates a node-based proxy server that will
      spin up individual NetCreate graph instances
      running on their own node processes.
    
      To start this manually:
        `node nc-router.js`
    
      Or use `npm run start`
    
      Then go to `localhost` to view the manager.
      (NOTE: This runs on port 80, so need to add a port)
    
      The manager will list the running databases.
    
      To start a new graph:
        `http://localhost/graph/tacitus/`
    
      If the graph already exists, it will be loaded.
      Otherwise it will create a new graph.
    
      Refresh the manager to view running databases.
  
 
  # Route Scheme
  
      /                            => localhost:80 Root: NetCreate Manager page
      /graph/<dbname>/#/edit/uid   => localhost:3x00/#/edit/uid
      /*.[js,css,html]             => localhost:3000/net-lib.js


  # Port scheme
 
      The proxy server runs on port 80.
      Defined in `port_router`
    
      Base application port is 3000
      New children start at 100
      With netports automatically set to xx29 (for websockets).
    
      e.g. first child would be:
          app port: 3100
          net port: 3129
 
*/

///////////////////////////////////////////////////////////////////////////////
// CONSTANTS

const { createProxyMiddleware } = require("http-proxy-middleware");
const { fork } = require("child_process");
const express = require("express");
const app = express();

const port_router = 80;
const port_app = 3000;
const port_net_suffix = 29;

let children = []; // array of forked process + meta info = { db, port, netport, process };
let childCount = -1; // Start at 3000 for BASE APP

const PRE = '...nc-router: ';


// OPTIONS
const childMax = 3; // Set this to limit the number of running processes
                    // in order to keep a rein on CPU and MEM loads



///////////////////////////////////////////////////////////////////////////////
// UTILITIES

/**
 * Used to determine express server port for netcreate app instances
 * 
 * Given a route index, returns a port based on port_app + index*100, e.g. 
 *   with port_app = 3000
 *   getPort(2) => 3200
 * 
 * @param {integer} index of route
 * @return integer
 */
function getPort(index) {
  return port_app + index * 100;
}
/**
 * Used to determine port for websockets
 * 
 * Given a route index, returns a port based on port_app + index*100, e.g. 
 *   with port_app = 3000
 *   getPort(2) => 3229
 * 
 * @param {integer} index of route
 * @return integer, e.g. if index=2, then 3229
 */
function getNetPort(index) {
  return getPort(index) + port_net_suffix;
}
/**
 * Use this to spawn a new node instance
 * @param {string} db 
 */
async function SpawnApp(db) {
  const result = await PromiseApp(db);
  newChildSpec = {
    db,
    port: result.routerUrlSpec.port,
    netport: result.routerUrlSpec.netport,
    process: result.process,
  };
  AddChildSpec(newChildSpec);
  return result.routerUrlSpec;
}
/**
 * Promises a new node NetCreate application process
 * 
 * In general, don't call this directly.  Use SpawnApp.
 * 
 * This starts `nc-start.js` via a fork.
 * nc-start.js will generate netcreate-config.js and start
 * the brunch server.
 * 
 * When nc-start.js has completed, it sends a message back
 * via fork messaging, at which point this promise is resolved.
 * 
 * @param {string} db 
 * @return resolve sends the forked process and meta info
 * 
 */
function PromiseApp(db) {
  return new Promise((resolve, reject) => {
    childCount++;
    if (childCount > childMax) {
      reject(`Too many graphs open already!  Graph ${childCount} not created.`);
    }

    const port = getPort(childCount);
    const netport = getNetPort(childCount);

    // 1. Define script
    const forked = fork("./nc-start.js");

    // 2. Define url specification for the proxy `router` function
    const routerUrlSpec = {
      protocol: "http:",
      host: "localhost",
      port: port,
      netport: netport,
    };
    
    // 3. Define fork success handler
    forked.on("message", (msg) => {
      console.log(PRE + "Received message from spawned fork:", msg);
      console.log(PRE);
      console.log(PRE + `${db} STARTED!`);
      console.log(PRE);
      const result = {
        process: forked,
        routerUrlSpec: routerUrlSpec
      }
      resolve(result);
    });

    // 4. Trigger start
    const forkParams = { db, port, netport };
    forked.send(forkParams);
  });
}

/**
 * Add Route only if it doesn't already exist
 * @param {object} route 
 */
function AddChildSpec(newroute) {
  if (children.find(route => route.db === newroute.db)) return;
  children.push(newroute);
}



///////////////////////////////////////////////////////////////////////////////
// HTTP-PROXY-MIDDLEWARE ROUTING
//

// ----------------------------------------------------------------------------
// INIT
console.log(`\n\n\n...`);
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
// ROUTES

// HANDLE `/graph/:graph/:file?
//
// If there's a missing trailing "/", the URL is malformed 
//
app.use(
  '/graph/:graph/:file?',
  createProxyMiddleware(
    (pathname, req) => {
      // only match if there is a trailing '/'?
      console.log("req.params", req.params);
      console.log("...pathname", pathname);               // `/hawaii/`;
      console.log("...req.path", req.path);               // '/'
      console.log("...req.baseUrl", req.baseUrl);         // '/hawaii'
      console.log("...req.originalUrl", req.originalUrl); // '/hawaii/'      \
      console.log("...req.query", req.query);             // '{}'
      
      if (req.params.file) return true; // legit file
      if (req.params.graph && req.originalUrl.endsWith("/")) return true; // legit graph
      return false;
    },
    {
      router: async function (req) {
        const db = req.params.graph;
        
        // look up
        let route = children.find(route => route.db === db);
        if (route) {
          console.log(PRE + '--> mapping to ', route.db, route.port);
          return {
            protocol: "http:",
            host: "localhost",
            port: route.port,
          };
        } else {
          // not defined yet, create a new one.
          console.log(PRE + "--> not defined yet, starting", db);
          const resultUrl = await SpawnApp(db);
          return resultUrl;
        }
      },
      pathRewrite: function (path, req) {
        console.log(PRE + "working on path,req", path);
        // remove '/graph'
        console.log(PRE + 'req.params', req.params);
        // const rewrite = path.split("/").splice(0, 1).join("/");
        const rewrite = path.replace(`/graph/${req.params.graph}`, '');
        console.log(PRE + '=> ', rewrite);
        // console.log("#### => replace ", path.replace("/graph"));
        return rewrite; // remove `/?hawaii/'
      },
      target: `http://localhost:3000`, // default fallback
      ws: true,
      changeOrigin: true,
    }
  )
);


// HANDLE MISSING TRAILING ".../" -- RETURN ERROR
app.get('/graph/:file', (req, res) => {
  console.log(PRE + '!!!!!!!!!!!!!!!!!!!!!!!!! BAD URL!')
  res.set("Content-Type", "text/html");
  res.send(
    `Bad URL.  
    Missing trailing "/".
    Perhaps you meant <a href="${req.originalUrl}/">${req.originalUrl}/</a>`
  );
});


// HANDLE "/kill/:graph" -- KILL REQUEST
app.get('/kill/:graph/', (req, res) => {
  console.log(PRE + "!!!!!!!!!!!!!!!!!!!!! / KILL!");
  const db = req.params.graph;
  res.set("Content-Type", "text/html");
  let response = `<h1>NetCreate Manager</h1>`;
  const child = children.find(child => child.db === db);
  if (child) {
    try {
      child.process.kill();
      children = children.filter(child => child.db !== db);
      response += `<p>Process ${db} killed.`;
    } catch (e) {
      response += `<p>ERROR while trying to kill ${db}</p>`;
      response += `<p>${e}</p>`;
    }
  } else {
    response += "ERROR: No database found to kill: " + db;
  }
  response += `<p><a href="/">Back to Manager</a></p>`;  
  
  res.send(response);
});


// HANDLE "/" -- MANAGER PAGE
app.get('/', (req, res) => {
  console.log(PRE + "!!!!!!!!!!!!!!!!!!!!! / ROOT!");
  res.set("Content-Type", "text/html");
  let response = `<h1>NetCreate Manager</h1>`
  response += `<p>${new Date().toLocaleTimeString()}</p >`;
  response +=
    "<table><thead><tr><td>Database</td><td>Port</td><td>Websocket</td><td></td></tr></thead><tbody>";
  children.forEach((route, index) => {
    let kill = `<a href="/kill/${route.db}/">kill</a>`;
    if (index < 1) kill = ''; // Don't allow BASE to be killed.
    response += `<tr><td>
<a href="/graph/${route.db}/" target="${route.db}">${route.db}</a>
</td><td>${route.port}</td><td>${route.netport}</td><td>${kill}<td></tr>`;
  });
  response += `</tbody></table>`;
  res.send(response);
});


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
  createProxyMiddleware(
    '/',
    {
      target: `http://localhost:3000`,
      ws: true,
      changeOrigin: true,
    }
  )
);


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
// START PROXY
//
app.listen(port_router, () =>
  console.log(PRE + `running on port ${port_router}.`)
);
