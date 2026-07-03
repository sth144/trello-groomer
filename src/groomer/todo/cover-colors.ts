import { cosineSimilarity } from "../../lib/embeddings";

/********************************************************************************************
 * Decide a Trello card cover color from the label it is semantically closest to.           *
 *                                                                                          *
 * Each label carries a Trello color already; a card's cover color becomes the color of      *
 * whichever label its embedding is nearest to (by cosine) - even a label the card does not   *
 * actually carry. Cards with no strong match fall back to a deterministic hash color so      *
 * every card still gets a stable, repeatable cover.                                         *
 *******************************************************************************************/

/** colors Trello accepts for a card cover */
export const COVER_COLORS = [
  "green", "yellow", "orange", "red", "purple",
  "blue", "sky", "lime", "pink", "black",
] as const;

export type CoverColor = (typeof COVER_COLORS)[number];

const COVER_COLOR_SET = new Set<string>(COVER_COLORS);

export interface LabelVector {
  name: string;
  /** the label's Trello color, or null if it has none */
  color: string | null;
  vec: number[];
}

export interface CoverColorDecision {
  color: CoverColor;
  /** which label drove the choice, or null when the hash fallback was used */
  matchedLabel: string | null;
  score: number;
}

/**
 * Map a raw Trello label color to a valid cover color. Trello label colors share the
 * cover palette but may carry shade suffixes (e.g. "green_light"); strip to the base.
 */
export function normalizeToCoverColor(raw: string | null | undefined): CoverColor | null {
  if (!raw) return null;
  const base = String(raw).toLowerCase().split("_")[0];
  return COVER_COLOR_SET.has(base) ? (base as CoverColor) : null;
}

/** deterministic, stable mapping from arbitrary text to a cover color */
export function hashToCoverColor(text: string): CoverColor {
  let hash = 0;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % COVER_COLORS.length;
  return COVER_COLORS[index];
}

/** find the label whose vector is most cosine-similar to the card vector */
export function pickNearestLabel(
  cardVec: number[],
  labels: LabelVector[]
): { label: LabelVector | null; score: number } {
  let best: LabelVector | null = null;
  let bestScore = -Infinity;
  for (const label of labels) {
    const score = cosineSimilarity(cardVec, label.vec);
    if (score > bestScore) {
      bestScore = score;
      best = label;
    }
  }
  return { label: best, score: best ? bestScore : 0 };
}

/**
 * Choose a cover color for a card. Uses the nearest label's color when the match is
 * confident enough and that label has a usable color; otherwise hashes the card title.
 *
 * @param fallbackText text hashed for the deterministic fallback (typically the card name)
 * @param minScore minimum cosine similarity required to trust the nearest label
 */
export function decideCoverColor(
  cardVec: number[],
  labels: LabelVector[],
  fallbackText: string,
  minScore: number
): CoverColorDecision {
  const { label, score } = pickNearestLabel(cardVec, labels);
  if (label && score >= minScore) {
    const color = normalizeToCoverColor(label.color);
    if (color) {
      return { color, matchedLabel: label.name, score };
    }
    // nearest label has no usable Trello color: derive a stable one from its name
    return { color: hashToCoverColor(label.name), matchedLabel: label.name, score };
  }
  return { color: hashToCoverColor(fallbackText), matchedLabel: null, score };
}
