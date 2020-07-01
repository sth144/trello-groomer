// TODO: documentation card in Trello board

import { TrelloHttpClient } from "../lib/http.client";
import { BoardModel } from "../model/board.model";
import { ICard } from "../lib/card.interface";
import { List } from "../lib/list.interface";
import { Checklist, CheckItem } from "../lib/checklist.interface";
import { ReplaySubject} from "rxjs";
import { first } from "rxjs/operators";
import { getNDaysFromNow, parseDueDate } from '../lib/date.utils';
import { logger } from "../lib/logger";
import { writeFileSync, existsSync } from "fs";
import { 
    removePropsByDotPath, detectRemovals, ConfigObj, 
    syncObjectsWithPreference, updateLiteralsByDotPath,
    detectLiteralChanges
} from "../lib/object.utils";
import { join } from "path";

/********************************************************************************************
 * BoardController exposes public methods which allow updating of Trello board. Enables     *
 *  automation of task dependencies                                                         *
 *******************************************************************************************/
export class BoardController<T extends BoardModel> {
    /**
     * emit a value to alert consumers that controller is initialized
     */
    private isAlive$ = new ReplaySubject<boolean>(1);
    public isAlive = this.isAlive$.pipe(first()).toPromise();

    public get AllLabelNames() {
        return Object.keys(this.boardModel.getLabels());
    }

    private allListsOnBoard: List[] = [];

    private httpClient: TrelloHttpClient = new TrelloHttpClient(this.secrets);
    public get NumRequests(): number {
        return this.httpClient.NumRequests;
    }

    constructor(private boardModel: T, private secrets: { key: string, token: string }) { }

    public async wakeUp() {
        await this.buildModel();

        this.isAlive$.next(true);
    }

    /**
     * asynchronously adds a card to the board (inbox)
     */
    public async addCard(opts: any, 
        toListId: string = (this.boardModel.getLists().hasOwnProperty("inbox")) ? 
            /* don't rely on / assume existence of inbox list... */
            (this.boardModel.getLists() as { inbox: { id: string } }).inbox.id : undefined)
        : Promise<ICard> {
        return await this.httpClient.asyncPost(`/cards?idList=${toListId}`, opts);
    }

