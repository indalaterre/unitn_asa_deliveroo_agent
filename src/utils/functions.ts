export const extractFirstElementsInSortedArray = <T>(
    array: T[],
    isEqual: (a: T, b: T) => boolean,
): T[] => {
    if (!array.length) return [];

    const firstValue: T = array[0];

    let i = 1;
    while (i < array.length - 1 && isEqual(array[i], firstValue)) {
        i++;
    }

    return array.slice(0, i);
};
