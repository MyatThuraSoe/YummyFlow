import { cn } from "@/lib/utils";

const Loader = ({
  title,
  className,
}: {
  title?: string;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4",
        className,
      )}
    >
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mb-2" />
      <p className="text-primary text-sm">{title || "Loading..."}</p>
    </div>
  );
};

export default Loader;