    public hasLabelFilterFactory(labelName: string) {
        const targetLabelId = this.boardModel.getLabels()[labelName];

        return (card: ICard) => {
            if (card.idLabels.filter((idLabel) => idLabel === targetLabelId).length > 0)
                return true;
            return false;
        }
    }
    /**
     * create and modify cards according to task dependency system
     *  - if a card is marked done, and exists in a checklist in another card, mark the checklist item on that other
     *      card done
     *  - if a checklist item is marked done, and that checklist item is linked to a card, mark that card done
     */
    public async updateTaskDependencies(checklistName: string, ignoreLists: List[] = []) {
        /**
         * create cards for items in checklists named "checklistName"
         */
        const checklists = this.boardModel.getChecklists();
        for (const checklistId of Object.keys(checklists)) {
            /** find target checklist */
            if (checklists[checklistId].name === checklistName) {
                /** go through items */
                for (const checklistItem of checklists[checklistId].checkItems) {
                    /** check if item already has a card */
                    let alreadyExists = false;
                    for (const name of this.boardModel.getAllCardNames()) {
                        if (checklistItem.name.indexOf(name) !== -1) {
                            alreadyExists = true;
                        }
                    }

                    let parentCard;

                    /** if doesn't exist as card, and isn't complete */
                    if (!alreadyExists && checklistItem.state !== "complete" && checklistItem.name.indexOf("https://") === -1
                        /** get reference to parent card, abort if undefined */
                        && ((parentCard = this.boardModel.getCardById(checklists[checklistId].idCard)) !== undefined)) {
                        let parsedResult = parseDueDate(checklistItem.name, parentCard.due);

                        /** create a new card */
                        const childCard = await this.addCard({
                            name: parsedResult.processedInputStr,
                            due: parsedResult.dueDateStr,
                            idLabels: parentCard.idLabels
                        });

                        /** change name of checklist item to include link */
                        await this.httpClient.asyncDelete(`/checklists/${checklistId}/checkItems/${checklistItem.id}/`);
                        const replacedCheckItem = await this.httpClient.asyncPost(`/checklists/${checklistId}/checkItems/`, {
                            /** prevents multiple URLs from being inserted */
                            name: `${checklistItem.name.split("https://")[0]} ${childCard.shortUrl}`
                        });

                        /** link added card to parent @1 */
                        await this.httpClient.asyncPost(`/cards/${childCard.id}/attachments`, {
                            name: `parent:${parentCard.id}|checklistId:${checklistId}|checkItemId:${replacedCheckItem.id}`,
                            url: parentCard.shortUrl
                        });
                    }
                }
            }
        }

        /**
         * if card completed, and part of checklist, check on checklist
         */
        for (const card of this.boardModel.getAllCards().filter((x) => !ignoreLists.some(l => l.id === x.idList))) {
            /** ensure card is not complete and has attachments */
            if (card.dueComplete && card.badges.attachments > 0) {
                /** 
                 * previously fetched attachments here, no longer necessary as attachments retrieved with
                 *  initial GET request
                 */

                /** for each attachment */
                for (const attachment of card.attachments) {
                    /** if attachment has substring "parent" (meaning it is a subtask) */
                    if (attachment.name.indexOf("parent") !== -1) {
                        /** split by delimiter "|" (see @1 above) and parse */
                        let info = attachment.name.split("|");
                        const parsed: any = {};
                        for (const item of info) {
                            const split = item.split(":");
                            const prop = split[0];
                            const val = split[1];
                            Object.assign(parsed, { [prop]: val });
                        }
                        /** find checklist corresponding to card and mark item complete */
                        if (parsed.hasOwnProperty("checklistId") && parsed.hasOwnProperty("checkItemId")
                            && this.boardModel.getAllChecklistItems().filter((x) => {
                                x.id === parsed["checkItemId"] && x.state !== "complete"
                            }).length > 0) {
                            this.httpClient.asyncPut(`/cards/${parsed.parent}/checkItem/${parsed.checkItemId}?state=complete`)
                                .catch((err) => { logger.info(err); });
                        }
                    }
                }
            }
        }
    }

    /**
     * update cards according to prep dependency rules
     * TODO: document rules
     */
    public async updatePrepDependencies(targetChecklistName: string, ignoreLists: List[] = []): Promise<void> {
        const checklists = this.boardModel.getChecklists();
        const allCards = this.boardModel.getAllCards();
        let targetChecklist = null;

        /** go through all checklists */
        Object.keys(checklists).map((checklistId) => {
            /** find target checklist */
            if (checklists[checklistId].name === targetChecklistName) {
                targetChecklist = checklists[checklistId];
                targetChecklist.checkItems.map((checklistItem) => {
                    allCards.map(async (prepCard) => {
                        /** if card (prep card) exists with name */
                        if (checklistItem.name === prepCard.name) {
                            /** insert prep card shortURL into check item name */
                            await this.httpClient.asyncDelete(`/checklists/${checklistId}/checkItems/${checklistItem.id}/`);
                            const replacedCheckItem = await this.httpClient.asyncPost(`/checklists/${checklistId}/checkItems/`, {
                                /** split()[] prevents multiple URLs from being inserted */
                                name: `${checklistItem.name.split("https://")[0]} ${prepCard.shortUrl}`
                            });

                            const dependentCard = this.boardModel.getCardById(checklists[checklistId].idCard);
                            /** provide link to dependent card in prep card */
                            await this.httpClient.asyncPost(`/cards/${prepCard.id}/attachments`, {
                                name: `dependent:${dependentCard.id}|checklistId:${checklistId}|checkItemId:${replacedCheckItem.id}`,
                                url: dependentCard.shortUrl
                            });
                        }
                    });
                });
            }
        });

        /** go through all cards */
        if (targetChecklist !== null) {
            /** if card completed, and part of a prep list, check item on prep list */
            allCards.filter((card) => (card.dueComplete && card.badges.attachments > 0))
                .filter(card => !ignoreLists.some(l => l.id === card.idList))
                .map(async (card) => {
                    card.attachments.map((attachment: any) => {
                        if (attachment.name !== undefined && attachment.name.indexOf("dependent") !== -1) {
                            const parsed: any = { };
                            const info = attachment.name.split("|");
                            for (const item of info) {
                                let split = item.split(":");
                                if (split.length === 2) {
                                    Object.assign(parsed, { [split[0]]: split[1] });
                                };
                            }
                            /** find checklist corresponding dependent to card and mark item complete */
                            if (parsed.hasOwnProperty("checklistId") && parsed.hasOwnProperty("checkItemId")
                                && this.boardModel.getAllChecklistItems().filter((x) => {
                                    x.id === parsed["checkItemId"] && x.state !== "complete"
                                }).length > 0) {
                                this.httpClient.asyncPut(`/cards/${parsed.dependent}/checkItem/${parsed.checkItemId}?`
                                    + `state=complete`).catch((err) => {
                                        logger.info(err);
                                    });
                                }
                        }
                    });
                });
        }
    }

