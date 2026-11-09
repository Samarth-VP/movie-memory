"use client";

import { useEffect, useState } from "react";

type FactResponse = { content: string; createdAt: string; stale: boolean };

// One state at a time: the UI is always in exactly one of these.
type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; fact: FactResponse };

async function fetchFact(): Promise<State> {
  try {
    const res = await fetch("/api/fact");
    const body = await res.json();
    if (!res.ok) {
      return { status: "error", message: body.error ?? "Something went wrong." };
    }
    return { status: "ready", fact: body };
  } catch {
    return { status: "error", message: "Network problem. Please try again." };
  }
}

export default function FactCard() {
  const [state, setState] = useState<State>({ status: "loading" });

  // Fetch once on mount. "cancelled" stops a stale response from
  // overwriting state after the component has gone away.
  useEffect(() => {
    let cancelled = false;
    fetchFact().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    setState({ status: "loading" });
    setState(await fetchFact());
  }

  return (
    <section className="rounded-lg border border-gray-500/40 p-5">
      <h2 className="text-sm uppercase tracking-wide text-gray-400">Fun fact</h2>

      {state.status === "loading" && (
        <p className="mt-1 text-gray-400">Looking up a fun fact...</p>
      )}

      {state.status === "error" && (
        <p role="alert" className="mt-1 text-red-500">
          {state.message}
        </p>
      )}

      {state.status === "ready" && (
        <>
          <p className="mt-1">{state.fact.content}</p>
          {state.fact.stale && (
            <p className="mt-2 text-sm text-amber-500">
              We couldn&apos;t get a new fact just now, so this is an earlier one.
            </p>
          )}
        </>
      )}

      <button
        type="button"
        onClick={refresh}
        disabled={state.status === "loading"}
        className="mt-4 rounded border border-gray-500/40 px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {state.status === "error" ? "Try again" : "Get another fact"}
      </button>
      <p className="mt-2 text-xs text-gray-500">
        A new fact is generated at most once a minute.
      </p>
    </section>
  );
}
