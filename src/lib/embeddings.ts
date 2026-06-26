import { logger } from "./logger";

/********************************************************************************************
 * Pluggable text embedding backends used to associate cards with labels by meaning.        *
 *                                                                                          *
 * Three backends, selected local-first with graceful fallback:                             *
 *   - local : @xenova/transformers MiniLM (real semantics, runs in-process, no API)        *
 *   - openai: text-embedding-3-small (real semantics, offloads compute, tiny API cost)     *
 *   - tfidf : lexical TF-IDF over a fixed corpus (no deps, no network; not truly semantic)  *
 *                                                                                          *
 * All backends expose the same embed() so callers can cosine-compare results uniformly.     *
 * The tfidf backend is fit against a fixed corpus at construction so that any later text is  *
 * projected into the same vocabulary space (making cosine across texts meaningful).         *
 *******************************************************************************************/

export type EmbedderKind = "local" | "openai" | "tfidf";

export interface Embedder {
  readonly kind: EmbedderKind;
  /** embed a batch of texts into equal-length numeric vectors */
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbedderOptions {
  /** preferred backend order; the first that initializes wins. Defaults to local-first. */
  prefer?: EmbedderKind[];
  /** corpus the tfidf backend is fit against (typically the label documents) */
  tfidfCorpus: string[];
  openai?: {
    apiKey: string;
    /** embedding model id, e.g. text-embedding-3-small */
    model?: string;
    /** override endpoint; defaults to OpenAI embeddings endpoint */
    endpoint?: string;
  };
  local?: {
    /** HF model id; defaults to a small, fast sentence model */
    model?: string;
  };
}

const DEFAULT_LOCAL_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_OPENAI_MODEL = "text-embedding-3-small";
const DEFAULT_OPENAI_ENDPOINT = "https://api.openai.com/v1/embeddings";
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
  "at", "by", "from", "is", "are", "be", "this", "that", "it", "as",
]);

export function tokenize(text: string): string[] {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Lexical TF-IDF embedder. Builds a fixed vocabulary + IDF weights from the supplied
 * corpus so any text embeds into the same dimensional space. Honest about its limits:
 * this matches shared tokens, it does not understand synonyms.
 */
class TfidfEmbedder implements Embedder {
  public readonly kind = "tfidf" as const;
  private vocab: Map<string, number> = new Map();
  private idf: number[] = [];

  constructor(corpus: string[]) {
    const docTokenSets = corpus.map((doc) => new Set(tokenize(doc)));
    docTokenSets.forEach((set) => {
      set.forEach((token) => {
        if (!this.vocab.has(token)) this.vocab.set(token, this.vocab.size);
      });
    });
    const numDocs = corpus.length || 1;
    this.idf = new Array(this.vocab.size).fill(0);
    this.vocab.forEach((index, token) => {
      const docFreq = docTokenSets.filter((set) => set.has(token)).length;
      this.idf[index] = Math.log((1 + numDocs) / (1 + docFreq)) + 1;
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vec = new Array(this.vocab.size).fill(0);
      const tokens = tokenize(text);
      if (tokens.length === 0) return vec;
      for (const token of tokens) {
        const index = this.vocab.get(token);
        if (index !== undefined) vec[index] += 1;
      }
      for (let i = 0; i < vec.length; i++) {
        vec[i] = (vec[i] / tokens.length) * this.idf[i];
      }
      return vec;
    });
  }
}

class OpenAIEmbedder implements Embedder {
  public readonly kind = "openai" as const;
  constructor(
    private apiKey: string,
    private model: string,
    private endpoint: string
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const res = await (globalThis as any).fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI embeddings status ${res.status}`);
    }
    const data = await res.json();
    const rows: any[] = Array.isArray(data?.data) ? data.data : [];
    return rows
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((row) => row.embedding as number[]);
  }
}

class LocalEmbedder implements Embedder {
  public readonly kind = "local" as const;
  private extractor: any;
  private constructor(extractor: any) {
    this.extractor = extractor;
  }

  /** load @xenova/transformers via a runtime dynamic import that tsc will not rewrite */
  static async create(model: string): Promise<LocalEmbedder> {
    // Function() keeps a real ESM dynamic import in the emitted CommonJS output.
    const dynamicImport = new Function("s", "return import(s)") as (
      s: string
    ) => Promise<any>;
    const transformers = await dynamicImport("@xenova/transformers");
    const extractor = await transformers.pipeline("feature-extraction", model);
    return new LocalEmbedder(extractor);
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (const text of texts) {
      const tensor = await this.extractor(text || " ", {
        pooling: "mean",
        normalize: true,
      });
      out.push(Array.from(tensor.data as Float32Array | number[]));
    }
    return out;
  }
}

async function tryCreate(
  kind: EmbedderKind,
  opts: EmbedderOptions
): Promise<Embedder | null> {
  try {
    if (kind === "local") {
      return await LocalEmbedder.create(opts.local?.model || DEFAULT_LOCAL_MODEL);
    }
    if (kind === "openai") {
      if (!opts.openai?.apiKey) return null;
      return new OpenAIEmbedder(
        opts.openai.apiKey,
        opts.openai.model || DEFAULT_OPENAI_MODEL,
        opts.openai.endpoint || DEFAULT_OPENAI_ENDPOINT
      );
    }
    return new TfidfEmbedder(opts.tfidfCorpus);
  } catch (e) {
    logger.info(`Embedder backend "${kind}" unavailable: ${String(e)}`);
    return null;
  }
}

/**
 * Create an embedder, preferring backends in order (local-first by default) and
 * falling back to the next on any initialization failure. tfidf always succeeds,
 * so this never throws as long as it is in the preference list.
 */
export async function createEmbedder(
  opts: EmbedderOptions
): Promise<Embedder> {
  const order = opts.prefer || ["local", "openai", "tfidf"];
  const withTfidfFallback: EmbedderKind[] = order.includes("tfidf")
    ? order
    : [...order, "tfidf"];
  for (const kind of withTfidfFallback) {
    const embedder = await tryCreate(kind, opts);
    if (embedder) {
      logger.info(`Using "${embedder.kind}" embedder for cover coloring`);
      return embedder;
    }
  }
  // unreachable in practice; tfidf cannot fail
  return new TfidfEmbedder(opts.tfidfCorpus);
}
