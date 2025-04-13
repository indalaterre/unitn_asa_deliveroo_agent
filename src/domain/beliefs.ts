import type { MatchMap, PositionWithDistance } from "@domain/map";
import { Parcel, Agent } from "@domain/models";
import { GameConfiguration } from "@domain/models/configurations";
import type { Position } from "@domain/models/environment";
import type { PlayerInfo } from "@domain/player-info";
import { HashMap } from "@utils/hashmap";
import { HashSet } from "@utils/hashset";
import EventEmitter from "eventemitter3";

export class BeliefContainer {
    /**
     * The position of the agent owning these beliefs
     * @private
     */
    private _ownPosition: Position;

    /**
     * @private The ID of the carried parcels (if any)
     */
    private _carriedParcelId: string[] = [];

    /**
     * @private Parcels that must be ignored during evaluation of additional picks up
     */
    private _notWorthParcels: HashSet<Parcel> = new HashSet();

    /**
     * A map containing how much time a tile have been visited
     */
    private visitedTiles: HashMap<Position, number> = new HashMap();

    /**
     * An internal event emitter
     * @private
     */
    private readonly _internalEventsBroken: EventEmitter = new EventEmitter();

    /**
     * Map that associates a position to a set of parcels
     */
    private readonly parcelsByPosition: HashMap<Position, HashSet<Parcel>> = new HashMap();

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

    private readonly agentsByPosition: Map<Position, Agent> = new Map();

    private readonly positionByAgent: Map<string, Position> = new Map();

    constructor(
        info: PlayerInfo,
        public readonly map: MatchMap,
    ) {
        this._ownPosition = info.position;
        for (const position of this.map.spawnTilePositions) {
            this.visitedTiles.set(position, 0);
        }
    }

    /**
     * @returns TRUE if the agent is carrying at least one parcel
     */
    get isCarrying(): boolean {
        return !!this._carriedParcelId.length;
    }

    /**
     * @returns the id of the parcel being carried
     */
    get carryingParcelId(): string {
        return this._carriedParcelId?.[0];
    }

    /**
     * @returns the id of the parcel being carried
     */
    get carryingParcelIds(): string[] {
        return this._carriedParcelId;
    }

