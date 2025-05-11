import type { MatchMap, PositionWithDistance } from "@domain/map";
import { type Agent, Instant, ObservedAgent, Parcel } from "@domain/models";
import { GameConfiguration } from "@domain/models/configurations";
import { DecayingValue } from "@domain/models/decaying-value";
import { DeliveryPointManager } from "@domain/models/delivery-point-manager";
import type { Position, Tile } from "@domain/models/environment";
import { type Intention, IntentionTypes } from "@domain/models/intention";
import type { PlayerInfo } from "@domain/player-info";
import { extractFirstElementsInSortedArray } from "@utils/functions";
import { HashMap } from "@utils/hashmap";
import { HashSet } from "@utils/hashset";
import { MultiValueHashMap } from "@utils/multivaluehashmap";
import EventEmitter from "eventemitter3";

export class BeliefContainer {
    /**
     * The id of the current agent
     * @private
     */
    private readonly _ownId: string;

    /**
     * Set of trusted agent IDs
     * @private
     */
    private _trustedAgentIds: Set<string> = new Set();

    /**
     * The position of the agent owning these beliefs
     * @private
     */
    private _ownPosition: Position;

    /**
     * The current agent score
     * @private
     */
    private _ownScore: number;

    /**
     * @private The ID of the carried parcels (if any)
     */
    private _carriedParcels: Parcel[] = [];

    /**
     * Stores the temporary disabled delivery points
     * @private
     */
    private _temporaryBlockedExplore: HashMap<Position, DecayingValue> = new HashMap();

    /**
     * Stores the temporary disabled delivery points
     * @private
     */
    private _temporaryBlockedDeliveries: HashMap<Position, DecayingValue> = new HashMap();

    /**
     * @private Parcels that must be ignored during evaluation of additional picks up
     */
    private _notWorthParcels: HashSet<Parcel> = new HashSet();

    /**
     * A map containing how much time a tile have been visited
     */
    private visitedTiles: HashMap<Position, number> = new HashMap();

    /**
     * Keeps the agents density in a region around the tile long GameConfiguration.agentsDensityRadius
     * @private
     */
    private _agentsDensityOnTile: HashMap<Position, number> = new HashMap();

    /**
     * Manages delivery point congestion
     * @private
     */
    private _deliveryPointManager: DeliveryPointManager;

    /**
     * An internal event emitter
     * @private
     */
    private readonly _internalEventsBroken: EventEmitter = new EventEmitter();

    /**
     * Map that associates a position to a set of parcels
     */
    private readonly parcelsByPosition: MultiValueHashMap<Position, Parcel> =
        new MultiValueHashMap();

    /**
     * @private
     * Map that contains all the free parcels (known by the agent) grouped by id
     */
    private readonly freeParcelsById: Map<string, Parcel> = new Map<string, Parcel>();

    /**
     * @private
     * Keeps track of all the parcels and their distance to the closest delivery point
     */
    private readonly parcelsDistancesToCloserDelivery: Map<string, PositionWithDistance> = new Map<
        string,
        PositionWithDistance
    >();

    /**
     * Map of all the agent seen.
     */
    private readonly agents: Map<string, ObservedAgent> = new Map();

    /**
     * HasMap Position -> Agent.
     */
    private readonly agentsByPosition: HashMap<Position, Agent> = new HashMap();

    /**
     * HasMap Agent -> Position
     */
    private readonly positionByAgent: HashMap<Agent, Position> = new HashMap();

    /**
     * The queue of parcels to be synchronized
     * @private
     */
    private _parcelsToBeSynchronized: Parcel[] = [];

    /**
     * The queue of agents to be synchronized
     * @private
     */
    private _agentsToBeSynchronized: HashSet<Agent> = new HashSet();

    constructor(
        info: PlayerInfo,
        public readonly map: MatchMap,
    ) {
        this._ownId = info.id.toString();
        this._ownPosition = info.position;
        for (const position of this.map.spawnTilePositions) {
            this.visitedTiles.set(position, 0);
            this._agentsDensityOnTile.set(position, 0);
        }

        // Initialize delivery point manager with all delivery tiles
        this._deliveryPointManager = new DeliveryPointManager(
            this.map.getDeliveryTiles().map((tile) => tile.position),
            this.map,
        );
    }

