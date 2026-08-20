// Render-time crash guard (issue #42). Without this, a thrown render error
// unmounts the whole React tree and Cloudflare/the browser shows a blank
// white page - no way back short of a manual reload.
import { Component, type ReactNode } from "react";
import { Button, EmptyState } from "~/client/components/ui";
import { t } from "~/client/i18n";

export class ErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: unknown) {
    if (import.meta.env.DEV) console.error(error);
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="flex h-full items-center px-3.5">
        <EmptyState
          title={t("error.crashed")}
          body={t("error.crashedBody")}
          action={
            <Button onClick={() => location.reload()}>{t("action.reload")}</Button>
          }
        />
      </div>
    );
  }
}
