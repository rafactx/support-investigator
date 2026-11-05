import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from './ui/button.tsx';
import { EmptyState } from './ui/empty-state.tsx';

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches render exceptions anywhere below it so one bad component can't
 * white-screen the whole SPA (PROMPT-WEB.md R6). Wraps `<App />` in
 * main.tsx. React only supports this via a class component; there is no
 * hook equivalent yet.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <EmptyState
          icon={<TriangleAlert aria-hidden="true" />}
          title="Something went wrong"
          description="The page hit an unexpected error. Reloading usually fixes it."
          action={
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          }
        />
      </main>
    );
  }
}
