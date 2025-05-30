import workerpool from "workerpool";

import type { Position } from "@domain/models/environment";
import { groupByMapping } from "@utils/functions";

export interface ClusteringRequest {
    k: number;
    maxIterations: number;
    positions: { row: number; column: number }[];
}

export interface ClusteredTiles {
    label: number;
    medoid: Position;
    positions: Position[];
}

export const kMedoidsClustering = (
    tiles: Position[],
    k: number,
    maxIterations = 100,
): ClusteredTiles[] => {
    if (k >= tiles?.length) {
        //Not enough tiles to partition. We'll skip this
        return [{ label: 0, positions: tiles, medoid: tiles[0] }];
    } else if (k === tiles?.length) {
        return tiles.map((tile: Position, index: number) => {
            return { label: index, medoid: tile, positions: [tile] };
        });
    }

    const medoidIndices: number[] = [];
    while (medoidIndices?.length < k) {
        const randomNumber: number = Math.floor(Math.random() * k);
        !medoidIndices.includes(randomNumber) && medoidIndices.push(randomNumber);
    }

    let medoids: Position[] = medoidIndices.map((index) => tiles[index]);
    for (let i = 0; i < maxIterations; i++) {
        const labels = assignMedoidToCluster(tiles, medoids);

        let changed = false;
        for (let clusterIndex = 0; clusterIndex < k; clusterIndex++) {
            const clusterPointsIndices = tiles
                .map((_, index) => index)
                .filter((index: number) => labels[index] === clusterIndex);

            // Skip empty clusters
            if (!clusterPointsIndices?.length) continue;

            let bestMedoid = medoidIndices[clusterIndex];
            let bestDistance = totalDistanceToCluster(tiles, bestMedoid, clusterPointsIndices);

            for (const index of clusterPointsIndices) {
                const distance = totalDistanceToCluster(tiles, index, clusterPointsIndices);
                if (distance < bestDistance) {
                    bestMedoid = index;
                    bestDistance = distance;
                }
            }

            if (bestMedoid !== medoidIndices[clusterIndex]) {
                medoidIndices[clusterIndex] = bestMedoid;
                changed = true;
            }
        }

        medoids = medoidIndices.map((index) => tiles[index]);
        if (!changed) break;
    }

    const finalLabels: Map<number, Position[]> = assignMedoidToCluster(tiles, medoids);

    const clusterResult: ClusteredTiles[] = [];
    for (const [label, positions] of finalLabels) {
        clusterResult.push({
            label,
            positions,
            medoid: medoids[label],
        });
    }

    return clusterResult;
};

function totalDistanceToCluster(tiles: Position[], medoidIndex: number, indices: number[]) {
    const medoid: Position = tiles[medoidIndex];
    return indices.reduce((acc, curr) => acc + manhattanDistance(tiles[curr], medoid), 0);
}

function assignMedoidToCluster(tiles: Position[], medoids: Position[]): Map<number, Position[]> {
    const positionsWithLabel = tiles.map((tile: Position) => {
        let bestIndex = 0;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (let i = 0; i < medoids?.length; i++) {
            const medoid: Position = medoids[i];
            const distance: number = manhattanDistance(tile, medoid);

            if (distance < bestDistance) {
                bestIndex = i;
                bestDistance = distance;
            }
        }

        return { label: bestIndex, tile };
    });

    return groupByMapping(positionsWithLabel, "label", "tile");
}

function manhattanDistance(
    obj: { row: number; column: number },
    obj2: { row: number; column: number },
): number {
    return Math.abs(obj.row - obj2.row) + Math.abs(obj.column - obj2.column);
}

workerpool.worker({ kMedoidsClustering });