    public async updateFollowupDependencies(targetChecklistName: string, ignoreLists: List[] = []): Promise<void> {
        const checklists = this.boardModel.getChecklists();
        const allCards = this.boardModel.getAllCards();
        let targetChecklist = null;

        /** go through all checklists and find target*/
        Object.keys(checklists).filter((checklistId) => checklists[checklistId].name === targetChecklistName)
            .forEach((checklistId) => {
                targetChecklist = checklists[checklistId];
                targetChecklist.checkItems.forEach(async (checklistItem: CheckItem) => {
                    /** if doesn't exist as card, and isn't complete */
                    if (checklistItem.state !== "complete" && !(allCards.some(x => x.name.indexOf(checklistItem.name) !== -1))
                        && checklistItem.name.indexOf("https://") === -1) {

                        const parentCard = this.boardModel.getCardById(checklists[checklistId].idCard);

                        let parsedResult = parseDueDate(checklistItem.name, parentCard.due);

                        /** create a new card */
                        const childCard = await this.addCard({
                            name: parsedResult.processedInputStr,
                            due: parsedResult.dueDateStr,
                            idLabels: parentCard.idLabels
                        });

                        /** change name of checklist item to include link */
                        await this.httpClient.asyncDelete(`/checklists/${checklistId}/checkItems/${checklistItem.id}/`);
                        const replacedCheckItem = await this.httpClient.asyncPost(`/checklists/${checklistId}/checkItems/`, {
                            /** prevents multiple URLs from being inserted */
                            name: `${checklistItem.name.split("https://")[0]} ${childCard.shortUrl}`
                        });

                        /** link added card to parent @1 */
                        await this.httpClient.asyncPost(`/cards/${childCard.id}/attachments`, {
                            name: `parent:${parentCard.id}|checklistId:${checklistId}|checkItemId:${replacedCheckItem.id}`,
                            url: parentCard.shortUrl
                        });
                    }

                });
            });

        /** go through all cards */
        if (targetChecklist !== null) {
            /** if card completed, and part of a followup list, check item on followup list */
            allCards.filter((card) => (card.dueComplete && card.badges.attachments > 0))
                .filter(card => !ignoreLists.some(l => l.id === card.idList))
                .map(async (card) => {
                    card.attachments.map((attachment: any) => {
                        if (attachment.name !== undefined && attachment.name.indexOf("dependent") !== -1) {
                            const parsed: any = { };
                            const info = attachment.name.split("|");
                            for (const item of info) {
                                let split = item.split(":");
                                if (split.length === 2) {
                                    Object.assign(parsed, { [split[0]]: split[1] });
                                };
                            }
                            /** find checklist corresponding dependent to card and mark item complete */
                            if (parsed.hasOwnProperty("checklistId") && parsed.hasOwnProperty("checkItemId")
                                && this.boardModel.getAllChecklistItems().filter((x) => {
                                    x.id === parsed["checkItemId"] && x.state !== "complete"
                                }).length > 0) {
                                this.httpClient.asyncPut(`/cards/${parsed.dependent}/checkItem/${parsed.checkItemId}?`
                                    + `state=complete`).catch((err) => {
                                        logger.info(err);
                                    });
                                }
                        }
                    });
                });
        }

    }

