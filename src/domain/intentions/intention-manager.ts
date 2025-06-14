import type { BeliefContainer } from "@domain/beliefs";
import type { Actuator } from "@domain/communication";
import { type Desire, DesirePriorities, DesireTypes, type DesiresManager } from "@domain/desires";
import type { PositionWithDistance } from "@domain/map";
import { type Agent, GameConfiguration, type Parcel } from "@domain/models";
import type { Directions, Position } from "@domain/models/environment";
import type { HandoffCoordinator } from "@domain/models/handoff-coordinator";
import { Intention, IntentionTypes } from "@domain/models/intention";
import { PriorityQueue } from "@domain/models/priority-queue";
import type { StatisticsLogger } from "@domain/models/statistics-logger";
import { InternalEventManager } from "@utils/internal-event-manager";

/**
 * Manages the agent's intentions
 * Responsible for converting desires into intentions and executing them
 */
export class IntentionManager {
    /**
     * Queue of intentions ordered by priority
     * @private
     */
    private _intentionQueue: PriorityQueue<IntentionTypes, Intention> = new PriorityQueue(
        (a, b) => {
            const prioritySorting: number = b.priority - a.priority;
            if (prioritySorting !== 0) {
                return prioritySorting;
            }

            return a.element.type - b.element.type;
        },
    );

    /**
     * The current executing intention
     * @private
     */
    private _currentIntention: Intention | null = null;

    /**
     * Creates a new intention manager
     * @param beliefs The agent's beliefs
     * @param desiresManager The agent's desires manager
     * @param statsLogger The agent's statistics logger
     * @param actuator The agent's actuator for executing actions
     * @param handoffCoordinator The agent's handoff coordinator
     */
    constructor(
        private readonly actuator: Actuator,
        private readonly beliefs: BeliefContainer,
        private readonly statsLogger: StatisticsLogger,
        private readonly desiresManager: DesiresManager,
        private readonly handoffCoordinator: HandoffCoordinator,
    ) {
        // Listen for desire updates
        InternalEventManager.on("desires:updated", async () => {
            await this.generateIntentionsFromDesires();
        });

        // Listen for desire failures
        InternalEventManager.on("desire:failed", (desire: Desire) => {
            this.handleDesireFailure(desire);
        });
    }

    /**
     * Sets the current intention
     * @param intention the new intention
     */
    set currentIntention(intention: Intention) {
        this._currentIntention = intention;
    }

    /**
     * Gets the current intention
     */
    get currentIntention(): Intention | null {
        return this._currentIntention;
    }

    /**
     * Processes the agent's intentions
     * This includes generating new intentions if needed and executing the current intention
     */
    async processIntentions(): Promise<void> {
        await this.generateIntentionsFromDesiresIfEmpty();

        if (!this.currentIntention || this.shouldGiveUpExploration()) {
            this.currentIntention = this._intentionQueue.poll();
            this.syncIntentionWithCurrentState();
        }

        // Execute current intention if available
        if (this.currentIntention) {
            // Check if the intention is still valid
            if (!this.isIntentionValid(this.currentIntention)) {
                this._currentIntention = null;
                return;
            }

            //console.log(`Current intention: ${this.currentIntention.toString()}`);

            // Execute the intention
            const success: boolean = await this.executeIntention(this._currentIntention);

            if (!success) {
                // Record failure
                this._currentIntention.addFailure();

                // Check if we should give up on this intention
                if (this._currentIntention.shouldGiveUp()) {
                    //console.log(`Giving up on intention: ${this._currentIntention.toString()}`);

                    // Find the desire that generated this intention
                    const relatedDesire: Desire = this.findDesireForIntention(
                        this._currentIntention,
                    );
                    if (relatedDesire) {
                        this.desiresManager.markDesireAsFailed(relatedDesire);
                    }

                    this._currentIntention = null;
                }
            } else {
                // Reset failures on success
                this._currentIntention.resetFailures();

                // Check if the intention is complete
                if (this.isIntentionComplete(this._currentIntention)) {
                    this._currentIntention = null;
                }
            }
        } /*else {
            console.log("There are no intention possible. WAITING for best moments");
        }*/
    }

