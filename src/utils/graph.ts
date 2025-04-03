import path from "node:path";
import workerpool from "workerpool";

import type { Tile } from "@domain/models/environment";
import { UndirectedGraph } from "graphology";

interface Edge {
    weight: number;
}

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
                if (!graph.hasNode(adj.hashCode()) || graph.hasUndirectedEdge(tileHash, adj.hashCode())) {
                    continue;
                }

                graph.addUndirectedEdge(tileHash, adj.hashCode(), {
                    weight: 1,
                });
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
                            weight: distance[i][j],
                        });
                    }
                }
            }
        }

        return graph;
    }

    getDistance(nodeA: string, nodeB: string): number {
        return this.getEdgeAttribute(nodeA, nodeB, "weight");
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
                if(!component.hasNode(currentNode)) {
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