    /**
     * @returns TRUE if the agent is carrying at least one parcel
     */
    get isCarrying(): boolean {
        return !!this._carriedParcels?.length;
    }

    /**
     * @returns the id of the parcel being carried
     */
    get carryingParcelIds(): string[] {
        return this._carriedParcels.map((parcel: Parcel) => parcel.id);
    }

    /**
     * @returns the parcels being carried by the agent
     */
    get carriedParcels(): Parcel[] {
        return [...this._carriedParcels];
    }

    get myId(): string {
        return this._ownId;
    }

    /**
     * The position of the agent
     */
    get myPosition(): Position {
        return this._ownPosition;
    }

    get myScore(): number {
        return this._ownScore;
    }

    /**
     * Sets the agent position according to last move
     * @param value the value got from the server
     */
    set myPosition(value: Position) {
        this._ownPosition = value;
    }

    /**
     * @returns The best parcel according to the following rule:
     * The Agent/Parcel + Parcel/Delivery distance must be the optimal one
     */
    get bestParcelToDeliver(): PositionWithDistance {
        const moveScoreCost: number = GameConfiguration.moveScoreCost;

        const candidates: PositionWithDistance[] = Array.from(this.freeParcelsById.values())
            .filter(
                (parcel: Parcel) =>
                    this.parcelsDistancesToCloserDelivery.has(parcel.id) &&
                    !this._notWorthParcels.has(parcel) &&
                    this.parcelsByPosition.has(parcel.position) &&
                    !this.agentsByPosition.has(parcel.position),
            )
            .map((parcel: Parcel) => {
                //The cost associated to each deviation step
                const toParcelPath: Position[] = this.map.calculatePath(
                    this.myPosition,
                    parcel.position,
                );

                const bestParcelDelivery: PositionWithDistance =
                    this.parcelsDistancesToCloserDelivery.get(parcel.id);
                if (!bestParcelDelivery) {
                    return {
                        context: {
                            parcel,
                            weightedScore: Number.POSITIVE_INFINITY,
                        },
                        position: parcel.position,
                        distance: toParcelPath.length,
                    } as PositionWithDistance;
                }

                const parcelToDeliveryPath: Position[] = this.map.calculatePath(
                    parcel.position,
                    bestParcelDelivery.position,
                );

                if (toParcelPath && parcelToDeliveryPath) {
                    const totalPathLength = toParcelPath.length + parcelToDeliveryPath.length;

                    const parcelsScore = this.parcelsByPosition
                        .get(parcel.position)
                        .all.reduce((acc, curr) => acc + curr.currentScore, 0);

                    const deliveryScore = parcelsScore - totalPathLength * moveScoreCost;

                    if (deliveryScore > 0) {
                        return {
                            context: {
                                parcel,
                                weightedScore: totalPathLength - deliveryScore,
                            },
                            position: parcel.position,
                            distance: toParcelPath.length,
                        } as PositionWithDistance;
                    }
                }

                return null;
            })
            .filter(Boolean)
            .sort((d1: PositionWithDistance, d2: PositionWithDistance) => {
                const weightedScore1 = d1.context.weightedScore;
                const weightedScore2 = d2.context.weightedScore;
                return weightedScore1 - weightedScore2;
            });

        const filteredCandidates: PositionWithDistance[] = extractFirstElementsInSortedArray(
            candidates,
            (a, b) => a.context.weightedScore === b.context.weightedScore,
        );

        return filteredCandidates?.shift();
    }

    updateDroppedParcels(parcelIds: Set<string>): void {
        this._carriedParcels = this._carriedParcels.filter(
            (parcel: Parcel) => !parcelIds.has(parcel.id),
        );

        this._notWorthParcels.clear();
    }

