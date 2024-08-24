#!/bin/bash

printf "\nThis script will rename the current log.txt to log-yyyy-mmdd-hhmm.txt.\n"
printf "then create a new log.txt\n"
printf "\n"

# check if log.txt exists
if [ ! -f log.txt ]; then
    printf "log.txt does not exist\n"
    printf "did you copy this script to the root level of nc-multiplex?\n"
    exit 1
fi


# POSIX check the size of log.txt and store it in SIZE
SIZE=$(wc -c < log.txt)

# if SIZE is 0, log.txt is empty so exit
if [ $SIZE -eq 0 ]; then
    printf "error: log.txt is empty, so skipping archive\n"
    exit 1
fi

# POSIX create a string based on current date and time YYYY-MMDD-HHMM
DATE=$(date +"%Y-%m%d-%H%M")


# POSIX set EXEC to true if any argument --execute was passed in cli
EXEC=false
if [ "$1" = "--execute" ]; then
    EXEC=true
fi

archive() {
    printf "# mv log.txt log-${DATE}.txt\n"
    if [ "$EXEC" = true ]; then
        mv log.txt log-${DATE}.txt
    fi
    # touch log.txt
    printf "# touch log.txt\n"
    if [ "$EXEC" = true ]; then
        touch log.txt
    fi
    printf "\nlog.txt archived to log-${DATE}.txt\n"
}

# if EXEC is true, run the rotate function
if [ "$EXEC" = true ]; then
    read -p "Press any key to continue. CTRL-C to cancel." -n1 -s
    printf "\n"
    archive
else
    printf "use --execute to actually archive log.txt instead of simulating it\n"
    printf "\n"
    archive
fi



