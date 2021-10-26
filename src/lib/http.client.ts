import { logger } from "./logger";

/** allow insecure requests for development */
// process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const request = require("request");

export class TrelloHttpClient {
    private numRequestsSent: number = 0;
    public get NumRequests(): number {
        return this.numRequestsSent;
    }

    constructor(private secrets: { key: string, token: string }) { }

    /********************************************************************************************
     * Private methods which interact with the Trello API to retrieve / manipulate remote data  *
     ********************************************************************************************/

    public async asyncGet(url: string): Promise<any> {
        this.numRequestsSent++;


        return new Promise((resolve, reject) => {
            request({
                method: "GET",
                uri: this.getLongUrl(url),
                timeout: 60000
            }, (err: Error, response: Response, body: string) => {
                let result = null;

logger.info(`For GET ${url}`);
logger.info(` ${JSON.stringify(err)}`);
logger.info("Response: ");
logger.info(` ${JSON.stringify(response)}`);
logger.info("Body: ")
logger.info(` ${body}`);

                if (body !== undefined && body !== null) {
                    try {
                        result = JSON.parse(body)

                        resolve(result);
                    } catch(e) {

                        logger.error(`${err} ${e} ${JSON.stringify(response)}`);
                        reject(e);
                    }
                }
            });
        });
    }

    public async asyncPut(url: string): Promise<any> {
        this.numRequestsSent++;

        const printUrl = url.replace("\n", "").replace("\t", "").replace("\r", "");
        logger.info(`${this.NumRequests}.) PUT ${printUrl}`);

        return new Promise((resolve, reject) => {
            request({
                method: "PUT",
                uri: this.getLongUrl(url),
                timeout: 60000
            }, (err: Error, response: Response, body: string) => {

logger.info(`For PUT ${url}`);
logger.info(` ${JSON.stringify(err)}`);
logger.info("Response: ");
logger.info(` ${JSON.stringify(response)}`);
logger.info("Body: ")
logger.info(` ${body}`);

                let result = null;
                if (body !== undefined && body !== null) {
                    try {
                        result = JSON.parse(body)
                        resolve(result);
                    } catch(e) {

                        logger.error(`${err} ${e} ${JSON.stringify(response)}`);
                        reject(e);
                    }
                }
            });
        });
    }

    public async asyncPost(url: string, opts: any): Promise<any> {
        this.numRequestsSent++;

        logger.info(`POST ${url} ${JSON.stringify(opts)}`);

        return new Promise((resolve, reject) => {
            let params = "";
            for (let prop of Object.keys(opts)) {
                params = params.concat(`&${prop}=${opts[prop]}`);
            }
            const uri = `${this.getLongUrl(url)}${params}`;
            request({
                method: "POST",
                uri: uri,
                timeout: 60000
            }, (err: Error, response: Response, body: string) => {
                let result = null;
                
logger.info(`For POST ${url}`);
logger.info(` ${JSON.stringify(err)}`);
logger.info("Response: ");
logger.info(` ${JSON.stringify(response)}`);
logger.info("Body: ")
logger.info(` ${body}`);


                if (body !== undefined && body !== null) {
                    try {
                        result = JSON.parse(body)
                        resolve(result);
                    } catch(e) {

                        logger.error(`${err} ${e} ${JSON.stringify(response)}`);
                        reject(e);
                    }
                }
            });
        });
    }

    public async asyncDelete(url: string): Promise<any> {
        this.numRequestsSent++;

        logger.info(`DELETE ${url}`);

        return new Promise((resolve, reject) => {
            request({
                method: "DELETE",
                uri: this.getLongUrl(url),
                timeout: 60000
            }, (err: Error, response: Response, body: string) => {
                let result = null;

logger.info(`For DELETE ${url}`);
logger.info(` ${JSON.stringify(err)}`);
logger.info("Response: ");
logger.info(` ${JSON.stringify(response)}`);
logger.info("Body: ")
logger.info(` ${body}`);

                if (body !== undefined && body !== null) {
                    try {
                        result = JSON.parse(body)``
                        resolve(result);
                    } catch(e) {
                        logger.error(`${err} ${e} ${response}`);
                        reject(e);
                    }
                }
            });
        });
    }

    /**
     * takes a URL path and returns a full url, with domain, key and token
     */
    private getLongUrl(path: string): string {
        let end = `key=${this.secrets.key}&token=${this.secrets.token}`;
        if (path.indexOf("?") === -1) {
            end = "?".concat(end);
        } else {
            end = "&".concat(end);
        }
        return `https://api.trello.com/1${path}${end}`;
    }
   
}