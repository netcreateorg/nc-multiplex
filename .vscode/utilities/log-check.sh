#!/bin/bash

# check if log.txt exists
if [ ! -f log.txt ]; then
    printf "log.txt does not exist\n"
    printf "did you copy this script to the root level of nc-multiplex?\n"
    exit 1
fi

# this script looks for restarts
BGBLU=$(tput setab 4)$(tput setaf 7)
RST=$(tput sgr0)

printf "\n${BGBLU} SERVER STARTS in LOG.TXT ${RST}\n"
cat log.txt | grep "nc-multiplex started"

printf "\n${BGBLU} DATASET LAUNCHES ${RST}\n"
cat log.txt | grep "instance confirmed"

printf "\n${BGBLU} ERRORS FOUND ${RST}\n"
ERRS=$(cat log.txt | grep "Error:")
if [ -z "$ERRORS" ]; then
  printf ".. No errors found\n"
else
  printf "$ERRORS"
fi
printf "\n"
