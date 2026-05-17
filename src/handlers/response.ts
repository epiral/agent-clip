/**
 * Unified response types and cursor utilities for resource-oriented commands.
 *
 * Response envelope:
 *   Single resource:  { data: T }
 *   List (paginated): { data: T[], has_more: boolean, cursor?: string }
 *   Delete:           { id: string }
 *   Error:            { error: { code: string, message: string } }
 *
 * Cursor encoding:
 *   Opaque base64 string encoding { sort_field, id }.
 *   Consumers must not parse; just pass back on next request.
 */

// --- Response envelopes ---

export interface DataResponse<T> {
  data: T;
}

export interface ListResponse<T> {
  data: T[];
  has_more: boolean;
  cursor?: string;
}

export interface DeleteResponse {
  id: string;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

/** Convenience: wrap a single resource */
export function ok<T>(data: T): DataResponse<T> {
  return { data };
}

/** Convenience: wrap a list with pagination */
export function list<T>(data: T[], has_more: boolean, cursor?: string): ListResponse<T> {
  return cursor ? { data, has_more, cursor } : { data, has_more };
}

/** Convenience: wrap a delete confirmation */
export function deleted(id: string): DeleteResponse {
  return { id };
}

// --- Cursor encoding/decoding ---

interface CursorPayload {
  /** The sort field value at the cursor position (timestamp, id, etc.) */
  s: number | string;
  /** The resource ID at the cursor position (tie-breaker) */
  id: string | number;
}

/**
 * Encode a cursor from sort field + id.
 * Returns an opaque base64 string.
 */
export function encodeCursor(sortValue: number | string, id: string | number): string {
  const payload: CursorPayload = { s: sortValue, id };
  return btoa(JSON.stringify(payload));
}

/**
 * Decode an opaque cursor string back to sort field + id.
 * Returns null if the cursor is invalid (never throws).
 */
export function decodeCursor(cursor: string): { sortValue: number | string; id: string | number } | null {
  try {
    const payload = JSON.parse(atob(cursor)) as CursorPayload;
    if (payload.s === undefined || payload.id === undefined) {
      return null;
    }
    return { sortValue: payload.s, id: payload.id };
  } catch {
    return null;
  }
}

// --- Pagination helper ---

export interface PaginationInput {
  limit: number;
  cursor?: string;
}

/**
 * Fetch one extra row to determine has_more, then trim.
 * Usage: query with LIMIT = limit + 1, then call this.
 */
export function paginate<T>(
  rows: T[],
  limit: number,
  getCursor: (item: T) => string,
): { data: T[]; has_more: boolean; cursor?: string } {
  if (rows.length > limit) {
    const data = rows.slice(0, limit);
    const cursor = getCursor(data[data.length - 1]);
    return { data, has_more: true, cursor };
  }
  return { data: rows, has_more: false };
}
