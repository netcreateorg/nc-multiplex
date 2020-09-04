# nc-multiplex

nc-multiplex implements multiple-database hosting for NetCreate.

It is a node-based reverse proxy / process manager that can spin up individual NetCreate graph instances running their own separate node processes on a single hosted server.


## Installation

This repo contains only the reverse proxy server.  You will need to install the NetCreate repo separately.

These instructions are primarily for installing on a local development machine.  See also "Installing in the Cloud" notes at the end.


#### Requirements
* git
* Node 10+

We assume you already have git and node 10+ installed.  We also assume you have `nvm` installed.  Running `nvm use` will set automatically set the right node version.  If you don't have `nvm` installed, just make sure you install NodeJS version 10.22.0 or later.


#### 1. Clone `nc-multiplex`
```
cd ~/your-dev-folder/
git clone https://gitlab.com/netcreate/nc-multiplex.git
cd ~/your-dev-folder/nc-multiplex
nvm use
npm ci
```


#### 2. Install NetCreate
Install NetCreate INSIDE the `nc-multiplex` folder.  e.g. your directory structure should look something like this:
```
~/your-dev-folder/nc-multiplex/
~/your-dev-folder/nc-multiplex/netcreate-2018/
```

```
cd ~/your-dev-folder/nc-multiplex
git clone https://github.com/netcreateorg/netcreate-2018.git
```

As of 7/23/2020, the ability to configure IP addresses is still on the `dev-bl/config-ip-filter` branch.  So check out that branch.  `nc-multiplex` will fail if you try to use the `master` or `dev` branch.

```
cd netcreate-2018
git checkout dev-bl/config-ip-filter
```

...continue with install...

```
cd netcreate-2018/build
npm ci
```


#### 3. Compile NetCreate for Classroom
```
npm run classroom
```
We need pre-compile the NetCreate code for the classroom.  This compiles the script to run without autoreload, and lets you test to make sure it can run.

`ctrl-c` to quit the running app.

Alternatively you can use `npm run package` if you want the network to run in STANDALONE mode (no edits).

The NetCreate instances spun up by `nc-multiplex` will use the shared compiled code for each NetCreate instance.

**IMPORTANT**: Every time you pull a new version of netcreate-2018, you need to recompile, otherwise, nc-multiplex will use the old compiled code.

**IMPORTANT**: Do NOT build it with `npm run dev` or NetCreate will try to enable autoreload (used for detecting changes in code and restarting the server during development).  This will result in a slow startup as well as repeated connection failures to port 9485 for autoreload.  If you see messages like this in your console, you probably built NetCrate using `npm run dev`: 

```
WebSocket connection to 'ws://*:9485/' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
```
or
```
Firefox can’t establish a connection to the server at ws://*:9485/. auto-reload.js:69:21
```


#### 4. Set your Home Page
If you would like a custom home page, add a file called `home.html` to the root folder at `nc-multiplex/home.html`.

If no `home.html` page is found, the app will display a NetCreate logo and contact information at `http://localhost/`.


#### 5. Set your Password
By default, the password is `kpop`.  We **strongly recommend** you set a custom password.  

To set a new password, create a text file named `SESAME` containing just your password text (no line feed), and place it in the root `/nc-multiplex` folder. Make sure you don't inadvertently insert a **newline** at the end of the file.

Or you can:
1. `ssh` to your machine
2. `cd your-dev-folder/nc-multiplex`
3. `printf "yourpassword" > SESAME`


#### 6. Start Reverse Proxy Server
```
cd ~/your-dev-folder/nc-multiplex
node nc-multiplex.js
```

***IP Address or Google Analytics Code**  
Use the optional `--ip` or `--googlea` parameters if you need 
to start the server with a specific IP address or google
analytics code. e.g.: 

  `node nc-multiplex.js --ip=192.168.1.40`
  `node nc-multiplex.js --googlea=xxxxx`
      
See "Caveats" below for more information.


#### 7. View the manager
```
http://localhost/manage
```


#### 8. Starting New Graphs

You can start a new graph one of two ways.

Form
1. On the "New Graph" box, type in a new database name.
2. Click "Create New Graph".  The new database will open in new window.

Direct Shortcut
1. Make sure you're logged in as an administrator.
2. Enter a new url with `/graph/<dbname>/`, e.g. `http://localhost/graph/tacitus/`

If the graph already exists, it will be loaded. 
Otherwise the router will create and load a new graph.

