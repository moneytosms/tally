import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { createQueryClient } from "./lib/queries";
import "./styles/index.css";

// Service worker registration lives in UpdatePrompt (useRegisterSW). It must never cache API responses - see docs/SPEC.md §10.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
