"use client";

import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  headingsPlugin,
  imagePlugin,
  ListsToggle,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  MDXEditor,
  quotePlugin,
  toolbarPlugin,
  UndoRedo,
} from "@mdxeditor/editor";

export function ReviewMarkdownEditor({
  markdown,
  onChange,
  uploadImage,
}: {
  markdown: string;
  onChange: (markdown: string) => void;
  uploadImage: (file: File) => Promise<string>;
}) {
  return (
    <MDXEditor
      className="review-markdown-editor min-h-48 rounded-lg border border-gray-200 bg-white"
      contentEditableClassName="prose prose-slate min-h-40 max-w-none px-4 py-3"
      markdown={markdown}
      onChange={onChange}
      plugins={[
        headingsPlugin(),
        listsPlugin(),
        quotePlugin(),
        linkPlugin(),
        linkDialogPlugin(),
        imagePlugin({
          disableImageResize: true,
          disableImageSettingsButton: true,
          imageUploadHandler: uploadImage,
        }),
        toolbarPlugin({
          toolbarContents: () => (
            <>
              <UndoRedo />
              <BlockTypeSelect />
              <BoldItalicUnderlineToggles options={["Bold", "Italic"]} />
              <ListsToggle />
              <CreateLink />
            </>
          ),
        }),
      ]}
    />
  );
}