    async generateIntentionsFromDesiresIfEmpty(): Promise<void> {
        if (!this._intentionQueue.size) return;
        return this.generateIntentionsFromDesires();
    }

    /**
     * Generates intentions based on current desires
     */
    async generateIntentionsFromDesires(): Promise<void> {
        // Get all desires
        const desire: Desire = this.desiresManager.getTopDesire();
        if (!desire) {
            return;
        }

        // Convert desires to intentions
        switch (desire.type) {
            case DesireTypes.DELIVER_PARCEL:
                await this.generateDeliverIntention(desire);
                break;

            case DesireTypes.PICKUP_PARCEL:
                this.generatePickupIntention(desire);
                break;

            case DesireTypes.PUT_DOWN_PARCEL:
                this.generatePutDownIntention(desire);
                break;

            case DesireTypes.EXPLORE_ENVIRONMENT:
                this.generateExploreIntention(desire);
                break;

            case DesireTypes.PICKUP_HANDOFF:
                this.generatePickupHandoffIntention(desire);
                break;
        }

        // Emit event that intentions have been updated
        InternalEventManager.emit("intentions:updated", this._intentionQueue.toArray());
    }

    /**
     * Generates a DELIVER intention from a desire
     * @param desire The desire to convert
     * @private
     */
    private async generateDeliverIntention(desire: Desire): Promise<void> {
        // Regular delivery without handoff
        const priority: number = desire.priority;
        const deliveryIntention: Intention = Intention.deliver(desire.position);

        this.processMovingIntention(deliveryIntention, desire);
        this._intentionQueue.add(deliveryIntention, priority);
    }

    /**
     * Generates a PICKUP intention from a desire
     * @param desire The desire to convert
     * @private
     */
    private generatePickupIntention(desire: Desire): void {
        const parcelId: string = desire?.context?.parcelId;
        if (!parcelId) {
            throw new Error("PICKUP desires requires a parcel id to be picked up");
        }

        if (this.beliefs.carryingParcelIds.includes(parcelId)) {
            // The agent as already this parcel. No need to re-pick it up
            return;
        }

        //If it's not an urgent pick-up move to that position
        if (desire.priority !== DesirePriorities.PRIORITY_PICKUP) {
            const intention: Intention = Intention.move(desire.position);
            this.processMovingIntention(intention, desire);
            this.addIntentionToQueue(intention, desire.priority);
        } else {
            // Otherwise, create a PICK-UP intention
            const pickUp: Intention = Intention.pickUp(desire.position);
            pickUp.context = desire.context;

            this.addIntentionToQueue(pickUp, desire.priority);
        }
    }

    /**
     * Generates a PUT_DOWN intention from a desire
     * @param desire The desire to convert
     * @private
     */
    private generatePutDownIntention(desire: Desire): void {
        const intention: Intention = Intention.putDown(desire.position);
        intention.context = desire.context;

        this.addIntentionToQueue(intention, desire.priority);
    }

    // Handoff is now handled as part of the DELIVER_PARCEL intention generation

    /**
     * Generates an EXPLORE intention from a desire
     * @param desire The desire to convert
     * @private
     */
    private generateExploreIntention(desire: Desire): void {
        if (
            this.currentIntention?.isExplore ||
            this._intentionQueue.hasElementOfType(IntentionTypes.EXPLORE)
        )
            return;

        const pathToPosition: Position[] = this.beliefs.calculateMovingPath(
            desire.position,
            this.beliefs.getOccupiedPositions(),
        );

        if (!pathToPosition) {
            return;
        }

        const intention: Intention = Intention.explore(desire.position);
        this.processMovingIntention(intention, desire);

        this.addIntentionToQueue(intention, desire.priority);
    }

    /**
     * Generates an PICKUP_HANDOFF intention from a desire
     * @param desire The desire to convert
     */
    private generatePickupHandoffIntention(desire: Desire): void {
        const intention: Intention = Intention.moveHandOff(desire.position);

        this.processMovingIntention(intention, desire);
        this.addIntentionToQueue(intention, desire.priority);
    }

