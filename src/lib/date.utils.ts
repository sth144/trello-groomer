import { logger } from "./logger";

export enum Weekday {
    Sunday,
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
}

export enum Months {
    Jan,
    Feb,
    Mar,
    Apr,
    May,
    Jun,
    Jul,
    Aug,
    Sep,
    Oct,
    Nov,
    Dec
}

export function getNextWeekDay(dayOfWeek: Weekday): Date {
    const today = new Date();
    const resultDate = new Date(today.getTime());
    resultDate.setDate(today.getDate() + (7 + dayOfWeek - today.getDay()) % 7);
    return resultDate;
}

export function getNDaysFromNow(n: number): Date {
    const date = new Date();
    date.setDate(date.getDate() + n);
    return date;
}

export function getRemnDaysInWeek(): number {
    let date = new Date();
    const endOfWeek = getNextWeekDay(Weekday.Sunday);
    return (+endOfWeek - +date) / (1000 * 60 * 60 * 24);
}

export function getRemnDaysInMonth(): number {
    let date = new Date();
    let time = new Date(date.getTime());
    time.setMonth(date.getMonth() + 1);
    time.setDate(0);
    return time.getDate() > date.getDate() ? time.getDate() - date.getDate() : 0;
}

export function getRemnDaysInYear(): number {
    const beginNextYear = new Date((new Date().getFullYear())+1, 0, 1);
    return diffBtwnDatesInDays(new Date(), beginNextYear)
}

export function diffBtwnDatesInDays(firstDate: Date, secondDate: Date) {
    return Math.round(((+secondDate)-(+firstDate))/(1000*60*60*24));
}

/**
 * RegEx's used to parse date, day, and time info from card titles
 */
export const DateRegexes = {
    /** date and time (hours and minutes), ex. 1941-12-07T14:00 */
    DateTimeStr: new RegExp(/\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d/),
    /** ex. Feb3@16:20 */
    MonthDayTime: new RegExp(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[0-9]{1,2}@[0-9]{1,2}(:[0-9]{1,2})?((a|A|p|P)(m|M))?/),
    /** ex. 4:20pm */
    TimeNonMil: new RegExp(/[0-9]{1,2}(:[0-9]{1,2})?(a|A|p|P)(m|M)/),
    /** day name and time, ex. Mon@13:30 */
    DayNameTime: new RegExp(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)@[0-9]{1,2}(:[0-9]{1,2})?((a|A|p|P)(m|M))?/),
    /** ex. January 2020 */
    MonthYear: new RegExp(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec){1}[a-z]{0,6} [0-9]{4}/)
}

/**
 * parses a string (card or checklist item name) for a date, time, day, etc.
 * @param inputStr name to parse
 * @param defaultDue this specifies the default due date if none parsed
 * @returns the processed input string, and the due date
 */
