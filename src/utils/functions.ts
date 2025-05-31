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

export const groupByMapping = <T, K extends keyof T, M extends keyof T>(
    array: T[],
    key: K,
    mapping: M,
): Map<T[K], T[M][]> => {
    const map: Map<T[K], T[M][]> = new Map<T[K], T[M][]>();

    for (const item of array) {
        const groupKey: T[K] = item[key];
        if (!map.has(groupKey)) {
            map.set(groupKey, []);
        }
        map.get(groupKey)!.push(item[mapping]);
    }

    return map;
};