    set carryingParcelIds(value: string[]) {
        this._carriedParcelId = value;
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
            .map((parcel: Parcel) => {
                //We check if the parcel can be delivered to a delivery point
                if (
                    !this.parcelsDistancesToCloserDelivery.has(parcel.id) ||
                    !this.parcelsByPosition.has(parcel.position) ||
                    this.getOccupiedPositions().indexOf(parcel.position.hashCode()) >= 0
                ) {
                    //This values we have the lowest priority and will be discarded
                    return null;
                }

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
        this._carriedParcelId = this._carriedParcelId.filter(
            (parcelId: string) => !parcelIds.has(parcelId),
        );

        this._notWorthParcels.clear();
    }

    findBestDelivery(): Position {
        return this.map.distanceFromTheClosestDelivery(this._ownPosition).position;
    }

    findAdditionalParcelWorthToKeep(delivery: Position): Position {
        //TODO: We need the logic to handle the movement time and the decay (when different than 1s)
        const distanceFromDelivery: number = this._ownPosition.manhattanDistance(delivery);
        const freeParcel: Parcel = Array.from(this.freeParcelsById.values())
            .filter((parcel: Parcel) => !this._notWorthParcels.has(parcel) && this.getOccupiedPositions().indexOf(parcel.position.hashCode()) <= 0)
            .map((parcel: Parcel) => {
                return {
                    context: parcel,
                    position: parcel.position,
                    distance: parcel.position.manhattanDistance(this._ownPosition),
                } as PositionWithDistance;
            })
            .sort((d1: PositionWithDistance, d2: PositionWithDistance) => d1.distance - d2.distance)
            .map((d: PositionWithDistance) => d.context as Parcel)
            .shift();

        if (!freeParcel) {
            return null;
        }

        //TODO: Need to improve this logic. Must only consider the cost of the deviation
        const candidateScore: number = freeParcel.currentScore;
        const parcelCost: number =
            freeParcel.position.manhattanDistance(this._ownPosition) +
            freeParcel.position.manhattanDistance(delivery);

        const costOfDeviation: number = Math.abs(parcelCost - distanceFromDelivery);

        const worthScore: number = candidateScore - costOfDeviation;
        //The parcel is worth to be considered. We need to check if there is a closer deliver
        const chosenPosition: Position =
            worthScore <= distanceFromDelivery ? null : freeParcel.position;
        if (!chosenPosition) {
            this._notWorthParcels.add(freeParcel);
        }

        return chosenPosition;
    }

    findBestExplorationSite(): Position {
        return this.visitedTiles
            .entryArray()
            .map(([position, visits]: [Position, number]) => {
                const distance: number = this._ownPosition.manhattanDistance(position);
                return {
                    position,
                    distance: 1 / (visits + 1) + distance,
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

                    this.parcelsByPosition
                        .computeIfAbsent(parcel.position, () => new HashSet<Parcel>())
                        .add(parcel);

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

    calculateMovingPath(to: Position): Position[] {
        const occupied_tiles = this.getOccupiedPositions();
        return this.map.calculatePath(this._ownPosition, to, occupied_tiles);
    }

    private updateClosestDistanceFromDelivery(parcelId: string, parcelPosition: Position) {
        const distanceFromClosestDelivery = this.map.distanceFromTheClosestDelivery(parcelPosition);
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
        this.parcelsByPosition
            .computeIfAbsent(newPosition, () => new HashSet<Parcel>())
            .add(updatedParcel);

        return true;
    }


    //////// AGENT

    synchronizeKnownAgents(agents: Agent[]) {

        // TODO: Improve this logic

        const agentVisibilityDistance = GameConfiguration.agentVisibilityDistance;

        // Do not consider the visible agents who can never interact with the player.
        const visibleAgents = agents.filter((agent) => {
            return this.map.isReachable(this.myPosition, agent.position);
        });

        const visibleOccupiedPositions: Map<Position, string> = new Map();
        for (const agent of visibleAgents){
            visibleOccupiedPositions.set(agent.position, agent.agentId);
        }

        for (const [position, agent] of this.agentsByPosition.entries()) {
            if (visibleOccupiedPositions.has(position)) {
                // The position is still occupied by an agent
                this.agentsByPosition.set(position, agent);
                this.positionByAgent.set(agent.agentId, position);
                continue;
            }
            const distance = this.myPosition.manhattanDistance(position);
            if (distance <= agentVisibilityDistance) {
                // The viewer can see the position and it is not occupied by an agent
                this.agentsByPosition.delete(position);
                this.positionByAgent.delete(agent.agentId);
            } else if (position.equals(this.myPosition)) {
                // The position is the same as the current position of the viewer,
                // so it cannot be occupied by an agent.
                this.agentsByPosition.delete(position);
                this.positionByAgent.delete(agent.agentId);
            } else if (
                distance > agentVisibilityDistance
            ) {
                // The agent just moved to a position that the viewer cannot see so we need to remove the
                // agent from the previous position
                this.agentsByPosition.delete(position);
                this.positionByAgent.delete(agent.agentId);
            } else {
                throw new Error("Something went wrong in synchronizeKnownAgents");
            }
        }

        for (const agent of visibleAgents) {
            if (!this.agentsByPosition.has(agent.position)) {
                this.agentsByPosition.set(agent.position, agent);
                this.positionByAgent.set(agent.agentId, agent.position);
            }
        }
    }

    /**
     * Returns a list of hashcode of the positions that are currently occupied by agents.
     */
    getOccupiedPositions(): string[] {
        const positions = [];

        for (const [position, agent] of this.agentsByPosition.entries()) {
            positions.push(position.hashCode());
            //console.log(`Agent ${agent.agentId} at position ${position}`);
        }

        return positions;
    }

    /**
     * Returns the agents occupying the positions in the environment.
     */
    getAgents(): Agent[] {
        return Array.from(this.agentsByPosition.values());
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
}
