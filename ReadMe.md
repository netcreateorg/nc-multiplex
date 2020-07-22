# nc-router

nc-router implements multiple-datbase hosting for NetCreate.

It is a node-based reverse proxy / manager / express server that can spin up individual NetCreate graph instances running their own node processes on a single hosted server.


## Installation

This repo contains only the reverse proxy server.  You will need to install the NetCreate repo separately.


#### 1. Clone `nc-router`
```
git clone nc-router
cd nc-router
```

#### 2. Install NetCreate
Install NetCreate INSIDE the `nc-router` folder.  e.g. your directory structure should look something like this:
```
~/your-dev-folder/nc-router/
~/your-dev-folder/nc-router/netcreate-2018/
```

```
git clone https://github.com/netcreateorg/netcreate-2018.git
cd netcreate-2018
npm ci
npm run dev         # Make sure NetCreate runs
```

#### 3. Compile NetCreate for Classroom
```
npm run classroom   # Not necessary if you ran `npm run dev` above
```
We need pre-compile the NetCreate code.


#### 4. Start Reverse Proxy Server
```
cd ~/your-dev-folder/nc-router
node nc-router.js
```

#### 5. View the manager
```
http://localhost
```

#### 6. Starting New Graphs

To start a new graph:
  `http://localhost/graph/tacitus/`
  
If the graph already exists, it will be loaded. 
Otherwise the router will create and load a new graph.

The reverse proxy server will invisibly route your requests to a node instance running on a specific port.  You can view the app directly, e.g.:
  `http://localhost:3100`

Refresh the manager to view the current list of running databases.

NOTE: The trailing "/" is necessary in the URL.  The system will warn you if you try to start a database without it, e.g. `http://localhost/graph/tacitus`.  This is necessary because we would otherwise be unable to distinguish between new graph requests and static file requests.



## How it works

Each graph is spun up with its own node process running on a separate port.  The port number is necessary to route calls to the correct instance.

There is a express server that handles all port 80 requests.  It then redirects requests to the individual graphs on specific ports.


# Caveats

* No security

There is absolutely no security on this system.  So use it with caution.  It's probably not a good idea to leave it permanently running on a public URL.

* Wide open databases

Anyone can view any database running on the server.