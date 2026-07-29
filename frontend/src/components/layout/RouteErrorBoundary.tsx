import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";

import PageState from "../ui/PageState";

type RouteErrorBoundaryProps = {
  children: ReactNode;
};

type RouteErrorBoundaryState = {
  hasError: boolean;
};

export default class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Route rendering failed", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="page-shell page-stack">
          <PageState
            variant="error"
            title="This page could not be displayed"
            message="The application shell is still available. Reload this page, or return to the dashboard and try another route."
            actions={(
              <>
                <button
                  type="button"
                  className="field-button field-button-primary"
                  onClick={() => window.location.reload()}
                >
                  Reload page
                </button>
                <Link className="field-button field-button-secondary" to="/">
                  Go to dashboard
                </Link>
              </>
            )}
          />
        </div>
      );
    }

    return this.props.children;
  }
}
