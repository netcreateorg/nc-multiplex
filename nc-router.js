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
  res.redirect(`http://localhost:${result.port}/graph/${result.db}`);
}
function promiseChild(db) {
  return new Promise((resolve, reject) => {
    childCount++;
    if (childCount > childMax) {
      reject(`Too many children!  Child ${childCount} not created.`);
    }
    
    const port = getPort(childCount);
    const netport = getNetPort(childCount);
    
    const args = [`--dataset=${db}`, `--port=${port}`, `--netport=${netport}`];
    const forked = fork("./nc-start.js", args);
    const forkdef = { db, port, netport };
    forked.on('message', msg => {
      console.log('...router: Message from child', msg);
      resolve(forkdef);
    })
    forked.send(forkdef);
    children.push(forkdef);
  });
}


///////////////////////////////////////////////////////////////////////////////
// START ROUTER

app.listen(port_router, () =>
  console.log(`nc-router.js on port ${port_router}.`)
);
