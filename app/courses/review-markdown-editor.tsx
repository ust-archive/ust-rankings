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
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export function ReviewMarkdownEditor({
  markdown,
  onChange,
  uploadImage,
}: {
  markdown: string;
  onChange: (markdown: string) => void;
  uploadImage: (file: File) => Promise<string>;
}) {
  const [mode, setMode] = useState("write");
  return (
    <Tabs onValueChange={setMode} value={mode}>
      <TabsList>
        <TabsTrigger value="write">Write</TabsTrigger>
        <TabsTrigger value="markdown">Markdown</TabsTrigger>
      </TabsList>
      <TabsContent value="write">
        <MDXEditor
          className="review-markdown-editor min-h-48 rounded-lg border border-gray-200 bg-white"
          contentEditableClassName="prose prose-sm prose-slate min-h-40 max-w-none px-4 py-3"
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
                  <ListsToggle options={["bullet", "number"]} />
                  <CreateLink />
                </>
              ),
            }),
          ]}
        />
      </TabsContent>
      <TabsContent value="markdown">
        <Textarea
          aria-label="Markdown source"
          className="review-markdown-editor min-h-48 font-[inherit] text-[14px] leading-6"
          name="markdownSource"
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          value={markdown}
        />
      </TabsContent>
    </Tabs>
  );
}
