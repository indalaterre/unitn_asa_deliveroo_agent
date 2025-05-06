import path from "node:path";
import workerpool from "workerpool";

import { GameConfiguration } from "@domain/models";
import { Position, type Tile } from "@domain/models/environment";
import { HashMap } from "@utils/hashmap";
import { UndirectedGraph } from "graphology";
import PriorityQueue from "priority-queue-typescript";

interface Edge {
    weight: number;
    neighbor: boolean;
    isDensityRadius: boolean;
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
    // Path cache for frequently accessed paths
    private _pathCache: Map<string, Position[]> = new Map<string, Position[]>();
    
    private readonly PATH_CACHE_SIZE_LIMIT = 1000;
    /**
     * Transforms the map into a graph in which each node as up to 4 connections (one per every accessible direction)
     */
    public static async buildGraph(tiles: Tile[]): Promise<Graph> {
        const graph = new Graph({ allowSelfLoops: true });
        
        // Clear path cache when building a new graph
        graph.clearPathCache();

        //Creating the graph nodes with tile positions
        tiles
            .filter((tile: Tile) => tile.walkable)
            .forEach((tile: Tile) => graph.addNode(tile.position.hashCode(), tile));

        //Creating connection between each adjacent node
        graph.forEachNode((tileHash: string, tile: Tile) => {
            for (const adj of tile.position.adjacent) {
                if (
                    !graph.hasNode(adj.hashCode()) ||
                    graph.hasUndirectedEdge(tileHash, adj.hashCode())
                ) {
                    continue;
                }

                graph.addUndirectedEdge(tileHash, adj.hashCode(), {
                    weight: 1,
                    neighbor: true,
                    isDensityRadius: false,
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

        const agentDensityRadius: number = GameConfiguration.agentsDensityRadius;
        for (let i = 0; i < components.length; i++) {
            const distance = distances[i];
            const component: Graph = components[i];

            const nodes: string[] = component.nodes();
            for (const [i, node] of nodes.entries()) {
                for (const [j, neighbor] of nodes.entries()) {
                    if (!graph.hasUndirectedEdge(node, neighbor)) {
                        graph.addUndirectedEdge(node, neighbor, {
                            neighbor: false,
                            weight: distance[i][j],
                            isDensityRadius: distance[i][j] <= agentDensityRadius,
                        });
                    }
                }
            }
        }

        // Verify bidirectional edges for consistency
        graph.verifyBidirectionalEdges();
        
        return graph;
    }
    
    /**
     * Clears the path cache
     */
    public clearPathCache(): void {
        this._pathCache.clear();
    }
    
    /**
     * Invalidates path cache entries involving a specific position
     * @param position The position to invalidate cache for
     * @private
     */
    private _invalidatePathCacheForPosition(position: Position): void {
        const positionHash = position.hashCode();
        const keysToRemove: string[] = [];
        
        for (const key of this._pathCache.keys()) {
            if (key.includes(positionHash)) {
                keysToRemove.push(key);
            }
        }
        
        for (const key of keysToRemove) {
            this._pathCache.delete(key);
        }
    }
    
    /**
     * Verifies that all edges are bidirectional and fixes any inconsistencies
     */
    public verifyBidirectionalEdges(): void {
        const edgesToAdd: [string, string, Edge][] = [];
        
        this.forEachEdge((edge: string, attributes: Edge, source: string, target: string) => {
            // Check if the reverse edge exists with the same attributes
            if (!this.hasEdge(target, source)) {
                edgesToAdd.push([target, source, attributes]);
            }
        });
        
        // Add any missing edges
        for (const [source, target, attributes] of edgesToAdd) {
            this.addUndirectedEdge(source, target, attributes);
        }
    }
    
    /**
     * Updates edge weights based on congestion or other factors
     * @param position The position to update weights for
     * @param congestionMap Map of congestion values by position
     */
    public updateEdgeWeights(position: Position, congestionMap: Map<string, number>): void {
        const positionHash = position.hashCode();
        
        this.forEachNeighbor(positionHash, (neighborHash: string) => {
            if (!this.isNeighbor(positionHash, neighborHash)) {
                return;
            }
            
            // Calculate new weight based on congestion
            let weight = 1; // Base weight
            
            // Add weight for congested areas
            const congestion = congestionMap.get(neighborHash) || 0;
            weight += congestion * 0.5;
            
            // Update edge weight
            this.setEdgeAttribute(positionHash, neighborHash, "weight", weight);
        });
        
        // Invalidate affected path cache entries
        this._invalidatePathCacheForPosition(position);
    }
    
    /**
     * Checks if the graph is fully connected
     * @returns True if all nodes are reachable from any node
     */
    public isFullyConnected(): boolean {
        if (this.order === 0) return true;
        
        // Pick any starting node
        const startNode = this.nodes()[0];
        
        // Run BFS to count reachable nodes
        const visited = new Set<string>();
        const queue: string[] = [startNode];
        
        while (queue.length > 0) {
            const current = queue.shift();
            
            if (visited.has(current)) continue;
            visited.add(current);
            
            this.forEachNeighbor(current, (neighbor: string) => {
                if (!visited.has(neighbor)) {
                    queue.push(neighbor);
                }
            });
        }
        
        // If all nodes are visited, the graph is connected
        return visited.size === this.order;
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
        occupied_tiles?: Position[],
        heuristic: AStarHeuristicFn = Position.manhattanDistance,
    ): Position[] {
        // Check cache first if no occupied tiles are specified
        if (!occupied_tiles || occupied_tiles.length === 0) {
            const cacheKey = `${start.hashCode()}-${end.hashCode()}`;
            if (this._pathCache.has(cacheKey)) {
                return this._pathCache.get(cacheKey);
            }
        }
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

                // Cache the result if no occupied tiles were specified
                if ((!occupied_tiles || occupied_tiles.length === 0) && this._pathCache.size < this.PATH_CACHE_SIZE_LIMIT) {
                    const cacheKey = `${start.hashCode()}-${end.hashCode()}`;
                    this._pathCache.set(cacheKey, path);
                }
                
                return path;
            }

            //Recalculating all G-Scores
            const currentHashCode = current.position.hashCode();
            this.forEachNeighbor(currentHashCode, (neighbor: string, tile: Tile) => {
                if (!this.isNeighbor(currentHashCode, neighbor)) {
                    return;
                }

                let occupied = 0;
                if (occupied_tiles?.some((position: Position) => position.equals(tile.position))) {
                    occupied = Number.POSITIVE_INFINITY;
                }

                const tentativeGScore: number =
                    //We use Infinity as an edge case for g-scores not present in the map
                    //In this situation we were not able to calculate the score meaning that there is not way to reach
                    //  this node
                    (gScore.get(current.position) ?? Number.POSITIVE_INFINITY) +
                    this.getDistance(currentHashCode, neighbor) +
                    occupied;

                if (tentativeGScore < (gScore.get(tile.position) ?? Number.POSITIVE_INFINITY)) {
                    gScore.set(tile.position, tentativeGScore);
                    pathMap.set(tile.position, current.position);

                    const f: number = heuristic(tile.position, end) + tentativeGScore;
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
