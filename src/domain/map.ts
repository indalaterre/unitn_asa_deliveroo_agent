import { Directions, type Position, type Tile } from "@domain/models/environment";
import { Graph } from "@utils/graph";
import { HashMap } from "@utils/hashmap";
import { HashSet } from "@utils/hashset";

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

    public getPddlMap(): Map<string, string[]> {
        const result = new Map();

        const pddlObjects = [];
        const pddlInit = [];

        for (const node of this._graph.nodeEntries()) {
            pddlObjects.push(`${node.attributes.pddlSerialize()}`);

            for (const neighbor of this._graph.neighborEntries(node.node)) {
                if (
                    node.attributes.position
                        .moveTo(Directions.LEFT)
                        .equals(neighbor.attributes.position)
                ) {
                    pddlInit.push(
                        `(left ${node.attributes.pddlSerialize()} ${neighbor.attributes.pddlSerialize()})`,
                    );
                } else if (
                    node.attributes.position
                        .moveTo(Directions.UP)
                        .equals(neighbor.attributes.position)
                ) {
                    pddlInit.push(
                        `(above ${node.attributes.pddlSerialize()} ${neighbor.attributes.pddlSerialize()})`,
                    );
                } else if (
                    node.attributes.position
                        .moveTo(Directions.RIGHT)
                        .equals(neighbor.attributes.position)
                ) {
                    pddlInit.push(
                        `(right ${node.attributes.pddlSerialize()} ${neighbor.attributes.pddlSerialize()})`,
                    );
                } else if (
                    node.attributes.position
                        .moveTo(Directions.DOWN)
                        .equals(neighbor.attributes.position)
                ) {
                    pddlInit.push(
                        `(belowe ${node.attributes.pddlSerialize()} ${neighbor.attributes.pddlSerialize()})`,
                    );
                }
            }
        }

        result.set("objects", pddlObjects);
        result.set("init", pddlInit);

        return result;
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
            if (!!this.calculatePath(position, delivery.position, occupiedTiles?.all)) {
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
}
