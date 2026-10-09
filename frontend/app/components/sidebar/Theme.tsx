import { useTheme } from "@/components/provider/theme-provider";
import { Button } from "@/components/ui/button";

const Theme = () => {
  const { setTheme, theme } = useTheme();

  return (
    <div className="flex gap-2 mb-1">
      <Button
        variant={theme === "light" ? "default" : "ghost"}
        size={"icon-lg"}
        className="text-xl"
        onClick={() => setTheme("light")}
      >
        🌞
      </Button>
      <Button
        variant={theme === "dark" ? "default" : "ghost"}
        size={"icon-lg"}
        className="text-xl"
        onClick={() => setTheme("dark")}
      >
        🌜
      </Button>
      <Button
        variant={theme === "system" ? "default" : "ghost"}
        size={"icon-lg"}
        className="text-xl"
        onClick={() => setTheme("system")}
      >
        🖥️
      </Button>
    </div>
  );
};

export default Theme;
