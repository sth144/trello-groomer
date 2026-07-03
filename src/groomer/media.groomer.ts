import { BoardController } from "../controller/board.controller";
import { BoardModel } from "../model/board.model";
import { logger } from "../lib/logger";
import { List } from "../lib/list.interface";
import { ICard } from "../lib/card.interface";
import { hasCardCover as sharedHasCardCover } from "../lib/card.cover";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "fs";
import { dirname, join } from "path";

enum MediaBoardLists {
  inbox = "inbox",
  backlog_books = "books",
  backlog_music = "music",
  backlog_movies = "movies",
  backlog_tv = "tv",
  backlog_games = "games",
  backlog_food = "food",
  in_progress = "progress",
  done = "done",
  backburner = "backburner",
}

export type MediaType =
  | "book"
  | "movie"
  | "tv"
  | "music"
  | "game"
  | "food"
  | "unknown";

type ProviderSource =
  | "heuristic"
  | "tmdb"
  | "omdb"
  | "itunes"
  | "google_books"
  | "musicbrainz"
  | "openai"
  | "cache";

export type Classification = {
  type: MediaType;
  confidence: number;
  source: ProviderSource;
  evidence?: string;
  title?: string;
  year?: string;
  artworkUrl?: string;
  metadataUrl?: string;
  externalId?: string;
  usage?: OpenAIUsage;
};

type Enrichment = {
  artworkUrl?: string;
  metadataUrl?: string;
  streamingProviders?: string[];
};

type SecretsConfig = {
  omdb?: { apiKey: string };
  googleBooks?: { apiKey?: string };
  tmdb?: { apiKey: string };
  openai?: {
    apiKey: string;
    model: string;
    endpoint?: string;
  };
  runtime?: {
    maxExternalCallsPerRun?: number;
    maxOpenAICallsPerRun?: number;
    maxCardsPerRun?: number;
    maxArtworkBackfillPerRun?: number;
    onlyInbox?: boolean;
    cachePath?: string;
    cacheTtlDays?: number;
    minConfidenceToAct?: number;
    applyLabels?: boolean;
    applyArtwork?: boolean;
    applyStreamingProviders?: boolean;
    backfillArtworkAcrossBoard?: boolean;
    moveLabeledCardsAcrossBoard?: boolean;
    updateUsageCard?: boolean;
    usageCardName?: string;
    streamingRegion?: string;
    minDelayMsBetweenExternalCalls?: number;
  };
};

type CacheEntry = {
  classification: Classification;
  enrichment?: Enrichment;
  labelTypes?: MediaType[];
  decidedAt: string;
};

type CacheFile = {
  version: number;
  byTitle: Record<string, CacheEntry>;
};

type GoogleBooksCandidate = {
  classification: Classification;
  strongMatch: boolean;
  exactTitleMatch: boolean;
};

type OpenAIUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
};

type RunUsage = {
  openaiCalls: number;
  openaiInputTokens: number;
  openaiOutputTokens: number;
  openaiModels: Record<string, number>;
};

