import { Directions, type Position, type Tile } from "@domain/models/environment";
import { Graph } from "@utils/graph";

export class MatchMap {
    private constructor(
        private readonly _graph: Graph,
        private readonly _delivery: Tile[],
        private readonly _spawn: Tile[],
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
        const spawnTiles: Tile[] = tiles
            .filter((tile: Tile) => tile.spawner);

        return new MatchMap(graph, deliveryTiles, spawnTiles);
    }

    public getTiles(): Tile[]{
        let tiles = [];

        this._graph.forEachNode( (tileHash: string, tile: Tile) => tiles.push(tile));

        return tiles;
    }

    public getPddlMap(): Map<string, string[]>{

        const result = new Map();

        let pddlObjects = [];
        let pddlInit = [];

        for (const node of this._graph.nodeEntries()){
            
            pddlObjects.push(`${node.attributes.pddlSerialize()}`);

            for (const neighbor of this._graph.neighborEntries(node.node)){
                if (node.attributes.position.moveTo(Directions.LEFT).equals(neighbor.attributes.position)){
                    pddlInit.push(`(left ${node.attributes.pddlSerialize()} ${neighbor.attributes.pddlSerialize()})`);
                } else if (node.attributes.position.moveTo(Directions.UP).equals(neighbor.attributes.position)){
                    pddlInit.push(`(above ${node.attributes.pddlSerialize()} ${neighbor.attributes.pddlSerialize()})`);
                } else if(node.attributes.position.moveTo(Directions.RIGHT).equals(neighbor.attributes.position)) {
                    pddlInit.push(`(right ${node.attributes.pddlSerialize()} ${neighbor.attributes.pddlSerialize()})`);
                } else if(node.attributes.position.moveTo(Directions.DOWN).equals(neighbor.attributes.position)){
                    pddlInit.push(`(belowe ${node.attributes.pddlSerialize()} ${neighbor.attributes.pddlSerialize()})`);
                }
            }
        }

        result.set("objects", pddlObjects);
        result.set("init", pddlInit);

        return result;
    }

    public getDeliveryTiles(): Tile[]{
        return this._delivery
    }

    public getSpawnTiles(): Tile[]{
        return this._spawn
    }
}
