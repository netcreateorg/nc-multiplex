# nc-router

2020-07-19 Test a node-based router to actual netcreate app.
This does not use Docker

# QuickRef

* RFC 3986 Path
  https://tools.ietf.org/html/rfc3986#section-3.3





Child Call sequence:

1. REQUEST: `http://localhost/dbname`
2. router.js: Start Child `nc-child.js`
3. nc-worker.js: Run `npm run worker`
4. npm run worker: Run `node nc-server.js`
5. nc-server.js: Start Express server listening on new port



Issues

* Why not run `nc-server.js` directly?
  * Because of the way the main NetCreate app is configured?  We need to start up the server via brunch?
* URLs have port numbers?
  * We can't copy and paste URLs because the port numbers will change?!?
  * Can we just do port redirects?
  * We have to use **ports** because each nc instance needs to listen on its own port.  That's fundamental to how we're handling the multiple server setup?
    * If we don't use ports, then each db request will need to have an additional db file reference?  Can we open multiple loki databases and redirect URSYS message to the appropriate db?  In some ways that might be simpler?
    * 


---
---

# LOG

* Make sure NetCreate runs by itself.


#### Spin up NetCreate instead of express server.
BUG: nc.js seems to run, but site won't load at localhost:3002
TRY: Run `brunch` directly?  => `brunch` won't run at all outside of `npm`?!?
TRY: Verify that no ip works with `localhost`
     => Yep.  Standalone netcreate app works fine with no ip s'pecd.
TRY: No response from either `localhost:3002` nor `192.168.4.30:3002`
     `localhost:80` does work.
TRY: Set router on port 3000 instead of 80?
     => Nope.  Server still never responds.
     Is there something blocking access to the port?  Why is the request not going through?
     Why is MEME code loading?  Cache?
     => Opening a new tab seemed to load it?

BUG: Spinning up a second site results in EADDRINUSE.
     Because port is hardcoded into the shell script.
     

PRB: Use fork process to trigger/end promises?
    * nc-start.js can be rewritten using `process.send` to send parameters rather 
          than passing arguments ala `nc.js`.
      --  Should it also be an asynch function?
      --  And return a confirmation to resolve the promise after the shell runs?

#### Run Production Code -- 2020-07-20
PRB: We don't need to compile or watch for changes.
TRY: According to `brunch-config.js`, use `npm run package` 
     or `npm run classroom`?
     
     What does `npm run classroom` run?
     -- Still compiles.
     -- Starts app.
     -- Can edit
     -- Saves seem to work.
     
     What does `npm run package` run?
     -- Compiles.
     -- Builds standalone, does not start server.
     -- Builds files in public
     
     What does 'standalone view' do?
     -- No login.
     -- No edit.

TRY: Can we run without building?
     => If you run `npm run classroom` first to build,
        then we can use a script `nc-run-built.js` to
        start the compiled code.
     BUT: Can you access different databases that way?
     -- What happens to NC_CONFIG?
     TRY: Change app/assets/netcreate-config.js
     => That does seem to load the db in `netcreate-config.js`
     TRY: Change netcreate-config.js again midstream
     => Works fine.  No cross data clobbering.
     
TRY: New `nc.js` that starts app directly, rather than `npm` or `brunch`.
     This way we can also make use of the promise.




#### Proxy -- 2020-07-20
PRB: Goal is to map like this:
     `localhost/graph/tacitus` => `localhost:3100`
     
     Websockets will be running on unique ports, so they don't
     need to be mapped.
     
     Autoreload will be off, so we can ignore port 9485.
     
PRB: Use http-proxy-middleware
     Which itself relies on http-proxy
     
PRB: `netc-app.css` is failing
     because it's not being rerouted to :3000.
     Since the base URL is `localhost`, not `localhost/hawaii`
     it isn't rerouted.
     We need to route EVERYTHING.
     
     But you can't route everything if the db is in the path.
     Because again, secondary calls do not have the route.
     
PRB: Can we force a subdomain?
     => YES!
     
     This works better.  The submdain is always there.
     This just means you always need to start from the manager?
     
     Or is there a way to catch the request before it gets
     evaluated against the app.use calls?
     
