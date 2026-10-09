import { defineSchema } from "@portabletext/editor";

// portable text schema definition
export const schemaDefinition = defineSchema({
  decorators: [
    { name: "strong", title: "Strong" },
    { name: "em", title: "Italic" },
    { name: "underline", title: "Underline" },
    { name: "strike-through", title: "Strike" },
    { name: "code", title: "Code" },
  ],
  styles: [
    { name: "normal", title: "Normal" },
    { name: "h1", title: "Heading 1" },
    { name: "h2", title: "Heading 2" },
    { name: "h3", title: "Heading 3" },
    { name: "blockquote", title: "Quote" },
  ],
  lists: [
    { name: "bullet", title: "Bullet" },
    { name: "number", title: "Number" },
  ],
  annotations: [{ name: "link", title: "Link" }],
  inlineObjects: [],
  blockObjects: [],
});
