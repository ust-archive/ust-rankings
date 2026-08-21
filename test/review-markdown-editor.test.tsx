import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@mdxeditor/editor", () => {
  const empty = () => null;
  const plugin = () => ({});
  return {
    MDXEditor: () => <div>visual editor</div>,
    BlockTypeSelect: empty,
    BoldItalicUnderlineToggles: empty,
    CreateLink: empty,
    ListsToggle: empty,
    UndoRedo: empty,
    headingsPlugin: plugin,
    imagePlugin: plugin,
    linkDialogPlugin: plugin,
    linkPlugin: plugin,
    listsPlugin: plugin,
    quotePlugin: plugin,
    toolbarPlugin: plugin,
  };
});

test("review editor offers a Markdown source mode beside the visual writer", async () => {
  const { ReviewMarkdownEditor } = await import(
    "@/app/courses/review-markdown-editor"
  );
  const markup = renderToStaticMarkup(
    <ReviewMarkdownEditor
      markdown={"**labs**"}
      onChange={() => {}}
      uploadImage={async () => "/attachments/x"}
    />,
  );
  expect(markup).toContain("Write");
  expect(markup).toContain("Markdown");
  expect(markup).toContain("visual editor");
});