##### => THREE FINDINGS
    1. http-proxy Using path, e.g. `localhost/hawaii/#/edit/mop/` 
       doesn't work well because it's hard to just reroute 
       the main request and not the secondary requests
       to other sources (e.g. js, css, etc.)
       
    2. http-proxy Using subdomains, e.g. `hawaii.localhost/#edit/map`
       is much cleaner and portable.
       It even works in dev environments because we can 
       subdomain localhost?
       
       But what happens with a real domain behind a DNS
       wall?  Will we be able to dynamically handle 
       subdomains?  Will we have to route EVERYTHING?
       
       And what about IP addresses?
       => Nope.  `hawaii.192.168.4.30` does not work.
          This is a MAJOR problem if we're running
          this in a classroom.
          
    3. express routes redirect, e.g. `localhost/hawaii/#/edit/mop`
       kind of works.  The problem is the redirect results in
       urls with ports, e.g. `localhost:3100/#/edit/mop`
       
       The secondary request problem isn't there because
       the actual app calls go directly to the port, e.g. 
       `localhost:3100/*`.  Only the initial db call goes to
       `localhost/hawaii`.


PRB: Can we use a static unrouted site to handle 
     all the static requests?  Do those need to be 
     routed to specific ports?  This would allow us to
     just reroute the main call and the websocket call?
     
     => Doesn't work because netcreat-config.js
        doesn't get rerouted!  It's missing in the base.
        
* Redirect ports via proxy
  --  https://stackoverflow.com/questions/23376301/how-do-i-dynamically-assign-a-port-in-nginx
      `localhost/test/4000` => `localhost:4000/test`
  => use http-proxy



#### PROXY -- 2020-07-21
PRB: Try Query e.g. `localhost/?hawaii/#/edit/mop`
     => This almost works.
        The query paramter can be pulled out.
        But netcreate-config.js call does not keep the query.
        So we still have to route `localhost` to `localhost:3000`
        to catch all non-querified requests.
        THis means netcreate-config is rerouted to the base :3000
        and loads that db.
        
PRB: Do we really need `netcreate-config.js`?
     Can we bypass that?
     * Can't dynamically require based on query?

TRY: Inject into header?
          -- port
          -- netport
          -- db
       => Problem is that js can't read the headers directly.
       
TRY: Use ?query to reroute
     The only call that keeps/uses the ?hawaii query is the 
     main call?  Though other calls do have ?hawaii as the 
     `initiator` e.g. `netcrete-config.js` has 
     Referer: http://localhost/?hawaii/
     
TRY: Use referrer when handling `netcreate-config.js`?
     Then route to proper port?
     => Referrer might be unavailable / is sometimes not defined.
     => Referrer seems to be not easy to access in the request object
     
TRY: Avoid `netcreate-config.js` altogether?
     * Initial call uses ?hawaii to set up pararameters
     * Subsequent NC_CONFIG calls are routed elsewhere?
     
     How do you load db values if they're not in NC_CONFIG?
     Can we load `netcreate-config.js` using ?query?
     
     Who calls `netcreate-config.js`?
     * SERVER-SIDE
        * brunch-config.js    <-- read by brunch-server.js?
          -- port override
          -- dataset override for packaging
        * brunch-server.js    <-- MAIN START SCRIPT
          -- ip override
          -- netport overide
          This is just an express server!
          It does not set the dataset.
        * server-database.js
          -- dataset override  <== MOST CRITICAL!!!
     * CLIENT-SIDE
        * index.html => bad call used by googlea
        * index.ejs => probably bad call used by googlea
        * nc-logic.js
          -- googlea
          -- dataset used to set db and template files
        * InfoPanel.jsx
          -- googlea
     * nc.js -- creator of course
     
     If index.html and index.ejs are the only client-side calls
     then generic re-route to 3000 should work?
     => index.ejs uses netcreate-config.js for mutliple reasons.
        Put in by sri on 5d6cfa0
        Also true for index.html
        Used for template selection.
        
     Why is this working then?
     * It probably works because nc-logic.js loads netceate-config
       only at initialization?
       
     What would it take to fully fix?
     * nc-logic.js
       -- Use query parameter to set dataset?
        
TRY: Load new db via `localhost/?newdb`?
     * We'd have to catch the new `/?` designation
     * And start up a new db
     * And ignore/prevent/block secondary js/css calls
       until the new db is up and running?
     => Seems messy, but it can work
     
TRY: Much cleaner to force db init
     e.g via `localhost/new/newdb`
     
     Solution involves two servers then:
     1. Proxy Server
        -- Routes to existing dbs or Manager
     2. Manager Server
        `localhost/admin`
        `localhost/new`
     
PRB: Newly created routes come AFTER the /?
      so they are never triggered.
      -- Do we need to delete all routes and recreate them 
        with each new db loaded?
      -- Can we re-order APIs?
      
