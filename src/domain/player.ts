import { BeliefContainer } from "@domain/beliefs";
import type { Actuator } from "@domain/communication";
import type { Sensor } from "@domain/communication/sensor";
import type { MatchMap, PositionWithDistance } from "@domain/map";
import {
    type CryptoConfiguration,
    type EnvironmentConfiguration,
    GameConfiguration,
    type Parcel,
    type PddlConfiguration,
} from "@domain/models";
import type { Agent } from "@domain/models/agent";
import { type Directions, Position } from "@domain/models/environment";
import { Intention, IntentionTypes } from "@domain/models/intention";
import { PddlSolver } from "@domain/pddl";
import type { PlayerInfo } from "@domain/player-info";
import { Cipher } from "@utils/cipher";

export class Player {
    /**
     * TRUE if the player is alive and able to play
     */
    private _isAlive = false;

    /**
     * Cryptographer used to protected messaged exchanged between friends from spies
     */
    private _cipher: Cipher;

    /**
     * @private The PDDL engine
     */
    private _pddlSolver: PddlSolver;

    /**
     * Contains all the beliefs of the agent
     */
    private readonly _beliefs: BeliefContainer;

    /**
     * The current executing intention
     * @private
     */
    private _currentIntention: Intention;

    public constructor(
        matchMap: MatchMap,
        initialParcels: Parcel[],
        sensor: Sensor,
        private actuator: Actuator,
        private readonly playerInfo: PlayerInfo,
        cryptoConfiguration: CryptoConfiguration,
        private readonly environmentConfiguration: EnvironmentConfiguration,
        private readonly pddlConfiguration: PddlConfiguration,
    ) {
        this._cipher = new Cipher(cryptoConfiguration);
        this._beliefs = new BeliefContainer(playerInfo, matchMap);

        this._pddlSolver = new PddlSolver(pddlConfiguration, this._beliefs);

        this.updateKnownParcels(initialParcels);
        sensor.onAgentSensing((agents: Agent[]) => this.updateKnownAgents(agents));
        sensor.onParcelDetected((parcels: Parcel[]) => this.updateKnownParcels(parcels));
        sensor.onPlayerPositionUpdate((position: Position) => this.updatePlayerPosition(position));
    }

    async start(): Promise<void> {
        this._isAlive = true;
        await this._run();
    }

    stop(): void {
        this._isAlive = false;
    }

    /**
     * This method implements the agent loop
     */
    private async _run(): Promise<void> {
        while (this._isAlive) {
            await new Promise((resolve) => setImmediate(resolve));
            await this.goAheadWithChosenPlan();

            const intention: Intention = this._calculateNextAction(this._currentIntention);
            if (!intention) {
                continue;
            }

            console.log(`Chosen intention: ${intention.toString()}`);

            if (Intention.MOVING_INTENTIONS.includes(intention.type)) {
                this.calculateShortestPathFromMovingIntention(intention);
            } else if (intention.type === IntentionTypes.PICK_UP) {
                // PICKUP case
                await this.executePickUpIntention();
            } else if (intention.type === IntentionTypes.PUT_DOWN) {
                // PUT DOWN case
                await this.executePutDownIntention();
            }
        }
    }

    private async executePickUpIntention() {
        const parcelsPickedUp: Set<string> = await this.actuator.pickup();

        console.log(`Parcels: ${parcelsPickedUp} have been picked up`);
        this._beliefs.updateCarriedParcelsAfterPickup(parcelsPickedUp);
    }

    private async executePutDownIntention() {
        const parcelsToDrop: string[] = this._beliefs.carryingParcelIds;
        const parcelsDropped: Set<string> = await this.actuator.putDown(parcelsToDrop);

        console.log(`Parcels ${parcelsDropped.toString()} have been dropped`);
        this._beliefs.updateDroppedParcels(parcelsDropped);
    }

