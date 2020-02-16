# trello-groomer
A Node.js program which will remotely groom Trello board using the Trello API. Can be run as a cron-job to continuously groom the trello board. Available operations include:
 * Auto-label cards based on title
 * Auto-link related cards based on title
 * Auto-assign due dates based on title
 * Create new linked cards for items in specially named checklists, with dependency relations (allows sub-tasks)
