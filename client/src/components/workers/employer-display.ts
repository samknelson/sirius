export function getDisplayedWorkerEmployers<T>(employers: readonly T[]): T[] {
  return employers.filter(
    (employer) =>
      (employer as { employmentStatusEmployed?: boolean | null } | null)?.employmentStatusEmployed !== false,
  );
}
