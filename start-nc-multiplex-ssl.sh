#!/bin/bash

# This script starts nc-multiplex.js on port 8080.
# This is useful when using an NGINX reverse proxy server
# to handle SSL, e.g. when deploying on DigitalOcean with HTTPS.

# this script is intended to be launched by pm2 to ensure that 
# the node process is restarted if it crashes, though you can
# also run it directly from the command line.

# the script is often run using the pm2 process manager.
# [app] is start-nc-multiplex.sh
# pm2 list 
# pm2 stop [app]      # stop the process in the pm2 list
# pm2 delete [app]    # to remove from pm2 list
# pm2 save            # to save the current list of processes
# pm2 start [app]     # to start the process

printf "starting nc-multiplex.js on port 8080 for SSL\n"
printf "for pm2 usage: see script comments for command list\n"
printf ".. browse to http://host:8080/manage for control\n"
printf ".. output is appended to log.txt\n"
printf ".. press ctrl+c to stop.\n"

# start the node process (sri's version)
node nc-multiplex --port=8080 >> log.txt 2>&1