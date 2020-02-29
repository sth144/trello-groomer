import { getRemnDaysInWeek, getRemnDaysInMonth, getRemnDaysInYear } from "./date.utils";

export function parseAutoDueConfig(path: string) {
    const result = { };
    const autoDueConfigRaw = require(path)
    Object.entries(autoDueConfigRaw).forEach((x: [string, unknown]) => {
        if (typeof x[1] === "object") {
            if (x[1].hasOwnProperty("periodType")) {
                if (!x[1].hasOwnProperty("endOfPeriod")) Object.assign(x[1], { endOfPeriod: true });
                if (!x[1].hasOwnProperty("dividePeriodBy")) Object.assign(x[1], { dividePeriodBy: 1 });
                if (!x[1].hasOwnProperty("multiplyPeriodBy")) Object.assign(x[1], { multiplyPeriodBy: 1 });

                let numerator, numDays;

                switch((x[1] as { periodType: string }).periodType) {
                    case "week": {
                        if ((x[1] as { endOfPeriod: boolean }).endOfPeriod) 
                            numerator = getRemnDaysInWeek();
                        else
                            numerator = 7;
                        break;
                    }
                    case "month": {
                        if ((x[1] as { endOfPeriod: boolean }).endOfPeriod) 
                            numerator = getRemnDaysInMonth();
                        else
                            numerator = 30;
                        break;
                    }
                    case "year": {
                        if ((x[1] as { endOfPeriod: boolean }).endOfPeriod) 
                            numerator = getRemnDaysInYear();
                        else
                            numerator = 365;
                        break;
                    }
                }

                numDays = Math.round(
                    (x[1] as { multiplyPeriodBy: number }).multiplyPeriodBy * numerator 
                        / (x[1] as { dividePeriodBy: number }).dividePeriodBy);

                Object.assign(result, {
                    [x[0]]: numDays
                })
            }
        } else if (typeof x[1] === "number") {
            Object.assign(result, {
                [x[0]]: Math.round(x[1])
            });
        }
    });
    return result;
}