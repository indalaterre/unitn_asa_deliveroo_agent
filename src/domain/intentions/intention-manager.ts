import { type Desire, DesireTypes, type DesiresManager } from "@domain/desires";
import { type Agent, GameConfiguration, type Parcel } from "@domain/models";
import type { StatisticsLogger } from "@domain/models/statistics-logger";
import { EventEmitter } from "eventemitter3";
import type { BeliefContainer } from "../beliefs";
import type { Actuator } from "../communication";
import type { Directions, Position } from "../models/environment";
import {
    type HandoffCoordinator,
    type HandoffRequest,
    HandoffStatus,
} from "../models/handoff-coordinator";
import { Intention, IntentionTypes } from "../models/intention";
import { IntentionQueue } from "../models/intention-queue";

/**
 * Manages the agent's intentions
 * Responsible for converting desires into intentions and executing them
 */
export class IntentionManager {
    private readonly MAX_CONSECUTIVE_FAILURES: number = 4;

    /**
     * Queue of intentions ordered by priority
     * @private
     */
    private _intentionQueue: IntentionQueue = new IntentionQueue();

    /**
     * The current executing intention
     * @private
     */
    private _currentIntention: Intention | null = null;

    /**
     * Event emitter for notifying changes to intentions
     * @private
     */
    private readonly _eventEmitter: EventEmitter = new EventEmitter();

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
        this.desiresManager.on("desires:updated", () => {
            this.generateIntentionsFromDesires();
        });

        // Listen for desire failures
        this.desiresManager.on("desire:failed", (desire: Desire) => {
            this.handleDesireFailure(desire);
        });
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
        if (!this._currentIntention || this.shouldGiveUpExploration()) {
            this._currentIntention = this._intentionQueue.poll();
        }

