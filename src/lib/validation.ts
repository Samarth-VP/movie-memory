import { z } from "zod";

// Single source of truth for movie input. Runs on the server only.
// trim() runs before the length checks, so "   " counts as empty.
export const movieSchema = z
  .string()
  .trim()
  .min(1, "Please enter a movie title.")
  .max(100, "Movie title must be 100 characters or fewer.");
