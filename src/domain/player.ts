import { BeliefContainer } from "@domain/beliefs";
import type { Actuator } from "@domain/communication";
import type { Sensor } from "@domain/communication/sensor";
import type { MatchMap, PositionWithDistance } from "@domain/map";
import type {
    CryptoConfiguration,
    EnvironmentConfiguration,
    Parcel,
    PddlConfiguration,
} from "@domain/models";
import type { Agent } from "@domain/models/agent";
import { type Directions, Position } from "@domain/models/environment";
import { Intention, IntentionTypes } from "@domain/models/intention";
import type { PlanMovingAction } from "@domain/models/plan";
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
     * The plan the agent is currently executing
     * @private
     */
    private _currentExecutingPlan: PlanMovingAction;

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

            if (this._currentExecutingPlan) {
                await this.goAheadWithChosenPlan();
            }

            const intention: Intention = this._calculateNextAction(
                this._currentExecutingPlan?.intention.type === IntentionTypes.EXPLORE,
            );
            if (!intention) {
                continue;
            }

            console.log(`Chosen intention: ${intention.toString()}`);

            if ([IntentionTypes.MOVE, IntentionTypes.EXPLORE].includes(intention.type)) {
                if (intention.type === IntentionTypes.EXPLORE) {
                    const a = 1;
                }
                this.calculateShortestPathFromMovingIntention(intention);
            } else if (intention.type === IntentionTypes.PICK_UP) {
                // PICKUP case
                const parcelsPickedUp: Set<string> = await this.actuator.pickup();

                console.log(`Parcels: ${parcelsPickedUp} have been picked up`);
                this._beliefs.carryingParcelIds = Array.from(parcelsPickedUp.values());
            } else if (intention.type === IntentionTypes.PUT_DOWN) {
                // PUT DOWN case
                const parcelsToDrop: string[] = this._beliefs.carryingParcelIds;
                const parcelsDropped: Set<string> = await this.actuator.putDown(parcelsToDrop);

                console.log(`Parcels ${parcelsDropped.toString()} have been dropped`);
                this._beliefs.updateDroppedParcels(parcelsDropped);
            }
        }
    }

    private calculateShortestPathFromMovingIntention(intention: Intention) {
        const path: Position[] = this._beliefs.calculateMovingPath(intention.position);
        const directions: Directions[] = [];

        // TODO: manage plan not found
        if (!path){
            //throw new Error("Path not found");
            return;
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

        this._currentExecutingPlan = {
            intention,
            data: directions,
            to: intention.position,
            from: this._beliefs.myPosition,
        } as PlanMovingAction;
    }

    private async goAheadWithChosenPlan() {
        const plan = this._currentExecutingPlan as PlanMovingAction;
        if ([IntentionTypes.MOVE, IntentionTypes.EXPLORE].includes(plan.intention.type)) {
            const nextDirection: Directions = (plan.data as Directions[]).shift();
            if (nextDirection) {
                const nextPosition = this._beliefs.myPosition.moveTo(nextDirection);
                console.log(`Moving from: ${this._beliefs.myPosition} to: ${nextPosition}`);
                await this.actuator.move(nextDirection);
            } else {
                //Moving plan has been completed
                this._currentExecutingPlan = null;
            }
        }
    }

    private _calculateNextAction(isExploring: boolean): Intention {
        //Checking if the agent is carrying something
        const isCarrying: boolean = this._beliefs.isCarrying;
        if (isCarrying) {
            //TODO: this part could be optimized
            const closestDelivery: Position = this._beliefs.findBestDelivery();
            if (closestDelivery?.equals(this._beliefs.myPosition)) {
                return Intention.putDown(closestDelivery);
            }

            //Let's check if we have good parcels nearby
            const newParcel: Position =
                this._beliefs.findAdditionalParcelWorthToKeep(closestDelivery);
            if (newParcel) {
                if (newParcel.equals(this._beliefs.myPosition)) {
                    return Intention.pickUp(newParcel);
                } else {
                    return Intention.move(newParcel);
                }
            } else {
                return Intention.move(closestDelivery);
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

        if (!isExploring) {
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
        // Fix row position
        let new_row: number;
        if (
            position.row > Math.floor(position.row) &&
            position.row < Math.floor(position.row) + 0.5
        ) {
            new_row = Math.floor(position.row);
        } else if (
            position.row > Math.floor(position.row) &&
            position.row > Math.floor(position.row) + 0.5
        ) {
            new_row = Math.ceil(position.row);
        } else {
            new_row = position.row;
        }

        // Fix column position
        let new_column: number;
        if (
            position.column > Math.floor(position.column) &&
            position.column < Math.floor(position.column) + 0.5
        ) {
            new_column = Math.floor(position.column);
        } else if (
            position.column > Math.floor(position.column) &&
            position.column > Math.floor(position.column) + 0.5
        ) {
            new_column = Math.ceil(position.column);
        } else {
            new_column = position.column;
        }

        const newPosition = new Position(new_row, new_column);

        this.playerInfo.position = newPosition;
        this._beliefs.synchronizeMyPosition(newPosition);
    }
}
