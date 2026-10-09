import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";

const MarkdownDialog = ({
  content,
  title,
}: {
  content: string;
  title: string;
}) => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          {title}
        </Button>
      </DialogTrigger>
      {/* Make the modal slightly wider to comfortably fit the recipe */}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Sparkles className="w-5 h-5 text-primary" />
            {title}
          </DialogTitle>
        </DialogHeader>

        {/* ScrollArea prevents the modal from growing taller than the screen */}
        <ScrollArea className="max-h-[60vh] w-full">
          {/* 
            THE MAGIC: 
            'prose' styles the markdown beautifully.
            'dark:prose-invert' ensures the text turns white in dark mode!
            'max-w-none' stops it from being artificially narrow.
          */}
          <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none prose-headings:text-primary prose-a:text-indigo-500">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

export default MarkdownDialog;