The reverse proxy server will invisibly route your requests to a node instance running on a specific port.  You can view the app directly, e.g.:
  `http://localhost:3100`

Refresh the manager to view the current list of running databases.

**IMPORTANT**: The trailing "/" is necessary in the URL.  The system will warn you if you try to start a database without it, e.g. `http://localhost/graph/tacitus`.  This is necessary because we would otherwise be unable to distinguish between new graph requests and static file requests.


#### 9. Load Existing Graph

The manager lists all the graphs it finds in the `~/your-dev-folder/nc-multiplex/netcreate-2018/build/runtime/` folder.  To load an existing graph:

1. Make sure you're logged in and your cookie hasn't expired.
2. Click on the graph link in the "Saved Graphs" box to start the graph.

If you're not logged in, you will get an error.

Shortcut: If you have an active valid cookie, you can just go directly to the URL.


#### 10. Generate Tokens

Any user who wants to edit a graph will need to generate a token.  Tokens now only work for specific graphs, so for instance a token for "hawaii" will not allow you to open "tacitus".  To generate tokens, in the "Generate Tokens" box:

1. Select the graph you want to generate tokens for.
2. Enter a Class ID.  It can be any string.  e.g. you can use this to designate an organization.
3. Enter a Project ID.  It can be any string.  e.g. you can use this to designate a group.
4. Select the number of tokens to generate.
5. Click "Generate Tokens".
6. Copy the resulting codes.

You can regenerate the same codes any time.


## Managing Databases

All databases are stored in the NetCreate runtime folder, e.g. `~/your-dev-folder/nc-multiplex/netcreate-2018/build/runtime/`.  All node processes share the same database files.  So any database you spin up will be in the main runtime folder.

* Prepopulate the databases and templates by simply copying the `*.loki` and `*.template` files there prior to running `node nc-multiplex.js`.

* You can copy and back up databases directly in the `runtime` folder.

* You can make modifications any time to the runtime folder and refresh the manager to view the new list.  Though keep in mind if someone is actively working on a graph, you may clobber their changes.

* When you request the database, the server will first try to load an existing file.  If none is found, it will create a new one.

* Templates are handled the same way -- When you request a database, a template with the same name is requested.  If none exists, nc-multiplex will create a new one based on the default template.

* Note you no longer need to use the `?` method to retrieve a specific database.  (It applies only to standalone mode anyway).  e.g. just use `localhost/graph/tacitus/` instead of `localhost/?dataset=2020-02-06_Tacitus#/`

* The database named "base" is always started on port 3000 to handle static file requests.  You shouldn't need to touch this graph.

* The default database template used when creating a new project is in `~/your-dev-folder/nc-multiplex/netcreate-2018/build/app/assets/templates/_default.template`.  You can modify this.


## How it works

nc-multiplex is essentially a traffic cop and process manager.

Its principle role is traffic cop.  When a request comes in, e.g. `http://localhost/graph/tacitus/`, nc-multiplex checks to see if there is already a running NetCreate instance.  If there isn't, it starts a new NetCreate instance, and then routes the traffic to `http://localhost:nnnn` where `nnnn` is the port number the newly created NetCreate instance is running on. The user never sees the port number.  (You can go directly to `http://localhost:nnnn` to work with the app if you want.)

When subsequent requests come in, any calls to `/graph/tacitus/` are also routed to the same port.  Any calls to other graphs, e.g. `/graph/hawaii/` are then spun up separately.

This is accomplished via an express server that handles all the requests.  The app is running on port 80.  It then redirects requests to the individual graphs on specific ports.

Because the system keeps spinning up new resources, we do have to keep an eye on them, as each instance will eat up a certain amount of memory and CPU cycles.  This is why there is a maximum active graph setting.  We'll have to do some testing to see where we should set the max.

Each process will continue running until it is explicitly killed.  

---

# OPTIONS

You can customize the behavior of `nc-multiplex` via startup parameters or changing options variables in the code directly.

## Password
By default, the password is `kpop`.  We **strongly recommend** you set a custom password.  

To set a new password, create a text file named `SESAME` containing just your password text (no line feed), and place it in the root `/nc-multiplex` folder. Make sure you don't inadvertently insert a **newline** at the end of the file.

Or you can:
1. `ssh` to your machine
2. `cd your-dev-folder/nc-multiplex`
3. `printf "yourpassword" > SESAME`


## Startup Parameters
Use startup parameters to set the ip address or google analytics code:

