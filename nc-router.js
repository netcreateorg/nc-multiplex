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
const app = express();
const { fork } = require("child_process");

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
// ROUTES

// root
app.get("/", (req, res) => {
  res.set('Content-Type', 'text/html');
  let response = `<p>NC Router! ${new Date().toLocaleTimeString()}</p>`;
  children.forEach((child, index) => {
    response += `<div>${index}). ${child.db}:${child.port}:${child.netport}</div>`;
  });
  res.send(response);
});


// /graph/dbname
app.get("/graph/:db", (req, res) => {
  const db = req.params.db;
  const forkdef = children.find((forkdef) => forkdef.db === db);
  if (forkdef) {
    console.log(`...router: ${db} found! Redirecting!`);
    // res.redirect(`http://localhost:${forkdef.port}/graph/${forkdef.db}`);
    // Just redirect to the port?  No need to spec db anymore?
    res.redirect(`http://localhost:${forkdef.port}/`);
  } else {
    console.log(`...router: ${db} not found, spawning new child`);
    requestChild(db, res);
  }
});
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
// START ROUTER

app.listen(port_router, () =>
  console.log(`nc-router.js on port ${port_router}.`)
);
