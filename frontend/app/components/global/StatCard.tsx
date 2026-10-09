import { Card, CardContent } from "@/components/ui/card";

const StatCard = ({ title, value, trend, isPositive, Icon }: any) => (
  <Card className="relative overflow-hidden shadow-sm border-border rounded-lg">
    <CardContent className="p-6">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <h3 className="text-3xl font-bold text-foreground">{value}</h3>
      </div>
      <div className="mt-4 flex items-center">
        <span
          className={`text-xs font-bold px-2 py-1 rounded-full ${
            isPositive
              ? "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400"
              : "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400"
          }`}
        >
          {trend}
        </span>
      </div>
      {/* Background Watermark Icon */}
      <Icon className="absolute -bottom-4 -right-4 w-24 h-24 text-muted/20 pointer-events-none" />
    </CardContent>
  </Card>
);

export default StatCard;
