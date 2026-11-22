import { Empty, EmptyHeader, EmptyTitle } from "./ui/empty";
import { Spinner } from "./ui/spinner";

export function LoadingScreen() {
  return (
    <main className="screen active loading-screen">
      <Empty role="status">
        <EmptyHeader>
          <Spinner aria-hidden="true" />
          <EmptyTitle>Loading KanjiKinjo…</EmptyTitle>
        </EmptyHeader>
      </Empty>
    </main>
  );
}