const CONFIG_PATH = join(process.cwd(), "config", "media_groomer.secrets.json");
const CACHE_VERSION = 6;
const MEDIA_GROOMER_ATTACHMENT_PREFIX = "media-groomer:";
const DESCRIPTION_START = "<!-- media-groomer:start -->";
const DESCRIPTION_END = "<!-- media-groomer:end -->";
const EXTERNAL_BUDGET_EXHAUSTED = "External API budget exhausted";
const LOW_CONFIDENCE_UNKNOWN_CACHE_TTL_DAYS = 1;

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^a-z0-9\s:()\-+&]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForCompare(s: string): string {
  return normalizeTitle(s)
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lookupTitle(title: string): string {
  return title
    .replace(/\[(movie|film|tv|show|series|book|music|album|game|food)\]/gi, " ")
    .replace(/^(movie|film|tv|show|series|book|music|album|game|food)\s*[:|-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureDir(path: string) {
  const d = dirname(path);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function atomicWriteJson(path: string, obj: unknown) {
  ensureDir(path);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  renameSync(tmp, path);
}

function readConfig(): SecretsConfig {
  if (!existsSync(CONFIG_PATH)) {
    return {};
  }
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as SecretsConfig;
}

export function loadMediaCache(cachePath: string): CacheFile {
  if (!existsSync(cachePath)) return { version: CACHE_VERSION, byTitle: {} };
  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as CacheFile;
    if (parsed.version !== CACHE_VERSION) {
      return { version: CACHE_VERSION, byTitle: {} };
    }
    return {
      version: CACHE_VERSION,
      byTitle: parsed.byTitle || {},
    };
  } catch {
    return { version: CACHE_VERSION, byTitle: {} };
  }
}

export function mediaCacheEntryIsFresh(entry: CacheEntry, ttlDays: number) {
  const t = new Date(entry.decidedAt).getTime();
  if (!Number.isFinite(t)) return false;
  const effectiveTtlDays =
    entry.classification?.type === "unknown" &&
    entry.classification.confidence < 0.75
      ? Math.min(ttlDays, LOW_CONFIDENCE_UNKNOWN_CACHE_TTL_DAYS)
      : ttlDays;
  return Date.now() - t <= effectiveTtlDays * 24 * 60 * 60 * 1000;
}

export function typeToListName(type: MediaType): MediaBoardLists | null {
  switch (type) {
    case "book":
      return MediaBoardLists.backlog_books;
    case "movie":
      return MediaBoardLists.backlog_movies;
    case "tv":
      return MediaBoardLists.backlog_tv;
    case "music":
      return MediaBoardLists.backlog_music;
    case "game":
      return MediaBoardLists.backlog_games;
    case "food":
      return MediaBoardLists.backlog_food;
    default:
      return null;
  }
}

export function typeToLabelName(type: MediaType): string | null {
  switch (type) {
    case "book":
      return "Books";
    case "movie":
      return "Movies";
    case "tv":
      return "Television";
    case "music":
      return "Music";
    case "game":
      return "Games";
    case "food":
      return "Food & Restaurants";
    default:
      return null;
  }
}

function labelNameToType(labelName: string): MediaType | null {
  switch (labelName) {
    case "Books":
      return "book";
    case "Movies":
      return "movie";
    case "Television":
      return "tv";
    case "Music":
      return "music";
    case "Games":
      return "game";
    case "Food & Restaurants":
      return "food";
    default:
      return null;
  }
}

function primaryTypeFromLabels(types: MediaType[]): MediaType | null {
  const priority: MediaType[] = ["movie", "tv", "music", "game", "food", "book"];
  return priority.find((type) => types.includes(type)) || null;
}

function isLikelyBookTitle(title: string) {
  const t = normalizeTitle(title);
  if (/\b(movie|film|season|episode|series|show)\b/.test(t)) return false;
  return /\bby\s+[a-z]+\s+[a-z]/.test(t) ||
    /\b(novel|memoir|paperback|hardcover|audiobook|kindle|chapter|book\s+\d+|vol\.?|volume)\b/.test(
      t
    );
}

function isGenericGoogleBooksHit(titleRaw: string, classification: Classification) {
  if (classification.source !== "google_books") return false;
  if (isLikelyBookTitle(titleRaw)) return false;
  const input = normalizeForCompare(lookupTitle(titleRaw));
  const matched = normalizeForCompare(classification.title || "");
  if (matched === input) return true;
  return matched.includes(input) && !/\bbook\s+\d+\b/.test(matched);
}

function uniqueMediaTypes(types: MediaType[]) {
  return types.filter(
    (type, index) => type !== "unknown" && types.indexOf(type) === index
  );
}

export function shouldMoveNewlyClassifiedCard(opts: {
  shouldClassifyUnlabeled: boolean;
  isProtectedList: boolean;
  isInboxCard: boolean;
  moveLabeledCardsAcrossBoard: boolean;
}) {
  return (
    opts.shouldClassifyUnlabeled &&
    !opts.isProtectedList &&
    (opts.isInboxCard || opts.moveLabeledCardsAcrossBoard)
  );
}

export function shouldFetchArtworkForLabeledCard(opts: {
  needsArtwork: boolean;
  shouldMoveByLabel: boolean;
  shouldCorrectManaged: boolean;
}) {
  return (
    opts.needsArtwork &&
    !opts.shouldMoveByLabel &&
    !opts.shouldCorrectManaged
  );
}

function isLikelyMusicTitle(title: string) {
  return /\b(album|ep|single|tracklist|spotify|bandcamp|vinyl|lp)\b/.test(
    normalizeTitle(title)
  );
}

function hasExistingManagedAttachment(card: ICard) {
  return (card.attachments || []).some((a) =>
    String(a.name || "").startsWith(MEDIA_GROOMER_ATTACHMENT_PREFIX)
  );
}

function hasManagedDescription(card: ICard) {
  return String(card.desc || "").includes(DESCRIPTION_START);
}

function managedByMediaGroomer(card: ICard) {
  return hasManagedDescription(card) || hasExistingManagedAttachment(card);
}

function hasCardCover(card: ICard) {
  return sharedHasCardCover(card) || hasExistingManagedAttachment(card);
}

export function upsertMediaDescriptionBlock(
  existingDescription: string,
  classification: Classification,
  enrichment: Enrichment
): string {
  const lines = [
    DESCRIPTION_START,
    "Media Groomer",
    `Type: ${classification.type}`,
    `Confidence: ${classification.confidence.toFixed(2)} (${classification.source})`,
  ];

  if (classification.title) lines.push(`Matched title: ${classification.title}`);
  if (classification.year) lines.push(`Year: ${classification.year}`);
  if (classification.evidence) lines.push(`Evidence: ${classification.evidence}`);
  if (enrichment.metadataUrl) lines.push(`Source: ${enrichment.metadataUrl}`);
  if (enrichment.streamingProviders?.length) {
    lines.push(`Streaming: ${enrichment.streamingProviders.join(", ")}`);
  }
  lines.push(DESCRIPTION_END);

  const block = lines.join("\n");
  const current = existingDescription || "";
  const start = current.indexOf(DESCRIPTION_START);
  const end = current.indexOf(DESCRIPTION_END);
  if (start !== -1 && end !== -1 && end >= start) {
    return `${current.slice(0, start).trimEnd()}\n\n${block}\n\n${current
      .slice(end + DESCRIPTION_END.length)
      .trimStart()}`.trim();
  }
  return `${current.trimEnd()}\n\n${block}`.trim();
}

export function heuristicClassify(titleRaw: string): Classification | null {
  const t = normalizeTitle(titleRaw);
  if (!t || t.length < 3) {
    return {
      type: "unknown",
      confidence: 0.99,
      source: "heuristic",
      evidence: "too short",
    };
  }
  if (["test", "asdf", "qwerty", "todo"].includes(t)) {
    return {
      type: "unknown",
      confidence: 0.99,
      source: "heuristic",
      evidence: "junk title",
    };
  }

  let scoreBook = 0;
  let scoreTv = 0;
  let scoreMovie = 0;
  let scoreMusic = 0;
  let scoreGame = 0;
  let scoreFood = 0;

  if (/\b(movie|film)\b/.test(t)) scoreMovie += 8;
  if (/\b(tv|show|series)\b/.test(t)) scoreTv += 8;
  if (/\b(book|novel|memoir|audiobook)\b/.test(t)) scoreBook += 8;
  if (/\b(album|music|song|single|ep)\b/.test(t)) scoreMusic += 8;
  if (/\b(game|steam|ps5|xbox|switch)\b/.test(t)) scoreGame += 8;
  if (/\b(food|restaurant|recipe)\b/.test(t)) scoreFood += 8;

  if (/\bs\d{1,2}\s*e\d{1,2}\b/.test(t) || /\bseason\s+\d+\b/.test(t) || /\bs\d{1,2}\b/.test(t)) {
    scoreTv += 4;
  }
  if (/\b(episode|miniseries|series|limited series|showrunner)\b/.test(t)) {
    scoreTv += 2;
  }
  if (/\b(film|movie|1080p|2160p|4k|bluray|brrip|webrip|imax|runtime)\b/.test(t)) {
    scoreMovie += 3;
  }
  if (/\(\s*(19|20)\d{2}\s*\)/.test(t)) scoreMovie += 1;
  if (isLikelyBookTitle(titleRaw)) scoreBook += 4;
  if (isLikelyMusicTitle(titleRaw)) scoreMusic += 4;
  if (/\b(steam|ps5|xbox|switch|gameplay|walkthrough|quest|dlc)\b/.test(t)) {
    scoreGame += 4;
  }
  if (/\b(recipe|cook|bake|marinate|sous vide|ingredients|restaurant)\b/.test(t)) {
    scoreFood += 4;
  }

  const candidates = ([
    ["tv", scoreTv, "matched tv patterns"],
    ["movie", scoreMovie, "matched movie patterns"],
    ["book", scoreBook, "matched book patterns"],
    ["music", scoreMusic, "matched music patterns"],
    ["game", scoreGame, "matched game patterns"],
    ["food", scoreFood, "matched food patterns"],
  ] as Array<[MediaType, number, string]>).sort((a, b) => b[1] - a[1]);

  const [bestType, bestScore, bestEvidence] = candidates[0];
  if (bestScore <= 0) return null;
  const gap = bestScore - candidates[1][1];
  return {
    type: bestType,
    confidence: clamp01(0.55 + 0.1 * bestScore + 0.08 * gap),
    source: "heuristic",
    evidence: bestEvidence,
  };
}

async function fetchWithBackoff(
  url: string,
  init: any,
  opts: { maxRetries: number; baseDelayMs: number; jitterMs: number }
): Promise<any> {
  let attempt = 0;
  while (true) {
    try {
      const res = await (globalThis as any).fetch(url, init);
      if ((res.status === 429 || res.status >= 500) && attempt < opts.maxRetries) {
        attempt++;
        const delay =
          opts.baseDelayMs * Math.pow(2, attempt) +
          Math.floor(Math.random() * opts.jitterMs);
        await sleep(delay);
        continue;
      }
      return res;
    } catch (e) {
      if (attempt < opts.maxRetries) {
        attempt++;
        const delay =
          opts.baseDelayMs * Math.pow(2, attempt) +
          Math.floor(Math.random() * opts.jitterMs);
        await sleep(delay);
        continue;
      }
      throw e;
    }
  }
}

function tmdbHeaders(config: SecretsConfig) {
  return config.tmdb?.apiKey
    ? { Authorization: `Bearer ${config.tmdb.apiKey}` }
    : {};
}

async function tmdbLookup(
  titleRaw: string,
  typeHint: MediaType | null,
  config: SecretsConfig
): Promise<Classification | null> {
  if (!config.tmdb?.apiKey) return null;

  const queryTitle = lookupTitle(titleRaw);
  const endpoint =
    typeHint === "movie" || typeHint === "tv"
      ? `https://api.themoviedb.org/3/search/${typeHint === "tv" ? "tv" : "movie"}`
      : "https://api.themoviedb.org/3/search/multi";
  const url = `${endpoint}?query=${encodeURIComponent(queryTitle)}&include_adult=false&language=en-US&page=1`;
  const res = await fetchWithBackoff(
    url,
    { method: "GET", headers: tmdbHeaders(config) },
    { maxRetries: 3, baseDelayMs: 250, jitterMs: 250 }
  );
  if (!res.ok) return null;
  const data = await res.json().catch((): any => null);
  const results = Array.isArray(data?.results) ? data.results : [];
  const normalized = normalizeForCompare(queryTitle);
  const match = results.find((item: any) => {
    const mediaType = typeHint === "movie" || typeHint === "tv" ? typeHint : item.media_type;
    if (!["movie", "tv"].includes(mediaType)) return false;
    const itemTitle = normalizeForCompare(item.title || item.name || "");
    return itemTitle === normalized || itemTitle.includes(normalized) || normalized.includes(itemTitle);
  });
  if (!match) return null;

  const type = (typeHint === "movie" || typeHint === "tv" ? typeHint : match.media_type) as MediaType;
  const posterPath = match.poster_path ? `https://image.tmdb.org/t/p/w500${match.poster_path}` : undefined;
  const title = match.title || match.name;
  const year = String(match.release_date || match.first_air_date || "").slice(0, 4) || undefined;
  return {
    type,
    confidence: 0.93,
    source: "tmdb",
    evidence: `TMDb ${type} match`,
    title,
    year,
    artworkUrl: posterPath,
    metadataUrl: `https://www.themoviedb.org/${type === "tv" ? "tv" : "movie"}/${match.id}`,
    externalId: String(match.id),
  };
}

async function tmdbStreamingProviders(
  classification: Classification,
  config: SecretsConfig
): Promise<string[]> {
  if (!config.tmdb?.apiKey || !classification.externalId) return [];
  if (!["movie", "tv"].includes(classification.type)) return [];
  const region = config.runtime?.streamingRegion || "US";
  const url = `https://api.themoviedb.org/3/${classification.type === "tv" ? "tv" : "movie"}/${classification.externalId}/watch/providers`;
  const res = await fetchWithBackoff(
    url,
    { method: "GET", headers: tmdbHeaders(config) },
    { maxRetries: 3, baseDelayMs: 250, jitterMs: 250 }
  );
  if (!res.ok) return [];
  const data = await res.json().catch((): any => null);
  const regionInfo = data?.results?.[region];
  const providers = ([] as any[])
    .concat(regionInfo?.flatrate || [])
    .concat(regionInfo?.ads || [])
    .concat(regionInfo?.free || [])
    .map((p) => String(p.provider_name || ""))
    .filter(Boolean);
  return providers.filter((p, i) => providers.indexOf(p) === i).slice(0, 12);
}

async function omdbLookup(titleRaw: string, apiKey: string): Promise<Classification | null> {
  const url = `https://www.omdbapi.com/?apikey=${encodeURIComponent(apiKey)}&t=${encodeURIComponent(lookupTitle(titleRaw))}`;
  const res = await fetchWithBackoff(
    url,
    { method: "GET" },
    { maxRetries: 3, baseDelayMs: 250, jitterMs: 250 }
  );
  const data = await res.json().catch((): any => null);
  if (!data || data.Response !== "True") return null;

  const omdbType = String(data.Type || "").toLowerCase();
  const type: MediaType =
    omdbType === "movie" ? "movie" : omdbType === "series" || omdbType === "episode" ? "tv" : "unknown";
  if (type === "unknown") return null;
  return {
    type,
    confidence: 0.9,
    source: "omdb",
    evidence: `OMDb Type=${omdbType}`,
    title: data.Title,
    year: data.Year,
    artworkUrl: data.Poster && data.Poster !== "N/A" ? data.Poster : undefined,
    metadataUrl: data.imdbID ? `https://www.imdb.com/title/${data.imdbID}/` : undefined,
    externalId: data.imdbID,
  };
}

async function itunesLookup(
  titleRaw: string,
  typeHint: MediaType | null
): Promise<Classification | null> {
  const queryTitle = lookupTitle(titleRaw);
  const normalized = normalizeForCompare(queryTitle);
  const searchTypes: MediaType[] =
    typeHint === "movie" || typeHint === "tv" ? [typeHint] : ["movie", "tv"];

  for (const searchType of searchTypes) {
    const params = new URLSearchParams({
      term: queryTitle,
      country: "US",
      limit: "5",
      media: searchType === "tv" ? "tvShow" : "movie",
      entity: searchType === "tv" ? "tvSeason" : "movie",
    });
    const res = await fetchWithBackoff(
      `https://itunes.apple.com/search?${params}`,
      { method: "GET" },
      { maxRetries: 3, baseDelayMs: 250, jitterMs: 250 }
    );
    if (!res.ok) continue;
    const data = await res.json().catch((): any => null);
    const results = Array.isArray(data?.results) ? data.results : [];
    const match = results.find((item: any) => {
      const itemTitle = normalizeForCompare(
        item.trackName || item.collectionName || item.artistName || ""
      );
      return itemTitle === normalized;
    });
    if (!match) continue;

    const artwork = String(match.artworkUrl100 || "")
      .replace(/100x100bb\.(jpg|png|webp)$/i, "600x600bb.$1")
      .replace(/100x100-75\.(jpg|png|webp)$/i, "600x600-75.$1");
    return {
      type: searchType,
      confidence: 0.84,
      source: "itunes",
      evidence: `iTunes ${searchType === "tv" ? "TV" : "movie"} exact title match`,
      title: match.trackName || match.collectionName,
      year: String(match.releaseDate || "").slice(0, 4) || undefined,
      artworkUrl: artwork || undefined,
      metadataUrl: match.trackViewUrl || match.collectionViewUrl,
      externalId: match.trackId ? String(match.trackId) : match.collectionId ? String(match.collectionId) : undefined,
    };
  }

  return null;
}

async function googleBooksLookup(
  titleRaw: string,
  apiKey?: string
): Promise<GoogleBooksCandidate | null> {
  const queryTitle = lookupTitle(titleRaw);
  const q = `intitle:${queryTitle}`;
  const base = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5`;
  const url = apiKey ? `${base}&key=${encodeURIComponent(apiKey)}` : base;
  const res = await fetchWithBackoff(
    url,
    { method: "GET" },
    { maxRetries: 3, baseDelayMs: 250, jitterMs: 250 }
  );
  const data = await res.json().catch((): any => null);
  if (!Array.isArray(data?.items) || data.items.length === 0) return null;

  const normalized = normalizeForCompare(queryTitle);
  const top = data.items[0];
  const info = top.volumeInfo || {};
  const topTitle = normalizeForCompare(String(info.title || ""));
  const exactTitleMatch = topTitle === normalized;
  const strongMatch =
    exactTitleMatch ||
    (normalized.length > 5 && topTitle.includes(normalized)) ||
    (topTitle.length > 5 && normalized.includes(topTitle));
  if (!strongMatch && !isLikelyBookTitle(titleRaw)) return null;

  const artwork =
    info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || undefined;
  return {
    strongMatch,
    exactTitleMatch,
    classification: {
      type: "book",
      confidence: strongMatch ? 0.9 : 0.76,
      source: "google_books",
      evidence: strongMatch ? "Google Books close title match" : "Google Books book-like title hit",
      title: info.title,
      year: String(info.publishedDate || "").slice(0, 4) || undefined,
      artworkUrl: artwork ? String(artwork).replace(/^http:/, "https:") : undefined,
      metadataUrl: info.infoLink,
      externalId: top.id,
    },
  };
}

async function musicBrainzLookup(titleRaw: string): Promise<Classification | null> {
  if (!isLikelyMusicTitle(titleRaw)) return null;
  const url = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(lookupTitle(titleRaw))}&fmt=json&limit=5`;
  const res = await fetchWithBackoff(
    url,
    {
      method: "GET",
      headers: {
        "User-Agent": "trello-groomer/1.0.0 (https://github.com/sth144/trello-groomer)",
      },
    },
    { maxRetries: 3, baseDelayMs: 1000, jitterMs: 250 }
  );
  if (!res.ok) return null;
  const data = await res.json().catch((): any => null);
  const groups = Array.isArray(data?.["release-groups"]) ? data["release-groups"] : [];
  const normalized = normalizeForCompare(titleRaw);
  const match = groups.find((g: any) => normalizeForCompare(g.title || "") === normalized) || groups[0];
  if (!match?.id) return null;
  return {
    type: "music",
    confidence: normalizeForCompare(match.title || "") === normalized ? 0.86 : 0.76,
    source: "musicbrainz",
    evidence: "MusicBrainz release-group match",
    title: match.title,
    year: String(match["first-release-date"] || "").slice(0, 4) || undefined,
    artworkUrl: `https://coverartarchive.org/release-group/${match.id}/front-500`,
    metadataUrl: `https://musicbrainz.org/release-group/${match.id}`,
    externalId: match.id,
  };
}

async function openaiLastResortClassify(
  titleRaw: string,
  openai: Required<SecretsConfig>["openai"]
): Promise<Classification> {
  const endpoint = openai.endpoint || "https://api.openai.com/v1/responses";
  const body = {
    model: openai.model,
    input: [
      {
        role: "system",
        content:
          "Classify short media titles into one of: book, movie, tv, music, game, food, unknown. " +
          "If a title is a movie or TV show and also has a book tie-in, choose movie or tv as the primary type. Be conservative.",
      },
      {
        role: "user",
        content: `Return compact JSON with type, confidence, evidence for title: ${titleRaw}`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "media_classification",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["book", "movie", "tv", "music", "game", "food", "unknown"],
            },
            confidence: { type: "number" },
            evidence: { type: "string" },
          },
          required: ["type", "confidence", "evidence"],
        },
      },
    },
  };

  const res = await fetchWithBackoff(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openai.apiKey}`,
      },
      body: JSON.stringify(body),
    },
    { maxRetries: 3, baseDelayMs: 500, jitterMs: 500 }
  );
  const data = await res.json().catch((): any => null);
  const usage: OpenAIUsage | undefined = data?.usage
    ? {
        inputTokens: Number(data.usage.input_tokens || 0),
        outputTokens: Number(data.usage.output_tokens || 0),
        totalTokens: Number(data.usage.total_tokens || 0),
        model: openai.model,
      }
    : undefined;
  if (!res.ok) {
    return {
      type: "unknown",
      confidence: 0,
      source: "openai",
      evidence: data?.error?.message || `OpenAI status ${res.status}`,
      usage,
    };
  }

  const text =
    data?.output_text ||
    data?.output?.[0]?.content?.find((c: any) => c?.type === "output_text")?.text ||
    data?.output?.[0]?.content?.[0]?.text;
  try {
    const parsed = JSON.parse(text);
    const type = parsed.type as MediaType;
    if (!["book", "movie", "tv", "music", "game", "food", "unknown"].includes(type)) {
      throw new Error("invalid type");
    }
    return {
      type,
      confidence: clamp01(Number(parsed.confidence || 0)),
      source: "openai",
      evidence: String(parsed.evidence || "OpenAI classification"),
      usage,
    };
  } catch {
    return {
      type: "unknown",
      confidence: 0,
      source: "openai",
      evidence: "OpenAI returned unparsable response",
      usage,
    };
  }
}

export class MediaBoardModel extends BoardModel {
  lists: Record<MediaBoardLists, List> = {
    [MediaBoardLists.inbox]: new List(),
    [MediaBoardLists.backlog_books]: new List(),
    [MediaBoardLists.backlog_music]: new List(),
    [MediaBoardLists.backlog_movies]: new List(),
    [MediaBoardLists.backlog_tv]: new List(),
    [MediaBoardLists.backlog_games]: new List(),
    [MediaBoardLists.backlog_food]: new List(),
    [MediaBoardLists.in_progress]: new List(),
    [MediaBoardLists.done]: new List(),
    [MediaBoardLists.backburner]: new List(),
  };

  constructor(id: string) {
    super();
    this._id = id;
  }
}

export const MediaGroomer = function () {
  let start: Date;
  let mediaModel: MediaBoardModel;
  let mediaController: BoardController<MediaBoardModel>;
  let config: SecretsConfig = {};
  let externalCallsRemaining = 10;
  let openaiCallsRemaining = 2;
  let initialExternalCallBudget = 10;
  let initialOpenAICallBudget = 2;
  let lastExternalCallAt = 0;
  const runUsage: RunUsage = {
    openaiCalls: 0,
    openaiInputTokens: 0,
    openaiOutputTokens: 0,
    openaiModels: {},
  };

  const initialize = async () => {
    start = new Date();
    logger.info("Started " + start.toString());
    config = readConfig();
    const secrets = require("../../config/key.json");
    const boards = require("../../config/boards.json");
    initialExternalCallBudget = config.runtime?.maxExternalCallsPerRun ?? 10;
    initialOpenAICallBudget = config.runtime?.maxOpenAICallsPerRun ?? 2;
    externalCallsRemaining = initialExternalCallBudget;
    openaiCallsRemaining = initialOpenAICallBudget;

    logger.info("Building model");
    mediaModel = new MediaBoardModel(boards.media.id);
    logger.info("Initializing controllers");
    mediaController = new BoardController<MediaBoardModel>(mediaModel, {
      key: secrets.key,
      token: secrets.token,
    });
    await mediaController.wakeUp();
    await mediaController.ensureLabel("Games", "pink");
  };

  async function spendExternalCallOrThrow() {
    if (externalCallsRemaining <= 0) {
      throw new Error(EXTERNAL_BUDGET_EXHAUSTED);
    }
    const delay = config.runtime?.minDelayMsBetweenExternalCalls ?? 250;
    const since = Date.now() - lastExternalCallAt;
    if (since < delay) await sleep(delay - since);
    externalCallsRemaining--;
    lastExternalCallAt = Date.now();
  }

  function bestMovieOrTvCandidate(candidates: Classification[]) {
    return candidates
      .filter((x) => x.type === "movie" || x.type === "tv")
      .sort((a, b) => b.confidence - a.confidence)[0];
  }

  async function classifyTitle(title: string, cache: CacheFile): Promise<CacheEntry> {
    const ttlDays = config.runtime?.cacheTtlDays ?? 3650;
    const key = normalizeTitle(title);
    const cached = cache.byTitle[key];
    if (cached && mediaCacheEntryIsFresh(cached, ttlDays)) {
      return {
        ...cached,
        classification: {
          ...cached.classification,
          source: "cache",
        },
      };
    }

    const h = heuristicClassify(title);
    const typeHint = h && h.confidence >= 0.75 ? h.type : null;
    const tried: Classification[] = [];
    const bookSignals: Classification[] = [];

    if (config.tmdb?.apiKey) {
      try {
        await spendExternalCallOrThrow();
        const tmdb = await tmdbLookup(title, typeHint, config);
        if (tmdb) tried.push(tmdb);
      } catch (e) {
        if (String(e).includes(EXTERNAL_BUDGET_EXHAUSTED)) throw e;
        logger.info(`TMDb skipped/failed for "${title}": ${String(e)}`);
      }
    }

    if (config.omdb?.apiKey) {
      try {
        await spendExternalCallOrThrow();
        const omdb = await omdbLookup(title, config.omdb.apiKey);
        if (omdb) tried.push(omdb);
      } catch (e) {
        if (String(e).includes(EXTERNAL_BUDGET_EXHAUSTED)) throw e;
        logger.info(`OMDb skipped/failed for "${title}": ${String(e)}`);
      }
    }

    try {
      if (!bestMovieOrTvCandidate(tried) || typeHint === "movie" || typeHint === "tv") {
        await spendExternalCallOrThrow();
        const itunes = await itunesLookup(title, typeHint);
        if (itunes) tried.push(itunes);
      }
    } catch (e) {
      if (String(e).includes(EXTERNAL_BUDGET_EXHAUSTED)) throw e;
      logger.info(`iTunes skipped/failed for "${title}": ${String(e)}`);
    }

    try {
      if (isLikelyBookTitle(title) || tried.length === 0 || config.openai?.apiKey) {
        await spendExternalCallOrThrow();
        const gb = await googleBooksLookup(title, config.googleBooks?.apiKey);
        if (gb && isLikelyBookTitle(title)) {
          if (gb.exactTitleMatch || gb.strongMatch) {
            bookSignals.push(gb.classification);
          }
          if (!isGenericGoogleBooksHit(title, gb.classification)) {
            tried.push(gb.classification);
          }
        }
      }
    } catch (e) {
      if (String(e).includes(EXTERNAL_BUDGET_EXHAUSTED)) throw e;
      logger.info(`Google Books skipped/failed for "${title}": ${String(e)}`);
    }

    try {
      if (isLikelyMusicTitle(title)) {
        await spendExternalCallOrThrow();
        const mb = await musicBrainzLookup(title);
        if (mb) tried.push(mb);
      }
    } catch (e) {
      if (String(e).includes(EXTERNAL_BUDGET_EXHAUSTED)) throw e;
      logger.info(`MusicBrainz skipped/failed for "${title}": ${String(e)}`);
    }

    const nonBookBest = tried
      .filter((x) => x.type !== "book")
      .sort((a, b) => b.confidence - a.confidence)[0];
    const bestBook = tried
      .filter((x) => x.type === "book")
      .sort((a, b) => b.confidence - a.confidence)[0];
    const best = nonBookBest || bestBook;

    let classification: Classification = best;
    if (classification && h && h.confidence > classification.confidence && h.type === classification.type) {
      classification = {
        ...classification,
        confidence: h.confidence,
        evidence: `${classification.evidence}; ${h.evidence}`,
      };
    }
    if (!classification && h && h.confidence >= 0.75) classification = h;

    if (
      (!classification || (classification.type === "book" && !isLikelyBookTitle(title))) &&
      config.openai?.apiKey &&
      config.openai?.model
    ) {
      try {
        await spendExternalCallOrThrow();
        if (openaiCallsRemaining <= 0) throw new Error("OpenAI budget exhausted");
        openaiCallsRemaining--;
        const openaiClassification = await openaiLastResortClassify(
          title,
          config.openai as any
        );
        runUsage.openaiCalls++;
        if (openaiClassification.usage) {
          runUsage.openaiInputTokens += openaiClassification.usage.inputTokens;
          runUsage.openaiOutputTokens += openaiClassification.usage.outputTokens;
          runUsage.openaiModels[openaiClassification.usage.model] =
            (runUsage.openaiModels[openaiClassification.usage.model] || 0) + 1;
        }
        if (
          openaiClassification.confidence >= 0.7 &&
          (openaiClassification.type !== "book" || isLikelyBookTitle(title))
        ) {
          tried.push(openaiClassification);
          classification = openaiClassification;
        } else if (!classification && openaiClassification.confidence >= 0.75) {
          classification = openaiClassification;
        }
      } catch (e) {
        if (String(e).includes(EXTERNAL_BUDGET_EXHAUSTED)) throw e;
        logger.info(`OpenAI skipped/failed for "${title}": ${String(e)}`);
      }
    }

    if (
      classification?.type === "book" &&
      !isLikelyBookTitle(title) &&
      isGenericGoogleBooksHit(title, classification)
    ) {
      classification = null;
    }

    if (!classification) {
      classification = {
        type: h?.type ?? "unknown",
        confidence: h ? Math.min(h.confidence, 0.74) : 0.5,
        source: "heuristic",
        evidence: h?.evidence || "no confident signal",
      };
    }
    const labelTypes = uniqueMediaTypes(
      [classification.type].concat(
        tried.map((x) => x.type),
        bookSignals.map((x) => x.type)
      )
    );

    const enrichment: Enrichment = {
      artworkUrl: classification.artworkUrl,
      metadataUrl: classification.metadataUrl,
    };
    if (
      config.runtime?.applyStreamingProviders !== false &&
      config.tmdb?.apiKey &&
      classification.externalId &&
      ["movie", "tv"].includes(classification.type)
    ) {
      try {
        await spendExternalCallOrThrow();
        enrichment.streamingProviders = await tmdbStreamingProviders(classification, config);
      } catch (e) {
        logger.info(`Streaming provider lookup skipped/failed for "${title}": ${String(e)}`);
      }
    }

    const entry = {
      classification,
      enrichment,
      labelTypes,
      decidedAt: new Date().toISOString(),
    };
    cache.byTitle[key] = entry;
    return entry;
  }

  function mediaTypesFromCardLabels(card: ICard): MediaType[] {
    const labels = mediaModel.getLabels();
    const labelIdToName: Record<string, string> = {};
    Object.keys(labels).forEach((name) => {
      labelIdToName[labels[name]] = name;
    });

    return uniqueMediaTypes(
      (card.idLabels || [])
        .map((labelId) => labelNameToType(labelIdToName[labelId]))
        .filter(Boolean) as MediaType[]
    );
  }

  async function lookupKnownType(
    title: string,
    type: MediaType
  ): Promise<Classification | null> {
    switch (type) {
      case "book": {
        try {
          await spendExternalCallOrThrow();
          const gb = await googleBooksLookup(title, config.googleBooks?.apiKey);
          return gb?.classification || null;
        } catch (e) {
          if (String(e).includes(EXTERNAL_BUDGET_EXHAUSTED)) throw e;
          logger.info(`Book artwork lookup skipped/failed for "${title}": ${String(e)}`);
          return null;
        }
      }
      case "movie":
      case "tv": {
        try {
          if (config.tmdb?.apiKey) {
            await spendExternalCallOrThrow();
            const tmdb = await tmdbLookup(title, type, config);
            if (tmdb) return tmdb;
          }
          if (config.omdb?.apiKey) {
            await spendExternalCallOrThrow();
            const omdb = await omdbLookup(title, config.omdb.apiKey);
            if (omdb) return omdb;
          }
          await spendExternalCallOrThrow();
          const itunes = await itunesLookup(title, type);
          if (itunes) return itunes;
        } catch (e) {
          if (String(e).includes(EXTERNAL_BUDGET_EXHAUSTED)) throw e;
          logger.info(`Movie/TV artwork lookup skipped/failed for "${title}": ${String(e)}`);
        }
        return null;
      }
      case "music": {
        try {
          await spendExternalCallOrThrow();
          return await musicBrainzLookup(title);
        } catch (e) {
          if (String(e).includes(EXTERNAL_BUDGET_EXHAUSTED)) throw e;
          logger.info(`Music artwork lookup skipped/failed for "${title}": ${String(e)}`);
          return null;
        }
      }
      default:
        return null;
    }
  }

  async function entryFromLabels(
    card: ICard,
    fetchArtwork: boolean
  ): Promise<CacheEntry | null> {
    const labelTypes = mediaTypesFromCardLabels(card);
    const primaryType = primaryTypeFromLabels(labelTypes);
    if (!primaryType) return null;

    const providerClassification = fetchArtwork
      ? await lookupKnownType(card.name, primaryType)
      : null;
    const usableProviderClassification =
      providerClassification?.type === primaryType ? providerClassification : null;
    const classification: Classification = usableProviderClassification || {
      type: primaryType,
      confidence: 1,
      source: "heuristic",
      evidence: "existing Trello media label",
    };
    return {
      classification,
      enrichment: {
        artworkUrl: classification.artworkUrl,
        metadataUrl: classification.metadataUrl,
      },
      labelTypes,
      decidedAt: new Date().toISOString(),
    };
  }

  async function enrichCard(
    card: ICard,
    classification: Classification,
    enrichment: Enrichment
  ): Promise<boolean> {
    let changed = false;
    if (config.runtime?.applyArtwork !== false && enrichment.artworkUrl && !hasCardCover(card)) {
      await mediaController.attachUrlToCard(
        card.id,
        enrichment.artworkUrl,
        `${MEDIA_GROOMER_ATTACHMENT_PREFIX} ${classification.type} artwork`,
        true
      );
      changed = true;
    }

    const hasMetadata =
      enrichment.metadataUrl ||
      enrichment.streamingProviders?.length ||
      classification.source !== "heuristic";
    if (hasMetadata) {
      const nextDescription = upsertMediaDescriptionBlock(card.desc || "", classification, enrichment);
      if (nextDescription !== (card.desc || "")) {
        await mediaController.updateCardDescription(card.id, nextDescription);
        card.desc = nextDescription;
        changed = true;
      }
    }
    return changed;
  }

  async function updateUsageCard(summary: {
    considered: number;
    moved: number;
    labeled: number;
    enriched: number;
  }) {
    if (config.runtime?.updateUsageCard === false) return;

    const cardName = config.runtime?.usageCardName || "Media Groomer Usage";
    const modelLines = Object.keys(runUsage.openaiModels).length
      ? Object.keys(runUsage.openaiModels)
          .sort()
          .map((model) => `- ${model}: ${runUsage.openaiModels[model]} calls`)
          .join("\n")
      : "- none";
    const desc = [
      "# Media Groomer Usage",
      "",
      `Last run: ${new Date().toISOString()}`,
      "",
      "## Run activity",
      `- Cards considered: ${summary.considered}`,
      `- Cards moved: ${summary.moved}`,
      `- Labels added: ${summary.labeled}`,
      `- Cards enriched: ${summary.enriched}`,
      `- External calls used: ${initialExternalCallBudget - externalCallsRemaining}/${initialExternalCallBudget}`,
      "",
      "## OpenAI usage from this groomer run",
      `- Requests attempted: ${runUsage.openaiCalls}/${initialOpenAICallBudget}`,
      `- Input tokens: ${runUsage.openaiInputTokens}`,
      `- Output tokens: ${runUsage.openaiOutputTokens}`,
      `- Total tokens: ${runUsage.openaiInputTokens + runUsage.openaiOutputTokens}`,
      "",
      "## Models",
      modelLines,
      "",
      "Note: token counts are recorded only when the OpenAI response includes usage data. Actual billed costs require OpenAI's Usage/Costs API with an admin key that has usage-read access.",
    ].join("\n");

    const existing = mediaModel.getCardByName(cardName);
    if (existing) {
      await mediaController.updateCardDescription(existing.id, desc);
      return;
    }

    const targetListId =
      mediaModel.lists[MediaBoardLists.backburner].id ||
      mediaModel.lists[MediaBoardLists.inbox].id;
    await mediaController.addCard({ name: cardName, desc }, targetListId);
  }

  async function classifyAndMoveUnlabeledCards() {
    const cachePath =
      config.runtime?.cachePath || join(process.cwd(), "cache", "media_classifier_cache.json");
    const cache = loadMediaCache(cachePath);
    const minConfidenceToAct = config.runtime?.minConfidenceToAct ?? 0.75;
    const applyLabels = config.runtime?.applyLabels ?? true;
    const onlyInbox = config.runtime?.onlyInbox ?? true;
    const maxCardsPerRun = config.runtime?.maxCardsPerRun ?? 25;
    const backfillArtworkAcrossBoard =
      config.runtime?.backfillArtworkAcrossBoard ?? true;
    const moveLabeledCardsAcrossBoard =
      config.runtime?.moveLabeledCardsAcrossBoard ?? true;
    const maxArtworkBackfillPerRun =
      config.runtime?.maxArtworkBackfillPerRun ?? maxCardsPerRun;
    const inboxListId = mediaModel.lists[MediaBoardLists.inbox].id;
    const protectedListIds = [
      mediaModel.lists[MediaBoardLists.done]?.id,
      mediaModel.lists[MediaBoardLists.in_progress]?.id,
      mediaModel.lists[MediaBoardLists.backburner]?.id,
    ].filter(Boolean);
    const cards = mediaModel
      .getAllCards()
      .slice()
      .sort((a, b) => {
        const priority = (card: ICard) => {
          const labelTypes = mediaTypesFromCardLabels(card);
          const hasMediaLabel = labelTypes.length > 0;
          const isInboxCard = card.idList === inboxListId;
          const isProtectedList = protectedListIds.includes(card.idList);
          const labelPrimaryType = primaryTypeFromLabels(labelTypes);
          const labeledTargetListName = labelPrimaryType
            ? typeToListName(labelPrimaryType)
            : null;
          const labeledTargetListId = labeledTargetListName
            ? mediaModel.lists[labeledTargetListName]?.id
            : null;
          const shouldMoveByLabel =
            hasMediaLabel &&
            !isProtectedList &&
            Boolean(labeledTargetListId) &&
            card.idList !== labeledTargetListId &&
            (isInboxCard || moveLabeledCardsAcrossBoard);
          if (shouldMoveByLabel) return 0;
          if (!hasMediaLabel && (!onlyInbox || isInboxCard)) return 1;
          if (
            backfillArtworkAcrossBoard &&
            hasMediaLabel &&
            !hasCardCover(card)
          ) {
            return 2;
          }
          return 3;
        };
        const priorityDiff = priority(a) - priority(b);
        return priorityDiff || a.name.localeCompare(b.name);
      });

    let considered = 0;
    let moved = 0;
    let labeled = 0;
    let enriched = 0;
    let artworkBackfillAttempts = 0;
    const mediaLabelNames = uniqueMediaTypes([
      "book",
      "movie",
      "tv",
      "music",
      "game",
      "food",
    ]).map((type) => typeToLabelName(type));
    const mediaLabelIds = mediaLabelNames
      .map((labelName) => labelName && mediaModel.getLabels()[labelName])
      .filter(Boolean);

    for (const card of cards) {
      if (considered >= maxCardsPerRun) break;
      if (!card?.name) continue;
      const isManaged = managedByMediaGroomer(card);
      const labelTypes = mediaTypesFromCardLabels(card);
      const hasMediaLabel = labelTypes.length > 0;
      const isInboxCard = card.idList === inboxListId;
      const labelPrimaryType = primaryTypeFromLabels(labelTypes);
      const labeledTargetListName = labelPrimaryType
        ? typeToListName(labelPrimaryType)
        : null;
      const labeledTargetListId = labeledTargetListName
        ? mediaModel.lists[labeledTargetListName]?.id
        : null;
      const isProtectedList = protectedListIds.includes(card.idList);
      const needsArtwork =
        backfillArtworkAcrossBoard &&
        hasMediaLabel &&
        !hasCardCover(card) &&
        artworkBackfillAttempts < maxArtworkBackfillPerRun;
      const shouldClassifyUnlabeled = !hasMediaLabel && (!onlyInbox || isInboxCard);
      const shouldMoveByLabel =
        hasMediaLabel &&
        !isProtectedList &&
        Boolean(labeledTargetListId) &&
        card.idList !== labeledTargetListId &&
        (isInboxCard || moveLabeledCardsAcrossBoard);
      const shouldCorrectManaged = isManaged && shouldMoveByLabel;

      if (!shouldClassifyUnlabeled && !shouldMoveByLabel && !needsArtwork && !shouldCorrectManaged) {
        continue;
      }

      considered++;
      let entry: CacheEntry;
      try {
        if (hasMediaLabel) {
          const shouldFetchArtwork = shouldFetchArtworkForLabeledCard({
            needsArtwork,
            shouldMoveByLabel,
            shouldCorrectManaged,
          });
          entry = await entryFromLabels(card, shouldFetchArtwork);
          if (!entry) continue;
          if (shouldFetchArtwork) artworkBackfillAttempts++;
        } else {
          entry = await classifyTitle(card.name, cache);
        }
      } catch (e) {
        if (String(e).includes(EXTERNAL_BUDGET_EXHAUSTED)) {
          logger.info("External API budget exhausted; stopping media classification pass.");
          break;
        }
        throw e;
      }
      const classification = entry.classification;
      if (classification.confidence < minConfidenceToAct) {
        logger.info(
          `No move (low confidence ${classification.confidence.toFixed(2)}): "${card.name}" -> ${classification.type}`
        );
        continue;
      }

      const listName = typeToListName(classification.type);
      const labelName = typeToLabelName(classification.type);
      if (!listName || !labelName) continue;
      const targetList = mediaModel.lists[listName];
      if (!targetList?.id) {
        logger.info(`Missing target list for media type ${classification.type}`);
        continue;
      }

      try {
        if (applyLabels) {
          const desiredLabelTypes = entry.labelTypes?.length
            ? entry.labelTypes
            : [classification.type];
          const desiredLabelIds: string[] = [];
          for (const desiredType of desiredLabelTypes) {
            const desiredLabelName = typeToLabelName(desiredType);
            if (!desiredLabelName) continue;
            desiredLabelIds.push(
              await mediaController.ensureLabel(
                desiredLabelName,
                desiredLabelName === "Games" ? "pink" : "black"
              )
            );
          }

          if (isManaged) {
            for (const existingLabelId of card.idLabels.slice()) {
              if (
                mediaLabelIds.includes(existingLabelId) &&
                !desiredLabelIds.includes(existingLabelId)
              ) {
                await mediaController.removeLabelFromCard(card.id, existingLabelId);
                card.idLabels = card.idLabels.filter((id) => id !== existingLabelId);
              }
            }
          }

          for (const labelId of desiredLabelIds) {
            if (!card.idLabels.includes(labelId)) {
              await mediaController.addLabelToCard(card.id, labelId);
              card.idLabels.push(labelId);
              labeled++;
            }
          }
        }
        let didEnrich = false;
        if (needsArtwork || !hasMediaLabel || shouldCorrectManaged) {
          didEnrich = await enrichCard(card, classification, entry.enrichment || {});
          if (didEnrich) enriched++;
        }
        const canMoveNewlyClassifiedCard = shouldMoveNewlyClassifiedCard({
          shouldClassifyUnlabeled,
          isProtectedList,
          isInboxCard,
          moveLabeledCardsAcrossBoard,
        });
        const canMoveCard =
          shouldMoveByLabel || shouldCorrectManaged || canMoveNewlyClassifiedCard;
        let didMove = false;
        if (canMoveCard && card.idList !== targetList.id) {
          await mediaController.moveCardToList(card.id, targetList.id);
          card.idList = targetList.id;
          moved++;
          didMove = true;
        }
        const action = didMove ? "Moved" : didEnrich ? "Backfilled" : "Checked";
        logger.info(
          `${action} "${card.name}" (${classification.type}, ${classification.confidence.toFixed(
            2
          )}, ${classification.source})${card.idList === targetList.id ? ` in ${targetList.name}` : ""}`
        );
      } catch (e) {
        logger.info(`Failed to update "${card.name}": ${String(e)}`);
      }
    }

    atomicWriteJson(cachePath, cache);
    await updateUsageCard({ considered, moved, labeled, enriched });
    logger.info(
      `Classification summary: considered=${considered}, moved=${moved}, labeled=${labeled}, enriched=${enriched}, externalCallsLeft=${externalCallsRemaining}, openaiCallsLeft=${openaiCallsRemaining}`
    );
  }

  const groom = async () => {
    logger.info("Grooming (Media)");
    logger.info("Syncing Audible library with board");
    const { spawn } = require("child_process");
    const subprocess = spawn("python3", ["get_library.py"], {
      cwd: "./py/audible",
    });
    subprocess.stdout.on("data", (data: string) => logger.info(data.toString()));
    subprocess.stderr.on("data", (err: string) => logger.info(err.toString()));
    await new Promise<void>((res) => subprocess.on("close", () => res()));

    const allCardsOnBoard = mediaModel
      .getAllCards()
      .sort((a, b) => b.name.localeCompare(a.name));
    for (let i = 0; i < allCardsOnBoard.length - 1; i++) {
      if (allCardsOnBoard[i].name.trim() === allCardsOnBoard[i + 1].name.trim()) {
        await mediaController.deleteCardByID(allCardsOnBoard[i].id);
      }
    }

    const audibleLibraryOutputPath = join(process.cwd(), "cache", "audible.json");
    if (existsSync(audibleLibraryOutputPath)) {
      if ((require as any).cache?.[audibleLibraryOutputPath]) {
        delete (require as any).cache[audibleLibraryOutputPath];
      }
      const audibleLibraryInfo = require(audibleLibraryOutputPath);
      logger.info("Audible data retrieved");

      const allCardTitlesOnBoard = mediaModel
        .getAllCardNames()
        .map((x) => normalizeTitle(x));
      const bookLabel = mediaModel.getLabels()["Books"];
      const inboxListId = mediaModel.lists[MediaBoardLists.inbox].id;

      for (const collection of [audibleLibraryInfo.library, audibleLibraryInfo.wishlist]) {
        for (const item of collection as string[]) {
          const itemNormalized = normalizeTitle(item);
          const existsAlready =
            allCardTitlesOnBoard.includes(itemNormalized) ||
            allCardTitlesOnBoard.some((title) => title.includes(itemNormalized)) ||
            allCardTitlesOnBoard.some((title) => itemNormalized.includes(title));
          if (!existsAlready) {
            await mediaController.addCard({ name: item, idLabels: bookLabel }, inboxListId);
          }
        }
      }
    }

    await classifyAndMoveUnlabeledCards();
  };

  return {
    run: async () => {
      await initialize();
      await groom();
    },
  };
};
