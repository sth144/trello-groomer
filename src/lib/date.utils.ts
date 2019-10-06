export enum Weekday {
    Sunday,
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
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