export function sortCopy<T>(values: Iterable<T>, compareFn?: (left: T, right: T) => number): T[] {
  const sorted = Array.from(values);
  sorted.sort(compareFn);
  return sorted;
}

export function reverseCopy<T>(values: Iterable<T>): T[] {
  const reversed = Array.from(values);
  reversed.reverse();
  return reversed;
}
