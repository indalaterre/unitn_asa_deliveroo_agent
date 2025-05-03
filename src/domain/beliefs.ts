import type { MatchMap, PositionWithDistance } from "@domain/map";
import { type Agent, Instant, ObservedAgent, Parcel } from "@domain/models";
import { GameConfiguration } from "@domain/models/configurations";
import type { Position } from "@domain/models/environment";
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
     * HasMap Position -> Agent.
     */
    private readonly agentsByPosition: HashMap<Position, Agent> = new HashMap();

    /**
     * HasMap Agent -> Position
     */
    private readonly positionByAgent: HashMap<Agent, Position> = new HashMap();

    /**
     * Map of all the agent seen.
     */
    private readonly agents: Map<string, ObservedAgent> = new Map();

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
        return (
            Array.from(this.freeParcelsById.values())
                .map((parcel: Parcel) => {
                    //We check if the parcel can be delivered to a delivery point
                    if (
                        !this.parcelsDistancesToCloserDelivery.has(parcel.id) ||
                        !this.parcelsByPosition.has(parcel.position) ||
                        this.agentsByPosition.has(parcel.position)
                    ) {
                        //This values we have the lowest priority and will be discarded
                        return null;
                    }

                    //Calculating the Agent/Parcel + Parcel/Delivery distance
                    const agentParcelDistance = this._ownPosition.manhattanDistance(
                        parcel.position,
                    );
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
                            (agentParcelDistance + parcelDeliveryDistance) /
                            parcelsInPosition.count,
                    } as PositionWithDistance;
                })
                .filter(Boolean)
                .sort(
                    (d1: PositionWithDistance, d2: PositionWithDistance) =>
                        d1.distance - d2.distance,
                )
                // TODO: Find a better way to see if the path is not practicable, or return the path calculated here.
                .filter((d) =>
                    this.map.calculatePath(
                        this.myPosition,
                        d.position,
                        this.getOccupiedPositions(),
                    ),
                )
                .shift()
        );
    }

    updateDroppedParcels(parcelIds: Set<string>): void {
        this._carriedParcels = this._carriedParcels.filter(
            (parcel: Parcel) => !parcelIds.has(parcel.id),
        );

        this._notWorthParcels.clear();
    }

    findBestDelivery(): Position {
        return this.map.distanceFromTheClosestDelivery(
            this._ownPosition,
            this.getOccupiedPositions(),
        )?.position;
    }

    findAdditionalParcelWorthToKeep(delivery: Position): Position {
        const distanceFromDelivery: number = this._ownPosition.manhattanDistance(delivery);
        const carryingParcelIds: Set<string> = new Set(this.carryingParcelIds);

        const positions: PositionWithDistance[] = Array.from(this.freeParcelsById.values())
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
            .sort(
                (d1: PositionWithDistance, d2: PositionWithDistance) => d1.distance - d2.distance,
            );

        let candidateParcel: PositionWithDistance = null;
        for (const position of positions) {
            if (
                this.map.calculatePath(
                    this.myPosition,
                    position.position,
                    this.getOccupiedPositions(),
                )
            ) {
                candidateParcel = position;
                break;
            }
        }

        const freeParcel: Parcel = candidateParcel?.context;
        if (!freeParcel) {
            return null;
        }

        //The cost associated to each deviation step
        const moveScoreCost: number = GameConfiguration.moveScoreCost;

        const toParcelPath: Position[] = this.map.calculatePath(
            this.myPosition,
            freeParcel.position,
            this.getOccupiedPositions(),
        );
        const parcelToDeliveryPath: Position[] = this.map.calculatePath(
            freeParcel.position,
            this.parcelsDistancesToCloserDelivery.get(freeParcel.id).position,
            this.getOccupiedPositions(),
        );
        const newParcelCost: number = toParcelPath.length + parcelToDeliveryPath.length;

        /*
         * The parcel is worth to be considered if:
         * currScore + newParcelScore - (moveCost * newDistance) >= currScore - (moveCost * distance)
         * newParcelScore >= -(moveCost * distance) + (moveCost * newDistance)
         * newParcelScore >= moveCost * (newDistance - distance)
         */
        const worthDetour: boolean =
            freeParcel.currentScore >= moveScoreCost * (newParcelCost - distanceFromDelivery);
        const chosenPosition: Position = worthDetour ? null : freeParcel.position;
        if (!chosenPosition) {
            this._notWorthParcels.add(freeParcel);
        }

        return chosenPosition;
    }

    findBestExplorationSite(): Position {
        const explorationCandidates: Position[] = this.visitedTiles
            .entryArray()
            .map(([position, visits]: [Position, number]) => {
                const distance: number = this._ownPosition.manhattanDistance(position);
                const agentsDensityMalus: number = this._agentsDensityOnTile.get(position);
                return {
                    position,
                    distance: 1 / (visits + 1) + distance + agentsDensityMalus,
                } as PositionWithDistance;
            })
            .sort((d1: PositionWithDistance, d2: PositionWithDistance) => d2.distance - d1.distance)
            .map((pos: PositionWithDistance) => pos.position);

        let explorationSite: Position = null;
        for (const candidate of explorationCandidates) {
            if (this.map.calculatePath(this.myPosition, candidate, this.getOccupiedPositions())) {
                explorationSite = candidate;
                break;
            }
        }

        return explorationSite;
    }

    synchronizeMyPosition(position: Position): void {
        this._ownPosition = position;
        this._internalEventsBroken.emit("own-position-changed", position);

        //We can update the map with the visited spawning tiles
        this.visitedTiles.update(position, (count: number) => (count ?? 0) + 1);
    }

    synchronizeKnownParcels(parcels: Parcel[]) {
        const reachableParcels: Parcel[] = parcels.filter((parcel: Parcel) =>
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
    }

    calculateMovingPath(to: Position, positionsToAvoid: Position[] = []): Position[] {
        return this.map.calculatePath(this._ownPosition, to, positionsToAvoid);
    }

    private updateClosestDistanceFromDelivery(parcelId: string, parcelPosition: Position) {
        const distanceFromClosestDelivery = this.map.distanceFromTheClosestDelivery(
            parcelPosition,
            this.getOccupiedPositions(),
        );

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
            if(parcel) {

                this._carriedParcels.push(parcel);
                this.freeParcelsById.delete(parcelId);

                this.parcelsByPosition.delete(this.myPosition);
                this.parcelsDistancesToCloserDelivery.delete(parcel.id);
            } else {
                const a = 1;
            }

        }
    }

    //////// AGENT

    synchronizeKnownAgents(agents: Agent[]) {
        // TODO: Improve this logic
        const agentVisibilityDistance: number = GameConfiguration.agentVisibilityDistance;

        // Do not take into account the visible agents that cannot interact with the player.
        const agentsSeen: Agent[] = agents.filter((agent) => {
            return this.map.isReachable(this.myPosition, agent.position);
        });

        const visibleOccupiedPositions: Map<Position, string> = new Map();
        for (const agent of agentsSeen) {
            visibleOccupiedPositions.set(agent.position, agent.agentId);
        }

        for (const [position, agent] of this.agentsByPosition.entries()) {
            if (visibleOccupiedPositions.has(position)) {
                // The position is currently still held by an agent
                this.agentsByPosition.set(position, agent);
                this.positionByAgent.set(agent, position);
                continue;
            }
            const distance = this.myPosition.manhattanDistance(position);
            if (distance <= agentVisibilityDistance) {
                // The viewer can see the position, and it is currently unoccupied by an agent.
                this.agentsByPosition.delete(position);
                this.positionByAgent.delete(agent);
            } else if (position.equals(this.myPosition)) {
                // The position is identical to the viewer's current location,
                // making it unoccupiable by an agent.
                this.agentsByPosition.delete(position);
                this.positionByAgent.delete(agent);
            } else if (distance > agentVisibilityDistance) {
                // The agent moved to a position that is not visible,
                // so we need to remove it from the previous position.
                this.agentsByPosition.delete(position);
                this.positionByAgent.delete(agent);
            } else {
                throw new Error("Something went wrong in synchronizeKnownAgents");
            }
        }

        for (const agent of agentsSeen) {
            if (!this.agentsByPosition.has(agent.position)) {
                this.agentsByPosition.set(agent.position, agent);
                this.positionByAgent.set(agent, agent.position);
            }

            //TODO: this map can be improved with a hashmap
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
