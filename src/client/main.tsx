import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { createQueryClient } from "./lib/queries";
import "./styles/index.css";

// No service worker registration. API responses must never be cached, and a
// half-configured one is worse than none — see docs/SPEC.md §10.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
