import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

class RootErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { hasError: boolean; message: string }
> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : "알 수 없는 렌더 오류가 발생했습니다.",
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-3 px-6">
          <h1 className="text-xl font-semibold">화면 렌더링 오류</h1>
          <p className="text-sm text-muted-foreground">
            {this.state.message}
          </p>
          <p className="text-xs text-muted-foreground">
            앱을 새로고침하거나 데이터 초기화 후 다시 실행해 주세요.
          </p>
        </main>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
);
