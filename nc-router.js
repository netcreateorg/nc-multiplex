/**
 *  nc-router.js
 * 
 *  This creates a node-based router manager that will
 *  spin up individual NetCreate graph instances
 *  running on their own node processes.
 * 
 *  To start this manually:
 *    `node nc-router.js`
 * 
 *  Or use `npm run start`
 * 
 *  Then go to `localhost` to view the manager.
 *  (NOTE: This runs on port 80, so need to add a port)
 * 
 *  The manager will list the running databases.
 * 
 *  To start a new graph:
 *    `http://localhost/graph/tacitus`
 * 
 *  If the graph already exists, it will be loaded.
 *  Otherwise it will create a new graph.
 * 
 *  Refresh the manager to view new databases.
 *  
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const { fork } = require("child_process");

const app = express();

/**
 *  Port scheme
 * 
 *  The router runs on port 80.
 *  Defined with port_router
 * 
 *  Base application port is 3000
 *  New children start at 100
 *  With netports automatically set to xx29 (for websockets).
 * 
 *  e.g. first child would be:
 *       app port: 3100
 *       net port: 3129
 * 
 */
const port_router = 80;
const port_app = 3000;
const port_net_suffix = 29;


// DB
let children = [];
let childCount = 0;
const childMax = 3;


console.log("...");
console.log("...");
console.log("...router: STARTED!");


///////////////////////////////////////////////////////////////////////////////
// UTILITIES

/**
 * 
 * @param {integer} index 
 * @return integer, e.g. if index=2, then 3200
 */
function getPort(index) {
  return port_app + index * 100;
}
/**
 * 
 * @param {integer} index 
 * @return integer, e.g. if index=2, then 3229
 */
function getNetPort(index) {
  return port_app + index * 100 + port_net_suffix;
}



///////////////////////////////////////////////////////////////////////////////
// EXPRESS ROUTES

// // root
// app.get("/manage", (req, res) => {
//   res.set('Content-Type', 'text/html');
//   let response = `<p>NC Router! ${new Date().toLocaleTimeString()}</p>`;
//   children.forEach((child, index) => {
//     response += `<div>${index}). ${child.db}:${child.port}:${child.netport}</div>`;
//   });
//   res.send(response);
// });


// // // /graph/dbname
// app.get("/graph/:db", (req, res) => {
//   const db = req.params.db;
//   const forkdef = children.find((forkdef) => forkdef.db === db);
//   if (forkdef) {
//     console.log(`...router: ${db} found! Redirecting!`);
//     // res.redirect(`http://localhost:${forkdef.port}/graph/${forkdef.db}`);
//     // Just redirect to the port?  No need to spec db anymore?
//     res.redirect(`http://localhost:${forkdef.port}/`);
//   } else {
//     console.log(`...router: ${db} not found, spawning new child`);
//     requestChild(db, res);
//   }
// });
async function requestChild(db, res) {
  const result = await promiseChild(db);
  console.log("...router: requestChild result:", result);
  // res.redirect(`http://localhost:${result.port}/graph/${result.db}`);
  res.redirect(`http://localhost:${result.port}`);
}
function promiseChild(db) {
  return new Promise((resolve, reject) => {
    childCount++;
    if (childCount > childMax) {
      reject(`Too many children!  Child ${childCount} not created.`);
    }
    
    const port = getPort(childCount);
    const netport = getNetPort(childCount);
    
    // direct start version
    const forked = fork("./nc-start.js");
    const forkParams = { db, port, netport };
    
    // nc version
    // const args = [`--dataset=${db}`, `--port=${port}`, `--netport=${netport}`];
    // const forked = fork("./nc-start-ncjs.js", args);
    // const forkdef = { db, port, netport };

    forked.on("message", (msg) => {
      console.log("...router: Message from child:", msg);
      console.log("...");
      console.log("...");
      console.log(`...router: ${db} STARTED!`);
      console.log("...");
      console.log("...");
      resolve(forkParams);
    });

    forked.send(forkParams);
    children.push(forkParams);
  });
}

///////////////////////////////////////////////////////////////////////////////
// HTTP-PROXY-MIDDLEWARE PORT ROUTER
//
// This doesn't work if app also assigns gets (e.g. if there's a app.get call)

