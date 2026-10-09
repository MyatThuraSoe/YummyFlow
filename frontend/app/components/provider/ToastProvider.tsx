import { Toaster } from "react-hot-toast";

import { useTheme } from "./theme-provider";
const ToastProvider = () => {
  const { theme } = useTheme();
  // const resolveTheme =
  //   theme === "system"
  //     ? typeof window !== "undefined" &&
  //       window.matchMedia("(prefers-color-scheme: dark)").matches
  //       ? "dark"
  //       : "light"
  //     : theme;
  return (
    <Toaster
      position="top-center"
      toastOptions={{
        duration: 4000,
        // style: {
        //   background: resolveTheme === "dark" ? "#000" : "#fff",
        //   color: resolveTheme === "dark" ? "#fff" : "#000",
        // },
      }}
    />
  );
};

export default ToastProvider;