        // Execute current intention if available
        if (this._currentIntention) {
            // Check if the intention is still valid
            if (!this.isIntentionValid(this._currentIntention)) {
                this._currentIntention = null;
                return;
            }

            console.log(`Current intention: ${this._currentIntention.toString()}`);

            // Execute the intention
            const success = await this.executeIntention(this._currentIntention);

            if (!success) {
                // Record failure
                this._currentIntention.addFailure();

                // Check if we should give up on this intention
                if (this._currentIntention.shouldGiveUp()) {
                    console.log(`Giving up on intention: ${this._currentIntention.toString()}`);

                    // Find the desire that generated this intention
                    const relatedDesire = this.findDesireForIntention(this._currentIntention);
                    if (relatedDesire) {
                        this.desiresManager.markDesireAsFailed(relatedDesire);
                    }

                    this._currentIntention = null;
                }
            } else {
                // Reset failures on success
                this._currentIntention.resetFailures();

                // Check if intention is complete
                if (this.isIntentionComplete(this._currentIntention)) {
                    this._currentIntention = null;
                }
            }
        }
    }

    /**
     * Generates intentions based on current desires
     */
    generateIntentionsFromDesires(): void {
        // Clear existing intentions
        this._intentionQueue.clear();

        // Get all desires
        const desires: Desire[] = this.desiresManager.getAllRankedDesires();

        // Convert desires to intentions
        for (const desire of desires) {
            switch (desire.type) {
                case DesireTypes.DELIVER_PARCEL:
                    this.generateDeliverIntention(desire);
                    break;

                case DesireTypes.PICKUP_PARCEL:
                    this.generatePickupIntention(desire);
                    break;

                case DesireTypes.PUT_DOWN_PARCEL:
                    this.generatePutDownIntention(desire);
                    break;

                case DesireTypes.HANDOFF_PARCEL:
                    this.generateHandoffIntention(desire);
                    break;

                case DesireTypes.EXPLORE_ENVIRONMENT:
                    this.generateExploreIntention(desire);
                    break;
            }
        }

        // Emit event that intentions have been updated
        this._eventEmitter.emit("intentions:updated", this._intentionQueue.toArray());
    }

    /**
     * Generates a DELIVER intention from a desire
     * @param desire The desire to convert
     * @private
     */
    private generateDeliverIntention(desire: Desire): void {
        const intention: Intention = Intention.deliver(desire.position);
        this.processMovingIntention(intention, desire);

        this._intentionQueue.add(intention, desire.priority);
    }

    /**
     * Generates a PICKUP intention from a desire
     * @param desire The desire to convert
     * @private
     */
    private generatePickupIntention(desire: Desire): void {
        // If already at the position, create a PICK_UP intention
        if (desire.position.equals(this.beliefs.myPosition)) {
            const intention = Intention.pickUp(desire.position);
            intention.context = desire.context;

            this._intentionQueue.add(intention, desire.priority);
        } else {
            // Otherwise, create a MOVE intention
            const intention: Intention = Intention.move(desire.position);
            this.processMovingIntention(intention, desire);

            this._intentionQueue.add(intention, desire.priority);
        }
    }

    /**
     * Generates a PUT_DOWN intention from a desire
     * @param desire The desire to convert
     * @private
     */
    private generatePutDownIntention(desire: Desire): void {
        const intention = Intention.putDown(desire.position);
        intention.context = desire.context;

        this._intentionQueue.add(intention, desire.priority);
    }

    /**
     * Generates a HANDOFF intention from a desire
     * @param desire The desire to convert
     * @private
     */
    private generateHandoffIntention(desire: Desire): void {
        // Create a handoff request if not already active
        if (!this.handoffCoordinator.hasActiveHandoff()) {
            const { friendId, parcelIds } = desire.context;

            const friendAgent: Agent = this.beliefs.getAgent(friendId);
            if (!friendAgent?.position) {
                return; // Can't calculate without partner position
            }

            // Calculate meeting position (midpoint between agents)
            const handoffPaths: Position[][] = this.beliefs.calculateMeetingPointPaths(
                friendAgent.position,
            );

            const secondsToMeeting: number =
                (handoffPaths[0].length + handoffPaths[1].length) *
                GameConfiguration.movementDuration.seconds;
            const handoffBufferInSeconds: number = 2;

            const meetingTime: number =
                Date.now() + (secondsToMeeting + handoffBufferInSeconds) * 1000;

            this.handoffCoordinator.createHandoffRequest(
                this.beliefs.myId,
                friendId,
                parcelIds,
                desire.position,
                handoffPaths[0],
                Math.min(10, Math.ceil(desire.priority / 10)), // Urgency based on priority
                meetingTime,
            );
        }

        // Create a MOVE intention to the meeting position
        const intention: Intention = Intention.move(desire.position);
        this.processMovingIntention(intention, desire);

        intention.context = {
            ...intention.context,
            isHandoff: true,
        };

        this._intentionQueue.add(intention, desire.priority);
    }

    /**
     * Generates an EXPLORE intention from a desire
     * @param desire The desire to convert
     * @private
     */
    private generateExploreIntention(desire: Desire): void {
        const intention: Intention = Intention.explore(desire.position);
        this.processMovingIntention(intention, desire);

        this._intentionQueue.add(intention, desire.priority);
    }

    /**
     * Handles a handoff request from another agent
     * @param request The handoff request to handle
     */
    handleHandoffRequest(request: HandoffRequest): void {
        // Only handle accepted requests
        if (request.status !== HandoffStatus.ACCEPTED) {
            return;
        }

        // Create a move intention to the meeting position
        const intention = Intention.move(request.meetingPosition);
        intention.context = {
            handoffRequestId: request.requestId,
            isHandoff: true,
        };

        // Add with high priority
        this._intentionQueue.add(
            intention,
            IntentionQueue.getDefaultPriority(IntentionTypes.MOVE) + 20, // Very high priority
        );

        // Emit event
        this._eventEmitter.emit("intention:handoff_added", request.requestId);
    }

    /**
     * Resets the current intention
     * This is typically called after a handoff or when an intention fails
     */
    resetCurrentIntention(): void {
        this._currentIntention = null;
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
                return this.beliefs.myPosition.equals(intention.position);

            case IntentionTypes.PUT_DOWN:
                // Check if we're at a delivery point and carrying parcels
                return (
                    this.beliefs.myPosition.equals(intention.position) && this.beliefs.isCarrying
                );

            case IntentionTypes.MOVE:
            case IntentionTypes.DELIVER:
            case IntentionTypes.EXPLORE:
                // These intentions are always valid
                return true;

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
        switch (intention.type) {
            case IntentionTypes.MOVE:
            case IntentionTypes.DELIVER:
            case IntentionTypes.EXPLORE:
                // These intentions are complete when we reach the target position
                return this.beliefs.myPosition.equals(intention.position);

            case IntentionTypes.PICK_UP:
            case IntentionTypes.PUT_DOWN:
                // These intentions are complete after a successful execution
                return true;

            default:
                return false;
        }
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
                // Check if this is a handoff-related move
                if (intention.hasContext() && intention.context.isHandoff) {
                    // If at the meeting position, wait for handoff
                    if (this.beliefs.myPosition.equals(intention.position)) {
                        return true; // Success - we're at the position
                    }
                }

                // Calculate path to target
                return await this.moveTowards(intention);

            case IntentionTypes.PICK_UP:
                // Execute pickup action
                const pickupResult: Set<string> = await this.actuator.pickup();

                if (pickupResult.size === 0) {
                    console.log("Failed to pick up parcels during handoff");
                    return Promise.resolve(false);
                }

                // Update our beliefs
                this.beliefs.updateCarriedParcelsAfterPickup(pickupResult);
                return Promise.resolve(true);

            case IntentionTypes.PUT_DOWN:
                // Execute put down action
                const carriedParcels: Parcel[] = this.beliefs.carriedParcels;
                const parcelsToDrop: string[] = this.beliefs.carryingParcelIds;
                const parcelsDropped: Set<string> = await this.actuator.putDown(parcelsToDrop);

                // Calculate points earned from the actual parcel scores
                let totalPointsEarned = 0;
                const droppedParcelIds = Array.from(parcelsDropped);

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

            default:
                return false;
        }
    }

    /**
     * Moves the agent towards a target position
     * @param intention The intention with calculated path
     * @returns Promise that resolves to true if the move was successful, false otherwise
     */
    private async moveTowards(intention: Intention): Promise<boolean> {
        let nextPosition: Position = intention.context.path?.shift();

        if (this.beliefs.isPositionOccupied(nextPosition)) {
            console.log(`Position ${nextPosition.toString()} is occupied by another agent`);

            const path: Position[] = this.beliefs
                .calculateMovingPath(intention.position, this.beliefs.getOccupiedPositions())
                //We remove the current position from the remaining path
                ?.slice(1);
            if (!path) {
                //Intention has failed
                return false;
            }

            nextPosition = path.shift();
            intention.context = {
                ...intention.context,
                path,
            };
        }

        // If already at target, return success
        if (this.beliefs.myPosition.equals(nextPosition)) {
            return true;
        }

        const nextDirection: Directions = this.beliefs.myPosition.getDirection(nextPosition);
        return await this.actuator.move(nextDirection);
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
                this._intentionQueue.remove(intention);
            }
        }

        // If current intention is related to this desire, reset it
        if (
            this._currentIntention &&
            desire.position?.equals(this._currentIntention.position) &&
            JSON.stringify(desire.context) === JSON.stringify(this._currentIntention.context)
        ) {
            this._currentIntention = null;
        }
    }

    /**
     * Registers an event listener
     * @param event The event to listen for
     * @param listener The listener function
     */
    on(event: string, listener: (...args: any[]) => void): void {
        this._eventEmitter.on(event, listener);
    }

    private processMovingIntention(intention: Intention, desire: Desire): void {
        const pathToPosition: Position[] = this.beliefs.calculateMovingPath(desire.position);
        if (!pathToPosition) {
            throw new Error("EXPLORE failed: Could not calculate path to position");
        }

        intention.context = {
            ...desire.context,
            from: this.beliefs.myPosition,
            to: desire.position,
            //Removing the first position because it's the current one
            path: pathToPosition.slice(1),
        };
    }

    private shouldGiveUpExploration(): boolean {
        // Check if there are higher priority intentions in the queue
        if (!this._intentionQueue.isEmpty()) {
            const nextIntention: Intention = this._intentionQueue.peek();
            if (
                this.currentIntention?.type === IntentionTypes.EXPLORE &&
                nextIntention?.type !== IntentionTypes.EXPLORE
            ) {
                return true;
            }
        }

        return false;
    }
}
