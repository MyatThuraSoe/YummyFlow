import { buttonVariants } from "@/components/ui/button";
import {
  Empty as EmptyTag,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Link } from "react-router";

const Empty = ({
  title,
  description,
  to,
}: {
  title: string;
  description: string;
  to?: string;
}) => {
  return (
    <EmptyTag className="justify-center min-h-150">
      <EmptyHeader>
        <EmptyMedia variant="default">EMPTY</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-2">
        {to && (
          <Link to={to} className={buttonVariants({ variant: "default" })}>
            Create {title}
          </Link>
        )}
      </EmptyContent>
    </EmptyTag>
  );
};

export default Empty;
