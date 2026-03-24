export class HttpError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function asHttpError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  const msg = e instanceof Error ? e.message : 'Unknown error';
  return new HttpError(500, msg);
}

