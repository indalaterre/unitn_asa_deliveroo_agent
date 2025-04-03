import workerpool from "workerpool";

export const createPairsDistanceMatrix = (adjacency: number[][]): number[][] => {
    const n = adjacency.length;
    const A = adjacency.map((row: number[]) =>
        row.reduce((acc, val, idx) => (val ? acc | (1n << BigInt(idx)) : acc), 0n),
    );

    let B = [...A];

    const distances = Array.from({ length: n }, () => Array(n).fill(Number.POSITIVE_INFINITY));
    for (let i = 1; i < n; i++) distances[i][i] = 0;

    let pairDistance = 1;
    while (true) {
        let changed = false;
        const nextB = Array(n).fill(0n);

        for (let i = 1; i < n; i++) {
            for (let j = 0; j < nextB.length; j++) {
                if (distances[i][j] === Number.POSITIVE_INFINITY && B[i] & (1n << BigInt(j))) {
                    distances[i][j] = pairDistance;
                    changed = true;
                }
            }
        }

        if (!changed) break;

        for (let i = 0; i < n; i++) {
            for (let k = 0; k < n; k++) {
                if (B[i] & (1n << BigInt(k))) {
                    nextB[i] |= A[k];
                }
            }
        }

        B = nextB;
        pairDistance++;
    }

    return distances;
};

workerpool.worker({ createPairsDistanceMatrix });
