REMOTE_HOST=$(cat .env | grep REMOTE_HOST | sed 's/REMOTE_HOST=//g')
REMOTE_PATH=$(cat .env | grep REMOTE_PATH | sed 's/REMOTE_PATH=//g')

if [ -z $REMOTE_HOST ] || [ -z $REMOTE_PATH ]; then
    echo "Add REMOTE_HOST and REMOTE_PATH properties to .env file, ie.:"
    echo "REMOTE_HOST=exampleuser@123.4.5.678"
    echo "REMOTE_PATH=/home/Projects/trello-groomer"
fi

rsync -avr -e ssh --exclude=node_modules . "$REMOTE_HOST:$REMOTE_PATH"
ssh $REMOTE_HOST "cd $REMOTE_PATH && npm install && tsc -p . && exit"