    /**
     * Checks if an intention is still valid
     * @param intention The intention to check
     * @returns True if the intention is valid, false otherwise
     */
    isIntentionValid(intention: Intention): boolean {
        switch (intention.type) {
            case IntentionTypes.PICK_UP:
                // Check if we're at the right position
                return (
                    this.beliefs.myPosition.equals(intention.position) &&
                    this.beliefs.isParcelOnPosition(intention.position)
                );

            case IntentionTypes.PUT_DOWN:
                // Check if we're at a delivery point and carrying parcels
                return (
                    this.beliefs.myPosition.equals(intention.position) && this.beliefs.isCarrying
                );

            case IntentionTypes.MOVE:
            case IntentionTypes.EXPLORE:
                // These intentions are always valid
                return !!this.beliefs.calculateMovingPath(
                    intention.position,
                    this.beliefs.getOccupiedPositions(),
                );

            case IntentionTypes.DELIVER:
                return this.beliefs.isCarrying;

            case IntentionTypes.PICKUP_HANDOFF:
            case IntentionTypes.PUT_DOWN_HANDOFF:
                return true;

            case IntentionTypes.WAIT:
                return intention.context?.stopWaitingCondition?.();
            default:
                return false;
        }
    }

    /**
     * Checks if an intention has been completed
     * @param intention The intention to check
     * @returns True if the intention is complete, false otherwise
     */
    private isIntentionComplete(intention: Intention): boolean {
        let isCompleted: boolean;

        switch (intention.type) {
            case IntentionTypes.MOVE:
            case IntentionTypes.DELIVER:
            case IntentionTypes.EXPLORE:
                // These intentions are complete when we reach the target position
                isCompleted =
                    this.beliefs.myPosition.equals(intention.position) ||
                    !intention.context?.path?.length;
                break;

            case IntentionTypes.PICK_UP:
            case IntentionTypes.PUT_DOWN:
                // These intentions are complete after a successful execution
                isCompleted = true;
                break;

            case IntentionTypes.PICKUP_HANDOFF:
            case IntentionTypes.PUT_DOWN_HANDOFF:
                isCompleted = true;
                break;
            default:
                isCompleted = false;
                break;
        }

        return isCompleted && !intention.promote();
    }

    /**
     * Executes an intention
     * @param intention The intention to execute
     * @returns Promise that resolves to true if the intention was executed successfully, false otherwise
     */
    async executeIntention(intention: Intention): Promise<boolean> {
        switch (intention.type) {
            case IntentionTypes.MOVE:
            case IntentionTypes.DELIVER:
            case IntentionTypes.EXPLORE:
                // Calculate the path to target
                return await this.moveTowards(intention);

            case IntentionTypes.PICK_UP:
                return await this.executePickup();

            case IntentionTypes.PUT_DOWN:
                return await this.executePutDown();

            case IntentionTypes.PICKUP_HANDOFF: {
                await this.handoffCoordinator.createHandoffRequest(
                    this.beliefs.myId,
                    intention.context.friendId,
                    this.beliefs.carryingParcelIds,
                    intention.position,
                    //TODO: Need to check this
                    Math.min(10, Math.ceil(intention.context.benefit / 10)), // Urgency based on priority
                );

                return Promise.resolve(true);
            }

            case IntentionTypes.WAIT:
                return true;

            default:
                return Promise.resolve(false);
        }
    }

    private async executePutDown() {
        // Execute put-down action
        const carriedParcels: Parcel[] = this.beliefs.carriedParcels;
        const parcelsToDrop: string[] = this.beliefs.carryingParcelIds;
        const parcelsDropped: Set<string> = await this.actuator.putDown(parcelsToDrop);

        // Calculate points earned from the actual parcel scores
        let totalPointsEarned = 0;
        const droppedParcelIds: string[] = Array.from(parcelsDropped);

        // Find the parcels that were dropped and sum their scores
        for (const parcel of carriedParcels) {
            if (droppedParcelIds.includes(parcel.id)) {
                // Use the current value of the decaying score
                totalPointsEarned += parcel.score.currentValue;
            }
        }

        // Record the delivery in our statistics logger with actual points
        this.statsLogger.recordDelivery(droppedParcelIds, totalPointsEarned);

        // Update beliefs
        this.beliefs.updateDroppedParcels(parcelsDropped);

        // Unregister from the current delivery point to reduce congestion tracking
        this.beliefs.unregisterFromDeliveryPoint(this.beliefs.myPosition);

        return Promise.resolve(true);
    }