    private calculateShortestPathFromMovingIntention(
        intention: Intention,
        positionsToAvoid: Position[] = [],
    ) {
        const path: Position[] = this._beliefs.calculateMovingPath(
            intention.position,
            positionsToAvoid,
        );
        const directions: Directions[] = [];

        // TODO: manage plan not found
        if (!path) {
            throw new Error("Path not found");
        }

        for (let i = 0; i < path.length - 1; i++) {
            const direction: Directions = path[i].getDirection(path[i + 1]);
            if (direction) {
                directions.push(direction);
            } else {
                throw new Error(`Invalid step from ${path[i]} to ${path[i + 1]}`);
            }
        }

        console.log(`Calculate directions to: ${intention.position}:`);
        console.log(directions.join(","));

        intention.context = {
            directions,
            to: intention.position,
            from: this._beliefs.myPosition,
        };

        this._currentIntention = intention;
    }

    private async goAheadWithChosenPlan() {
        if (Intention.MOVING_INTENTIONS.includes(this._currentIntention?.type)) {
            if (this._currentIntention.context.directions?.length) {
                const nextDirection: Directions = this._currentIntention.context.directions.shift();
                const nextPosition: Position = this._beliefs.myPosition.moveTo(nextDirection);

                // TODO: This logic can be improved
                if (this._beliefs.isPositionOccupied(nextPosition)) {
                    this.calculateShortestPathFromMovingIntention(this._currentIntention, [
                        nextPosition,
                    ]);
                }

                if (this._beliefs.isAgentOnDeliveryTile() && this._beliefs.isCarrying) {
                    await this.executePutDownIntention();
                }

                if (this._beliefs.isAgentOnFreeParcel()) {
                    await this.executePickUpIntention();
                }

                console.log(`Moving from: ${this._beliefs.myPosition} to: ${nextPosition}`);
                await this.actuator.move(nextDirection);
            } else {
                //Moving plan has been completed
                this._currentIntention = null;
            }
        }
    }

    private _calculateNextAction(currentIntention: Intention): Intention {
        const isCarrying: boolean = this._beliefs.isCarrying;
        if (isCarrying) {
            //TODO: this part could be optimized
            const closestDelivery: Position =
                currentIntention?.type === IntentionTypes.DELIVER
                    ? currentIntention.position
                    : this._beliefs.findBestDelivery();

            if (closestDelivery.equals(this._beliefs.myPosition)) {
                return Intention.putDown(closestDelivery);
            }

            //Let's check if we have good parcels nearby
            if (this._beliefs.carryingParcelIds?.length < GameConfiguration.maxCarryingParcels) {
                const newParcel: Position =
                    this._beliefs.findAdditionalParcelWorthToKeep(closestDelivery);
                if (newParcel) {
                    if (newParcel.equals(this._beliefs.myPosition)) {
                        return Intention.pickUp(newParcel);
                    } else {
                        return Intention.move(newParcel);
                    }
                } else {
                    return !!closestDelivery ? Intention.deliver(closestDelivery) : null;
                }
            }
        }

        /*
            We need to calculate the best parcel to be taken.
            The idea is to choose the one with the best agent-parcel-delivery distance
        */
        const bestParcelPosition: PositionWithDistance = this._beliefs.bestParcelToDeliver;
        if (bestParcelPosition) {
            if (this._beliefs.myPosition?.equals(bestParcelPosition?.position)) {
                //We can pickup the parcel
                return Intention.pickUp(bestParcelPosition.position);
            }

            return Intention.move(bestParcelPosition.position);
        }

        if (currentIntention?.type !== IntentionTypes.EXPLORE) {
            //Evaluate the best position to explore
            const explorationSite: Position = this._beliefs.findBestExplorationSite();
            return Intention.explore(explorationSite);
        }

        return null;
    }

    updateKnownParcels(parcels: Parcel[]): void {
        this._beliefs.synchronizeKnownParcels(parcels);
    }

    updateKnownAgents(agents: Agent[]): void {
        this._beliefs.synchronizeKnownAgents(agents);
    }

    updatePlayerPosition(position: Position) {
        this.playerInfo.position = new Position(position.row, position.column);
        this._beliefs.synchronizeMyPosition(this.playerInfo.position);
    }
}
