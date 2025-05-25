const winston = require('winston');

let logfileIdentifier = '';
if (process.argv.length >= 3) {
  logfileIdentifier = process.argv[2];
}

export const logger = winston.createLogger({
  transports: [
    /**
     * info transport, prints to file on disk
     */
    new winston.transports.File({
      level: 'info',
      filename: `log/info.${logfileIdentifier}.log`,
      handleExceptions: true,
      format: winston.format.printf(({ message }: { message: string }) => {
        if (message !== undefined && message.hasOwnProperty('replace')) {
          let formatted = `${message.replace('\n', '')}`;
          return formatted;
        } else {
          return message;
        }
      }),
      /** maxsize, maxFiles, and tailable configure log rotation scheme */
      maxsize: 500000,
      maxFiles: 3,
      tailable: true,
      options: {
        flags: 'w',
        colorize: true,
      },
    }),
    /**
     * debug transport, prints output to the console
     */
    new winston.transports.Console({
      level: 'info',
      format: winston.format.printf(({ message }: { message: string }) => {
        if (message !== undefined && message.hasOwnProperty('replace')) {
          let formatted = `${message.replace('\n', '')}`;
          return formatted;
        } else {
          return message;
        }
      }),
      handleExceptions: true,
    }),
  ],
  exitOnError: false,
});
