export class CheckItem {
  id: string = '';
  idChecklist: string = '';
  name: string = '';
  state: string = '';
}

export class Checklist {
  id: string = '';
  name: string = '';
  idCard: string = '';
  checkItems: CheckItem[] = [];
}
