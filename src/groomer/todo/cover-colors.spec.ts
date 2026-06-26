import { expect } from "chai";
import {
  COVER_COLORS,
  normalizeToCoverColor,
  hashToCoverColor,
  pickNearestLabel,
  decideCoverColor,
  LabelVector,
} from "./cover-colors";
import {
  cosineSimilarity,
  tokenize,
  createEmbedder,
} from "../../lib/embeddings";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).to.be.closeTo(1, 1e-9);
  });
  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).to.equal(0);
  });
  it("returns 0 for zero or mismatched vectors", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).to.equal(0);
    expect(cosineSimilarity([1], [1, 2])).to.equal(0);
  });
});

describe("tokenize", () => {
  it("lowercases, strips punctuation, drops stop/short words", () => {
    expect(tokenize("Clean the Kitchen!")).to.deep.equal(["clean", "kitchen"]);
  });
});

describe("normalizeToCoverColor", () => {
  it("passes through valid cover colors", () => {
    expect(normalizeToCoverColor("green")).to.equal("green");
  });
  it("strips shade suffixes", () => {
    expect(normalizeToCoverColor("green_light")).to.equal("green");
  });
  it("returns null for unknown or empty", () => {
    expect(normalizeToCoverColor("teal")).to.equal(null);
    expect(normalizeToCoverColor(null)).to.equal(null);
  });
});

describe("hashToCoverColor", () => {
  it("is deterministic and always a valid cover color", () => {
    const a = hashToCoverColor("Buy guitar strings");
    const b = hashToCoverColor("Buy guitar strings");
    expect(a).to.equal(b);
    expect(COVER_COLORS).to.include(a);
  });
});

describe("pickNearestLabel", () => {
  const labels: LabelVector[] = [
    { name: "A", color: "red", vec: [1, 0] },
    { name: "B", color: "blue", vec: [0, 1] },
  ];
  it("finds the most similar label", () => {
    const { label } = pickNearestLabel([0.9, 0.1], labels);
    expect(label?.name).to.equal("A");
  });
});

describe("decideCoverColor", () => {
  const labels: LabelVector[] = [
    { name: "Chores", color: "green", vec: [1, 0] },
    { name: "Money", color: "lime", vec: [0, 1] },
  ];
  it("uses the nearest label's color when confident", () => {
    const d = decideCoverColor([1, 0], labels, "anything", 0.5);
    expect(d.color).to.equal("green");
    expect(d.matchedLabel).to.equal("Chores");
  });
  it("falls back to a hash color below threshold", () => {
    const d = decideCoverColor([1, 1], labels, "weird card", 0.99);
    expect(d.matchedLabel).to.equal(null);
    expect(COVER_COLORS).to.include(d.color);
  });
  it("hashes the label name when the nearest label has no color", () => {
    const noColor: LabelVector[] = [{ name: "Mystery", color: null, vec: [1, 0] }];
    const d = decideCoverColor([1, 0], noColor, "card", 0.1);
    expect(d.matchedLabel).to.equal("Mystery");
    expect(COVER_COLORS).to.include(d.color);
  });
});

describe("createEmbedder (tfidf backend, end to end)", () => {
  it("scores a card closest to the label that shares its words", async () => {
    const labelDocs = ["Chores clean organize", "Money sell deposit roth"];
    const embedder = await createEmbedder({
      prefer: ["tfidf"],
      tfidfCorpus: labelDocs,
    });
    expect(embedder.kind).to.equal("tfidf");
    const labelVecs = await embedder.embed(labelDocs);
    const [cardVec] = await embedder.embed(["clean the kitchen and organize"]);
    const labels: LabelVector[] = [
      { name: "Chores", color: "green", vec: labelVecs[0] },
      { name: "Money", color: "lime", vec: labelVecs[1] },
    ];
    const { label } = pickNearestLabel(cardVec, labels);
    expect(label?.name).to.equal("Chores");
  });
});
