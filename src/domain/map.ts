import { Position, type Tile } from "@domain/models/environment";
import type { ClusteredTiles, ClusteringRequest } from "@utils/clustering-worker";
import { Graph } from "@utils/graph";
import { HashMap } from "@utils/hashmap";
import { HashSet } from "@utils/hashset";

import path from "node:path";
import workerpool, { type Pool } from "workerpool";

/**
 * Models a position and its distance
 */
export interface PositionWithDistance {
    /**
     * The position
     */
    position: Position;

    /**
     * The Manhattan distance
     */
    distance: number;

    /**
     * Context of the position
     */
    context: any;
}

export class MatchMap {
    private readonly _spawnPositions: HashSet<Position> = new HashSet();
    private readonly _deliveryPositions: HashSet<Position> = new HashSet();
    private readonly _adjacencyMatrix: HashMap<Position, Position[]> = new HashMap();

    /**
     * Stores the calculated paths in a cache
     * The key: startPosition.hashCode + endPosition.hashCode
     * @private
     */
    private readonly _pathsCache: Map<string, Position[]> = new Map<string, Position[]>();

    private constructor(
        private readonly width: number,
        private readonly height: number,

        private readonly _graph: Graph,
        private readonly _spawn: Tile[],
        private readonly _delivery: Tile[],
    ) {
        const deliveryPositions: Position[] = this._delivery.map((tile: Tile) => tile.position);
        this._deliveryPositions = new HashSet(deliveryPositions);

        const spawnPositions: Position[] = this._spawn.map((tile: Tile) => tile.position);
        this._spawnPositions = new HashSet(spawnPositions);
    }

    /**
     * Builds the match map starting from the initial position of the agent
     */
    static async build(tiles: Tile[], initialPosition: Position): Promise<MatchMap> {
        const graph = await Graph.buildGraph(tiles);
        const deliveryTiles: Tile[] = tiles
            .filter((tile: Tile) => tile.delivery)
            .filter((tile: Tile) =>
                graph.hasUndirectedEdge(initialPosition.hashCode(), tile.position.hashCode()),
            );

        const spawnTiles: Tile[] = tiles.filter((tile: Tile) => tile.spawner);

        const width = tiles
            .map((tile: Tile) => tile.position.row)
            .reduce((acc: number, curr: number) => Math.max(acc, curr), 0);

        const height = tiles
            .map((tile: Tile) => tile.position.column)
            .reduce((acc: number, curr: number) => Math.max(acc, curr), 0);

        const map = new MatchMap(width, height, graph, spawnTiles, deliveryTiles);
        map._buildAdjacencyMatrix(tiles);

        return map;
    }

    get spawnTilePositions(): Position[] {
        return this._spawn.map((tile: Tile) => tile.position);
    }

    public getTiles(): Tile[] {
        const tiles = [];

        this._graph.forEachNode((_: string, tile: Tile) => tiles.push(tile));

        return tiles;
    }

    public getDeliveryTiles(): Tile[] {
        return this._delivery;
    }

    public getSpawnTiles(): Tile[] {
        return this._spawn;
    }

    /**
     * TRUE if position TO is reachable by position FROM
     */
    isReachable(from: Position, to: Position): boolean {
        return this._graph.hasUndirectedEdge(from.hashCode(), to.hashCode());
    }

    /**
     * @param a
     * @param b
     * @param throwError TRUE if an error must be thrown in case positions are not reachable
     * @returns the shortest path from point A to B
     */
    distance(a: Position, b: Position, throwError = false): number {
        if (!this._graph.hasUndirectedEdge(a.hashCode(), b.hashCode())) {
            if (throwError) {
                throw new Error(`No path exists between ${a} and ${b}.`);
            }

            return null;
        }

        return this._calculateDistanceFromReachable(a, b);
    }

    /**
     * The positions in the density radius starting from the input position
     * @param position  the input position
     */
    getTilesInDensityRadius(position: Position): Position[] {
        const positions: Position[] = [];

        const positionHashCode = position.hashCode();
        this._graph.forEachNeighbor(positionHashCode, (neighborId: string) => {
            const isInRadius: boolean = this._graph.getEdgeAttribute(
                positionHashCode,
                neighborId,
                "isDensityRadius",
            );
            if (isInRadius) {
                const neighborTile: Tile = this._graph.getNodeAttributes(neighborId); // Tile
                positions.push(neighborTile.position);
            }
        });

        return positions;
    }