    findBestDelivery(requestPosition: Position = this._ownPosition): PositionWithDistance {
        const blockedDeliveries: HashSet<Position> = this._temporaryBlockedDeliveries.keySet();

        // Update all delivery point statuses to account for time decay
        this._deliveryPointManager.updateAllStatuses();

        // Get all delivery tiles and create PositionWithDistance objects for each
        return (
            this.map
                .getDeliveryTiles()
                .map((tile: Tile) => tile.position)
                .map((tilePosition: Position) => {
                    // Check if this delivery point is in the blocked list
                    const isBlocked = blockedDeliveries?.has(tilePosition);

                    // Calculate path and distance
                    const path = this.map.calculatePath(
                        requestPosition,
                        tilePosition,
                        blockedDeliveries?.all,
                    );
                    const distance = this.map.distanceIfPossible(requestPosition, tilePosition);

                    // Determine if this point is reachable
                    const isReachable =
                        path !== null &&
                        path.length > 0 &&
                        distance !== null &&
                        distance !== Number.POSITIVE_INFINITY;

                    // Calculate competitive score using the delivery point manager
                    const competitiveScore = this._deliveryPointManager.calculateCongestionScore(
                        tilePosition,
                        distance || Number.POSITIVE_INFINITY,
                    );

                    // Get additional agent density from surrounding area
                    const agentsDensity = this._agentsDensityOnTile.get(tilePosition) ?? 0;

                    // Get tactical advantage score (higher is better)
                    const tacticalAdvantage =
                        this._deliveryPointManager.getTacticalAdvantageScore(tilePosition);

                    // Calculate final weighted score
                    const weightedScore = competitiveScore + agentsDensity * 0.3;

                    // We'll use the actual weighted score for all points
                    // The sorting function will handle prioritization

                    return {
                        distance: distance || Number.POSITIVE_INFINITY,
                        position: tilePosition,
                        context: {
                            weightedDistance: weightedScore,
                            isBlocked: isBlocked,
                            isReachable: isReachable,
                            path: path,
                            opponentCongestion:
                                this._deliveryPointManager.getOpponentCongestionLevel(tilePosition),
                            estimatedWaitTime:
                                this._deliveryPointManager.getEstimatedWaitTime(tilePosition),
                            tacticalAdvantage: tacticalAdvantage,
                        },
                    } as PositionWithDistance;
                })
                // Sort with a custom comparator that prioritizes reachable points
                .sort((d1: PositionWithDistance, d2: PositionWithDistance) => {
                    // First prioritize by reachability
                    const d1Reachable = d1.context.isReachable && !d1.context.isBlocked;
                    const d2Reachable = d2.context.isReachable && !d2.context.isBlocked;

                    if (d1Reachable && !d2Reachable) {
                        return -1; // d1 comes first (reachable before blocked)
                    }
                    if (!d1Reachable && d2Reachable) {
                        return 1; // d2 comes first (reachable before blocked)
                    }

                    // If both have same reachability status, sort by weighted score
                    return d1.context.weightedDistance - d2.context.weightedDistance;
                })
                .shift()
        );
    }

