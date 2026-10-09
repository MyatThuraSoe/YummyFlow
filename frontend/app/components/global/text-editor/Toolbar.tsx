// check the source code for the toolbar => @/components/global/text-editor/Toolbar.tsx
import { bold, italic } from "@portabletext/keyboard-shortcuts";
import {
  useDecoratorButton,
  useStyleSelector,
  useToolbarSchema,
  type ExtendDecoratorSchemaType,
  type ExtendStyleSchemaType,
  type ToolbarDecoratorSchemaType,
  type ToolbarStyleSchemaType,
} from "@portabletext/toolbar";
import {
  Bold,
  Italic,
  Underline,
  Heading1,
  Heading2,
  Heading3,
  Quote,
} from "lucide-react";

// ==========================================================
// Extension Configurations (Adding Icons & Shortcuts)
// ==========================================================
const extendDecorator: ExtendDecoratorSchemaType = (decorator) => {
  if (decorator.name === "strong")
    return {
      ...decorator,
      icon: () => <Bold className="w-4 h-4" />,
      shortcut: bold,
      title: "Bold",
    };
  if (decorator.name === "em")
    return {
      ...decorator,
      icon: () => <Italic className="w-4 h-4" />,
      shortcut: italic,
      title: "Italic",
    };
  if (decorator.name === "underline")
    return {
      ...decorator,
      icon: () => <Underline className="w-4 h-4" />,
      title: "Underline",
    };
  return decorator;
};

const extendStyle: ExtendStyleSchemaType = (style) => {
  if (style.name === "h1")
    return {
      ...style,
      icon: () => <Heading1 className="w-4 h-4" />,
      title: "Heading 1",
    };
  if (style.name === "h2")
    return {
      ...style,
      icon: () => <Heading2 className="w-4 h-4" />,
      title: "Heading 2",
    };
  if (style.name === "h3")
    return {
      ...style,
      icon: () => <Heading3 className="w-4 h-4" />,
      title: "Heading 3",
    };
  if (style.name === "blockquote")
    return {
      ...style,
      icon: () => <Quote className="w-4 h-4" />,
      title: "Quote",
    };
  return style;
};

// ==========================================================
// Main Toolbar Component
// ==========================================================
export function Toolbar() {
  const toolbarSchema = useToolbarSchema({
    extendDecorator,
    extendStyle,
  });

  return (
    <div className="flex flex-wrap items-center gap-1 p-2 bg-muted/50 border-b border-border rounded-t-md">
      {/* Map Decorators (Bold, Italic, Underline) */}
      {toolbarSchema.decorators?.map((decorator) => (
        <DecoratorButton key={decorator.name} schemaType={decorator} />
      ))}
      <div className="w-px h-6 bg-border mx-1" /> {/* Divider */}
      {/* Map Styles (H1, H2, Blockquote, etc). We filter out 'normal' as it's the default */}
      {toolbarSchema.styles
        ?.filter((s) => s.name !== "normal")
        .map((style) => (
          <StyleButton key={style.name} schemaType={style} />
        ))}
    </div>
  );
}

// ==========================================================
// Shared Button Styling Logic
// ==========================================================
const getButtonClasses = (isActive: boolean) =>
  `p-2 rounded-md transition-colors flex items-center justify-center ${
    isActive
      ? "bg-accent text-accent-foreground shadow-sm" // Active Theme
      : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground" // Inactive Theme
  }`;

// ==========================================================
// Individual Buttons
// ==========================================================
const DecoratorButton = (props: { schemaType: ToolbarDecoratorSchemaType }) => {
  const decoratorButton = useDecoratorButton(props);
  const isActive = decoratorButton.snapshot.matches({ enabled: "active" });

  return (
    <button
      type="button"
      title={props.schemaType.title}
      // CRITICAL FIX: onMouseDown + e.preventDefault() prevents losing text selection!
      onMouseDown={(e) => {
        e.preventDefault();
        decoratorButton.send({ type: "toggle" });
      }}
      className={getButtonClasses(isActive)}
    >
      {props.schemaType.icon ? (
        <props.schemaType.icon />
      ) : (
        props.schemaType.title
      )}
    </button>
  );
};

function StyleButton(props: { schemaType: ToolbarStyleSchemaType }) {
  const styleSelector = useStyleSelector({ schemaTypes: [props.schemaType] });
  // Check if this specific style is the currently active one in the context
  const isActive =
    styleSelector.snapshot.context.activeStyle === props.schemaType.name;

  return (
    <button
      type="button"
      title={props.schemaType.title}
      // CRITICAL FIX: onMouseDown + e.preventDefault()
      onMouseDown={(e) => {
        e.preventDefault();
        styleSelector.send({ type: "toggle", style: props.schemaType.name });
      }}
      className={getButtonClasses(isActive)}
    >
      {props.schemaType.icon ? (
        <props.schemaType.icon />
      ) : (
        props.schemaType.title
      )}
    </button>
  );
}
