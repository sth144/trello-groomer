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

/**
 * RegEx's used to parse date, day, and time info from card titles
 */
export const DueDateRegexes = {
    /** date and time (hours and minutes), ex. 1941-12-07T14:00 */
    DateTimeStr: new RegExp(/\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d/),
    /** ex. Feb3@16:20 */
    MonthDayTime: new RegExp(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[0-9]{1,2}(@[0-9]{1,2}(:[0-9]{1,2})*)?/),
    /** day name and time, ex. Mon@13:30 */
    DayNameTime: new RegExp(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)@[0-9]{1,2}(:[0-9]{1,2})?/),
}

// TODO: apply this to all cards, not just new task dependency items...

/**
 * parses a string (card or checklist item name) for a date, time, day, etc.
 * @param inputStr name to parse
 * @param defaultDue this specifies the default due date if none parsed
 * @returns the processed input string, and the due date
 */
export function parseDueDate(inputStr: string, defaultDue: string)
    : { processedInputStr: string, dueDateStr: string } {
    let extractDue;
    let dueDate = defaultDue;
    let processedInput = inputStr;

    if (extractDue = inputStr.match(DueDateRegexes.DateTimeStr)) {
        dueDate = extractDue[0];
        processedInput = inputStr.replace(DueDateRegexes.DateTimeStr, "");
    } else if (extractDue = inputStr.match(DueDateRegexes.MonthDayTime)) {
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
                    const timeStr = split[1];
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
        processedInput = inputStr.replace(DueDateRegexes.MonthDayTime, "");
        console.log("NOW PROCESSED INPUT ");
        console.log(processedInput);
    } else if (extractDue = inputStr.match(DueDateRegexes.DayNameTime)) {
        const date = new Date();
        const split = extractDue[0].split("@");
        const dayNameStr = split[0];
        let extractDayName = dayNameStr.match(/([A-Z]*|[a-z]*)*/);
        if (extractDayName !== null && extractDayName.length > 0 && extractDayName[0] !== null) {
            const weekdayAbbrev = extractDayName[0];
            const weekdayNum = getWeekDayNumFromAbbrev(weekdayAbbrev);
            if (weekdayNum === null) return;

            date.setTime(getNextWeekDay(weekdayNum).getTime());
            let hourNum = 12, minutes = 0;
            if (split.length > 1) {
                const timeStr = split[1];
                const timeStrSplit = timeStr.split(":");
                hourNum = parseInt(timeStrSplit[0]);
                if (timeStrSplit.length > 1) {
                    minutes = parseInt(timeStrSplit[1]);
                }
            }
            date.setHours(hourNum, minutes);
            dueDate = date.toString();
        }
        processedInput = inputStr.replace(DueDateRegexes.DayNameTime, "");
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