    public async markCardsDoneIfLinkedCheckItemsDone() {
        /**
         * if checklist item completed, and has card, complete card
         */
        for (const checklistItem of this.boardModel.getAllChecklistItems()) {
            if (checklistItem.state === "complete") {
                /** check that name includes link to card */
                const splitCheckItemName = checklistItem.name.split(" https://");
                if (splitCheckItemName.length > 1) {
                    for (const card of this.boardModel.getAllCards()) {
                        if (!card.dueComplete && checklistItem.name.indexOf(card.shortUrl) !== -1) {
                            await this.httpClient.asyncPut(`/cards/${card.id}?dueComplete=true`);
                        }
                    }
                }
            }
        }
    }

    /**
     * move all cards from list to list if pass filter
     * @param fromListIds source list
     * @param toListId destination list
     * @param filter the function through which to filter all cards to determine whether or not they should
     *                  be moved
     */
    public async moveCardsFromToIf(fromListIds: string[], toListId: string, filter: (card: ICard) => boolean): Promise<void> {
        for (const fromListId of fromListIds) {
            const from: List = this.boardModel.getListById(fromListId);
            const fromListCards = from.getCards();
            for (const card of fromListCards) {
                if (filter(card)) {
                    // TODO: this should be encapsulated in a moveCard operation
                    await this.httpClient.asyncPut(`/cards/${card.id}?idList=${toListId}&pos=top`);

                    /** update local model */
                    [fromListId, toListId].forEach(async (id) => {
                        this.boardModel.getListById(id).cards = await this.httpClient.asyncGet(`/lists/${id}/cards`);
                    });
                }
            }
        }
    }

    public async assignDueDatesIf(
        listId: string, dueInDays: number, conditionFilter: (card: ICard) => boolean, randomStagger: number = null
    ) : Promise<void> {
        const createDueDate = () => {
            if (randomStagger !== null) {
                let staggerNDays = Math.floor(Math.random() * (randomStagger + 1));
                if (Math.random() < 0.5) {
                    staggerNDays *= -1;
                }
                dueInDays = Math.max(dueInDays + staggerNDays, 0);
            }
            return getNDaysFromNow(dueInDays);
        }

        const batch: Promise<any>[] = [];
        this.boardModel.getListById(listId).getCards()
            .filter(conditionFilter)
            .map((card) => {
                const newDueDate = createDueDate();
                logger.info(`Assigning due date to ${card.name}: ${newDueDate}`);
                batch.push(this.httpClient.asyncPut(`/cards/${card.id}?due=${newDueDate}`));
                card.due = newDueDate.toUTCString();
            });

        await Promise.all(batch);
    }

    public async addLabelToCardsInListIfTitleContains(labelName: string, checkFor: string[]): Promise<void>  {
        checkFor = checkFor.map(x => x !== undefined && x.toLowerCase());

        const allLabels = this.boardModel.getLabels();
        if (allLabels.hasOwnProperty(labelName) && allLabels[labelName].length > 0) {

            const labelId = this.boardModel.getLabels()[labelName];

            this.boardModel.getAllCards().forEach(async (card) => {
                const cardNameLowerCase = card.name.toLowerCase();
                
                if (checkFor.some(x => cardNameLowerCase.indexOf(x) !== -1)
                    && card.idLabels.indexOf(labelId) === -1) {
                    await this.httpClient.asyncPost(`/cards/${card.id}/idLabels?`, {
                        value: labelId
                    });
                    card.idLabels.push(labelId);
                }
            });
        }
    }

    public async markCardsInListDone(listId: string): Promise<void> {
        this.boardModel.getListById(listId).getCards()
            .filter((card) => card.due !== null)
            .filter((card) => card.dueComplete === false)
            .map(async (card) => {
                await this.httpClient.asyncPut(`/cards/${card.id}?dueComplete=true`);
            });
    }