    /**
     * Moves the agent towards a target position
     * @param intention The intention with calculated path
     * @returns Promise that resolves to true if the move was successful, false otherwise
     */
    private async moveTowards(intention: Intention): Promise<boolean> {
        let nextPosition: Position = intention.context?.path?.[0];
        if (!nextPosition || this.beliefs.myPosition.equals(intention.position)) {
            return true;
        }

        if (
            this.beliefs.freeParcels.filter((parcel) =>
                parcel.position.equals(this.beliefs.myPosition),
            ).length
        ) {
            await this.executePickup();
        }

        if(this.beliefs.isCarrying && this.beliefs.imOnADeliveryTile()) {
            await this.executePutDown();
        }

        if (this.beliefs.isPositionOccupied(nextPosition)) {
            const path: Position[] = this.beliefs
                .calculateMovingPath(intention.position, this.beliefs.getOccupiedPositions())
                //We remove the current position from the remaining path
                ?.slice(1);
            if (!path) {
                //Intention has failed
                return false;
            }

            nextPosition = path[0];
            intention.context = {
                ...intention.context,
                path,
            };
        }

        const nextDirection: Directions = this.beliefs.myPosition.getDirection(nextPosition);
        const successfulMove: boolean = await this.actuator.move(nextDirection);

        if (successfulMove) {
            intention.context?.path?.shift();
            this.beliefs.synchronizeMyPosition(nextPosition);
        }

        return successfulMove;
    }

    /**
     * Finds the desire that generated an intention
     * @param intention The intention to find the desire for
     * @returns The desire that generated the intention, or null if not found
     */
    private findDesireForIntention(intention: Intention): Desire | null {
        const desires: Desire[] = this.desiresManager.getAllDesires();

        // Find a desire with matching position and context
        return desires.find(
            (desire: Desire) =>
                desire.position?.equals(intention.position) &&
                JSON.stringify(desire.context) === JSON.stringify(intention.context),
        );
    }

    /**
     * Handles a desire failure
     * @param desire The desire that failed
     */
    private handleDesireFailure(desire: Desire): void {
        // Remove any intentions related to this desire
        const intentions: Intention[] = this._intentionQueue.toArray();

        for (const intention of intentions) {
            if (
                desire.position?.equals(intention.position) &&
                JSON.stringify(desire.context) === JSON.stringify(intention.context)
            ) {
                /*
                if (intention.type == IntentionTypes.PICKUP_HANDOFF || intention.type == IntentionTypes.PUT_DOWN_HANDOFF) {
                    if (this.handoffCoordinator.hasActiveHandoff()) {
                        this.handoffCoordinator.createHandofUpdate(
                            this.beliefs.myId,
                            intention.context.handoffRequestId,
                            intention.context.partnerId,
                            HandoffUpdateType.CANCELED,
                        );

                        console.log(`handleDesireFailure drop handoff`);
                        this.handoffCoordinator.completeHandoff(intention.context.handoffRequestId, false);
                    }
                }*/
                this._intentionQueue.remove(intention);
            }
        }

        // If the current intention is related to this desire, reset it
        if (
            this._currentIntention &&
            desire.position?.equals(this._currentIntention.position) &&
            JSON.stringify(desire.context) === JSON.stringify(this._currentIntention.context)
        ) {
            this._currentIntention = null;
        }
    }

    private processMovingIntention(intention: Intention, desire: Desire): boolean {
        const pathToPosition: Position[] = this.beliefs.calculateMovingPath(
            desire.position,
            this.beliefs.getOccupiedPositions(),
        );
        if (!pathToPosition) {
            return false;
        }

        intention.context = {
            ...desire.context,
            from: this.beliefs.myPosition,
            to: desire.position,
            //Removing the first position because it's the current one
            path: pathToPosition.slice(1),
        };

        return true;
    }

