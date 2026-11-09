"use client";

import { useState } from "react";
import { updateFavoriteMovie } from "./actions";

export default function EditableMovie({ movie }: { movie: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(movie);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function startEditing() {
    setValue(movie); // always start from the saved movie
    setError(null);
    setEditing(true);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await updateFavoriteMovie(value);
    setPending(false);
    if (result.error) {
      setError(result.error); // stay in edit mode, keep what they typed
    } else {
      setEditing(false); // the page re-renders with the saved movie
    }
  }

  if (!editing) {
    return (
      <div className="mt-1 flex items-center justify-between gap-4">
        <p className="text-xl font-semibold">{movie}</p>
        <button
          type="button"
          onClick={startEditing}
          className="rounded border border-gray-500/40 px-3 py-1.5 text-sm"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 flex flex-col gap-2">
      <label htmlFor="movie" className="sr-only">
        Favorite movie
      </label>
      <input
        id="movie"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded border px-3 py-2 text-white"
      />
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-white px-3 py-1.5 text-sm text-black disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={pending}
          className="rounded border border-gray-500/40 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
