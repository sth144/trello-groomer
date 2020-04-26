# trello-groomer
A Node.js program which will remotely groom Trello board using the Trello API. Can be run as a cron-job to continuously groom the trello board. Available operations include:
 * Auto-label cards based on title
 * Auto-link related cards based on title
 * Auto-assign due dates based on title
 * Create new linked cards for items in specially named checklists, with dependency relations (allows sub-tasks)

## TODO:
### Deployment
* get Docker build working
* get Kubernetes deployment working
* get rid of deploy.sh and launch.sh
### Auto-label
* integrate stopwords into auto-label
* get rid of auto-label based on single shared word?
* stemmer
    * still want un-stemmed words in auto-label.config.json file...
* get ML model working
    * get stemming working
    * reconcile with synced config files (merge?)
    * migrate to neural net
### Tasks
* prettify JSON in auto-___.config cards