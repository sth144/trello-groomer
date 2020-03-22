#!/bin/bash

WHICH_USER=$(cat .env | grep WHICH_USER | sed 's/WHICH_USER=//g')

if [ -z $WHICH_USER ]; then 
    echo "WHICH_USER not found in .env, please add it"
    exit 1
fi

. "/home/$WHICH_USER/.nvm/nvm.sh"

npm start