    findAdditionalParcelWorthToKeep(delivery: Position): PositionWithDistance {
        const distanceFromDelivery: number = this._ownPosition.manhattanDistance(delivery);
        const carryingParcelIds: Set<string> = new Set(this.carryingParcelIds);

        const candidatePosition: PositionWithDistance = Array.from(this.freeParcelsById.values())
            .filter(
                (parcel: Parcel) =>
                    !carryingParcelIds.has(parcel.id) && !this._notWorthParcels.has(parcel),
            )
            .map((parcel: Parcel) => {
                const toParcelPath: Position[] = this.map
                    .calculatePath(this.myPosition, parcel.position)
                    ?.slice(1);

                if (toParcelPath) {
                    return {
                        context: { parcel },
                        position: parcel.position,
                        distance: toParcelPath.length,
                    } as PositionWithDistance;
                }

                return null;
            })
            .filter(Boolean)
            .sort((d1: PositionWithDistance, d2: PositionWithDistance) => d1.distance - d2.distance)
            .shift();

        const freeParcel: Parcel = candidatePosition?.context?.parcel;
        if (!freeParcel) {
            return null;
        }

        //The cost associated to each deviation step
        const moveScoreCost: number = GameConfiguration.moveScoreCost;

        const toParcelPathLength: number = candidatePosition.distance;
        const parcelToDeliveryPath: Position[] = this.map.calculatePath(
            freeParcel.position,
            this.parcelsDistancesToCloserDelivery.get(freeParcel.id).position,
        );

        let chosenPosition: PositionWithDistance = null;
        if (parcelToDeliveryPath) {
            const newParcelCost: number = toParcelPathLength + parcelToDeliveryPath.length;

            /*
             * The parcel is worth to be considered if:
             * currScore + newParcelScore - (moveCost * newDistance) >= currScore - (moveCost * distance)
             * newParcelScore >= -(moveCost * distance) + (moveCost * newDistance)
             * newParcelScore >= moveCost * (newDistance - distance)
             */
            const netBenefit: number =
                freeParcel.currentScore - moveScoreCost * (newParcelCost - distanceFromDelivery);
            if (netBenefit > 5) {
                chosenPosition = {
                    ...candidatePosition,
                    context: {
                        ...candidatePosition.context,
                        netBenefit,
                    },
                };
            } else {
                this._notWorthParcels.add(freeParcel);
            }
        }

        return chosenPosition;
    }

    findBestExplorationSite(): Position {
        // Only consider spawn tiles as potential exploration targets
        const spawnTiles: Tile[] = this.map.getSpawnTiles();

        // Get the agent's visibility distance from game configuration
        const visibilityDistance = GameConfiguration.agentVisibilityDistance;

        // Filter spawn tiles to only include those outside the visibility area
        const tilesOutsideVisibility: Tile[] = spawnTiles.filter((tile) => {
            const distanceToTile = this._ownPosition.manhattanDistance(tile.position);
            return distanceToTile > visibilityDistance; // Only consider tiles outside visibility range
        });

        // First try to find unexplored spawn tiles outside visibility
        const unexploredTiles: Tile[] = tilesOutsideVisibility
            .filter((tile) => !this.visitedTiles.has(tile.position))
            .filter((tile) => !this._temporaryBlockedExplore.has(tile.position));

        // If we have unexplored tiles outside visibility, prioritize those
        if (unexploredTiles.length > 0) {
            return unexploredTiles
                .map((tile: Tile) => {
                    const distance = this._ownPosition.manhattanDistance(tile.position);
                    return {
                        position: tile.position,
                        distance: distance, // Lower distance is better for unexplored tiles
                    } as PositionWithDistance;
                })
                .sort((d1, d2) => d1.distance - d2.distance) // Sort by closest first
                .map((pos) => pos.position)
                .shift();
        }

        // If no unexplored tiles outside visibility, try any spawn tile outside visibility
        if (tilesOutsideVisibility.length > 0) {
            const exploredPositions = tilesOutsideVisibility
                .filter((tile) => !this._temporaryBlockedExplore.has(tile.position))
                .map((tile) => this.calculateTileExplorationFactor(tile))
                .sort((a, b) => b.score - a.score) // Higher score is better
                .filter(Boolean)
                .map((positionData) => positionData.position)
                .shift();

            if (!exploredPositions) {
                return exploredPositions;
            }
        }

        // Fallback: If no tiles outside visibility or all are blocked, consider any spawn tile
        const anySpawnTiles = spawnTiles
            .filter((tile) => !this._temporaryBlockedExplore.has(tile.position))
            .map((tile) => this.calculateTileExplorationFactor(tile))
            .sort((a, b) => b.score - a.score); // Higher score is better

        if (anySpawnTiles.length > 0) {
            return anySpawnTiles[0].position;
        }

        // Last resort fallback: return a random spawn position
        const spawnPositions = spawnTiles.map((tile) => tile.position);
        return spawnPositions[Math.floor(Math.random() * spawnPositions.length)];
    }

