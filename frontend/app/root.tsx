import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Route } from "./+types/root";
import "./app.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/provider/theme-provider";
import ToastProvider from "@/components/provider/ToastProvider";
import { EdgeStoreProvider } from "@/lib/useEdgestore";
import SocketProvider from "@/components/provider/SocketProvider";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* font */}
        <style>
          @import
          url('https://fonts.googleapis.com/css2?family=Saira:ital,wght@0,100..900;1,100..900&display=swap');
        </style>
        {/* to remove that theme change b4 change to the stored theme */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var storageKey = "medflow-theme";
                  var defaultTheme = "system";
                  var theme = localStorage.getItem(storageKey) || defaultTheme;
                  var supportDarkMode = window.matchMedia("(prefers-color-scheme: dark)").matches;
                  
                  var root = document.documentElement;
                  root.classList.remove("light", "dark");
                  
                  if (theme === "dark" || (theme === "system" && supportDarkMode)) {
                    root.classList.add("dark");
                  } else {
                    root.classList.add("light");
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        <ThemeProvider defaultTheme="system" storageKey="medflow-theme">
          {/* Toast */}
          <ToastProvider />
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  // Created once per mount — per request on the server, per page load in the
  // browser. This used to be `new QueryClient()` in the component body, which
  // built a brand-new cache on every render and made every query a cold fetch.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Treat data as fresh for 30s so navigating between screens does not
            // re-hit the API. Freshness during service comes from socket events,
            // not from polling.
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            // A till or kitchen screen stays open all day. Refetching every
            // mounted query each time the tab regains focus is pure waste.
            refetchOnWindowFocus: false,
            // A dropped wifi connection at the till is worth recovering from.
            refetchOnReconnect: true,
            retry: 1,
          },
          mutations: {
            // Mutations are user-initiated; a silent retry can double-charge
            // or double-void an order.
            retry: 0,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/* make sure socket provider is iniside react query provider */}
      <SocketProvider>
        <EdgeStoreProvider basePath="http://localhost:5000/edgestore">
          <Outlet />
        </EdgeStoreProvider>
      </SocketProvider>
    </QueryClientProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
