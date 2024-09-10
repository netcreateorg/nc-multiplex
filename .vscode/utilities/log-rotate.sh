#!/bin/bash

printf "\nThis script will rotate the log.txt file to log.txt.1, log.txt.2, etc.\n"
printf "You might actually run log-archive instead, which makes a timestamped copy.\n"
printf "\n"

# check if log.txt exists
if [ ! -f log.txt ]; then
    printf "log.txt does not exist\n"
    printf "did you copy this script to the root level of nc-multiplex?\n"
    exit 1
fi

# function to rotate log.txt.1 to log.txt.2, etc.
function rotate() {
    log_files=()
    while IFS= read -r -d '' file; do
        log_files+=("$file")
    done < <(find . -maxdepth 1 -type f -name "log.txt.*" -print0)

    # filter the file list so it's only log.txt.1, log.txt.2, etc.
    LEN=${#log_files[@]}
    for ((i=0; i<${LEN}; i++)); do
        # echo the number after log.txt and strip the leading ./ from the path, store in num var
        num=$(echo ${log_files[$i]} | sed 's/\.\/log\.txt\.//')
        # make sure num is an integer
        num=$(echo $num | sed 's/[^0-9]*//g')
        # if num is not an integer, remove it from the log_files list
        if [ -z "$num" ]; then
            unset log_files[$i]
        fi
    done
    # update LEN to the new length of the log_files array
    LEN=${#log_files[@]}
    # sort the log_files array 
    IFS=$'\n' log_files=($(sort <<<"${log_files[*]}"))

    # if log.txt exists but there are no existing rotated logs, mv log.txt to log.txt.1 and exit
    if [ ${LEN} -eq 0 ]; then
        echo "# mv log.txt log.txt.1"
        if [ "$EXEC" = true ]; then
            mv log.txt log.txt.1
        fi
        return
    fi

    # otherwise, rotate highest to highest+1 for everything
    for ((i=${LEN}-1; i>=0; i--)); do
        # otherwise, mv log.txt.i to log.txt.i+1
        echo "# mv log.txt.${i} log.txt.$((i+1))"
        if [ "$EXEC" = true ]; then
            mv log.txt.${i} log.txt.$((i+1))
        fi
    done
    # finally, mv log.txt to log.txt.0
    echo "# mv log.txt log.txt.0"
    if [ "$EXEC" = true ]; then
        mv log.txt log.txt.0
    fi
    echo "# touch log.txt"
    if [ "$EXEC" = true ]; then
        touch log.txt
    fi
}

# set EXEC to true if any argument --execute was passed in cli
EXEC=false
if [[ $* == *--execute* ]]; then
    EXEC=true
fi

# if EXEC is true, run the rotate function
if [ "$EXEC" = true ]; then
    read -p "Press any key to continue. CTRL-C to cancel." -n1 -s
    printf "\n"
    rotate
else
    printf "use --execute to actually rotate the logs instead of simulating it\n"
    printf ""
    rotate
fi