export function parseDueDate(inputStr: string, defaultDue: string)
    : { processedInputStr: string, dueDateStr: string } {
    let extractDue, extractTime;
    let dueDate = defaultDue;
    let processedInput = inputStr;

    if (extractDue = inputStr.match(DateRegexes.DateTimeStr)) {
        dueDate = extractDue[0];
        processedInput = inputStr.replace(DateRegexes.DateTimeStr, "");
    } else {
        if (extractDue = inputStr.match(DateRegexes.MonthDayTime)) {
            const date = new Date();
            const split = extractDue[0].split("@");
            const dayStr = split[0];

            let extractMonth = dayStr.match(/([A-Z]*|[a-z]*)*/);
            if (extractMonth !== null && extractMonth.length > 0 && extractMonth[0] !== null) {
                const monthAbbrev = extractMonth[0];
                const monthNum = getMonthNumFromAbbrev(monthAbbrev);
                if (monthNum === null) return

                let extractDay = dayStr.match(/[0-9]{1,2}/);
                if (extractDay !== null && extractDay.length > 0 && extractDay[0] !== null) {
                    const dayNum = parseInt(extractDay[0]);
                    date.setMonth(monthNum, dayNum);
                    let hourNum = 12, minutes = 0;
                    if (split.length > 1) {
                        let timeStr = split[1];
                        /** check for non-military times */
                        if (extractTime = timeStr.match(DateRegexes.TimeNonMil)) {
                            timeStr = conventionalToMilitaryTime(extractTime[0]);
                            processedInput = processedInput.replace(extractTime[0], "")
                            processedInput = processedInput.replace(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)@/, "");
                        }
                        const timeStrSplit = timeStr.split(":");
                        hourNum = parseInt(timeStrSplit[0]);
                        if (timeStrSplit.length > 1) {
                            minutes = parseInt(timeStrSplit[1]);
                        }
                    }
                    date.setHours(hourNum, minutes);

                    /** if date is prior to today in year, add a year */
                    if (+date < +(new Date())) {
                        date.setFullYear(date.getFullYear()+1);
                    }

                    dueDate = date.toString();
                }
            }
            processedInput = inputStr.replace(DateRegexes.MonthDayTime, "");
        } else if (extractDue = inputStr.match(DateRegexes.DayNameTime)) {
            logger.info(extractDue);
            const date = new Date();
            const split = extractDue[0].split("@");
            const dayStr = split[0];

            let extractDayName = dayStr.match(/([A-Z]*|[a-z]*)*/);
            if (extractDayName !== null && extractDayName.length > 0 && extractDayName[0] !== null) {
                const weekdayAbbrev = extractDayName[0];
                const weekdayNum = getWeekDayNumFromAbbrev(weekdayAbbrev);
                if (weekdayNum === null) return;

                date.setTime(getNextWeekDay(weekdayNum).getTime());
                let hourNum = 12, minutes = 0;
                if (split.length > 1) {
                    let timeStr = split[1];
                    /** check for non-military times */
                    if (extractTime = timeStr.match(DateRegexes.TimeNonMil)) {
                        timeStr = conventionalToMilitaryTime(extractTime[0]);
                        processedInput = processedInput.replace(extractTime[0], "")
                        processedInput = processedInput.replace(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)@/, "");
                    }
                    const timeStrSplit = timeStr.split(":");
                    hourNum = parseInt(timeStrSplit[0]);
                    if (timeStrSplit.length > 1) {
                        minutes = parseInt(timeStrSplit[1]);
                    }
                }
                date.setHours(hourNum, minutes);
                dueDate = date.toString();
            }
            processedInput = inputStr.replace(DateRegexes.DayNameTime, "");
        }
    }

    return {
        processedInputStr: processedInput,
        dueDateStr: dueDate
    }
}

export function getMonthNumFromAbbrev(monthAbbrev: string): number {
    const keys = Object.keys(Months);
    const namesStartAt = keys.length / 2;
    for (let i = namesStartAt, j = 0; i < keys.length; i++, j++) {
        if (monthAbbrev === keys[i]) {
            return j;
        }
    }
    return null;
}

export function getWeekDayNumFromAbbrev(weekdayNameAbbrev: string): number {
    const keys = Object.keys(Weekday);
    const namesStartAt = keys.length / 2;
    for (let i = namesStartAt, j = 0; i < keys.length; i++, j++) {
        if (keys[i].indexOf(weekdayNameAbbrev) === 0) {
            return j;
        }
    }
    return null;
}

export function conventionalToMilitaryTime(conventionalTime: string): string {
    const findDomainRgx = /(a|p|A|P)(m|M)/;
    const parseDomain = conventionalTime.match(findDomainRgx);
    let domain;
    if (parseDomain !== null && parseDomain.length > 0 && parseDomain[0] !== null) {
        domain = parseDomain[0];
    } else domain = "pm";
    conventionalTime = conventionalTime.replace(findDomainRgx, "");
    const split = conventionalTime.split(":");
    let hours = (domain === "PM" || domain === "pm") ? 12 : 0;
    hours += parseInt(split[0]);
    let minutes = 0;
    if (split.length > 1) {
        minutes = parseInt(split[1]);
    }
    return `${hours}:${minutes}`;
}