import { useEffect, useState } from "react";
import { EditorProvider, PortableTextEditable } from "@portabletext/editor";
import { EventListenerPlugin } from "@portabletext/editor/plugins";

import { schemaDefinition } from "@/components/global/text-editor/schema";
import { Toolbar } from "@/components/global/text-editor/Toolbar";
import {
  renderDecorator,
  renderStyle,
} from "@/components/global/text-editor/editor-render";

const PortableTextEditorField = ({
  onChange,
  value,
}: {
  value: any[] | undefined;
  onChange: (value: any[] | undefined) => void;
}) => {
  const [editorKey, setEditorKey] = useState("empty-editor");

  useEffect(() => {
    // If the editor started empty, but suddenly receives real data from TanStack Query...
    if (
      editorKey === "empty-editor" &&
      Array.isArray(value) &&
      value.length > 0
    ) {
      setEditorKey("loaded-editor"); // ...Change the key to instantly remount it!
    }
  }, [value, editorKey]);

  return (
    <div
      key={editorKey}
      className="flex flex-col border border-input rounded-md overflow-hidden bg-background focus-within:ring-1 focus-within:ring-ring focus-within:border-primary transition-all shadow-sm"
    >
      <EditorProvider
        initialConfig={{
          schemaDefinition,
          initialValue: value || undefined,
        }}
      >
        <EventListenerPlugin
          on={(event) => {
            if (event.type === "mutation") {
              // Ensure we pass back valid data or undefined
              const snapshot = event.value;
              if (!snapshot || snapshot.length === 0) {
                onChange(undefined);
              } else {
                onChange(snapshot);
              }
            }
          }}
        />
        <Toolbar />
        <div className="p-4 min-h-62.5 cursor-text">
          <PortableTextEditable
            className="outline-none max-w-none text-foreground"
            renderStyle={renderStyle}
            renderDecorator={renderDecorator}
            renderBlock={(props) => (
              <div className="mb-2">{props.children}</div>
            )}
            renderListItem={(props) => (
              <li className="ml-6 list-disc mt-2">{props.children}</li>
            )}
          />
        </div>
      </EditorProvider>
    </div>
  );
};

export default PortableTextEditorField;
