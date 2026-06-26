#!/bin/bash

WHICH_GROOMER=$1

while true
do
	echo "Starting script"
	node dist/index.js $WHICH_GROOMER
done