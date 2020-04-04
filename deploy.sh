#!/bin/bash

REMOTE_HOST=$(cat .env | grep REMOTE_HOST | sed 's/REMOTE_HOST=//g')
REMOTE_PATH=$(cat .env | grep REMOTE_PATH | sed 's/REMOTE_PATH=//g')
REMOTE_PWRD=$(cat .env | grep REMOTE_PWRD | sed 's/REMOTE_PWRD=//g')

if [ -z $REMOTE_HOST ] || [ -z $REMOTE_PATH ] || [ -z $REMOTE_PWRD ]; then 
    echo "REMOTE_HOST, REMOTE_PWRD and/or REMOTE_PATH not found in .env, please add them"
    exit 1
fi

rsync -avr -e ssh --exclude=node_modules,cache,dist,log,.git,.vscode . "$REMOTE_HOST:$REMOTE_PATH"

# NOTE: systemd service must be configured on remote host
ssh $REMOTE_HOST "cd $REMOTE_PATH; npm install && tsc -p . && echo $REMOTE_PWRD | sudo -S systemctl restart trello-groomer && exit"
