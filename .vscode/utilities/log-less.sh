#!/bin/bash

printf "\nThis script will strip the ansi codes from the log file and pipe it to less\n"
printf "It may take a few seconds to to load, so be patient! Type 'q' to quit when done.\n"
printf "\n"

# check if log.txt exists
if [ ! -f log.txt ]; then
    printf "log.txt does not exist\n"
    printf "did you copy this script to the root level of nc-multiplex?\n"
    exit 1
fi

# wait for keyboard confirm before continuing
read -p "Press any key to continue... " -n1 -s
printf "\n"

npx strip-ansi-cli < log.txt | less

printf "\nless 'nc-multiplex/log.txt' complete\n"
printf "\n"
