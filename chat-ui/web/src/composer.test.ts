import { describe, expect, it } from "vitest";
import { buildContent, fenceFor, matchingCommands } from "./composer";

describe("matchingCommands", () => {
  it("offers every command for a bare slash", () => {
    expect(matchingCommands("/").map((command) => command.id)).toEqual(["new", "search", "pin", "delete"]);
  });

  it("narrows by prefix and ignores case", () => {
    expect(matchingCommands("/PI").map((command) => command.id)).toEqual(["pin"]);
  });

  it("offers nothing once the draft is a sentence", () => {
    expect(matchingCommands("/new chat please")).toEqual([]);
    expect(matchingCommands("hello")).toEqual([]);
  });
});

describe("fenceFor", () => {
  it("uses three backticks when the text has none", () => {
    expect(fenceFor("plain")).toBe("```");
  });

  it("uses a fence longer than any backtick run in the text", () => {
    expect(fenceFor("a ``` b")).toBe("````");
  });
});

describe("buildContent", () => {
  it("returns the typed text when nothing is attached", () => {
    expect(buildContent("hello", [])).toBe("hello");
  });

  it("puts each attachment inline before the typed text", () => {
    const content = buildContent("Summarize it", [{ name: "notes.txt", text: "line one" }]);
    expect(content).toBe("Attached file: notes.txt\n```\nline one\n```\n\nSummarize it");
  });

  it("keeps attachment text from closing its own block", () => {
    const content = buildContent("", [{ name: "tricky.md", text: "use ``` here" }]);
    expect(content).toBe("Attached file: tricky.md\n````\nuse ``` here\n````");
  });
});
