export function isUnauthorizedError(error: unknown): boolean {
  if (error instanceof Response) {
    return error.status === 401 || error.status === 403;
  }
  
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as any).status;
    return status === 401 || status === 403;
  }
  
  return false;
}