    synchronizeMyPosition(position: Position): void {
        this._ownPosition = position;
        this._internalEventsBroken.emit("own-position-changed", position);

        //We can update the map with the visited spawning tiles
        this.visitedTiles.update(position, (count: number) => (count ?? 0) + 1);
    }

    giveUpWithIntention(intention: Intention): void {
        const type: IntentionTypes = intention.type;
        if (type === IntentionTypes.MOVE) {
            const parcels: HashSet<Parcel> = this.parcelsByPosition.get(intention.position);
            this._notWorthParcels.addAll(parcels.all);
        } else if (type === IntentionTypes.DELIVER) {
            this._temporaryBlockedDeliveries.set(intention.position, new DecayingValue(10));
            // Unregister from the delivery point if giving up on a deliver intention
            this.unregisterFromDeliveryPoint(intention.position);
        } else if (type === IntentionTypes.EXPLORE) {
            this._temporaryBlockedExplore.set(intention.position, new DecayingValue(10));
        }
    }

    /**
     * Unregisters the agent from a delivery point to reduce congestion tracking
     * @param position The delivery point position
     */
    unregisterFromDeliveryPoint(position: Position): void {
        // Only unregister if the position is a delivery point
        if (this.map.isDeliveryPosition(position)) {
            this._deliveryPointManager.unregisterDeliveryIntent(position);
        }
    }

    /**
     * Checks if a position is occupied by another agent
     * @param position The position to check
     * @returns True if the position is occupied by another agent
     */
    isPositionOccupied(position: Position): boolean {
        return this.agentsByPosition.has(position);
    }

    /**
     * Gets all positions currently occupied by other agents
     * @returns Array of positions occupied by other agents
     */
    getOccupiedPositions(): Position[] {
        return this.agentsByPosition.keySet().all;
    }

    /**
     * Checks if the agent is currently on a delivery tile
     * @returns True if the agent is on a delivery tile
     */
    isAgentOnDeliveryTile(): boolean {
        return this.map.isDeliveryPosition(this._ownPosition);
    }

