import type { BeliefContainer } from "@domain/beliefs";
import type { Actuator } from "@domain/communication";
import { type Desire, DesireTypes, type DesiresManager } from "@domain/desires";
import { type Agent, GameConfiguration, type Parcel } from "@domain/models";
import type { Directions, Position } from "@domain/models/environment";
import {
    type HandoffCoordinator,
    type HandoffRequest,
    HandoffStatus,
} from "@domain/models/handoff-coordinator";
import { Intention, IntentionTypes } from "@domain/models/intention";
import { IntentionQueue } from "@domain/models/intention-queue";
import type { StatisticsLogger } from "@domain/models/statistics-logger";
import { EventEmitter } from "eventemitter3";

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
        this.desiresManager.on("desires:updated", async () => {
            await this.generateIntentionsFromDesires();
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
            const success: boolean = await this.executeIntention(this._currentIntention);

            if (!success) {
                // Record failure
                this._currentIntention.addFailure();

                // Check if we should give up on this intention
                if (this._currentIntention.shouldGiveUp()) {
                    console.log(`Giving up on intention: ${this._currentIntention.toString()}`);

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

                // Check if intention is complete
                if (this.isIntentionComplete(this._currentIntention)) {
                    this._currentIntention = null;
                }
            }
        } else {
            console.log("There are no intention possible. WAITING for best moments");
        }
    }

    /**
     * Generates intentions based on current desires
     */
    async generateIntentionsFromDesires(): Promise<void> {
        // Clear existing intentions
        this._intentionQueue.clear();

        // Get all desires
        const desires: Desire[] = this.desiresManager.getAllRankedDesires();

        // Convert desires to intentions
        for (const desire of desires) {
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
                
                case DesireTypes.PUT_DOWN_HANDOFF:
                    this.generatePutDownHandoffIntention(desire);
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
    private async generateDeliverIntention(desire: Desire): Promise<void> {
        // Check if this delivery involves a handoff
        if (desire.context?.handoff) {
            // Extract handoff information
            const { partnerId, meetingPosition } = desire.context.handoff;

            // Create a handoff request if not already active
            if (!this.handoffCoordinator.hasActiveHandoff()) {
                const friendAgent: Agent = this.beliefs.getAgent(partnerId);
                if (!friendAgent?.position) {
                    // Fall back to regular delivery if partner not found
                    const regularIntention: Intention = Intention.deliver(desire.position);
                    this.processMovingIntention(regularIntention, desire);
                    this._intentionQueue.add(regularIntention, desire.priority);
                    return;
                }

                // Calculate meeting position (midpoint between agents)
                const handoffPaths: Position[][] = this.beliefs.calculateMeetingPointPaths(
                    friendAgent.position,
                );

                if (!handoffPaths || handoffPaths.length < 2) {
                    // Fall back to regular delivery if path calculation fails
                    const regularIntention: Intention = Intention.deliver(desire.position);
                    this.processMovingIntention(regularIntention, desire);
                    this._intentionQueue.add(regularIntention, desire.priority);
                    return;
                }

                const secondsToMeeting: number =
                    (handoffPaths[0].length + handoffPaths[1].length) *
                    GameConfiguration.movementDuration.seconds;
                const handoffBufferInSeconds: number = 2;

                const meetingTime: number =
                    Date.now() + (secondsToMeeting + handoffBufferInSeconds) * 1000;

                await this.handoffCoordinator.createHandoffRequest(
                    this.beliefs.myId,
                    partnerId,
                    desire.context.parcelIds,
                    meetingPosition,
                    null,
                    Math.min(10, Math.ceil(desire.priority / 10)), // Urgency based on priority
                    meetingTime,
                );
            }

            // Create a MOVE intention to the meeting position
            const intention: Intention = Intention.move(meetingPosition);
            this.processMovingIntention(intention, desire);

            intention.context = {
                ...intention.context,
                isHandoff: true,
                isInitiator: true,
                partnerId: partnerId,
            };

            this._intentionQueue.add(intention, desire.priority);
        } else {
            // Regular delivery without handoff
            const intention: Intention = Intention.deliver(desire.position);
            this.processMovingIntention(intention, desire);

            this._intentionQueue.add(intention, desire.priority);
        }
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

    // Handoff is now handled as part of the DELIVER_PARCEL intention generation

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
     * Generates an PICKUP_HANDOFF intention from a desire
     * @param desire The desire to convert
     */
    private generatePickupHandoffIntention(desire: Desire): void {
        const intention: Intention = Intention.move(desire.position);
        intention.context = {
            handoffRequestId: desire.context.requestId,
            isHandoff: true,
            isReceiver: true, // Flag that we're receiving parcels
        };
    }

    /**
     * Generates an PUT_DOWN_HANDOFF intention from a desire
     * @param desire The desire to convert
     */
    private generatePutDownHandoffIntention(desire: Desire): void {
        const intention: Intention = Intention.putDown(desire.position);
        intention.context = {
            handoffRequestId: desire.context.requestId,
            isHandoff: true,
            isReceiver: false, // Flag that we're receiving parcels
        };
    }

    /**
     * Sends a handoff response message to the initiator
     * @param request The handoff request
     * @param accepted Whether the request is accepted
     * @param estimatedArrivalTime When the agent expects to arrive (if accepted)
     */
    /**
     * Sends a handoff confirmation message to the partner agent
     * @param handoff The handoff request that was completed
     * @param success Whether the handoff was successful
     */
    private async sendHandoffConfirmation(
        handoff: HandoffRequest,
        success: boolean,
    ): Promise<void> {
        try {
            // Find the messenger in the actuator (assuming it's available)
            const messenger = (this.actuator as any).messenger;
            if (!messenger) {
                console.error("Messenger not available in actuator");
                return;
            }

            // Determine the recipient (the other agent in the handoff)
            const recipientId =
                this.beliefs.myId === handoff.initiatorId
                    ? handoff.receiverId
                    : handoff.initiatorId;

            // Send the handoff confirmation
            await messenger.sendHandoffConfirm(
                recipientId,
                handoff.requestId,
                handoff.parcelIds,
                success,
                this.beliefs.myPosition,
            );

            console.log(
                `Sent handoff ${success ? "success" : "failure"} confirmation for request ${handoff.requestId}`,
            );
        } catch (error) {
            console.error("Error sending handoff confirmation:", error);
        }
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
                    // If at the meeting position, handle the handoff process
                    if (this.beliefs.myPosition.equals(intention.position)) {
                        // Get the handoff request ID from context
                        const handoffRequestId = intention.context.handoffRequestId;
                        if (!handoffRequestId) {
                            console.error("Missing handoff request ID in intention context");
                            return false;
                        }

                        // Get the active handoff
                        const activeHandoff: HandoffRequest =
                            this.handoffCoordinator.getActiveHandoff();
                        if (!activeHandoff || activeHandoff.requestId !== handoffRequestId) {
                            console.error(
                                "Handoff request not found or doesn't match active handoff",
                            );
                            return false;
                        }

                        // Handle based on role (initiator or receiver)
                        if (intention.context.isInitiator) {
                            // We're the initiator - put down parcels for the other agent to pick up
                            console.log(
                                `Initiating handoff of parcels ${activeHandoff.parcelIds.join(", ")} at ${intention.position}`,
                            );

                            // Only put down the specific parcels for this handoff
                            const parcelsDropped = await this.actuator.putDown(
                                activeHandoff.parcelIds,
                            );

                            if (parcelsDropped.size === 0) {
                                console.error("Failed to put down parcels for handoff");
                                return false;
                            }

                            // Update our beliefs
                            this.beliefs.updateDroppedParcels(parcelsDropped);

                            // Wait a moment for the other agent to pick up
                            await new Promise((resolve) => setTimeout(resolve, 1000));

                            // Complete the handoff
                            this.handoffCoordinator.completeHandoff(handoffRequestId, true);

                            // Send confirmation
                            await this.sendHandoffConfirmation(activeHandoff, true);

                            console.log(`Handoff completed successfully at ${intention.position}`);
                            return true;
                        } else if (intention.context.isReceiver) {
                            // We're the receiver - pick up parcels from the other agent
                            console.log(
                                `Receiving handoff of parcels ${activeHandoff.parcelIds.join(", ")} at ${intention.position}`,
                            );

                            // Try to pick up the parcels
                            const pickupResult = await this.actuator.pickup();

                            if (pickupResult.size === 0) {
                                console.error("Failed to pick up parcels during handoff");

                                // Complete the handoff as failed
                                this.handoffCoordinator.completeHandoff(handoffRequestId, false);

                                // Send confirmation of failure
                                await this.sendHandoffConfirmation(activeHandoff, false);

                                return false;
                            }

                            // Update our beliefs
                            this.beliefs.updateCarriedParcelsAfterPickup(pickupResult);

                            // Complete the handoff
                            this.handoffCoordinator.completeHandoff(handoffRequestId, true);

                            // Send confirmation
                            await this.sendHandoffConfirmation(activeHandoff, true);

                            console.log(`Handoff received successfully at ${intention.position}`);
                            return true;
                        } else {
                            // Generic handoff handling (for backward compatibility)
                            console.log(
                                `At handoff position ${intention.position}, waiting for coordination`,
                            );
                            return true;
                        }
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
        let nextPosition: Position = intention.context?.path?.shift();
        if (!nextPosition) {
            //The intention has no more steps
            return true;
        }

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

    private processMovingIntention(intention: Intention, desire: Desire): boolean {
        const pathToPosition: Position[] = this.beliefs.calculateMovingPath(
            desire.position,
            this.beliefs.getOccupiedPositions(),
        );
        if (!pathToPosition) {
            return false;
            //throw new Error("EXPLORE failed: Could not calculate path to position");
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