    private syncIntentionWithCurrentState(): void {
        if (!Intention.MOVING_INTENTIONS.includes(this.currentIntention?.type)) return;

        let pathToPosition: Position[] = this.beliefs.calculateMovingPath(
            this.currentIntention.position,
            this.beliefs.getOccupiedPositions(),
        );

        if (this.currentIntention?.isDeliver) {
            //Evaluating a possible handoff
            const potentialHandoffPartner = this.evaluatePotentialHandoffPartners();
            if (potentialHandoffPartner) {
                // Create a PutDownHandoff desire with handoff context
                const { agentId, meetingPosition, pathToMeeting, benefit } =
                    potentialHandoffPartner;

                this.currentIntention = Intention.deliverHandoff(meetingPosition, agentId, benefit);
                pathToPosition = pathToMeeting;
            } else if (!GameConfiguration.usePddl) {
                //We run this only in case PDDL is not activated. This is needed to keep the PDDL clean of external code modifications
                const bestDeliveryPoint: PositionWithDistance = this.beliefs.findBestDelivery();
                if (!bestDeliveryPoint?.position.equals(this.currentIntention.position)) {
                    pathToPosition = this.beliefs.calculateMovingPath(
                        bestDeliveryPoint.position,
                        this.beliefs.getOccupiedPositions(),
                    );
                }

                this.currentIntention.updatePosition(bestDeliveryPoint.position, [
                    IntentionTypes.PUT_DOWN,
                ]);
            }
        }

        if (!pathToPosition) {
            return;
        }

        this.currentIntention.context = {
            ...this.currentIntention.context,
            from: this.beliefs.myPosition,
            to: this.currentIntention.position,
            //Removing the first position because it's the current one
            path: pathToPosition.slice(1),
        };
    }

    private shouldGiveUpExploration(): boolean {
        // Check if there are higher priority intentions in the queue
        if (!this._intentionQueue.isEmpty() && this.currentIntention?.isExplore) {
            const nextIntention: Intention = this._intentionQueue.peek();
            return !nextIntention?.isExplore;
        }

        return false;
    }

    private addIntentionToQueue(intention: Intention, priority: number): void {
        if (this.currentIntention?.equals(intention)) {
            return;
        }

        this._intentionQueue.add(intention, priority);
    }

    private async executePickup(): Promise<boolean> {
        const pickupResult: Set<string> = await this.actuator.pickup();

        if (!pickupResult.size) {
            return Promise.resolve(false);
        }

        // Update our beliefs
        this.beliefs.updateCarriedParcelsAfterPickup(pickupResult);
        return Promise.resolve(true);
    }

    /**
     * Evaluates potential handoff partners and returns the best one if beneficial
     * @returns The best handoff partner information or null if no beneficial handoff
     * @private
     */
    private evaluatePotentialHandoffPartners(): {
        agentId: string;
        meetingPosition: Position;
        benefit: number;
        pathToMeeting: Position[];
    } | null {
        // Find potential handoff partners
        const agents: Agent[] = this.beliefs.trustedAgents;
        let bestPartner = null;
        let maxBenefit = 0;

        // Evaluate each agent as a potential handoff partner
        for (const agent of agents) {
            // Skip if agent is not trusted
            if (!this.beliefs.isTrustedAgent(agent.agentId)) {
                continue;
            }

            // Calculate the benefit of a handoff
            const handoffBenefit: number = this.beliefs.evaluateHandoffBenefit(agent.agentId);

            // Only consider handoff if beneficial and better than current best
            if (handoffBenefit > 0 && handoffBenefit > maxBenefit) {
                // Calculate meeting position (midpoint between agents)
                const handoffPaths: Position[][] = this.beliefs.calculateMeetingPointPaths(
                    agent.position,
                );

                if (handoffPaths?.length >= 2 && handoffPaths[0].length > 0) {
                    const meetingPosition: Position = handoffPaths[0][handoffPaths[0].length - 1];

                    bestPartner = {
                        agentId: agent.agentId,
                        meetingPosition: meetingPosition,
                        benefit: handoffBenefit,
                        pathToMeeting: handoffPaths[0],
                    };

                    maxBenefit = handoffBenefit;
                }
            }
        }

        return bestPartner;
    }
}