    /**
     * Checks if the agent is currently on a tile with a free parcel
     * @returns True if the agent is on a tile with a free parcel
     */
    isAgentOnFreeParcel(): boolean {
        const parcelsInPosition: HashSet<Parcel> = this.parcelsByPosition.get(this._ownPosition);
        if (!parcelsInPosition?.count) {
            return false;
        }

        const carriedParcelIds = new Set<string>(this.carryingParcelIds);

        for (const parcel of parcelsInPosition.all) {
            if (!carriedParcelIds.has(parcel.id)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Calculates a congestion score for a delivery point
     * @param position The delivery point position
     * @param distance The distance to the delivery point
     * @returns A weighted score (lower is better)
     */
    calculateDeliveryPointCongestionScore(position: Position, distance: number): number {
        return this._deliveryPointManager.calculateCongestionScore(position, distance);
    }

    queueParcelsSynchronization(parcels: Parcel[]): void {
        this._parcelsToBeSynchronized.push(...parcels);
    }

    synchronizeKnownParcels(): void {
        const reachableParcels: Parcel[] = this._parcelsToBeSynchronized.filter((parcel: Parcel) =>
            this.map.isReachable(this._ownPosition, parcel.position),
        );

        const reachableParcelIds: Set<string> = new Set(
            reachableParcels.map((parcel: Parcel) => parcel.id),
        );

        const visibility: number = GameConfiguration.parcelVisibilityDistance;

        //This set of arrays is meant to detect changes in parcel beliefs in order to fire "changed belief" event
        const newFreeParcels: Parcel[] = [];
        const expiredParcels: Parcel[] = [];
        const noLongerFreeParcels: Parcel[] = [];
        const changedPositionParcels: [string, Position, Position][] = [];

        //Checking for expired parcels
        for (const [id, parcel] of this.freeParcelsById.entries()) {
            if (parcel.expired) {
                //Remove expired parcel
                this._removeParcel(parcel);
                expiredParcels.push(parcel);
                continue;
            }

            const isParcelReachable = reachableParcelIds.has(id);
            const shouldBeVisible = this._canSee(this._ownPosition, parcel.position, visibility);

            if (shouldBeVisible && !isParcelReachable) {
                //This means that the parcel is not there anymore and has been taken by another agent
                this._removeParcel(parcel);
                noLongerFreeParcels.push(parcel);
            }
        }

        for (const parcel of reachableParcels) {
            if (!parcel.agentId) {
                //The parcel is not taken by any other agent
                if (this.freeParcelsById.has(parcel.id)) {
                    //The parcel is already known by the agent
                    //Checking if has been moved (for any reason)
                    if (this._changeParcelPosition(parcel.id, parcel.position)) {
                        changedPositionParcels.push([
                            parcel.id,
                            //The old position
                            this.freeParcelsById.get(parcel.id).position,
                            parcel.position,
                        ]);
                    }
                } else {
                    // This is a new parcel not seen before
                    this.freeParcelsById.set(parcel.id, parcel);
                    this.parcelsByPosition.add(parcel.position, parcel);

                    newFreeParcels.push(parcel);
                }
            } else if (this.freeParcelsById.has(parcel.id)) {
                //The parcel was considered as free, but it's not free anymore
                this._removeParcel(parcel);
            }
        }

        //Updating the distances of the parcels by the closest delivery point
        for (const parcel of newFreeParcels) {
            this.updateClosestDistanceFromDelivery(parcel.id, parcel.position);
        }
        for (const knownParcel of changedPositionParcels) {
            this.updateClosestDistanceFromDelivery(knownParcel[0], knownParcel[2]);
        }

        if (newFreeParcels.length || noLongerFreeParcels.length || changedPositionParcels.length) {
            this._internalEventsBroken.emit("parcels-changed", {
                newParcels: newFreeParcels,
                takenParcels: noLongerFreeParcels,
                movedParcels: changedPositionParcels,
            });
        }

        if (expiredParcels.length) {
            this._internalEventsBroken.emit("parcels-expired", { expiredParcels });
        }

        //Cleaning disabled delivery points
        this._temporaryBlockedExplore.deleteIf(
            (_, value: DecayingValue) => value.currentValue <= 0,
        );
        this._temporaryBlockedDeliveries.deleteIf(
            (_, value: DecayingValue) => value.currentValue <= 0,
        );

        this._parcelsToBeSynchronized = [];
    }

    calculateMovingPath(to: Position, positionsToAvoid: Position[] = []): Position[] {
        return this.map.calculatePath(this._ownPosition, to, positionsToAvoid);
    }

    calculateMeetingPointPaths(to: Position): Position[][] {
        return this.map.calculateMidPointPaths(this.myPosition, to);
    }

    private updateClosestDistanceFromDelivery(parcelId: string, parcelPosition: Position) {
        const distanceFromClosestDelivery: PositionWithDistance =
            this.findBestDelivery(parcelPosition);
        this.parcelsDistancesToCloserDelivery.set(parcelId, distanceFromClosestDelivery);
    }

    private _removeParcel(toRemove: Parcel): void {
        this.freeParcelsById.delete(toRemove.id);
        this.parcelsDistancesToCloserDelivery.delete(toRemove.id);
        this.parcelsByPosition.get(toRemove.position)?.delete(toRemove);
    }

    private _canSee(startPosition: Position, endPosition: Position, maxDistance: number): boolean {
        return startPosition.manhattanDistance(endPosition) <= maxDistance;
    }

    /**
     * @returns TRUE if the position has been changed
     */
    private _changeParcelPosition(parcelId: string, newPosition: Position): boolean {
        const parcel: Parcel = this.freeParcelsById.get(parcelId);
        if (!parcel) {
            throw new Error("Parcel was not found");
        }

        const knownPosition: Position = parcel.position;
        if (knownPosition.equals(newPosition)) {
            return false;
        }

        const updatedParcel = new Parcel(parcelId, parcel.agentId, newPosition, parcel.score);
        this.freeParcelsById.set(parcelId, updatedParcel);

        //Updating positions index
        //Removing old entry
        this.parcelsByPosition.get(knownPosition)?.delete(parcel);

        //Setting new value
        this.parcelsByPosition.add(newPosition, updatedParcel);

        return true;
    }

    updateCarriedParcelsAfterPickup(pickedParcelIds: Set<string>) {
        const pickedUpParcels: HashSet<Parcel> = this.parcelsByPosition.get(this.myPosition);
        if (!pickedUpParcels) {
            return;
        }

        for (const parcelId of pickedParcelIds) {
            const parcel: Parcel = this.freeParcelsById.get(parcelId);
            if (parcel) {
                this._carriedParcels.push(parcel);
                this.freeParcelsById.delete(parcelId);

                this.parcelsByPosition.delete(this.myPosition);
                this.parcelsDistancesToCloserDelivery.delete(parcel.id);
            }
        }
    }

    /**
     * Evaluates the benefit of handing off parcels to another agent
     * @param agentId The ID of the potential handoff partner
     * @returns A numeric value representing the benefit (higher is better)
     */
    evaluateHandoffBenefit(agentId: string): number {
        // If not carrying parcels, no benefit
        if (!this.isCarrying) {
            return -1;
        }

        const friendAgent: Agent = this.agents.get(agentId);
        const agentPosition: Position = friendAgent?.position;
        if (!agentPosition) {
            return -1;
        }

        // Find the best delivery point for our parcels
        const bestDelivery: PositionWithDistance = this.findBestDelivery();
        const myPathToAgent: Position[][] = this.map.calculateMidPointPaths(
            this.myPosition,
            agentPosition,
        );
        if (!myPathToAgent) {
            //Path to agent is blocked. We need to skip it
            return -1;
        }

        //SPECIAL CASE: Path from my position to best delivery is blocked. We evaluate asking help to a friend
        if (bestDelivery?.distance === Number.POSITIVE_INFINITY) {
            const pathLength: number = myPathToAgent[0].length + myPathToAgent[1].length;
            if (!pathLength) {
                return -1;
            } else if (pathLength > 20) {
                return 50;
            } else {
                return 200;
            }
        }

        const myPathToDelivery: Position[][] = this.map.calculateMidPointPaths(
            this.myPosition,
            bestDelivery.position,
        );

        //We consider as meeting position the final destination of the agent path to at the middle of the path
        const myDistanceToMeeting: number = myPathToDelivery[0].length;
        const friendDistanceToMeeting: number = myDistanceToMeeting[1].length;

        //We now calculate the benefit of a handoff operation
        /*
        YOU -------- myDistanceToDelivery --------> DELIVERY POINT
          \                                         /
           \-- myDistanceToMeeting --> MEETING    /
                                       POINT <----/
                                              friendMeetingToDelivery
                                                  /
                                                 /
                                             PARTNER

         */
        const timeSavings: number =
            myDistanceToMeeting - (myDistanceToMeeting + friendDistanceToMeeting);

        const totalParcelValue: number = this.carriedParcels.reduce(
            (sum: number, parcel: Parcel) => sum + parcel.currentScore,
            0,
        );

        // We increase the priority of the handoff if parcels are closer to expiration (their score is low)
        return timeSavings - Math.floor(totalParcelValue / 10);
    }

    //////// AGENT

    queueAgentsSynchronization(agents: Agent[]): void {
        this._agentsToBeSynchronized.addAll(agents);
    }

    synchronizeKnownAgents(): void {
        // Cleaning up expired agents
        for (const [id, agent] of this.agents.entries()) {
            if (agent.isExpired()) {
                this.agents.delete(id);
                this.agentsByPosition.delete(agent.position);
                this.positionByAgent.delete(agent);
            }
        }

        // Updating the agents density
        this._agentsDensityOnTile.clear();

        // Collect opponent positions for delivery point congestion tracking
        const opponentPositions: Position[] = [];

        // Clear existing position mappings to prevent stale data
        this.agentsByPosition.clear();

        // Process existing agents (opponents)
        for (const agent of this.agents.values()) {
            // Skip our own agent
            if (agent.agentId === this._ownId) continue;

            // Add opponent position to the list for delivery point congestion calculation
            // Only consider non-trusted agents as opponents for congestion
            if (agent.position && !this._trustedAgentIds.has(agent.agentId)) {
                opponentPositions.push(agent.position);
            }

            // Update position mappings
            if (agent.position) {
                this.agentsByPosition.set(agent.position, agent);
                this.positionByAgent.set(agent, agent.position);
            }

            // Update agent density for all positions in radius
            // We still track density for all agents, including trusted ones
            const tilesInRadius: Position[] = this.map.getTilesInDensityRadius(agent.position);
            for (const position of tilesInRadius) {
                this._agentsDensityOnTile.update(position, (count: number) => (count ?? 0) + 1);
            }
        }

        // Adding new agents
        for (const agent of this._agentsToBeSynchronized.all) {
            // Check if we already have this agent
            const existingAgent = this.agents.get(agent.agentId);
            if (existingAgent) {
                // Update the existing agent's position
                if (existingAgent.position && !existingAgent.position.equals(agent.position)) {
                    // Remove old position mapping
                    this.agentsByPosition.delete(existingAgent.position);

                    // Update position
                    existingAgent.position = agent.position;
                    existingAgent.lastSeen = Instant.now();

                    // Update position mappings
                    this.agentsByPosition.set(agent.position, agent);
                    this.positionByAgent.set(agent, agent.position);
                }
            } else {
                // Create new observed agent
                const observedAgent = ObservedAgent.fromAgent(agent);
                this.agents.set(agent.agentId, observedAgent);

                // Update position mappings
                if (agent.position) {
                    this.agentsByPosition.set(agent.position, agent);
                    this.positionByAgent.set(agent, agent.position);
                }
            }

            // Add to opponent positions if it's not our agent
            if (agent.agentId !== this._ownId && agent.position) {
                opponentPositions.push(agent.position);
            }
        }

        // Make sure our own position is not marked as occupied
        this.agentsByPosition.delete(this._ownPosition);

        // Update delivery point manager with current opponent positions and our position
        this._deliveryPointManager.updateOpponentPositions(opponentPositions, this._ownPosition);

        this._agentsToBeSynchronized.clear();
    }

    getAgent(agentId: string): Agent | undefined {
        return this.agents.get(agentId);
    }

    /**
     * Returns the agents occupying the positions in the environment.
     */
    getTrustedAgents(): Agent[] {
        return Array.from(this._trustedAgentIds.values())
            .map((agentId: string) => this.agents.get(agentId))
            .filter((agent: ObservedAgent) => !agent.isFriendExpired())
            .map((agent: ObservedAgent) => agent.toAgent());
    }

    /**
     * Adds an agent to the trusted agents list
     * @param agentId The ID of the agent to trust
     */
    addTrustedAgent(agentId: string): void {
        if (this._ownId !== agentId) {
            this.agents.get(agentId)?.ping();
            this._trustedAgentIds.add(agentId);
        }
    }

    /**
     * Checks if an agent is trusted
     * @param agentId The ID of the agent to check
     * @returns True if the agent is trusted
     */
    isTrustedAgent(agentId: string): boolean {
        return this._trustedAgentIds.has(agentId);
    }

    private calculateTileExplorationFactor(tile: Tile) {
        const position = tile.position;
        const visits = this.visitedTiles.get(position) || 0;
        const distance = this._ownPosition.manhattanDistance(position);
        const agentsDensityMalus = this._agentsDensityOnTile.get(position) || 0;

        // Add some randomness to prevent getting stuck
        const randomFactor: number = Math.random();

        return {
            position,
            // Higher score is better: prefer less visited tiles that are closer
            score: 1 / (visits + 1) - distance * 0.05 - agentsDensityMalus + randomFactor,
        };
    }
}