    public async deleteCardsInListIfLabeled(listId: string, labelName: string): Promise<void> {
        this.boardModel.getListById(listId).cards.filter((card: any) => {
            return card.labels.some((l: any) => l.name === labelName);
        }).forEach(async (cardWithLabel) => {
            await this.httpClient.asyncDelete(`/cards/${cardWithLabel.id}`);
        });
    }

    public async autoLinkRelatedCards(ignorePatterns: string[]): Promise<void> {
        const allCards = this.boardModel.getAllCards();

        const labelAssociations: { [labelId: string]: ICard[] } = { };

        /** create a data structure mapping labels to cards with those label IDs */
        allCards.forEach((card) => {
            for (let labelId of card.idLabels) {
                if (!labelAssociations.hasOwnProperty(labelId)) {
                    Object.assign(labelAssociations, {
                        [labelId]: []
                    });
                }
                labelAssociations[labelId].push(card);
            }
        });

        const maxLinksAdded = 100;
        let totalLinksAdded = 0;

        Object.keys(labelAssociations).forEach(async (key) => {
            for (let cardA of labelAssociations[key]) {
                const potentialLinksForCardA: ICard[] = [];
                for (let cardB of labelAssociations[key].filter(x => x.name !== cardA.name)) {
                    /** compute common words with length > 3 */
                    const wordsInCommon: string[] = [];
                    const [wordsA, wordsB] = [cardA.name, cardB.name].map(
                        y => y.split(" ")
                            .map(x => x.toLowerCase())
                            .filter(x => x.length > 3)
                            .filter(x => ignorePatterns.indexOf(x) === -1)
                    );
                    
                    wordsA.forEach((wordA) => {
                        wordsB.forEach((wordB) => {
                            if (wordA === wordB && wordsInCommon.indexOf(wordA) === -1) {
                                wordsInCommon.push(wordA);
                            }
                        });
                    });

                    if (wordsInCommon.length > 0) {
                        potentialLinksForCardA.push(cardB);
                    }
                }

                const maxTrelloAttachments = 10;
                const numPreExistingTrelloAttachments = cardA.badges.attachmentsByType.trello.card;
                /** 
                 * if for each card for which titles share a common word > 3 characters
                 */
                if (potentialLinksForCardA.length > 0 && numPreExistingTrelloAttachments < maxTrelloAttachments) {
                    const numAttachmentsCanAdd = maxTrelloAttachments - numPreExistingTrelloAttachments;

                    /** sort linksNeeded by date (will link most recently updated cards if limited) */
                    potentialLinksForCardA.sort((a: ICard, b: ICard) => {
                        if (a.dateLastActivity === b.dateLastActivity) return 0;
                        const dateA = new Date(a.dateLastActivity), dateB = new Date(b.dateLastActivity);
                        if (+dateA > +dateB) return -1;
                        return 1;
                    });

                    let numAddedThisCard = 0;

                    const linksToAdd: ICard[] = [];

                    /** generate linksToAdd list synchronously in order to obey constraints */
                    potentialLinksForCardA.forEach((cardToLink: ICard) => {
                        /** if cards not already linked */
                        if (!cardA.attachments.some((x: unknown): boolean => {
                            return (x as { url: string }).url.indexOf(cardToLink.shortUrl) !== -1;
                        })) {
                            /** link cards (up to 10 trello attachments) */
                            if (numAddedThisCard < numAttachmentsCanAdd && totalLinksAdded < maxLinksAdded 
                                && !cardA.actions.some((a: any) => {
                                    if (a.data.hasOwnProperty("attachment")) {
                                        /** do not re-link a card which has already been linked and removed */
                                        return cardToLink.shortUrl.indexOf( a.data.attachment.name ) !== -1;
                                    } return false;
                                }) && !cardToLink.dueComplete) {
                                linksToAdd.push(cardToLink);

                                numAddedThisCard++;
                                /** increment badge value on card to affect iterations for other labels */
                                cardA.badges.attachmentsByType.trello.card++;
                                totalLinksAdded++;
                            }
                        }
                    });

                    /** post links asynchronously */
                    linksToAdd.forEach(async (cardToLink: ICard) => {
                        await this.httpClient.asyncPost(`/cards/${cardA.id}/attachments`, {
                            url: cardToLink.shortUrl
                        });
                    });
                }
            }
        });
    }
    