* `--ip` -- e.g. `node nc-multiplex.js --ip=192.168.1.40`.  See "IP option is for private IP networks" below for more details.
* `--googlea` -- e.g.  `node nc-multiplex.js --googlea=xxxxx`


## Variables
You can tweak the following variables in `nc-multiplex.js` to change the behavior of the app.  TEST if you do!

```
const PROCESS_MAX = 30;  // Set this to limit the number of running processes
                         // in order to keep a rein on CPU and MEM loads
                         // If you set this higher than 100 you should make
                         // sure you open inbound ports higher than 3100 and 4100

const MEMORY_MIN = 256;  // in MegaBytes
                         // Don't start a new process if there is less than
                         // MEMORY_MIN memory remaining.  
                         // In our testing with macOS and Ubuntu 18.04 on EC2:
                         // * Each node process is generally ~30 MB.
                         // * Servers stop responding with less than 100 MB remaining.

const ALLOW_NEW = false; // default = false
                         // false: App will respond with ERROR NO DATABASE if you enter
                         //        a url that points to a non-existent database.
                         // true:  Set to true to allow auto-spawning a new database via
                         //        url.  e.g. going to `http://localhost/graph/newdb/` 
                         //        would automatically create a new database if it
                         //        didn't already exist.

const AUTH_MINUTES = 2;  // default = 30
                         // Number of minutes to authorize login cookie
                         // After AUTH_MINUTES, the user wil have to re-login.
```


## Installing in the Cloud

There are a few other considerations if you're installing `nc-multiplex` in the cloud, e.g. Amazon EC2 or Digial Ocean.


* Open Ports

You'll need to open the following inbound ports to run `nc-multiplex`.

**Inbound ports**
```
3000-3100 Application Instances
4000-4100 WebSockets
```

If you set `PROCESS_MAX` (in `nc-multiplex.js`) higher than 100, you'll want to open more ports.  e.g. if `PROCESS_MAX` is 200, then you'll need to open the range `3000-3200` and `4000-4200`.

All outbound ports should be open.

In addition, if you plan on running NetCreate in `dev` mode (e.g. using the `.nc.js` script directly), you'll probably also want to open:
```
22   SSH
2929 WebSockets for dev mode
9485 For AutoReload
```


* IP option is for private IP networks

Generally, you won't need to use the `--ip` option.

`--ip` is for use with EC2 and docker implementations that default to a private ip network address.  In those cases, the public network ip is not visible to the `brunch-server` start script, and the system ends up using the private ip address for websockets, rendering it unreachable. Passing an IP address will force brunch to override the private ip address.


* Running Node

To keep node running, you'll need a process manager.

On Ubuntu, you can use `pm` or `pm2`.  With `pm2` you can pass the `ip` parameter like this (note the extra set of dashes): `sudo pm2 start nc-multiplex.js -- --ip=196.168.1.30`


* Memory Limits

In our limited testing, each node process seemed to take about 18 - 28MB.  On a system with 1 Gig of memory, running Ubuntu 18.04, the base system started at 192MB.  We were able to run about 30 instances before the system would crash, with the memory reported by htop at about 850+MB out of 979MB.

So setting `PROCESS_MAX` to 30 is probably a safer maximum.


---


# Caveats

* No security

There is absolutely no security on this system.  So use it with caution.  It's probably not a good idea to leave it permanently running on a public URL.


* Wide open databases

Anyone can view any database running on the server, unless you have set the `requireLogin` flag on the database template files.  See the (User Guide)[https://github.com/netcreateorg/netcreate-2018/wiki/User-Guide].


* No limits on creating

Anyone with admin access can create as many new databases as they want, using any name they choose.  If the name exists, the system will load the existing db.  There is currently no error checking here.  So you may end up with many hundreds of databases over time.

* `home.html`

To keep things simple and slightly more secure, you can't include any files with the home page, e.g. no images, css, or js.  The one exception is you can use NetCreate's logo: `<img src="/images/netcreate-logo.svg">`.  (The Express server is not set up to serve any other files.)

The server only checks for the existence of the home page on startup, so if you change the home page, you'll need to restart the server to activate it.

* Password

The server only checks for the existence of the password override on startup, so if you change the password, you'll need to restart the server to activate it.

After you successfully login, the system will set a cookie that allows you to access the manage page for a few minutes (30 by default).  You can customize the number of minutes your authorization cookie is valid for with the `AUTH_MINUTES` variable.