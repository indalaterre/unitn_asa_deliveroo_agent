import type { Position, Tile } from "@domain/models/environment";
import { Graph } from "@utils/graph";

export class MatchMap {
    private constructor(
        private readonly _graph: Graph,
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

        return new MatchMap(graph, deliveryTiles);
    }
}
