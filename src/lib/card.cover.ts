import { ICard } from "./card.interface";

/**
 * True if the card already has a cover of any kind (uploaded image, attached image,
 * or a solid color). Callers that also treat managed attachments as a cover should
 * layer that check on top of this one.
 */
export function hasCardCover(card: ICard): boolean {
  const cover = card.cover;
  return Boolean(
    cover?.idAttachment || cover?.idUploadedBackground || cover?.color
  );
}