    /**
     * @param a
     * @param b
     * @returns the shortest path from point A to B. No errors thrown
     */
    distanceIfPossible(a: Position, b: Position): number {
        return this.distance(a, b, false);
    }

    /**
     * Calculates the distance of a position from the closest delivery point
     * @param position
     * @param occupiedTiles positions to be ignored because occupied by another agent
     */
    distanceFromTheClosestDelivery(
        position: Position,
        occupiedTiles: HashSet<Position> = null,
    ): PositionWithDistance {
        const bestDeliverySites: PositionWithDistance[] = this._delivery
            .map((tile: Tile) => tile.position)
            .filter((position: Position) => !occupiedTiles?.has(position))
            .map((tilePosition: Position) => {
                return {
                    position: tilePosition,
                    distance: this.distanceIfPossible(position, tilePosition),
                } as PositionWithDistance;
            })
            //Removing not reachable delivery tiles
            .filter((d): d is PositionWithDistance & { distance: number } => d.distance != null)
            //Sorting descendently to then pop the last element
            .sort(
                (d1: PositionWithDistance, d2: PositionWithDistance) => d1.distance - d2.distance,
            );

        let chosenBestDelivery: PositionWithDistance = null;
        for (const delivery of bestDeliverySites) {
            if (this.calculatePath(position, delivery.position, occupiedTiles?.all)) {
                chosenBestDelivery = delivery;
                break;
            }
        }

        return chosenBestDelivery;
    }

    calculatePath(from: Position, to: Position, positionsToAvoid: Position[] = []): Position[] {
        if (positionsToAvoid?.length) {
            return this._graph.calculatePathWithAStar(from, to, positionsToAvoid);
        }

        const cacheKey = `${from.hashCode()}-${to.hashCode()}`;
        if (!this._pathsCache.has(cacheKey)) {
            const path: Position[] = this._graph.calculatePathWithAStar(from, to);
            path?.length && this._pathsCache.set(cacheKey, path);
        }

        return this._pathsCache.get(cacheKey);
    }

    calculateMidPointPaths(from: Position, to: Position): Position[][] {
        const path: Position[] = this.calculatePath(from, to);
        if (!path) {
            return null;
        }

        const firstHalf: Position[] = path.slice(0, Math.floor(path.length / 2));
        const secondHalf: Position[] = path.slice(Math.floor(path.length / 2));

        return [firstHalf, secondHalf];
    }

    private _calculateDistanceFromReachable(a: Position, b: Position): number {
        return this._graph.getDistance(a.hashCode(), b.hashCode());
    }

    private _buildAdjacencyMatrix(tiles: Tile[]): void {
        this._adjacencyMatrix.clear();

        const tileSet = new HashSet<Position>(tiles.map((tile: Tile) => tile.position));

        for (const tile of tiles) {
            const adjacentPositions: Position[] = [];

            for (const position of tile.position.adjacent) {
                if (tileSet.has(position)) {
                    adjacentPositions.push(position);
                }
            }

            this._adjacencyMatrix.set(tile.position, adjacentPositions);
        }
    }

    isSpawnPosition(position: Position): boolean {
        return this._spawnPositions.has(position);
    }

    isDeliveryPosition(position: Position): boolean {
        return this._deliveryPositions.has(position);
    }

    /**
     * Runs k-medoids clustering in a Web Worker to avoid blocking the main thread
     * @param k Number of clusters to create
     * @param maxIterations Maximum number of iterations for the algorithm
     * @returns Promise that resolves to the clustering result
     */
    async runKMedoidsClustering(k: number, maxIterations = 100): Promise<ClusteredTiles[]> {
        const spawnPositions: Position[] = this.spawnTilePositions;

        //Creating the async worker,
        const workerPool: Pool = workerpool.pool(
            path.join(__dirname, "/utils/clustering-worker.js"),
            { maxWorkers: 1 },
        );

        const clusterRequest = {
            k,
            maxIterations,
            positions: spawnPositions.map((pos) => ({ row: pos.row, column: pos.column })),
        } as ClusteringRequest;

        const workerResult = await workerPool.exec("kMedoidsClustering", [
            clusterRequest.positions,
            clusterRequest.k,
            clusterRequest.maxIterations,
        ]);
        await workerPool.terminate();

        return workerResult.map((result: any) => {
            return {
                label: result.label,
                positions: result.positions.map((pos) => new Position(pos.row, pos.column)),
                medoid: new Position(result.medoid.row, result.medoid.column),
            } as ClusteredTiles;
        });
    }
}
