import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview", () => {
  test("renders GitHub-flavored markdown tables as HTML tables", () => {
    const html = renderToStaticMarkup(
      <MarkdownPreview markdown={"# Shiplog\n\n| Repo | Count |\n| --- | ---: |\n| core | 7 |"} />,
    );

    expect(html).toContain("<h1>Shiplog</h1>");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Repo</th>");
    expect(html).toContain("<td>core</td>");
  });

  test("escapes raw HTML by default", () => {
    const html = renderToStaticMarkup(
      <MarkdownPreview markdown={'<script>alert("nope")</script>'} />,
    );

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
