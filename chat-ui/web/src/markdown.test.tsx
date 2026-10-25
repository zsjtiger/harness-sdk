import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

function html(text: string): string {
  return renderToStaticMarkup(<Markdown text={text} />);
}

describe("Markdown", () => {
  it("renders paragraphs, inline code, and bold", () => {
    expect(html("Show **bold** and `code`")).toBe("<p>Show <strong>bold</strong> and <code>code</code></p>");
  });

  it("keeps single line breaks inside a paragraph", () => {
    expect(html("one\ntwo")).toBe("<p>one<br/>two</p>");
  });

  it("renders fenced code verbatim", () => {
    expect(html('```js\nconst x = "<b>hi</b>";\n```')).toBe(
      '<pre><code>const x = &quot;&lt;b&gt;hi&lt;/b&gt;&quot;;</code></pre>',
    );
  });

  it("never turns text into HTML elements", () => {
    expect(html("<img src=x onerror=alert(1)>")).toBe("<p>&lt;img src=x onerror=alert(1)&gt;</p>");
  });
});
