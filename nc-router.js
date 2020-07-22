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

let routes = []; // array of forkParams = { db, port, netport };
let routeCount = -1; // Start at 3000 for BASE APP

const PRE = '...nc-router: ';


// OPTIONS
const routeMax = 3; // Set this to limit the number of running processes
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
  const resultUrl = await PromiseApp(db);
  newRoute = {
    db,
    port: resultUrl.port,
    netport: resultUrl.netport
  }
  AddRoute(newRoute);
  return resultUrl;
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
 */
function PromiseApp(db) {
  return new Promise((resolve, reject) => {
    routeCount++;
    if (routeCount > routeMax) {
      reject(`Too many graphs open already!  Graph ${routeCount} not created.`);
    }

    const port = getPort(routeCount);
    const netport = getNetPort(routeCount);

    // 1. Define script
    const forked = fork("./nc-start.js");

    // 2. Define success handler
    const url = {
      protocol: "http:",
      host: "localhost",
      port: port,
      netport: netport,
    };
    forked.on("message", (msg) => {
      console.log(PRE + "Received message from spawned fork:", msg);
      console.log(PRE);
      console.log(PRE + `${db} STARTED!`);
      console.log(PRE);
      resolve(url);
    });

    // 3. Trigger start
    const forkParams = { db, port, netport };
    forked.send(forkParams);
  });
}

/**
 * Add Route only if it doesn't already exist
 * @param {object} route 
 */
function AddRoute(newroute) {
  if (routes.find(route => route.db === newroute.db)) return;
  routes.push(newRoute);
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
        let route = routes.find(route => route.db === db);
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
})


// HANDLE "/" -- MANAGER PAGE
app.get('/', (req, res) => {
  console.log(PRE + "!!!!!!!!!!!!!!!!!!!!! / ROOT!");
  res.set("Content-Type", "text/html");
  let response = `<h1>NetCreate Manager</h1>`
  response += `<p>${ new Date().toLocaleTimeString() }</p >`;
  response +=
    "<table><thead><tr><td>Database</td><td>Port</td><td>Websocket</td></tr></thead><tbody>";
  routes.forEach((route, index) => {
    response += `<tr><td>
<a href="/graph/${route.db}/" target="${route.db}">${route.db}</a>
</td><td>${route.port}</td><td>${route.netport}</td></tr>`;
  });
  response += `</tbody></table>`;
  res.send(response);
})


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
