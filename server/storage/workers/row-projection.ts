/** Public worker reads never expose the internal migration/profile data blob. */
export function stripWorkerData<T extends { data?: unknown }>(row: T): Omit<T, "data"> {
  const { data: _data, ...rest } = row;
  return rest;
}
