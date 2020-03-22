const winston = require("winston");

export const logger = winston.createLogger({            
    transports: [
        /**
         * info transport, prints to file on disk
         */
        new winston.transports.File({
            level: "info",
            filename: "log/info.log",
            handleExceptions: true,
            format: winston.format.printf(({ message }: { message: string }) => {
                let formatted = `${message.replace("\n", "")}`;
                return formatted;
            }),
            /** maxsize, maxFiles, and tailable configure log rotation scheme */
            maxsize: 500000,
            maxFiles: 3,
            tailable: true,
            options: {
                flags: "w",
                colorize: true
            }
        }),
        /**
         * debug transport, prints output to the console
         */
        new winston.transports.Console({
            level: "info",
            format: winston.format.printf(({ message }: { message: string }) => {
                let formatted = `${message.replace("\n", "")}`;
                return formatted;
            }),
            handleExceptions: true
        })
    ],
    exitOnError: false
});