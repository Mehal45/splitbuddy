// Entry for the portable preview bundle (see scripts/make-relative.mjs).
import { createRoot } from "react-dom/client";
import { App } from "@/components/app/app";

createRoot(document.getElementById("root")!).render(<App />);
