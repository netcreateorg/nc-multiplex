# nc-router

2020-07-19 Test a node-based router to actual netcreate app.
This does not use Docker







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



#### MEXT 2020-07-19
* Return a promise when the app is actually created?  Is that even possible?
  -- nc-start.js script stops at nc.js.  So the promise is not resolved.
  
* How to handle startup
  --  Any new graph is going to take a minute to start up, unless...
      --  Is it possible to run precompiled versions? So only the db load is slow?
  --  Once a graph has started, a redirect should work if user doesn't change URL
  --  Copy and paste of URL is invalid b/c of port values will change
      --  Is it possible to do port routing?
      --  Maybe opening a db always requires initially hitting the router?
      
* How to handle the redirect after request?
  --  Is it possible to redirect to ports without showing the port number?
      REQUEST: nc.com/graph/tacitus
      ROUTER:  nc.com:3100/graph/tacitus
      It doesn't seem like it's possible?
      
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