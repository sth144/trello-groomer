export interface ICard {
    id: string,
    badges: any,
    name: string,
    due: string,
    dueComplete: boolean,
    dateLastActivity: string,
    idList: string,
    idLabels: string[],
    pos: number,
    shortUrl: string,
    attachments: { name: string }[],
    actions: { type: string }[]
};