    public async removeDueDateFromCardsInList(listId: string): Promise<void> {
        this.boardModel.getListById(listId).getCards()
            .filter(card => card.hasOwnProperty("due") && card.due !== null && card.due !== undefined)
            .forEach(async (card) => {
                await this.httpClient.asyncPut(`/cards/${card.id}?due=null`);
            });
    }

    public async parseDueDatesFromCardNames(): Promise<void> {
        for (const card of this.boardModel.getAllCards()) {
            let parsedResult = parseDueDate(card.name, null), dueDate, parsedName;
            if (card.due === null
                && ((dueDate = parsedResult.dueDateStr) !== null)
                && ((parsedName = parsedResult.processedInputStr) !== null)) {
                await this.httpClient.asyncPut(`/cards/${card.id}?due=${dueDate}&name=${parsedName}`);
            }
        }
    }

    public async syncConfigJsonWithCard(jsonFileName: string, cardName: string) {
        const targetConfigSyncCard = this.boardModel.getCardByName(cardName);
        const configPath = join(process.cwd(), "config", jsonFileName);
        const loadedConfig = require(configPath);

        /** validate */
        if ([targetConfigSyncCard, loadedConfig].some(x => {
            return (x === undefined || typeof x !== "object")
        })) {
            return;
        }

        const updateFromCard: ConfigObj = JSON.parse(targetConfigSyncCard.desc);

        const prevConfigUpdatePath = join(process.cwd(), "cache/", `old.${jsonFileName}`);
        let prevConfigUpdate = { };

        /** check cached previous configs to check for removals */
        if (existsSync(prevConfigUpdatePath)) 
            prevConfigUpdate = require(prevConfigUpdatePath);

        /** if literal updated in config file, and not in card, overwrite card value */
        updateLiteralsByDotPath(updateFromCard, 
            detectLiteralChanges(loadedConfig as ConfigObj, prevConfigUpdate as ConfigObj));

        removePropsByDotPath(loadedConfig, detectRemovals(updateFromCard, prevConfigUpdate));
        removePropsByDotPath(updateFromCard, detectRemovals(loadedConfig, prevConfigUpdate));
        
        const configUpdate = syncObjectsWithPreference(updateFromCard, loadedConfig);

        await this.httpClient.asyncPut(`/cards/${targetConfigSyncCard.id}?desc=${JSON.stringify(configUpdate)}`)
        
        // TODO: cache these with redis?

        /** cache update from merged objects to enable detection of deletions on next pass */
        writeFileSync(prevConfigUpdatePath, JSON.stringify(configUpdate));
        writeFileSync(configPath, JSON.stringify(configUpdate, null, 4));
    }