// const filter = (pathname, req) => {
//   // For http://sub.localhost/hawaii/#/edit/mop-bugle-lme
//   // Note that anything after the '#' is ignored
//   // See request object documentation: https://www.tutorialspoint.com/nodejs/nodejs_request_object.htm
//
//   console.log("pathname", pathname);               // `/hawaii/`
//   console.log("req.path", req.path);               // '/'
//   console.log("req.baseUrl", req.baseUrl);         // '/hawaii'
//   console.log("req.originalUrl", req.originalUrl); // '/hawaii/'
//   console.log("req.params", req.params);           // '{}'
//   console.log("req.query", req.query);             // '{}'
//   console.log("req.route", req.route);             // undefined
//   console.log("req.hostname", req.hostname);       // 'sub.localhost'
//   console.log("req.subdomains", req.subdomains);   // []
  
//   return true; // true to match
// };
// app.use(
// //  "/hawaii",
//   createProxyMiddleware(
//     filter,
//     {
//     ws: true,
//     // matches request.headers.host and request.headers.path 
//     // = '/hawaii'
//     // router: {
//     //   'sub.*' : 'http://localhost:3000'
//     // },
//     pathRewrite: {
//       "^/hawaii": "/",
//     },
//     target: "http://localhost:3000",
//     changeOrigin: true,
//   })
// );


// Pathname Approach
//   `localhost/hawaii/#/edit/mop` => `localhost:3100/#/edit/mop`
//   `localhost/netcreate-config.js` fails
//
// This ALMOST works.
// Problem is that it does not redirect the other calls, e.g. /scripts/netc-lib.js
// only redirects the main call.
// let forks = [
//   { db: "hawaii", port: "3000" },
//   { db: "tacitus", port: "3100" },
// ];
// forks.forEach(fork => {
//   const dbpath = `/${fork.db}/`;
//   app.use( createProxyMiddleware(
//     (pathname, req) => {
//       console.log("checking baseurl", pathname, "against fork.db", dbpath);
//       if (pathname === dbpath) {
//         return true;
//       } else {
//         return false;
//       }
//     },
//     {
//       pathRewrite: (path, req) => {
//         console.log('replacing ',path,'with',fork.db)
//         return path.replace(fork.db, '')
//       },
//       target: `http://localhost:${fork.port}`,
//       ws: true,
//       changeOrigin: true
//     }
//   ));
// });


// Subdomain Approach
//   `hawaii.localhost/#/edit/mop` => `localhost:3100/#/edit/mop`
//   `hawaii.192.168.1.15` is not valid
//   
// This works well, but not for a real domain (unless all subdomain calls are routed
// to this server)
// AND definitely not for classrooms, where an IP address is used.
// let forks = [
//   { db: "hawaii", port: "3000" },
//   { db: "tacitus", port: "3100" },
// ];
// forks.forEach((fork) => {
//   const dbsubdomain = `${fork.db}.`;
//   app.use(
//     createProxyMiddleware(
//       (pathname, req) => {
//         console.log("checking hostname", req.hostname, "against fork.db", dbsubdomain);
//         if (req.hostname.startsWith(dbsubdomain)) {
//           console.log("...matches", dbsubdomain);
//           return true;
//         } else {
//           console.log("...doesn't match", dbsubdomain);
//           return false;
//         }
//       },
//       {
//         target: `http://localhost:${fork.port}`,
//         ws: true,
//         changeOrigin: true,
//       }
//     )
//   );
// });


/**
 *  Pathname Query Approach
 * 
 *    `localhost/?hawaii/#/edit/mop` => `localhost:3100/?hawaii/#/edit/mop`
 * 
 *  The pathname is terminated by '?' or '#'
 *  A Query can be terminated by '#' as well.
 *  So we take advantage of that to inject two bits of info
 * 
 *  This works so long as:
 *  1. We start a generic app at :3000
 *  2. We manually start hawaii and tacitus at 3100 and 3200
 *     (because we haven't implemented new db init)
 *  
 */
let forks = [
  { db: "hawaii", port: "3100" },
  { db: "tacitus", port: "3200" },
];
forks.forEach(fork => {
  app.use(
    // (request, result, next) => {
    //   console.log(`\nAPP REQUEST`);
    //   console.log(`REQUEST`, request);
    //   console.log(`RESULT`, result);
    // },
    createProxyMiddleware(
      (pathname, req) => {
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
        return req.originalUrl === "/?" + fork.db + "/";
      },
      {
        // pathRewrite: (path, req) => {
        //   console.log('replacing ',path,'with',fork.db)
        //   return path.replace(fork.db, '')
        // },
        target: `http://localhost:${fork.port}`,
        // router: req => {
        
        // },
        ws: true,
        changeOrigin: true
      }
    )
  );
});


// route everything else to 3000
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



///////////////////////////////////////////////////////////////////////////////
// START ROUTER

app.listen(port_router, () =>
  console.log(`nc-router.js on port ${port_router}.`)
);
