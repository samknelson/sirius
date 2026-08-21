/**
 * Finds the first sequence-assigned Sirius ID above every supplied ID source.
 * Deliberately iterates rather than spreading into Math.max: real S1 runs can
 * contain hundreds of thousands of workers, exceeding V8's argument limit.
 */
export function nextSiriusId(...sources: Iterable<number>[]): number {
  let highest = 0;
  for (const source of sources) {
    for (const value of source) {
      if (value > highest) highest = value;
    }
  }
  return highest + 1;
}