// /demo: a shareable deep link straight into demo mode (sample data, in-memory,
// nothing saved). The landing page, the launch film and the welcome screen's
// "Try the demo" button all come through here. Lives outside the Shell so a
// signed-out visitor is never bounced to /welcome first.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { startDemo } from "~/client/lib/demo";
import { ScreenSkeleton } from "~/client/components/ui";

export function DemoEntry() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  useEffect(() => {
    startDemo(qc);
    navigate("/", { replace: true });
  }, [qc, navigate]);
  return <ScreenSkeleton />;
}
