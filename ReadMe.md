# nc-router

This is a node-based router manager / express server that can spin up individual NetCreate graph instances running their own node processes on a single hosted server.


## Installation

This repo is only for the router.  You will need to install NetCreate repo separately.


```
git clone nc-router
cd nc-router

# Install NetCreate
git clone netcreate-2018
cd netcreate-2018
npm ci
npm run dev         # Make sure it runs

# Compile Classroom
npm run classroom   # Not necessary if you ran `npm run dev` above

# Start Router
cd <parent>/nc-router
node nc-router.js

# View the manager
http://localhst
```



## Starting New Graphs

To start a new graph:
  `http://localhost/graph/tacitus`
  
If the graph already exists, it will be loaded. 
Otherwise the router will create and load a new graph.

You will be redirected to the port the graph is hosted on. e.g.:
  `http://localhost:3100`

Refresh the manager to view the current list of running databases.



## How it works

Each graph is spun up with its own node process running on a separate port.  The port number is necessary to route calls to the correct instance.

There is a express server that handles all port 80 requests.  It then redirects requests to the individual graphs on specific ports.

The downside of this approach:
* the URL can't be easily copied
* URLs don't indicate which graph you're working on
* Anyone can port-hop to view your graph
* 