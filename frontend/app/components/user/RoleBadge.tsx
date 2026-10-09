const RoleBadge = ({ role }: { role: string }) => {
  const roleStyles: Record<string, string> = {
    ADMIN: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
    MANAGER: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
    STAFF:
      "bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400",
    KITCHEN:
      "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400",
    CUSTOMER:
      "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400",
  };

  const style = roleStyles[role?.toUpperCase()] || roleStyles.CUSTOMER;

  return (
    <span
      className={`px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide ${style}`}
    >
      {role?.toUpperCase() || "CUSTOMER"}
    </span>
  );
};

export default RoleBadge;
