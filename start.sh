#!/bin/bash

# this script is intended to be launched by pm2 to ensure that 
# the node process is restarted if it crashes, though you can
# also run it directly from the command line.

printf "starting nc-multiplex-sri.js\n"
printf ".. browse to http://host:80/manage for control\n"
printf ".. output is appended to log.txt\n"
printf ".. press ctrl+c to stop.\n"

# start the node process (sri's version)
node nc-multiplex-sri >> log.txt 2>&1