    /**
     * initialize the board model (pull data from Trello)
     */
    private async buildModel(): Promise<void> {
        logger.info("Retrieving lists");
        // TODO: can these requests be batched?
        /**
         * get all lists on board, map to lists specified on BoardModel
         */
        this.allListsOnBoard = await this.httpClient.asyncGet(`/board/${this.boardModel.id}/lists`).catch((err) => console.error(err));
        const modelListsHandle = this.boardModel.getLists() as Record<string, List>;

        for (const responseList of this.allListsOnBoard) {
            for (const listNameToFetch of this.boardModel.getListNames()) {
                if (responseList.name.toLowerCase().indexOf(listNameToFetch) !== -1) {
                    /** create a new list object in memory for each desired list */
                    Object.assign(modelListsHandle[listNameToFetch], {
                        id: responseList.id,
                        name: responseList.name,
                        cards: []
                    });
                    /** fetch cards for list */
                    (modelListsHandle)[listNameToFetch].cards
                        = await this.httpClient.asyncGet(`/lists/${responseList.id}/cards?attachments=true&actions=deleteAttachmentFromCard,updateCard`);
                }
            }
        };

        /**
         * get all checklists on board
         */
        const checklistsOnBoard = await this.httpClient.asyncGet(`/boards/${this.boardModel.id}/checklists`);

        for (const responseChecklist of checklistsOnBoard) {
            /** create a new checklist model in memory */
            (this.boardModel.getChecklists() as any)[responseChecklist.id] = new Checklist();
            Object.assign((this.boardModel.getChecklists() as any)[responseChecklist.id], {
                id: responseChecklist.id,
                name: responseChecklist.name,
                idCard: responseChecklist.idCard,
            });
            /** populate in memory checklist model with checklist items */
            for (const responseCheckItem of responseChecklist.checkItems) {
                const newCheckItem = new CheckItem();
                Object.assign(newCheckItem, {
                    id: responseCheckItem.id,
                    idChecklist: responseCheckItem.idChecklist,
                    name: responseCheckItem.name,
                    state: responseCheckItem.state
                });
                (this.boardModel.getChecklists())[responseChecklist.id].checkItems.push(newCheckItem);
            }
        }

        logger.info("Retrieving labels");
        /**
         * get all labels on board
         */
        const allLabels = { };
        (await this.httpClient.asyncGet(`/boards/${this.boardModel.id}/labels`)).map((label: any) => {
            if (label.hasOwnProperty("id") && label.hasOwnProperty("name")) {
                Object.assign(allLabels, { [label.name]: label.id })
            }
        });

        this.boardModel.Labels = allLabels;
    }

    public async addListsToModelIfNameMeetsConditions(conditions: ((a: any) => boolean)[]): Promise<List[]> {
        const result = [];

        const modelListsHandle: any = this.boardModel.getLists();
        for (const responseList of this.allListsOnBoard) {
            let qualifies = true;
            for (const condition of conditions) {
                if (!condition(responseList)) {
                    qualifies = false  
                } 
            }
            if (qualifies && !modelListsHandle.hasOwnProperty(responseList.name)) {
                /** create a new list object in memory for each desired list */
                const newList = new List();
                Object.assign(modelListsHandle, {
                    [responseList.name]: Object.assign(newList, {
                        id: responseList.id,
                        name: responseList.name,
                        cards: []
                    })
                });
                /** fetch cards for list */
                (modelListsHandle)[responseList.name].cards
                    = await this.httpClient.asyncGet(`/lists/${responseList.id}/cards?attachments=true&actions=deleteAttachmentFromCard,updateCard`);
                result.push(newList);
            }
        }

        return result;
    }

    /** can be used to pass lists from one BoardController to another */
    public importLists(lists: List[], associatedLabels: Record<string, string>): void {
        lists.forEach(list => {
            list.cards.forEach(x => x.idLabels = this.translateLabels(x.idLabels, associatedLabels))
            this.boardModel.addList(list.name, list);
        });
    }

    /** lists imported from another board will not share the same label IDs */
    private translateLabels(inputLabels: string[], inputLabelDict: Record<string, string>): string[] {
        const result: string[] = [];
        inputLabels.forEach(inputLabelId => {
            const allLabels = this.boardModel.getLabels();
            for (const i in allLabels) {
                for (const j in inputLabelDict) {
                    if (inputLabelDict[j] === inputLabelId && i === j) {
                        result.push(allLabels[i])
                    }
                }
            }
        });
        return result;
    }

    public dump(): void {
        // TODO: merge all this label stuff into a single json file
        writeFileSync(join(process.cwd(), "cache/labels.json"), JSON.stringify(this.boardModel.getLabels()));

        const labelData: any[] = []
        this.boardModel.getAllCards().forEach(x => { 
            if (x.idLabels.length > 0) {
                labelData.push({ name: x.name, labels: x.idLabels });
            } 
        });
        writeFileSync(join(process.cwd(), "cache/label-data.json"), JSON.stringify(labelData));

        const unlabeledCards: any[] = this.boardModel.getAllCards().filter(x => x.idLabels.length === 0).map(x => x.name);
        writeFileSync(join(process.cwd(), "cache/unlabeled.json"), JSON.stringify(unlabeledCards))

        writeFileSync(join(process.cwd(), "cache/model.json"), JSON.stringify(this.boardModel, null, 4));
    }
}

