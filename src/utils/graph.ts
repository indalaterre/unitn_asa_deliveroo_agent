import path from "node:path";
import workerpool from "workerpool";

import { Position, type Tile } from "@domain/models/environment";
import { HashMap } from "@utils/hashmap";
import { UndirectedGraph } from "graphology";
import PriorityQueue from "priority-queue-typescript";

interface Edge {
    weight: number;
    neighbor: boolean;
}

/**
 * Interface used for the priority queue of the A*
 */
interface PositionWithScore {
    /**
     * The position score
     */
    score: number;

    /**
     * The position instance
     */
    position: Position;
}

export type AStarHeuristicFn = (from: Position, end: Position) => number;

export class Graph extends UndirectedGraph<Tile, Edge> {
    /**
     * Transforms the map into a graph in which each node as up to 4 connections (one per every accessible direction)
     */
    public static async buildGraph(tiles: Tile[]): Promise<Graph> {
        const graph = new Graph({ allowSelfLoops: true });

        //Creating the graph nodes with tile positions
        for (const tile of tiles) {
            graph.addNode(tile.position.hashCode(), tile);
        }

        //Creating connection between each adjacent node
        graph.forEachNode((tileHash: string, tile: Tile) => {
            for (const adj of tile.position.adjacent) {
                if (
                    !graph.hasNode(adj.hashCode()) ||
                    graph.hasUndirectedEdge(tileHash, adj.hashCode())
                ) {
                    continue;
                }

                graph.addUndirectedEdge(tileHash, adj.hashCode(), { weight: 1, neighbor: true });
            }
        });

        const components: Graph[] = graph.calculateConnectedComponents();
        console.log(`Found ${components.length} components`);

        const adjacencyMatrices: number[][][] = components.map((component: Graph) =>
            component.computeAdjacencyMatrix(),
        );

        console.log(`Calculating ${adjacencyMatrices.length} adjacency matrices`);
        const threadPool = workerpool.pool(path.join(__dirname, "/utils/matrix.js"), {
            maxWorkers: adjacencyMatrices.length,
        });

        const distances = await Promise.all(
            adjacencyMatrices.map((matrix: number[][]) =>
                threadPool.exec("createPairsDistanceMatrix", [matrix]),
            ),
        );

        await threadPool.terminate();

        for (let i = 0; i < components.length; i++) {
            const distance = distances[i];
            const component = components[i];

            const nodes: string[] = component.nodes();
            for (const [i, node] of nodes.entries()) {
                for (const [j, neighbor] of nodes.entries()) {
                    if (!graph.hasUndirectedEdge(node, neighbor)) {
                        graph.addUndirectedEdge(node, neighbor, {
                            neighbor: false,
                            weight: distance[i][j],
                        });
                    }
                }
            }
        }

        return graph;
    }

    getDistance(nodeA: string, nodeB: string): number {
        return this.getEdgeAttribute(nodeA, nodeB, "weight") ?? 1;
    }

    isNeighbor(nodeA: string, nodeB: string): boolean {
        return this.getEdgeAttribute(nodeA, nodeB, "neighbor") ?? false;
    }

    getNeighborDistance(nodeA: string, nodeB: string): number {
        return this.getEdgeAttribute(nodeA, nodeB, "weight") ?? 1;
    }

    calculatePathWithAStar(
        start: Position,
        end: Position,
        heuristic: AStarHeuristicFn = Position.manhattanDistance,
    ): Position[] {
        const gScore: HashMap<Position, number> = new HashMap();
        gScore.set(start, 0);

        const fScore: HashMap<Position, number> = new HashMap();
        fScore.set(start, heuristic(start, end));

        const pathMap: HashMap<Position, Position> = new HashMap();

        const priority: PriorityQueue<PositionWithScore> = new PriorityQueue(
            1,
            (a: PositionWithScore, b: PositionWithScore) => a.score - b.score,
        );
        priority.add({ position: start, score: fScore.get(start) });

        while (priority.size() > 0) {
            const current: PositionWithScore = priority.poll();

            if (current.position.equals(end)) {
                const path: Position[] = [];

                let position: Position = current.position;
                while (position) {
                    path.unshift(position);
                    position = pathMap.get(position);
                }

                return path;
            }

            //Recalculating all G-Scores
            const currentHashCode = current.position.hashCode();
            this.forEachNeighbor(currentHashCode, (neighbor: string, tile: Tile) => {
                if (!this.isNeighbor(currentHashCode, neighbor)) {
                    return;
                }

                const tentativeGScore =
                    //We use Infinity as an edge case for g-scores not present in the map
                    //In this situation we were not able to calculate the score meaning that there is not way to reach
                    //  this node
                    (gScore.get(current.position) ?? Number.POSITIVE_INFINITY) +
                    this.getDistance(currentHashCode, neighbor);

                if (tentativeGScore < (gScore.get(tile.position) ?? Number.POSITIVE_INFINITY)) {
                    gScore.set(tile.position, tentativeGScore);
                    pathMap.set(tile.position, current.position);

                    const f = heuristic(tile.position, end) + tentativeGScore;
                    fScore.set(tile.position, f);

                    priority.add({ position: tile.position, score: f });
                }
            });
        }

        return null;
    }

    /*
        Extract graph components. That partitions of the graph where all the nodes are connected together
     */
    private calculateConnectedComponents(): Graph[] {
        const foundComponents: Graph[] = [];
        const visitedNodes = new Set<string>();

        this.forEachNode((startNode: string) => {
            if (visitedNodes.has(startNode)) return;

            const component = new Graph();
            const stack: string[] = [startNode];

            while (stack.length > 0) {
                const currentNode: string = stack.pop();
                if (visitedNodes.has(currentNode)) continue;

                visitedNodes.add(currentNode);
                if (!component.hasNode(currentNode)) {
                    component.addNode(currentNode, this.getNodeAttributes(currentNode));
                }

                this.forEachNeighbor(currentNode, (neighbor: string) => {
                    if (!visitedNodes.has(neighbor)) {
                        stack.push(neighbor);
                    }

                    if (!component.hasNode(neighbor)) {
                        component.addNode(neighbor, this.getNodeAttributes(neighbor));
                    }

                    if (!component.hasUndirectedEdge(currentNode, neighbor)) {
                        component.addUndirectedEdge(
                            currentNode,
                            neighbor,
                            this.getEdgeAttributes(currentNode, neighbor),
                        );
                    }
                });
            }

            foundComponents.push(component);
        });

        return foundComponents;
    }

    /*
        Computes the adjacency matrix.
        A matrix where each element x,y will be 1 if the node x and y are connected
     */
    private computeAdjacencyMatrix(): number[][] {
        const nodes: string[] = Array.from(this.nodes());

        const size = this.nodes().length;
        const matrix: number[][] = Array.from({ length: size }, () => Array(size).fill(0));

        const indexMap = new Map<string, number>();
        nodes.forEach((node: string, index: number) => indexMap.set(node, index));

        this.forEachEdge((_, __, source: string, target: string) => {
            const i = indexMap.get(source);
            const j: number = indexMap.get(target);

            matrix[i][j] = 1;
            matrix[j][i] = 1; // <- handles the bidirectional property
        });

        return matrix;
    }
}
