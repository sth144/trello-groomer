import { BoardController } from "@base/controller/board.controller";
import { ToDoBoardModel } from "../todo.groomer";
import { ICard } from "@base/lib/card.interface";
import { hasCardCover } from "../../lib/card.cover";
import { logger } from "../../lib/logger";
import {
  createEmbedder,
  Embedder,
  EmbedderKind,
} from "../../lib/embeddings";
import {
  decideCoverColor,
  LabelVector,
} from "./cover-colors";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

/********************************************************************************************
 * Auto-beautify the To Do board:                                                           *
 *   1. ensure every card carries at least one label (catch-all fallback for the unmatched)  *
 *   2. give every coverless card a cover color drawn from the label it is closest to in      *
 *      meaning (embedding cosine), with a deterministic hash fallback                        *
 *******************************************************************************************/

interface BeautifyConfig {
  enabled: boolean;
  applyCovers: boolean;
  ensureLabels: boolean;
  fallbackLabelName: string;
  fallbackLabelColor: string;
  maxCoversPerRun: number;
  embedding: {
    prefer: EmbedderKind[];
    /** override min cosine score to trust a label; null uses a per-backend default */
    minScore: number | null;
    openai?: { apiKey: string; model?: string; endpoint?: string };
    local?: { model?: string };
  };
}

const DEFAULTS: BeautifyConfig = {
  enabled: true,
  applyCovers: true,
  ensureLabels: true,
  fallbackLabelName: "Misc",
  fallbackLabelColor: "black",
  maxCoversPerRun: 60,
  embedding: {
    prefer: ["local", "openai", "tfidf"],
    minScore: null,
  },
};

/** dense backends produce confident scores; lexical tfidf scores run much lower */
const DEFAULT_MIN_SCORE: Record<EmbedderKind, number> = {
  local: 0.3,
  openai: 0.3,
  tfidf: 0.12,
};

function loadConfig(): BeautifyConfig {
  const path = join(process.cwd(), "config", "beautify.config.todo.json");
  if (!existsSync(path)) return DEFAULTS;
  try {
    const loaded = JSON.parse(readFileSync(path, "utf8"));
    return {
      ...DEFAULTS,
      ...loaded,
      embedding: { ...DEFAULTS.embedding, ...(loaded.embedding || {}) },
    };
  } catch (e) {
    logger.info(`Failed to read beautify config, using defaults: ${String(e)}`);
    return DEFAULTS;
  }
}

function loadLabelKeywords(): Record<string, string[]> {
  const path = join(process.cwd(), "config", "auto-label.config.todo.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/** build one "document" per label from its name plus any configured keywords */
function buildLabelDocs(
  labelNames: string[],
  keywords: Record<string, string[]>
): string[] {
  return labelNames.map((name) => {
    const extra = keywords[name] ? ` ${keywords[name].join(" ")}` : "";
    return `${name}${extra}`;
  });
}

function cardDoc(card: ICard): string {
  return `${card.name || ""} ${card.desc || ""}`.trim();
}

async function ensureCardLabels(
  controller: BoardController<ToDoBoardModel>,
  cards: ICard[],
  config: BeautifyConfig
): Promise<number> {
  const unlabeled = cards.filter((c) => (c.idLabels || []).length === 0);
  if (unlabeled.length === 0) return 0;

  const fallbackId = await controller.ensureLabel(
    config.fallbackLabelName,
    config.fallbackLabelColor
  );
  let added = 0;
  for (const card of unlabeled) {
    await controller.addLabelToCard(card.id, fallbackId);
    card.idLabels.push(fallbackId);
    added++;
  }
  logger.info(`Beautify: added fallback label to ${added} unlabeled card(s)`);
  return added;
}

function buildLabelVectors(
  labelNames: string[],
  labelColors: Record<string, string>,
  labelVecs: number[][]
): LabelVector[] {
  return labelNames.map((name, i) => ({
    name,
    color: labelColors[name] || null,
    vec: labelVecs[i],
  }));
}

async function applyCoverColors(
  controller: BoardController<ToDoBoardModel>,
  cards: ICard[],
  labelVectors: LabelVector[],
  embedder: Embedder,
  config: BeautifyConfig
): Promise<number> {
  const coverless = cards
    .filter((c) => c.name && !hasCardCover(c))
    .slice(0, config.maxCoversPerRun);
  if (coverless.length === 0) return 0;

  const minScore =
    config.embedding.minScore ?? DEFAULT_MIN_SCORE[embedder.kind];
  const cardVecs = await embedder.embed(coverless.map(cardDoc));

  let colored = 0;
  for (let i = 0; i < coverless.length; i++) {
    const card = coverless[i];
    const decision = decideCoverColor(
      cardVecs[i],
      labelVectors,
      card.name,
      minScore
    );
    try {
      await controller.setCardCoverColor(card.id, decision.color);
      card.cover = { ...(card.cover || {}), color: decision.color };
      colored++;
      logger.info(
        `Beautify: "${card.name}" -> ${decision.color}` +
          ` (${decision.matchedLabel || "hash"}, cos=${decision.score.toFixed(2)})`
      );
    } catch (e) {
      logger.info(`Beautify: failed to set cover for "${card.name}": ${String(e)}`);
    }
  }
  return colored;
}

export async function processBeautification(
  controller: BoardController<ToDoBoardModel>
): Promise<void> {
  const config = loadConfig();
  if (!config.enabled) {
    logger.info("Beautify: disabled by config");
    return;
  }

  const cards = controller.BoardModel.getAllCards().filter(Boolean);
  if (config.ensureLabels) {
    await ensureCardLabels(controller, cards, config);
  }
  if (!config.applyCovers) return;

  const labelNames = Object.keys(controller.BoardModel.getLabels());
  if (labelNames.length === 0) {
    logger.info("Beautify: no labels on board, skipping cover coloring");
    return;
  }

  const labelDocs = buildLabelDocs(labelNames, loadLabelKeywords());
  const embedder = await createEmbedder({
    prefer: config.embedding.prefer,
    tfidfCorpus: labelDocs,
    openai: config.embedding.openai,
    local: config.embedding.local,
  });

  const labelVecs = await embedder.embed(labelDocs);
  const labelVectors = buildLabelVectors(
    labelNames,
    controller.BoardModel.getLabelColors(),
    labelVecs
  );

  const colored = await applyCoverColors(
    controller,
    cards,
    labelVectors,
    embedder,
    config
  );
  logger.info(`Beautify: set cover color on ${colored} card(s)`);
}
