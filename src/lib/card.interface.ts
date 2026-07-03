export interface ICard {
  id: string;
  badges: any;
  name: string;
  desc: string;
  due: string;
  dueComplete: boolean;
  dateLastActivity: string;
  idList: string;
  idLabels: string[];
  idBoard: string;
  pos: number;
  shortUrl: string;
  attachments: { name: string; url?: string }[];
  cover?: {
    color?: string;
    idAttachment?: string;
    idUploadedBackground?: string | boolean;
  };
  actions: IAction[];
}

export interface IAction {
  type: string;
  data: Record<string, Record<string, unknown> | string | number>;
  date: string;
}
