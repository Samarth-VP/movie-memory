"use client";

import { useEffect } from "react";

// Shown when something unexpected throws while rendering a page
// (for example the database is down). Next.js requires this to be a
// client component.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-gray-400">
        We hit an unexpected problem. Please try again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded border border-gray-500/40 px-4 py-2"
      >
        Try again
      </button>
    </main>
  );
}