TRY: Can we use a single formula (perhaps with parameters) 
     to reroute everything?
     => YES!  Works


PRB: With `/graph/:graph` approach, why are websockets failing?
     `auto-reload.js` seems to be trying to load ws://localhost:9488
     Where does that even come from?
     
TRY: Turn off `ws: true` in all reroutes?
     => NOPE
     
TRY: The request for netcreat-config.js is returning index.html
     So the URL rewrite is too aggressive?
     Turn off rewrite
     => That doesn't work b/c `/graph/hawaii` is not found
     Just remove `/graph/hawaii/`
     
     
PRB: Why the heck is netcreate-config.js request being made
     with `/graph` in the path?
     #### working on path,req /graph/netcreate-config.js
     #### req.params { graph: 'netcreate-config.js' }

TRY: Use `src="/netcreate-config.js"` to remove `/graph`?
     => Now it's returning empty?!?!
     
TRY: Don't we prefer `/graph/hawaii/netcreate-config.js`?
     That way we can redirect to the right port!
     => Yes.
     
     CAVEATS
     * URL has to have trailing `/`
       e.g. `http://localhost/graph/hawaii` will fail
       because without trailing `/`, the netcreate-config.js request looks like
       `http://localhost/graph/netcreate-config.js` so `netcreate-config.js`
       is treated as the `:graph` parameter.
       But `http://localhost/graph/hawaii/#/edit/mop-bugle-lme` will work
     
TRY: Do we need `/graph/hawaii/`?  Can it just be `/hawaii/`?
     => NO!
     * We need a code, otherwise, we can't distinguish between
       management calls and db calls.
     * We can use a shorter URL, e.g. `/g/`

TRY: Use Regular expressions to clean route url?
     https://expressjs.com/en/guide/routing.html
     => No need.  Using parameters instead.


#### Param vs Query -- 2020-07-22
Should we use params `localhost/graph/hawaii/` or
query `localhost/?hawaii`?

* params advantages
  -- `netcreate-config.js` is automatially requested from `/graph/hawaii/`
      with query, the url would be `localhost/netcreate-config.js?hawaii`?
  
* query advantages
  -- `/graph/hawaii` doesn't need a trailing `/`


#### Handling root / -- 2020-07-22
PRB What should the root page be?
    And how do we distinguish that from a secondary request?
    
    If we need to route / to 3000 in order to handle secondary (includes/requires)
    then how do we handle a generic request to localhost?
    
TRY app.get('/')
    => That works.  And it doesn't interfere with the general / redirect.
       e.g. `/` will go to manager, but `/netlib.js` is routed to 3000    

    

     
# CURRENT ISSUES


* Auto-start app at 3000

* Show loading?



---
---


#### MEXT -- 2020-07-19
* Catch non-trailing /, e.g. `localhost/graph/tacitus` does not run

* Stop a running process?

* Handle templates
* Remove `?database=` parameter?  Or disable it?


* List available dbs and allow startup directly from manage?

* Do we need to do a fork.send?

* Secure connections?
  --  Do we need to prevent new dbs from being created?
    
* Redo google analytics / make sure it still works
      
* How to shut down a child?
  --  If all children keep running, we might run out of resources?
  --  Should children shut down after some timeout?      



# help

If you want to watch a directory for changes (say, config files) you can use the chokidar npm package.

![img](https://ca.slack-edge.com/T02GBCZS3-U02GBCZSF-gfbfa7a03768-48)

**[ben](https://app.slack.com/team/U02GBCZSF)**[2 minutes ago](https://inquirium.slack.com/archives/C02GW9W11/p1595103594159000?thread_ts=1595091236.155700&cid=C02GW9W11)

ah, cool!

![img](https://ca.slack-edge.com/T02GBCZS3-U02H80ASU-9ee5122e31b6-48)

**[daveseah](https://app.slack.com/team/U02H80ASU)**[1 minute ago](https://inquirium.slack.com/archives/C02GW9W11/p1595103639159200?thread_ts=1595091236.155700&cid=C02GW9W11)

It's really easy to set up...you tell it a file or directory to watch, and it fires an event with the changes to your code.

![img](https://ca.slack-edge.com/T02GBCZS3-U02H80ASU-9ee5122e31b6-48)

**[daveseah](https://app.slack.com/team/U02H80ASU)**[1 minute ago](https://inquirium.slack.com/archives/C02GW9W11/p1595103666159400?thread_ts=1595091236.155700&cid=C02GW9W11)

Its the basis for most livereload packages