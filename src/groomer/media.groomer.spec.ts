import { assert, expect } from "chai";
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import {
  loadMediaCache,
  heuristicClassify,
  mediaCacheEntryIsFresh,
  normalizeTitle,
  shouldMoveNewlyClassifiedCard,
  typeToLabelName,
  typeToListName,
  upsertMediaDescriptionBlock,
} from "./media.groomer";

describe("Media groomer", () => {
  describe("type mappings", () => {
    it("maps media types to the live board list aliases", () => {
      expect(typeToListName("book")).to.equal("books");
      expect(typeToListName("movie")).to.equal("movies");
      expect(typeToListName("tv")).to.equal("tv");
      expect(typeToListName("music")).to.equal("music");
      expect(typeToListName("game")).to.equal("games");
      expect(typeToListName("food")).to.equal("food");
      expect(typeToListName("unknown")).to.equal(null);
    });

    it("maps media types to the live board label names", () => {
      expect(typeToLabelName("book")).to.equal("Books");
      expect(typeToLabelName("movie")).to.equal("Movies");
      expect(typeToLabelName("tv")).to.equal("Television");
      expect(typeToLabelName("music")).to.equal("Music");
      expect(typeToLabelName("game")).to.equal("Games");
      expect(typeToLabelName("food")).to.equal("Food & Restaurants");
      expect(typeToLabelName("unknown")).to.equal(null);
    });
  });

  describe("cache", () => {
    const cachePath = join(process.cwd(), "cache", "media-groomer-test-cache.json");

    afterEach(() => {
      if (existsSync(cachePath)) {
        unlinkSync(cachePath);
      }
    });

    it("ignores old cache versions", () => {
      writeFileSync(
        cachePath,
        JSON.stringify({
          version: 1,
          byTitle: {
            "andor season ii": {
              classification: {
                type: "book",
                confidence: 0.78,
                source: "google_books",
              },
              decidedAt: new Date().toISOString(),
            },
          },
        })
      );

      const cache = loadMediaCache(cachePath);
      expect(cache.version).to.equal(6);
      expect(Object.keys(cache.byTitle)).to.deep.equal([]);
    });

    it("expires low-confidence unknown entries quickly", () => {
      const staleUnknown = {
        classification: {
          type: "unknown" as const,
          confidence: 0.5,
          source: "heuristic" as const,
        },
        decidedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      };
      const staleMovie = {
        classification: {
          type: "movie" as const,
          confidence: 0.9,
          source: "omdb" as const,
        },
        decidedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      };

      expect(mediaCacheEntryIsFresh(staleUnknown, 3650)).to.equal(false);
      expect(mediaCacheEntryIsFresh(staleMovie, 3650)).to.equal(true);
    });
  });

  describe("movement decisions", () => {
    it("moves newly classified Inbox cards in the same pass", () => {
      expect(
        shouldMoveNewlyClassifiedCard({
          shouldClassifyUnlabeled: true,
          isProtectedList: false,
          isInboxCard: true,
          moveLabeledCardsAcrossBoard: false,
        })
      ).to.equal(true);
    });

    it("does not move newly classified cards out of protected lists", () => {
      expect(
        shouldMoveNewlyClassifiedCard({
          shouldClassifyUnlabeled: true,
          isProtectedList: true,
          isInboxCard: true,
          moveLabeledCardsAcrossBoard: true,
        })
      ).to.equal(false);
    });
  });

  describe("heuristics", () => {
    it("treats explicit movie hints as movie even when the title contains by", () => {
      const result = heuristicClassify("[movie] North by northwest");
      expect(result?.type).to.equal("movie");
      expect(result?.confidence).to.be.greaterThan(0.9);
    });

    it("treats season shorthand as television", () => {
      const result = heuristicClassify("South Park S27");
      expect(result?.type).to.equal("tv");
      expect(result?.confidence).to.be.greaterThan(0.8);
    });

    it("treats show wording as television", () => {
      const result = heuristicClassify("Mr. Show");
      expect(result?.type).to.equal("tv");
      expect(result?.confidence).to.be.greaterThan(0.9);
    });

    it("does not infer book from a plain movie title", () => {
      const result = heuristicClassify("The Matrix");
      expect(result?.type).to.not.equal("book");
    });
  });

  describe("descriptions", () => {
    it("appends a managed metadata block without removing manual text", () => {
      const result = upsertMediaDescriptionBlock(
        "manual notes",
        {
          type: "movie",
          confidence: 0.93,
          source: "tmdb",
          evidence: "TMDb movie match",
          title: "North by Northwest",
          year: "1959",
        },
        {
          metadataUrl: "https://www.themoviedb.org/movie/213",
          streamingProviders: ["Max", "Criterion Channel"],
        }
      );

      assert.include(result, "manual notes");
      assert.include(result, "<!-- media-groomer:start -->");
      assert.include(result, "Type: movie");
      assert.include(result, "Streaming: Max, Criterion Channel");
    });

    it("replaces only the managed metadata block", () => {
      const original = [
        "top notes",
        "",
        "<!-- media-groomer:start -->",
        "old block",
        "<!-- media-groomer:end -->",
        "",
        "bottom notes",
      ].join("\n");

      const result = upsertMediaDescriptionBlock(
        original,
        {
          type: "tv",
          confidence: 0.91,
          source: "tmdb",
          evidence: "TMDb tv match",
        },
        {}
      );

      assert.include(result, "top notes");
      assert.include(result, "bottom notes");
      assert.notInclude(result, "old block");
      assert.include(result, "Type: tv");
    });
  });

  describe("normalization", () => {
    it("normalizes punctuation and whitespace consistently", () => {
      expect(normalizeTitle("  The Phoenician Scheme — 2025  ")).to.equal(
        "the phoenician scheme - 2025"
      );
    });
  });
});
