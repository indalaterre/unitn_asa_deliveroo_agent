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
    private readonly adjacencyMatrix: HashMap<Position, Position[]> = new HashMap();

    private constructor(
        private readonly width: number,
        private readonly height: number,

        private readonly _graph: Graph,
        private readonly _spawn: Tile[],
        private readonly _delivery: Tile[],
    ) {}

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

        this._graph.forEachNode((tileHash: string, tile: Tile) => tiles.push(tile));

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
     */
    distanceFromTheClosestDelivery(position: Position, occupied_tiles: Position[] = []): PositionWithDistance {
        return (
            this._delivery
                .map((tile: Tile) => tile.position)
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
                    (d1: PositionWithDistance, d2: PositionWithDistance) =>
                        d2.distance - d1.distance,
                )
                // TODO: Find a better way to see if the path is not practicable, or return the path calculated here.
                .filter((d): d is PositionWithDistance & { distance: number } => !!this.calculatePath(position, d.position, occupied_tiles))
                .pop()
        );
    }

    calculatePath(from: Position, to: Position, occupied_tiles: Position[] = []): Position[] {
        return this._graph.calculatePathWithAStar(from, to, occupied_tiles);
    }

    private _calculateDistanceFromReachable(a: Position, b: Position): number {
        return this._graph.getDistance(a.hashCode(), b.hashCode());
    }

    private _buildAdjacencyMatrix(tiles: Tile[]): void {
        this.adjacencyMatrix.clear();

        const tileSet = new HashSet<Position>(tiles.map((tile: Tile) => tile.position));

        for (const tile of tiles) {
            const adjacentPositions: Position[] = [];

            for (const position of tile.position.adjacent) {
                if (tileSet.has(position)) {
                    adjacentPositions.push(position);
                }
            }

            this.adjacencyMatrix.set(tile.position, adjacentPositions);
        }
    }
}
