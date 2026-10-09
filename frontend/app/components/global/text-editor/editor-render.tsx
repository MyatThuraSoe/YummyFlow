// check the source code for the toolbar => @/components/global/text-editor/editor-render.tsx

import type {
  RenderDecoratorFunction,
  RenderStyleFunction,
} from "@portabletext/editor";

export const renderStyle: RenderStyleFunction = (props) => {
  if (props.schemaType.name === "h1") {
    return (
      <h1 className="text-3xl font-extrabold scroll-m-20 tracking-tight mt-4 mb-2">
        {props.children}
      </h1>
    );
  }
  if (props.schemaType.name === "h2") {
    return (
      <h2 className="text-2xl font-bold scroll-m-20 tracking-tight mt-4 pb-2 border-b border-border">
        {props.children}
      </h2>
    );
  }
  if (props.schemaType.name === "h3") {
    return (
      <h3 className="text-xl font-semibold scroll-m-20 tracking-tight mt-4 mb-2">
        {props.children}
      </h3>
    );
  }
  if (props.schemaType.name === "blockquote") {
    return (
      <blockquote className="mt-4 border-l-4 border-primary pl-4 italic text-muted-foreground bg-muted/30 py-1 pr-4 rounded-r-md">
        {props.children}
      </blockquote>
    );
  }
  return <div className="leading-7 mb-2">{props.children}</div>;
};

export const renderDecorator: RenderDecoratorFunction = (props) => {
  if (props.value === "strong") {
    return <strong className="font-bold">{props.children}</strong>;
  }
  if (props.value === "em") {
    return <em className="italic">{props.children}</em>;
  }
  if (props.value === "underline") {
    return <u className="underline underline-offset-4">{props.children}</u>;
  }
  return <>{props.children}</>;
};
