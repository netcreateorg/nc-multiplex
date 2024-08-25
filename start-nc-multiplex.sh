#!/bin/bash

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

printf "starting nc-multiplex.js\n"
printf ".. browse to http://host:80/manage for control\n"
printf ".. output is appended to log.txt\n"
printf ".. press ctrl+c to stop.\n"
printf "using pm2? commands are listed in script comments.\n"

# start the node process (sri's version)
node nc-multiplex >> log.txt 2>&1