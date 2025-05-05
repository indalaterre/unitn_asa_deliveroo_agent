import type { MatchMap, PositionWithDistance } from "@domain/map";
import { type Agent, Instant, ObservedAgent, Parcel } from "@domain/models";
import { GameConfiguration } from "@domain/models/configurations";
import { DecayingValue } from "@domain/models/decaying-value";
import type { Position, Tile } from "@domain/models/environment";
import { type Intention, IntentionTypes } from "@domain/models/intention";
import type { PlayerInfo } from "@domain/player-info";
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
     * The position of the agent owning these beliefs
     * @private
     */
    private _ownPosition: Position;

    /**
     * @private The ID of the carried parcels (if any)
     */
    private _carriedParcels: Parcel[] = [];

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
     * The position of the agent
     */
    get myPosition(): Position {
        return this._ownPosition;
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
        return Array.from(this.freeParcelsById.values())
            .filter(
                (parcel: Parcel) =>
                    this.parcelsDistancesToCloserDelivery.has(parcel.id) &&
                    !this._notWorthParcels.has(parcel) &&
                    this.parcelsByPosition.has(parcel.position) &&
                    !this.agentsByPosition.has(parcel.position),
            )
            .map((parcel: Parcel) => {
                //Calculating the Agent/Parcel + Parcel/Delivery distance
                const agentParcelDistance = this._ownPosition.manhattanDistance(parcel.position);

                const parcelDeliveryDistance = parcel.position.manhattanDistance(
                    this.parcelsDistancesToCloserDelivery.get(parcel.id).position,
                );

                //The calculated distance will be divided but the number of parcels in that position
                //TODO: Add a metric for the score

                const parcelsInPosition = this.parcelsByPosition.get(parcel.position);
                return {
                    context: parcel,
                    position: parcel.position,
                    distance:
                        (agentParcelDistance + parcelDeliveryDistance) / parcelsInPosition.count,
                } as PositionWithDistance;
            })
            .filter(Boolean)
            .sort((d1: PositionWithDistance, d2: PositionWithDistance) => d1.distance - d2.distance)
            .shift();
    }

    updateDroppedParcels(parcelIds: Set<string>): void {
        this._carriedParcels = this._carriedParcels.filter(
            (parcel: Parcel) => !parcelIds.has(parcel.id),
        );

        this._notWorthParcels.clear();
    }

    findBestDelivery(requestPosition: Position = this._ownPosition): PositionWithDistance {
        const blockedDeliveries: HashSet<Position> = this._temporaryBlockedDeliveries.keySet();

        const bestDeliverySites: PositionWithDistance[] = this.map
            .getDeliveryTiles()
            .map((tile: Tile) => tile.position)
            .filter((position: Position) => !blockedDeliveries?.has(position))
            .map((tilePosition: Position) => {
                const distance = this.map.distanceIfPossible(requestPosition, tilePosition);
                const agentsDensity = this._agentsDensityOnTile.get(tilePosition);

                return {
                    //Weight
                    distance,
                    position: tilePosition,
                    context: { weightedDistance: (distance ?? 0) + agentsDensity },
                } as PositionWithDistance;
            })
            //Removing not reachable delivery tiles
            .filter((d): d is PositionWithDistance & { distance: number } => d.distance != null)
            //Sorting descendently to then pop the last element
            .sort(
                (d1: PositionWithDistance, d2: PositionWithDistance) => {
                    const { weightedDistance1 } = d1.context;
                    const { weightedDistance2 } = d2.context;
                    return weightedDistance1 - weightedDistance2
                },
            );

        let chosenBestDelivery: PositionWithDistance = null;
        for (const delivery of bestDeliverySites) {
            if (
                !!this.map.calculatePath(requestPosition, delivery.position, blockedDeliveries?.all)
            ) {
                chosenBestDelivery = delivery;
                break;
            }
        }

        return chosenBestDelivery;
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
                return {
                    context: parcel,
                    position: parcel.position,
                    distance: parcel.position.manhattanDistance(this._ownPosition),
                } as PositionWithDistance;
            })
            .sort((d1: PositionWithDistance, d2: PositionWithDistance) => d1.distance - d2.distance)
            .shift();

        const freeParcel: Parcel = candidatePosition?.context;
        if (!freeParcel) {
            return null;
        }

        //The cost associated to each deviation step
        const moveScoreCost: number = GameConfiguration.moveScoreCost;

        const toParcelPath: Position[] = this.map.calculatePath(
            this.myPosition,
            freeParcel.position,
        );
        const parcelToDeliveryPath: Position[] = this.map.calculatePath(
            freeParcel.position,
            this.parcelsDistancesToCloserDelivery.get(freeParcel.id).position,
        );

        let chosenPosition: PositionWithDistance = null;
        if (toParcelPath && parcelToDeliveryPath) {
            const newParcelCost: number = toParcelPath.length + parcelToDeliveryPath.length;

            /*
             * The parcel is worth to be considered if:
             * currScore + newParcelScore - (moveCost * newDistance) >= currScore - (moveCost * distance)
             * newParcelScore >= -(moveCost * distance) + (moveCost * newDistance)
             * newParcelScore >= moveCost * (newDistance - distance)
             */
            const worthDetour: boolean =
                freeParcel.currentScore >= moveScoreCost * (newParcelCost - distanceFromDelivery);
            if (worthDetour) {
                chosenPosition = candidatePosition;
            } else {
                this._notWorthParcels.add(freeParcel);
            }
        }

        return chosenPosition;
    }

    findBestExplorationSite(): Position {
        return this.visitedTiles
            .entryArray()
            .filter(([position, _]: [Position, number]) => this.map.isSpawnPosition(position))
            .map(([position, visits]: [Position, number]) => {
                const distance: number = this._ownPosition.manhattanDistance(position);
                const agentsDensityMalus: number = this._agentsDensityOnTile.get(position);
                return {
                    position,
                    distance: 1 / (visits + 1) + distance + agentsDensityMalus,
                } as PositionWithDistance;
            })
            .sort((d1: PositionWithDistance, d2: PositionWithDistance) => d2.distance - d1.distance)
            .map((pos: PositionWithDistance) => pos.position)
            .shift();
    }

    synchronizeMyPosition(position: Position): void {
        this._ownPosition = position;
        this._internalEventsBroken.emit("own-position-changed", position);

        //We can update the map with the visited spawning tiles
        this.visitedTiles.update(position, (count: number) => (count ?? 0) + 1);
    }

    giveUpWithIntention(intention: Intention): void {
        const type = intention.type;
        if (type === IntentionTypes.MOVE) {
            const parcels: HashSet<Parcel> = this.parcelsByPosition.get(intention.position);
            this._notWorthParcels.addAll(parcels.all);
        } else if (type === IntentionTypes.DELIVER) {
            this._temporaryBlockedDeliveries.set(intention.position, new DecayingValue(5));
        }
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
        this._temporaryBlockedDeliveries.deleteIf(
            (_, value: DecayingValue) => value.currentValue <= 0,
        );

        this._parcelsToBeSynchronized = [];
    }

    calculateMovingPath(to: Position, positionsToAvoid: Position[] = []): Position[] {
        return this.map.calculatePath(this._ownPosition, to, positionsToAvoid);
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

    //////// AGENT

    queueAgentsSynchronization(agents: Agent[]): void {
        this._agentsToBeSynchronized.addAll(agents);
    }

    synchronizeKnownAgents() {
        // TODO: Improve this logic
        const agentVisibilityDistance: number = GameConfiguration.agentVisibilityDistance;

        // Filter visible and reachable agents
        const visibleAgents: Agent[] = this._agentsToBeSynchronized.all.filter((agent: Agent) =>
            this.map.isReachable(this.myPosition, agent.position),
        );

        const visibleOccupiedPositions: HashMap<Position, string> = new HashMap();
        for (const agent of visibleAgents) {
            visibleOccupiedPositions.set(agent.position, agent.agentId);
        }

        for (const [position, agent] of this.agentsByPosition.entries()) {
            if (visibleOccupiedPositions.has(position)) {
                // The position is currently still held by an agent
                this.agentsByPosition.set(position, agent);
                this.positionByAgent.set(agent, position);
                continue;
            }

            const isMyPosition = this.myPosition.equals(position);

            const distance: number = this.myPosition.manhattanDistance(position);
            const isVisible = distance <= agentVisibilityDistance;

            if (
                isMyPosition ||
                !isVisible ||
                (isVisible && !visibleOccupiedPositions.has(position))
            ) {
                this.agentsByPosition.delete(position);
                this.positionByAgent.delete(agent);
            }
        }

        for (const agent of visibleAgents) {
            if (!this.agentsByPosition.has(agent.position)) {
                this.agentsByPosition.set(agent.position, agent);
                this.positionByAgent.set(agent, agent.position);
            }

            if (!this.agents.has(agent.agentId)) {
                const observedAgent = new ObservedAgent(agent.agentId, agent.score, Instant.now());
                this.agents.set(observedAgent.agentId, observedAgent);
            } else {
                const seenAgent = {
                    ...this.agents.get(agent.agentId),
                    score: agent.score,
                    lastSeen: Instant.now(),
                } as ObservedAgent;

                this.agents.set(agent.agentId, seenAgent);
            }
        }

        //Keeps track of how much tiles there are in the density area of each position
        const positionRadiusAreaCount: HashMap<Position, number> = new HashMap();
        for (const [agent, position] of this.positionByAgent.entries()) {
            if (agent.agentId === this._ownId) {
                continue;
            }

            const densityPositions: Position[] = this.map.getTilesInDensityRadius(position);
            for (const densityPosition of densityPositions) {
                if (!positionRadiusAreaCount.has(densityPosition)) {
                    positionRadiusAreaCount.set(
                        densityPosition,
                        this.map.getTilesInDensityRadius(position)?.length,
                    );
                }

                this._agentsDensityOnTile.update(
                    densityPosition,
                    (count: number) => (count ?? 0) + 1,
                );
            }
        }

        for (const [position, tilesCount] of positionRadiusAreaCount.entries()) {
            this._agentsDensityOnTile.update(
                position,
                (count: number) => (count ?? 0) / tilesCount,
            );
        }

        this._agentsToBeSynchronized.clear();
    }

    /**
     * Returns the agents occupying the positions in the environment.
     */
    getAgents(): Agent[] {
        return Array.from(this.agentsByPosition.values());
    }

    getOccupiedPositions(): Position[] {
        return Array.from(this.agentsByPosition.keys());
    }

    /**
     * Returns whether the given position is occupied by an agent.
     */
    isPositionOccupied(position: Position): boolean {
        let result = false;

        if (this.agentsByPosition.has(position)) {
            result = true;
        }

        return result;
    }

    isAgentOnDeliveryTile(): boolean {
        return this.map.isDeliveryPosition(this.myPosition);
    }

    isAgentOnFreeParcel(): boolean {
        const parcelsInPosition: HashSet<Parcel> = this.parcelsByPosition.get(this.myPosition);
        if (!parcelsInPosition) {
            return false;
        }

        const carriedParcelIds: Set<string> = new Set<string>(this.carryingParcelIds);

        for (const parcel of parcelsInPosition) {
            if (!carriedParcelIds.has(parcel.id)) {
                return true;
            }
        }

        return false;
    }
}
