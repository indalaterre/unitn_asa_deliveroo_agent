import type { BeliefContainer } from "@domain/beliefs";
import type { Actuator } from "@domain/communication";
import { type Desire, DesirePriorities, DesireTypes, type DesiresManager } from "@domain/desires";
import { type Agent, GameConfiguration, type Parcel } from "@domain/models";
import type { Directions, Position } from "@domain/models/environment";
import type { HandoffCoordinator, HandoffRequest } from "@domain/models/handoff-coordinator";
import { HandoffActionRequire, HandoffUpdateType } from "@domain/models/handoff-coordinator";
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
            this.syncIntentionWithCurrentState(this.currentIntention);
        }

        // Execute current intention if available
        if (this.currentIntention) {
            // Check if the intention is still valid
            if (!this.isIntentionValid(this.currentIntention)) {
                this._currentIntention = null;
                return;
            }

            console.log(`Current intention: ${this.currentIntention.toString()}`);

            // Execute the intention
            const success: boolean = await this.executeIntention(this._currentIntention).catch((error) => {
                console.log(`executeIntention error: ${error}`);
                return false;
            });

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

                    if (this.handoffCoordinator.hasActiveHandoff() && (this._currentIntention.type == IntentionTypes.PICK_UP_HANDOFF || this._currentIntention.type == IntentionTypes.PUT_DOWN_HANDOFF)) {
                        await this.handoffCoordinator.createHandofUpdate(
                            this.beliefs.myId,
                            this._currentIntention.context.handoffRequestId,
                            this._currentIntention.context.partnerId,
                            HandoffUpdateType.CANCELED,
                        );

                        console.log(`handleDesireFailure drop handoff`);
                        this.handoffCoordinator.completeHandoff(this._currentIntention.context.handoffRequestId, false);
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
        } else {
            console.log("There are no intention possible. WAITING for best moments");
        }
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
                
                case DesireTypes.PUT_DOWN_HANDOFF:
                    await this.generatePutDownHandoffIntention(desire);
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
        const parcelId: string = desire?.context?.parcelId;
        if (!parcelId) {
            throw new Error("PICKUP desires requires a parcel id to be picked up");
        }

        if (this.beliefs.carryingParcelIds.includes(parcelId)) {
            // The agent as already this parcel. No need to re-pick it up
            return;
        }

        //If it's not a urgent pick-up move to that position
        if (desire.priority !== DesirePriorities.PRIORITY_PICKUP) {
            const intention: Intention = Intention.move(desire.position);
            this.processMovingIntention(intention, desire);
            this.addIntentionToQueue(intention, desire.priority);
        }

        // Otherwise, create a MOVE intention

        const pickUp: Intention = Intention.pickUp(desire.position);
        pickUp.context = desire.context;

        this.addIntentionToQueue(pickUp, desire.priority);
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
            this.currentIntention?.type === IntentionTypes.EXPLORE ||
            this._intentionQueue.hasElementOfType(IntentionTypes.EXPLORE)
        )
            return;

        const intention: Intention = Intention.explore(desire.position);
        this.processMovingIntention(intention, desire);

        this.addIntentionToQueue(intention, desire.priority);
    }

    /**
     * Generates an PICKUP_HANDOFF intention from a desire
     * @param desire The desire to convert
     */
    private generatePickupHandoffIntention(desire: Desire): void {
        const intention: Intention = Intention.pickUpHandoff(desire.position);

        try {
            if (this.handoffCoordinator.hasActiveHandoff()){

                const activeHandoff = this.handoffCoordinator.getActiveHandoff();

                this.processMovingIntention(intention, desire);

                intention.context = {
                    ...intention.context,
                    handoffRequestId: desire.context.requestId,
                    isHandoff: true,
                    isInitiator: false,
                    isReceiver: true,
                    partnerId: desire.context.partnerId,
                    timeToMeet: activeHandoff.timeToMeet,
                };

                this._intentionQueue.add(intention, desire.priority);
            } else {
                console.log("generatePickupHandoffIntention NO activeHandoff");
            }
        } catch (error) {
            console.log(`generatePickupHandoffIntention error: ${error}`);
        }
    }

    /**
     * Generates an PUT_DOWN_HANDOFF intention from a desire
     * @param desire The desire to convert
     */
    private async generatePutDownHandoffIntention(desire: Desire): Promise<void> {

        // Extract handoff information
        const partnerId = desire.context.partnerId;
        const meetingPosition = desire.position;

        // Create a handoff request if not already active
        if (!this.handoffCoordinator.hasActiveHandoff() && !this.handoffCoordinator.hasPendingRequests) {
            
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
            const handoffBufferInSeconds: number = 3;

            const meetingTime: number =
                Date.now() + (secondsToMeeting + handoffBufferInSeconds) * 1000;

            await this.handoffCoordinator.createHandoffRequest(
                this.beliefs.myId,
                partnerId,
                desire.context.parcelIds,
                meetingPosition,
                Math.min(10, Math.ceil(desire.priority / 10)), // Urgency based on priority
                meetingTime,
                HandoffActionRequire.MOVE,
            )
        }

        const activeHandoff = this.handoffCoordinator.getActiveHandoff();

        if (activeHandoff) {
            const intention: Intention = Intention.putDownHandoff(desire.position);
        
            this.processMovingIntention(intention, desire);

            intention.context = {
                ...intention.context,
                handoffRequestId: activeHandoff.requestId,
                isHandoff: true,
                isInitiator: true,
                isReceiver: false,
                partnerId: desire.context.partnerId,
                timeToMeet: activeHandoff.timeToMeet,
            };

            this._intentionQueue.add(intention, desire.priority);
        } else {
            console.log("generatePutDownHandoffIntention waiting response")
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
            case IntentionTypes.PICK_UP_HANDOFF:
            case IntentionTypes.PUT_DOWN_HANDOFF:
                // Check if we are on time
                if (this.handoffCoordinator.hasActiveHandoff()){
                    const activeHandoff = this.handoffCoordinator.getActiveHandoff();
                    return activeHandoff.expiresAt > Date.now();
                }
                return false;
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
                const remainingPath = intention.context.path;
                if (!remainingPath?.length) {
                    const isMyPosition = this.beliefs.myPosition.equals(intention.position);
                    const a = 1;
                }

                // These intentions are complete when we reach the target position
                return this.beliefs.myPosition.equals(intention.position);

            case IntentionTypes.PICK_UP:
            case IntentionTypes.PUT_DOWN:
                // These intentions are complete after a successful execution
                return true;
            case IntentionTypes.PICK_UP_HANDOFF:
            case IntentionTypes.PUT_DOWN_HANDOFF:
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

                // Calculate path to target
                return await this.moveTowards(intention);

            case IntentionTypes.PICK_UP:
                return await this.executePickup();

            case IntentionTypes.PUT_DOWN:
                if (!this.beliefs.isAgentOnDeliveryTile()) {
                    return Promise.resolve(false);
                }

                // Execute put-down action
                const carriedParcels: Parcel[] = this.beliefs.carriedParcels;
                const parcelsToDrop: string[] = this.beliefs.carryingParcelIds;
                const parcelsDropped: Set<string> = (await this.actuator.putDown(parcelsToDrop));

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

            case IntentionTypes.PUT_DOWN_HANDOFF:
            {
                const pickUpPartnerPosition = this.beliefs.partnerAdjacentTile(intention.context.partnerId);

                // Get the handoff request ID from context
                const handoffRequestId = intention.context.handoffRequestId;
                if (!handoffRequestId) {
                    console.error("Missing handoff request ID in intention context");
                    return Promise.resolve(false);
                }

                // Partner is near
                if (pickUpPartnerPosition) {
                    // Get the active handoff
                    const activeHandoff: HandoffRequest =
                        this.handoffCoordinator.getActiveHandoff();
                    if (!activeHandoff || activeHandoff.requestId !== handoffRequestId) {
                        console.error(
                            "Handoff request not found or doesn't match active handoff",
                        );
                        return Promise.resolve(false);
                    }

                    // We're the initiator - put down parcels for the other agent to pick up
                    console.log(
                        `Initiating handoff of parcels ${activeHandoff.parcelIds.join(", ")} at ${intention.position}`,
                    );

                    let positionToMove = null;
                    for (const adjacentPosition of this.beliefs.myPosition.adjacent) {
                        if (this.beliefs.map.isReachable(this.beliefs.myPosition, adjacentPosition) && !this.beliefs.isPositionOccupied(adjacentPosition)) {
                            positionToMove = adjacentPosition;
                            break;
                        }
                    }

                    if (positionToMove == null) {

                        let requiredPositionToMove = null;
                        for (const adjacentPosition of pickUpPartnerPosition.adjacent) {
                            if (this.beliefs.map.isReachable(pickUpPartnerPosition, adjacentPosition) && !this.beliefs.isPositionOccupied(adjacentPosition)) {
                                requiredPositionToMove = adjacentPosition;
                                break;
                            }
                        }
                        // Ask to move away
                        await this.handoffCoordinator.createHandofUpdate(
                            this.beliefs.myId,
                            handoffRequestId,
                            intention.context.partnerId,
                            HandoffUpdateType.NEW_METTING_POINT,
                            HandoffActionRequire.MOVE_AWAY,
                            null,
                            requiredPositionToMove,
                            intention.context.meetingTime + 500,
                        );

                        await new Promise((resolve) => setTimeout(resolve, 500));

                    } else {

                        // Only put down the specific parcels for this handoff
                        const parcelsDropped = await this.actuator.putDown(
                            activeHandoff.parcelIds,
                        );

                        if (parcelsDropped.size === 0) {
                            console.error("Failed to put down parcels for handoff");
                            return Promise.resolve(false);
                        }

                        // Update our beliefs
                        this.beliefs.updateDroppedParcels(parcelsDropped);

                        await this.handoffCoordinator.createHandofUpdate(
                            this.beliefs.myId,
                            handoffRequestId,
                            intention.context.partnerId,
                            HandoffUpdateType.PARCELS_POSITION,
                            HandoffActionRequire.PICK_UP,
                            Array.from(parcelsDropped),
                            this.beliefs.myPosition,
                            intention.context.meetingTime + 500,
                        );

                        const nextDirection: Directions = this.beliefs.myPosition.getDirection(positionToMove);
                        const moved = await this.actuator.move(nextDirection).catch((error) => {
                            console.log(error.track);
                            return false;
                        });

                        if (moved) {
                            // Wait a moment for the other agent to pick up
                            await new Promise((resolve) => setTimeout(resolve, 500));
                            // Complete the handoff
                            this.handoffCoordinator.completeHandoff(handoffRequestId, true);
                            console.log(`Handoff completed successfully at ${intention.position}`);
                        }

                        return Promise.resolve(true);
                    }
                } else {

                    let atMeetingPoint = false;

                    if (this.beliefs.myPosition.equals(intention.position)) {
                        atMeetingPoint = true;
                    }

                    const friendAgent: Agent = this.beliefs.getAgent(intention.context.partnerId);
                    const frientDistance = this.beliefs.map.distance(this.beliefs.myPosition, friendAgent.position);

                    // Calculate meeting position (midpoint between agents)
                    const handoffPaths: Position[][] = this.beliefs.calculateMeetingPointPaths(
                        friendAgent.position,
                    );

                    if (handoffPaths?.length >= 2 && handoffPaths[1].length > 0) {

                        const meetingPosition: Position = handoffPaths[1][0];
                        if (frientDistance > GameConfiguration.agentVisibilityDistance) {
                    
                            const secondsToMeeting: number =
                                (handoffPaths[0].length + handoffPaths[1].length) *
                                GameConfiguration.movementDuration.seconds;
                            const handoffBufferInSeconds: number = 3;

                            const meetingTime: number =
                            Date.now() + (secondsToMeeting + handoffBufferInSeconds) * 1000;
                            
                            await this.handoffCoordinator.createHandofUpdate(
                                this.beliefs.myId,
                                handoffRequestId,
                                friendAgent.agentId,
                                HandoffUpdateType.NEW_METTING_POINT,
                                HandoffActionRequire.MOVE,
                                null,
                                meetingPosition,
                                meetingTime,
                            );
                        } else {
                            this.handoffCoordinator.moveTowardFrined(meetingPosition);
                        }
                    } else {
                        return Promise.resolve(false);
                    }
                    //return Promise.resolve(true);

                    // Calculate path to target
                    return await this.moveTowards(intention);
                }
            }

            case IntentionTypes.PICK_UP_HANDOFF:
            {
                // Get the handoff request ID from context
                const handoffRequestId = intention.context.handoffRequestId;
                if (!handoffRequestId) {
                    console.error("Missing handoff request ID in intention context");
                    return Promise.resolve(false);
                }

                if (this.handoffCoordinator.hasActiveHandoff()) {

                    const activeHandoff = this.handoffCoordinator.getActiveHandoff();

                    switch (activeHandoff.actionRequired) {
                        case HandoffActionRequire.MOVE:

                            if (this.handoffCoordinator.hasActiveHandoff() && this.beliefs.myPosition.equals(intention.position)) {
                        
                                const friendAgent: Agent = this.beliefs.getAgent(intention.context.partnerId);
  
                                const frientDistance = this.beliefs.map.distance(this.beliefs.myPosition, friendAgent.position);

                                // Calculate meeting position (midpoint between agents)
                                const handoffPaths: Position[][] = this.beliefs.calculateMeetingPointPaths(
                                    friendAgent.position,
                                );

                                if (handoffPaths?.length >= 2 && handoffPaths[1].length > 0) {

                                    if (frientDistance > GameConfiguration.agentVisibilityDistance) {
                                        const meetingPosition: Position = handoffPaths[1][0];

                                        const secondsToMeeting: number =
                                            (handoffPaths[0].length + handoffPaths[1].length) *
                                            GameConfiguration.movementDuration.seconds;
                                        const handoffBufferInSeconds: number = 3;

                                        const meetingTime: number =
                                        Date.now() + (secondsToMeeting + handoffBufferInSeconds) * 1000;

                                        await this.handoffCoordinator.createHandofUpdate(
                                            this.beliefs.myId,
                                            intention.context.handoffRequestId,
                                            friendAgent.agentId,
                                            HandoffUpdateType.NEW_METTING_POINT,
                                            HandoffActionRequire.MOVE,
                                            null,
                                            meetingPosition,
                                            meetingTime,
                                        );
                                    } else {
                                        const meetingPosition: Position = handoffPaths[0][handoffPaths[0].length -1];
                                        this.handoffCoordinator.moveTowardFrined(meetingPosition);
                                    }
                                    return Promise.resolve(true);
                                }
                            }

                            // Calculate path to target
                            return await this.moveTowards(intention);

                        case HandoffActionRequire.MOVE_AWAY:
                        {
                            const moved = await this.moveTowards(intention);

                            await new Promise((resolve) => setTimeout(resolve, 300));

                            return moved;
                        }
                        
                        case HandoffActionRequire.PICK_UP:
                            // Wait a moment for the other agent to put down
                            await new Promise((resolve) => setTimeout(resolve, 300));

                            // Synchronize beliefs
                            this.beliefs.synchronizeKnownAgents();
                            this.beliefs.synchronizeKnownParcels();

                            const nextDirection: Directions = this.beliefs.myPosition.getDirection(intention.position);
                            let moved = await this.actuator.move(nextDirection).catch((error) => {
                                console.log(error.track);
                                return false;
                            });
                
                            // Try to pick up the parcels
                            const pickupResult = await this.actuator.pickup()
                            if (pickupResult.size === 0) {
                                console.error("Failed to pick up parcels during handoff")
                                // Complete the handoff as failed
                                this.handoffCoordinator.completeHandoff(handoffRequestId, false)
                                return Promise.resolve(false);
                            }

                            // Update our beliefs
                            this.beliefs.updateCarriedParcelsAfterPickup(pickupResult);

                            this.handoffCoordinator.completeHandoff(handoffRequestId, true);

                            return Promise.resolve(true);
                        default:
                            console.error("Missing handoff action required");
                            break;
                    }
                }
                
                return Promise.resolve(false);
            }
            default:
                return Promise.resolve(false);
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
            if (!this.beliefs.myPosition.equals(intention.position))
                return false;
            //The intention has no more steps
            return true;
        }

        if (
            this.beliefs.freeParcels.filter((parcel) =>
                parcel.position.equals(this.beliefs.myPosition),
            ).length
        ) {
            await this.executePickup();
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

        const nextDirection: Directions = this.beliefs.myPosition.getDirection(nextPosition);
        const successfulMove: boolean = await this.actuator.move(nextDirection).catch((error) => {
            console.log(error.track);
            return false;
        });
        if (successfulMove) {
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
                if (intention.type == IntentionTypes.PICK_UP_HANDOFF || intention.type == IntentionTypes.PUT_DOWN_HANDOFF) {
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
                }
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

    private syncIntentionWithCurrentState(intention: Intention): void {
        if (!Intention.MOVING_INTENTIONS.includes(intention?.type)) return;

        const pathToPosition: Position[] = this.beliefs.calculateMovingPath(
            intention.position,
            this.beliefs.getOccupiedPositions(),
        );

        if (!pathToPosition) {
            return;
        }

        intention.context = {
            ...intention.context,
            from: this.beliefs.myPosition,
            to: intention.position,
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

        if (pickupResult.size === 0) {
            console.log("Failed to pick up parcels during handoff");
            return Promise.resolve(false);
        }

        // Update our beliefs
        this.beliefs.updateCarriedParcelsAfterPickup(pickupResult);
        return Promise.resolve(true);
    }
}
