import { AppError } from "../errors/index.js";

const CURSOR_VERSION = 1;

type CursorEnvelope<T> = {
  v: number;
  payload: T;
};

export function encodeCursor<T>(payload: T): string {
  const envelope: CursorEnvelope<T> = {
    v: CURSOR_VERSION,
    payload,
  };

  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

export function decodeCursor<T>(cursor: string): T {
  if (!cursor || cursor.length > 4096) {
    throw invalidCursor();
  }

  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as CursorEnvelope<T>;

    if (
      parsed === null ||
      typeof parsed !== "object" ||
      parsed.v !== CURSOR_VERSION ||
      !("payload" in parsed)
    ) {
      throw invalidCursor();
    }

    return parsed.payload;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw invalidCursor();
  }
}

function invalidCursor(): AppError {
  return new AppError({
    code: "VALIDATION_INVALID_CURSOR",
    message: "The pagination cursor is invalid.",
    statusCode: 400,
  });
}

export type CursorPage = {
  nextCursor: string | null;
  hasMore: boolean;
};
