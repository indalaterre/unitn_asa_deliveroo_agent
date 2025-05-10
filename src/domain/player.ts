import { BeliefContainer } from "@domain/beliefs";
import type { Actuator } from "@domain/communication";
import type { Sensor } from "@domain/communication/sensor";
import type { MatchMap, PositionWithDistance } from "@domain/map";
import { GameConfiguration, type Parcel } from "@domain/models";
import type { Agent } from "@domain/models/agent";
import { type Directions, Position } from "@domain/models/environment";
import { Intention, IntentionTypes } from "@domain/models/intention";
import { IntentionQueue } from "@domain/models/intention-queue";
import { StatisticsLogger } from "@domain/models/statistics-logger";
import type { PlayerInfo } from "@domain/player-info";
import { MessageFactory } from "@domain/communication/message-factory";
import { HelloMessage, Messenger } from "@domain/communication/messenger";
import { HandoffCoordinator, HandoffRequest, HandoffStatus } from "@domain/models/handoff-coordinator";
import {Promise} from "workerpool";

export class Player {
    /**
     * TRUE if the player is alive and able to play
     */
    private _isAlive = false;

    private _helloSendingInterval;

    /**
     * Contains all the beliefs of the agent
     */
    private readonly _beliefs: BeliefContainer;

    /**
     * Queue of intentions ordered by priority
     * @private
     */
    private _intentionQueue: IntentionQueue = new IntentionQueue();

    /**
     * The current executing intention
     * @private
     */
    private _currentIntention: Intention;

    /**
     * Logger for tracking delivery statistics
     * @private
     */
    private _statsLogger: StatisticsLogger = new StatisticsLogger();

    /**
     * Coordinator for parcel handoffs between agents
     * @private
     */
    private _handoffCoordinator: HandoffCoordinator = new HandoffCoordinator();

    public constructor(
        matchMap: MatchMap,
        initialParcels: Parcel[],
        sensor: Sensor,
        private readonly actuator: Actuator,
        private readonly messenger: Messenger,
        private readonly playerInfo: PlayerInfo,
    ) {
        this._beliefs = new BeliefContainer(playerInfo, matchMap);

        this.updateKnownParcels(initialParcels);

        sensor.onPlayerPositionUpdate((position: Position) => this.updatePlayerPosition(position));
        sensor.onAgentSensing(async (agents: Agent[]) => {
            this.updateKnownAgents(agents);
            /*
            await this.messenger.shoutAgentsInfo(
                MessageFactory.createAgentsUpdateMessage(playerInfo.id.toString(), agents),
            );*/
        });

        sensor.onParcelDetected(async (parcels: Parcel[]) => {
            this.updateKnownParcels(parcels);
            /*
            await this.messenger.shoutParcelInfo(
                MessageFactory.createParcelInfoMessage(playerInfo.id.toString(), parcels),
            );*/
        });

        messenger.onAgentsInfoReceived((agents: Agent[]) => this.updateKnownAgents(agents));
        messenger.onParcelInfoReceived((parcels: Parcel[]) => this.updateKnownParcels(parcels));
        messenger.onHelloMessageReceived((agent: Agent) => {
            this._beliefs.addTrustedAgent(agent.agentId)
            this.updateKnownAgents([agent])
        });

        // Set up handoff message handlers
        this.setupHandoffMessageHandlers();
    }

    /**
     * Sets up handlers for handoff-related messages
     * @private
     */
    private setupHandoffMessageHandlers(): void {
        // Handle handoff requests from other agents
        this.messenger.onMessageReceived(async (message: any) => {
            if (message.type === 'handoff_request') {
                await this.handleHandoffRequest(message);
            } else if (message.type === 'handoff_response') {
                await this.handleHandoffResponse(message);
            } else if (message.type === 'handoff_confirm') {
                await this.handleHandoffConfirmation(message);
            }
        });
    }

    /**
     * Handles an incoming handoff request
     * @param message The handoff request message
     * @private
     */
    private async handleHandoffRequest(message: any): Promise<void> {
        console.log(`Received handoff request from ${message.senderId} for parcels: ${message.parcelIds.join(', ')}`);

        // Create a handoff request object
        const request: HandoffRequest = {
            requestId: message.requestId,
            initiatorId: message.senderId,
            receiverId: this.playerInfo.id.serialize(),
            parcelIds: message.parcelIds,
            meetingPosition: message.meetingPosition,
            urgency: message.urgency,
            timeToMeet: message.timeToMeet,
            expiresAt: message.expiresAt,
            status: HandoffStatus.PENDING
        };

        // Register the incoming request
        this._handoffCoordinator.registerIncomingRequest(request);

        // Evaluate if we should accept the handoff
        const shouldAccept = this.evaluateHandoffRequest(request);

        if (shouldAccept) {
            // Calculate estimated arrival time
            const path = this._beliefs.calculateMovingPath(request.meetingPosition);
            const estimatedArrivalTime = Date.now() + (path ? path.length * 1000 : 10000);

            // Accept the request
            this._handoffCoordinator.acceptIncomingRequest(request.requestId, estimatedArrivalTime);

            // Send response
            await this.messenger.sendHandoffResponse(
                request.initiatorId,
                request.requestId,
                true,
                request.parcelIds,
                request.meetingPosition,
                estimatedArrivalTime
            );

            // Create an intention to move to the meeting position
            const handoffIntention = this._handoffCoordinator.createHandoffIntention(request);
            this._intentionQueue.add(handoffIntention, IntentionQueue.getDefaultPriority(IntentionTypes.MOVE) + 5);
        } else {
            // Reject the request
            this._handoffCoordinator.rejectIncomingRequest(request.requestId);

            // Send response
            await this.messenger.sendHandoffResponse(
                request.initiatorId,
                request.requestId,
                false,
                request.parcelIds,
                request.meetingPosition,
                0
            );
        }
    }

    /**
     * Handles a response to a handoff request
     * @param message The handoff response message
     * @private
     */
    private async handleHandoffResponse(message: any): Promise<void> {
        console.log(`Received handoff response from ${message.senderId} for request ${message.requestId}: ${message.accepted ? 'ACCEPTED' : 'REJECTED'}`);

        // Update the outgoing request status
        const request = this._handoffCoordinator.updateOutgoingRequest(
            message.requestId,
            message.accepted,
            message.estimatedArrivalTime
        );

        if (request && message.accepted) {
            // Create an intention to move to the meeting position
            const handoffIntention = this._handoffCoordinator.createHandoffIntention(request);
            this._intentionQueue.add(handoffIntention, IntentionQueue.getDefaultPriority(IntentionTypes.MOVE) + 5);
        }
    }

    /**
     * Handles a handoff confirmation message
     * @param message The handoff confirmation message
     * @private
     */
    private async handleHandoffConfirmation(message: any): Promise<void> {
        console.log(`Received handoff confirmation from ${message.senderId} for request ${message.requestId}: ${message.success ? 'SUCCESS' : 'FAILED'}`);

        // Complete the handoff
        this._handoffCoordinator.completeHandoff(message.requestId, message.success);

        if (message.success) {
            // Update beliefs based on the handoff
            // If we're the receiver, we need to add the parcels to our carried parcels
            const request = this._handoffCoordinator.getActiveHandoff();
            if (request && request.receiverId === this.playerInfo.id.serialize()) {
                // We received parcels - update our beliefs
                // Note: In a real implementation, we would need to get the actual parcel objects
                // For now, we'll just log that we received parcels
                console.log(`Received parcels in handoff: ${message.parcelIds.join(', ')}`);
            }
        }
    }

    /**
     * Evaluates whether to accept a handoff request
     * @param request The handoff request to evaluate
     * @returns True if the request should be accepted
     * @private
     */
    private evaluateHandoffRequest(request: HandoffRequest): boolean {
        // Don't accept if we already have an active handoff
        if (this._handoffCoordinator.hasActiveHandoff()) {
            return false;
        }

        // Don't accept if we're carrying too many parcels already
        const currentParcelCount = this._beliefs.carryingParcelIds.length;
        const wouldExceedCapacity = currentParcelCount + request.parcelIds.length > GameConfiguration.maxCarryingParcels;

        if (wouldExceedCapacity) {
            return false;
        }

        // Calculate if we're closer to a delivery point than the initiator
        const deliveryPoints = this._beliefs.map.getDeliveryTiles().map(tile => tile.position);

        // Find the initiator agent
        const initiatorAgent = this._beliefs.getAgents().find(agent => agent.agentId === request.initiatorId);

        if (!initiatorAgent) {
            return false; // Can't find the initiator
        }

        // Check if we're closer to a delivery point
        let closestDeliveryToSelf = null;
        let minDistanceToSelf = Infinity;

        for (const deliveryPoint of deliveryPoints) {
            const distance = this._beliefs.myPosition.manhattanDistance(deliveryPoint);
            if (distance < minDistanceToSelf) {
                minDistanceToSelf = distance;
                closestDeliveryToSelf = deliveryPoint;
            }
        }

        let closestDeliveryToInitiator = null;
        let minDistanceToInitiator = Infinity;

        for (const deliveryPoint of deliveryPoints) {
            const distance = initiatorAgent.position.manhattanDistance(deliveryPoint);
            if (distance < minDistanceToInitiator) {
                minDistanceToInitiator = distance;
                closestDeliveryToInitiator = deliveryPoint;
            }
        }

        // Accept if we're significantly closer to a delivery point
        return minDistanceToSelf < minDistanceToInitiator * 0.8;
    }

    /**
     * Initiates a handoff with another agent
     * @param targetAgentId ID of the agent to hand off to
     * @returns True if the handoff request was created
     */
    async initiateHandoff(targetAgentId: string): Promise<boolean> {
        // Don't initiate if we already have an active handoff
        if (this._handoffCoordinator.hasActiveHandoff()) {
            return false;
        }

        // Don't initiate if we're not carrying any parcels
        if (!this._beliefs.isCarrying) {
            return false;
        }

        // Find the target agent
        const targetAgent = this._beliefs.getAgents().find(agent => agent.agentId === targetAgentId);

        if (!targetAgent) {
            return false; // Can't find the target agent
        }

        // Check if a handoff would be beneficial
        const deliveryPoints = this._beliefs.map.getDeliveryTiles().map(tile => tile.position);
        const isBeneficial = this._handoffCoordinator.isHandoffBeneficial(
            this._beliefs.myPosition,
            this._beliefs.carriedParcels,
            targetAgent,
            deliveryPoints
        );

        if (!isBeneficial) {
            return false;
        }

        // Find optimal meeting position
        const meetingPosition = this._handoffCoordinator.findOptimalMeetingPosition(
            this._beliefs.myPosition,
            targetAgent.position
        );

        // Create the handoff request
        const request = this._handoffCoordinator.createHandoffRequest(
            this.playerInfo.id.serialize(),
            targetAgentId,
            this._beliefs.carryingParcelIds,
            meetingPosition,
            8, // High urgency
            Date.now() + 10000, // Meet in 10 seconds
            30000 // Expires in 30 seconds
        );

        // Send the handoff request
        await this.messenger.sendHandoffRequest(
            targetAgentId,
            request.parcelIds,
            request.meetingPosition,
            request.urgency,
            request.timeToMeet,
            30000 // Expires in 30 seconds
        );

        return true;
    }

    /**
     * Checks for handoff opportunities with nearby trusted agents
     * @private
     */
    private async checkHandoffOpportunities(): Promise<void> {
        // Clean up expired requests
        this._handoffCoordinator.cleanupExpiredRequests();

        // Don't check if we already have an active handoff
        if (this._handoffCoordinator.hasActiveHandoff()) {
            return;
        }

        // Don't check if we're not carrying any parcels
        if (!this._beliefs.isCarrying) {
            return;
        }

        // Get nearby trusted agents
        const trustedAgents = this._beliefs.getAgents().filter(agent =>
            this._beliefs.isTrustedAgent(agent.agentId) &&
            this._beliefs.myPosition.manhattanDistance(agent.position) <= GameConfiguration.agentVisibilityDistance
        );

        if (trustedAgents.length === 0) {
            return; // No trusted agents nearby
        }

        // Get delivery points
        const deliveryPoints = this._beliefs.map.getDeliveryTiles().map(tile => tile.position);

        // Find our closest delivery point
        let closestDeliveryToSelf = null;
        let minDistanceToSelf = Infinity;

        for (const deliveryPoint of deliveryPoints) {
            const distance = this._beliefs.myPosition.manhattanDistance(deliveryPoint);
            if (distance < minDistanceToSelf) {
                minDistanceToSelf = distance;
                closestDeliveryToSelf = deliveryPoint;
            }
        }

        if (!closestDeliveryToSelf) {
            return; // No delivery points found
        }

        // Find the best agent to hand off to
        let bestAgent = null;
        let bestAgentScore = 0;

        for (const agent of trustedAgents) {
            // Find the agent's closest delivery point
            let closestDeliveryToAgent = null;
            let minDistanceToAgent = Infinity;

            for (const deliveryPoint of deliveryPoints) {
                const distance = agent.position.manhattanDistance(deliveryPoint);
                if (distance < minDistanceToAgent) {
                    minDistanceToAgent = distance;
                    closestDeliveryToAgent = deliveryPoint;
                }
            }

            if (!closestDeliveryToAgent) continue;

            // Calculate distances
            const selfToDelivery = minDistanceToSelf;
            const selfToAgent = this._beliefs.myPosition.manhattanDistance(agent.position);
            const agentToDelivery = minDistanceToAgent;

            // Calculate benefit score:
            // - Higher score means more beneficial handoff
            // - We want agent to be closer to delivery than we are
            // - We want the combined distance (self to agent + agent to delivery) to be less than self to delivery
            // - We also consider how much closer the agent is to delivery compared to us

            if (agentToDelivery < selfToDelivery && (selfToAgent + agentToDelivery) < selfToDelivery) {
                // Calculate how much distance we save
                const distanceSaved = selfToDelivery - (selfToAgent + agentToDelivery);

                // Calculate how much closer the agent is to delivery
                const agentAdvantage = selfToDelivery - agentToDelivery;

                // Combined score
                const score = distanceSaved + agentAdvantage;

                if (score > bestAgentScore) {
                    bestAgentScore = score;
                    bestAgent = agent;
                }
            }
        }

        // If we found a good agent to hand off to, initiate the handoff
        if (bestAgent && bestAgentScore > 3) { // Only hand off if we save at least 3 steps
            console.log(`Initiating handoff with agent ${bestAgent.agentId} (score: ${bestAgentScore})`);
            await this.initiateHandoff(bestAgent.agentId);
        }
    }

    async start(): Promise<void> {
        this._isAlive = true;

        // Set up interval to log statistics periodically
        const statsInterval = setInterval(() => {
            if (this._isAlive) {
                this._statsLogger.logStatistics();
            } else {
                clearInterval(statsInterval);
            }
        }, 10000); // Log every 10 seconds

        // Set up interval to check for handoff opportunities periodically
        const handoffCheckInterval = setInterval(async () => {
            if (this._isAlive && this._beliefs.isCarrying) {
                await this.checkHandoffOpportunities();
            } else if (!this._isAlive) {
                clearInterval(handoffCheckInterval);
            }
        }, 5000); // Check every 5 seconds

        this._helloSendingInterval = setInterval(async () => {
            await this.shoutHelloMessage();
        }, 1000);

        await Promise.all([this.shoutHelloMessage(), this._run()]);
    }

    stop(): void {
        this._isAlive = false;

        clearInterval(this._helloSendingInterval);

        // Log final statistics when stopping
        console.log("\n"); // Add a newline before final stats
        this._statsLogger.logFinalStatistics();
        console.log(""); // Add a newline after final stats
    }

    private async _run(): Promise<void> {
        while (this._isAlive) {
            await new Promise((resolve) => setImmediate(resolve));

            this._beliefs.synchronizeKnownAgents();
            this._beliefs.synchronizeKnownParcels();

            // Check for handoff opportunities
            await this.checkHandoffOpportunities();

            // Manage current intention
            if (!this._currentIntention) {
                this._generateNewIntentions();
                this._currentIntention = this._intentionQueue.poll();
            }

            // Check if we need to execute a handoff
            if (this._handoffCoordinator.hasActiveHandoff()) {
                const handoffExecuted = await this.executeHandoff();
                if (handoffExecuted) {
                    // Reset current intention after handoff
                    this._currentIntention = null;
                    continue;
                }
            }

            // Execute intention
            if (this._currentIntention) {
                // Check if the intention is still valid
                if (!this._isIntentionValid(this._currentIntention)) {
                    this._currentIntention = null;
                    continue;
                }

                console.log(`Current intention: ${this._currentIntention.toString()}`);

                // Peek at the next intention in the queue
                const nextIntention = this._intentionQueue.peek();

                // Only recalculate if forced, or if next intention is EXPLORE, or if queue is empty
                if (!nextIntention || nextIntention.type === IntentionTypes.EXPLORE) {
                    // Clear the queue and generate new intentions
                    this._intentionQueue.clear();
                    this._generateNewIntentions();

                    // If we just picked up a parcel, immediately add a DELIVER intention with high priority
                    // This helps prevent loops by ensuring we move to delivery after pickup
                    if (this._beliefs.isCarrying) {
                        const deliveryPoint = this._beliefs.findBestDelivery();
                        if (deliveryPoint?.position) {
                            // If we're not already at the delivery point, create a DELIVER intention
                            if (!deliveryPoint.position.equals(this._beliefs.myPosition)) {
                                const deliverIntention = Intention.deliver(deliveryPoint.position);
                                // Use an even higher priority to ensure it's selected next
                                this._intentionQueue.add(
                                    deliverIntention,
                                    IntentionQueue.getDefaultPriority(IntentionTypes.DELIVER) + 10,
                                );
                            } else {
                                // If we're already at a delivery point, create a PUT_DOWN intention
                                const putDownIntention = Intention.putDown(deliveryPoint.position);
                                this._intentionQueue.add(
                                    putDownIntention,
                                    IntentionQueue.getDefaultPriority(IntentionTypes.PUT_DOWN) + 10,
                                );
                            }
                        }
                    }
                }

                // Check if intentions need to be recalculated based on current state
                // This helps prioritize more important intentions that may have become available
                this._checkAndRecalculateIntentions(false);

                // Execute the current intention based on its type
                if (this._currentIntention.type === IntentionTypes.PICK_UP) {
                    // PICKUP case
                    await this.executePickUpIntention();
                    this._currentIntention = null;

                    // After pickup, recalculate intentions and flag that we just picked up a parcel
                    // This helps prevent loops by ensuring we prioritize delivery after pickup
                    this._checkAndRecalculateIntentions(true, true);
                } else if (this._currentIntention.type === IntentionTypes.PUT_DOWN) {
                    // PUTDOWN case
                    await this.executePutDownIntention();
                    this._currentIntention = null;

                    // Force recalculation of intentions after putting down parcels
                    this._checkAndRecalculateIntentions(true);
                } else if (Intention.MOVING_INTENTIONS.includes(this._currentIntention.type)) {
                    // MOVE, EXPLORE, DELIVER cases
                    if (!this._currentIntention.hasContext()) {
                        // Calculate path for the intention
                        if (
                            !this.calculateShortestPathFromMovingIntention(this._currentIntention)
                        ) {
                            if (
                                this.handleIntentionFailure(this._currentIntention, "No path found")
                            ) {
                                this._currentIntention = null;
                            }
                            continue;
                        }
                    }

                    // Execute one step of the plan
                    const success = await this.goAheadWithChosenPlan();
                    if (!success && this._currentIntention) {
                        if (
                            this.handleIntentionFailure(
                                this._currentIntention,
                                "Plan execution failed",
                            )
                        ) {
                            this._currentIntention = null;
                        }
                    }

                    // If we've reached the destination, check if we need to recalculate intentions
                    if (
                        this._currentIntention &&
                        this._beliefs.myPosition.equals(this._currentIntention.position)
                    ) {
                        // We've reached the destination
                        if (this._currentIntention.type === IntentionTypes.EXPLORE) {
                            // For EXPLORE intentions, we're done once we reach the position
                            this._currentIntention = null;
                        } else if (this._currentIntention.type === IntentionTypes.MOVE) {
                            // For MOVE intentions, we're done once we reach the position
                            this._currentIntention = null;
                            // Check if we need to recalculate intentions after completion
                            this._checkAndRecalculateIntentions(false);
                        }
                        // For DELIVER intentions, we don't complete here - they complete via PUT_DOWN
                    }
                }
            }
        }
    }

    private async executePickUpIntention() {
        const parcelsPickedUp: Set<string> = await this.actuator.pickup();
        this._beliefs.updateCarriedParcelsAfterPickup(parcelsPickedUp);

        // After picking up parcels, regenerate intentions with a focus on delivery
        if (this._beliefs.isCarrying) {
            // Clear the intention queue and regenerate intentions
            this._intentionQueue.clear();
            this._generateNewIntentions(true); // Pass true to indicate we just picked up parcels
        }
    }

    private async executePutDownIntention() {
        // Get the carried parcels before dropping them to access their scores
        const carriedParcels = this._beliefs.carriedParcels;
        const parcelsToDrop: string[] = this._beliefs.carryingParcelIds;
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
        this._statsLogger.recordDelivery(droppedParcelIds, totalPointsEarned);

        // Update beliefs
        this._beliefs.updateDroppedParcels(parcelsDropped);

        // Unregister from the current delivery point to reduce congestion tracking
        this._beliefs.unregisterFromDeliveryPoint(this._beliefs.myPosition);
    }

    private calculateShortestPathFromMovingIntention(
        intention: Intention,
        positionsToAvoid: Position[] = [],
        resetFailures = true,
    ): boolean {
        let path: Position[] = this._beliefs.calculateMovingPath(
            intention.position,
            positionsToAvoid,
        );

        if (!path) {
            //Trying to calculate the path considering also the blocks
            path = this._beliefs.calculateMovingPath(
                intention.position,
                this._beliefs.getOccupiedPositions(),
            );

            if (!path) {
                //There is no way to reach the destination. Skipping the intention
                return false;
            }
        }

        const directions: Directions[] = [];

        for (let i = 0; i < path.length - 1; i++) {
            const direction: Directions = path[i].getDirection(path[i + 1]);
            if (direction) {
                directions.push(direction);
            } else {
                throw new Error(`Invalid step from ${path[i]} to ${path[i + 1]}`);
            }
        }

        intention.context = {
            directions,
            to: intention.position,
            from: this._beliefs.myPosition,
        };

        // Reset failures when we successfully calculate a new path
        resetFailures && intention.resetFailures();
        this._currentIntention = intention;

        return true;
    }

    private async goAheadWithChosenPlan(): Promise<boolean> {
        if (Intention.MOVING_INTENTIONS.includes(this._currentIntention?.type)) {
            if (this._currentIntention.context.directions?.length) {
                let nextDirection: Directions = this._currentIntention.context.directions.shift();
                const nextPosition: Position = this._beliefs.myPosition.moveTo(nextDirection);

                // Check if the next position is occupied by another agent
                if (this._beliefs.isPositionOccupied(nextPosition)) {
                    console.log(`Position ${nextPosition.toString()} is occupied by another agent`);

                    // Always count this as a failure for the intention
                    this._currentIntention.addFailure();

                    // For DELIVER intentions, be more aggressive about giving up
                    if (
                        this._currentIntention.type === IntentionTypes.DELIVER &&
                        this._currentIntention.getFailureCount() >= 2
                    ) {
                        console.log(
                            `Giving up on delivery intention after ${this._currentIntention.getFailureCount()} failures due to blocked path`,
                        );
                        this._beliefs.giveUpWithIntention(this._currentIntention);
                        this._intentionQueue.remove(this._currentIntention);
                        this._currentIntention = null;
                        return Promise.resolve(false);
                    }

                    // For other intentions, use the standard handler
                    if (
                        this.handleIntentionFailure(
                            this._currentIntention,
                            "Position occupied",
                            nextPosition,
                        )
                    ) {
                        this._currentIntention = null;
                        return Promise.resolve(false);
                    } else if (this._currentIntention.context.directions?.length) {
                        // Only try to get the next direction if there are directions left
                        nextDirection = this._currentIntention.context.directions.shift();
                    } else {
                        // If no directions left, recalculate path
                        if (
                            !this.calculateShortestPathFromMovingIntention(this._currentIntention, [
                                nextPosition,
                            ])
                        ) {
                            // If recalculation fails, give up
                            this.handleIntentionFailure(
                                this._currentIntention,
                                "Cannot recalculate path",
                            );
                            this._currentIntention = null;
                            return Promise.resolve(false);
                        }
                        return Promise.resolve(true); // Try again next cycle with new path
                    }
                }

                if (this._beliefs.isAgentOnDeliveryTile() && this._beliefs.isCarrying) {
                    await this.executePutDownIntention();

                    // If we're executing a DELIVER intention and we've reached the delivery point and put down parcels,
                    // mark the intention as completed
                    if (
                        this._currentIntention &&
                        this._currentIntention.type === IntentionTypes.DELIVER
                    ) {
                        this._currentIntention = null;
                        // Force recalculation of intentions after completing a delivery
                        this._checkAndRecalculateIntentions(true);
                        return Promise.resolve(true);
                    }
                }

                if (this._beliefs.isAgentOnFreeParcel()) {
                    await this.executePickUpIntention();
                }

                if (nextDirection) {
                    const moveSuccess = await this.actuator.move(nextDirection);

                    // If move fails, handle the failure
                    if (!moveSuccess && this._currentIntention) {
                        this.handleIntentionFailure(this._currentIntention, "Move action failed");
                    }

                    return moveSuccess;
                }
            } else {
                //Moving plan has been completed
                this._currentIntention = null;
            }

            return Promise.resolve(false);
        }

        return Promise.resolve(true);
    }

    /**
     * Centralized method to handle intention failures
     * @param intention The intention that failed
     * @param reason Optional reason for the failure
     * @param occupiedPosition Optional position that caused the failure
     * @returns True if the intention should be abandoned, false otherwise
     */
    private handleIntentionFailure(
        intention: Intention,
        reason?: string,
        occupiedPosition?: Position,
    ): boolean {
        if (!intention) return false;

        intention.addFailure();

        // Special handling for DELIVER intentions
        if (intention.type === IntentionTypes.DELIVER) {
            const isAgentBlocking = reason === "Position occupied";

            // Only try to recalculate path for agent blocking with few failures
            if (isAgentBlocking && intention.getFailureCount() < 3) {
                console.log("Agent blocking delivery path, trying alternative route...");

                const occupiedPositions: Position[] = occupiedPosition ? [occupiedPosition] : [];
                const success = this.calculateShortestPathFromMovingIntention(
                    intention,
                    occupiedPositions,
                    false,
                );
                if (success) {
                    return false; // Don't give up on the intention yet
                }
            }

            // In all other cases for DELIVER intentions, give up
            // This includes: non-agent blocking failures, too many failures, or path recalculation failed
            console.log(
                `Giving up on delivery intention after ${intention.getFailureCount()} failures`,
            );
            this._beliefs.giveUpWithIntention(intention);
            this._intentionQueue.remove(intention);
            this._checkAndRecalculateIntentions();
            return true;
        }
        // Handle MOVE intentions
        else if (intention.type === IntentionTypes.MOVE && intention.getFailureCount() >= 2) {
            // For move intentions, be a bit more persistent but still give up earlier
            this._beliefs.giveUpWithIntention(intention);

            // Remove this intention from the queue if it exists there
            this._intentionQueue.remove(intention);

            // Check if we need to recalculate intentions
            this._checkAndRecalculateIntentions();
            return true;
        }

        // For other intentions, use the standard threshold
        else if (intention.shouldGiveUp()) {
            this._beliefs.giveUpWithIntention(intention);

            // Remove this intention from the queue if it exists there
            this._intentionQueue.remove(intention);

            // Check if we need to recalculate intentions
            this._checkAndRecalculateIntentions();
            return true;
        }

        return false;
    }

    /**
     * Generates new intentions based on the agent's current beliefs and adds them to the intention queue
     * @private
     * @param justPickedUp Optional flag indicating if we just picked up parcels, to prioritize delivery
     */
    private _generateNewIntentions(justPickedUp = false): void {
        // Clear the queue before generating new intentions
        this._intentionQueue.clear();

        // Generate intentions based on the agent's current state
        const isCarrying: boolean = this._beliefs.isCarrying;

        if (isCarrying) {
            // If carrying parcels, prioritize delivery
            // Get all delivery tiles from the map
            const allDeliveryTiles = this._beliefs.map
                .getDeliveryTiles()
                .map((tile) => tile.position);

            // Sort delivery points by congestion score (lower is better)
            const sortedDeliveryPoints = allDeliveryTiles
                .map((position) => {
                    const distance = this._beliefs.map.distanceIfPossible(
                        this._beliefs.myPosition,
                        position,
                    );
                    if (distance === null) return null;

                    // Calculate congestion score using the public method
                    const congestionScore = this._beliefs.calculateDeliveryPointCongestionScore(
                        position,
                        distance,
                    );

                    return {
                        position,
                        score: congestionScore,
                    };
                })
                .filter(Boolean)
                .sort((a, b) => a.score - b.score);

            // Create DELIVER intentions for all delivery points with descending priorities
            for (let i = 0; i < sortedDeliveryPoints.length; i++) {
                const deliveryPoint = sortedDeliveryPoints[i];

                // Skip if we're already at this delivery point
                if (deliveryPoint.position.equals(this._beliefs.myPosition)) {
                    // If we're already at a delivery point, create a PUT_DOWN intention instead
                    const putDownIntention = Intention.putDown(deliveryPoint.position);
                    const priorityBonus = justPickedUp ? 10 : 0; // Higher priority if we just picked up
                    this._intentionQueue.add(
                        putDownIntention,
                        IntentionQueue.getDefaultPriority(IntentionTypes.PUT_DOWN) + priorityBonus,
                    );
                    continue;
                }

                // Create a DELIVER intention with priority based on ranking
                const deliverIntention = Intention.deliver(deliveryPoint.position);

                // Base priority is DELIVER, with bonus for being higher in the ranking
                // First delivery point gets highest priority, then decreasing
                const rankingBonus = 10 - Math.min(10, i); // 10 for first, 9 for second, etc.
                const justPickedUpBonus = justPickedUp ? 10 : 0; // Extra bonus if we just picked up parcels
                this._intentionQueue.add(
                    deliverIntention,
                    IntentionQueue.getDefaultPriority(IntentionTypes.DELIVER) +
                        rankingBonus +
                        justPickedUpBonus,
                );
            }

            // If not carrying max parcels, check for additional valuable parcels nearby
            if (this._beliefs.carryingParcelIds?.length < GameConfiguration.maxCarryingParcels) {
                // Find the best delivery point (the one with highest priority)
                const bestDeliveryPoint =
                    sortedDeliveryPoints.length > 0 ? sortedDeliveryPoints[0].position : null;

                if (bestDeliveryPoint) {
                    // Look for additional valuable parcels on the way to delivery
                    const newParcel =
                        this._beliefs.findAdditionalParcelWorthToKeep(bestDeliveryPoint);
                    if (newParcel) {
                        if (newParcel.position.equals(this._beliefs.myPosition)) {
                            // If at parcel position, create pickup intention
                            const pickupIntention = Intention.pickUp(newParcel.position);
                            this._intentionQueue.add(
                                pickupIntention,
                                IntentionQueue.getDefaultPriority(IntentionTypes.PICK_UP),
                            );
                        } else {
                            // If not at parcel position, create move intention
                            const moveIntention = Intention.move(newParcel.position);
                            // Lower priority than delivery but higher than exploration
                            this._intentionQueue.add(
                                moveIntention,
                                IntentionQueue.getDefaultPriority(IntentionTypes.MOVE) - 10,
                            );
                        }
                    }
                }
            }
        } else {
            // If not carrying parcels, look for the best parcel to deliver
            const bestParcelPosition: PositionWithDistance = this._beliefs.bestParcelToDeliver;
            if (bestParcelPosition) {
                if (this._beliefs.myPosition?.equals(bestParcelPosition?.position)) {
                    //We can pickup the parcel
                    const pickupIntention = Intention.pickUp(bestParcelPosition.position);
                    this._intentionQueue.add(
                        pickupIntention,
                        IntentionQueue.getDefaultPriority(IntentionTypes.PICK_UP),
                    );
                } else {
                    //If not at parcel position, create move intention
                    const moveIntention = Intention.move(bestParcelPosition.position);
                    this._intentionQueue.add(
                        moveIntention,
                        IntentionQueue.getDefaultPriority(IntentionTypes.MOVE),
                    );
                }
            }
        }

        // Only add an exploration intention as a fallback if we don't already have one
        // This ensures we only have one EXPLORE intention at a time
        if (!this._intentionQueue.hasIntentionOfType(IntentionTypes.EXPLORE)) {
            const explorationSite: Position = this._beliefs.findBestExplorationSite();
            if (explorationSite) {
                const exploreIntention = Intention.explore(explorationSite);
                this._intentionQueue.add(
                    exploreIntention,
                    IntentionQueue.getDefaultPriority(IntentionTypes.EXPLORE),
                );
            }
        }
    }

    /**
     * Checks if intentions need to be recalculated based on current state
     * This helps prioritize more important intentions that may have become available
     * @private
     * @param forceRecalculate If true, always recalculate intentions regardless of conditions
     * @param justPickedUp If true, we just picked up a parcel, so prioritize delivery
     */
    private _checkAndRecalculateIntentions(forceRecalculate = false, justPickedUp = false): void {
        // Peek at the next intention in the queue
        const nextIntention = this._intentionQueue.peek();

        // Only recalculate if forced, or if next intention is EXPLORE, or if queue is empty
        if (forceRecalculate || !nextIntention || nextIntention.type === IntentionTypes.EXPLORE) {
            // Clear the queue and generate new intentions
            this._intentionQueue.clear();
            this._generateNewIntentions(justPickedUp);

            // If we just picked up a parcel, immediately add a DELIVER intention with high priority
            // This helps prevent loops by ensuring we move to delivery after pickup
            if (justPickedUp && this._beliefs.isCarrying) {
                const deliveryPoint = this._beliefs.findBestDelivery();
                if (deliveryPoint?.position) {
                    // If we're not already at the delivery point, create a DELIVER intention
                    if (!deliveryPoint.position.equals(this._beliefs.myPosition)) {
                        const deliverIntention = Intention.deliver(deliveryPoint.position);
                        // Use an even higher priority to ensure it's selected next
                        this._intentionQueue.add(
                            deliverIntention,
                            IntentionQueue.getDefaultPriority(IntentionTypes.DELIVER) + 10,
                        );
                    } else {
                        // If we're already at a delivery point, create a PUT_DOWN intention
                        const putDownIntention = Intention.putDown(deliveryPoint.position);
                        this._intentionQueue.add(
                            putDownIntention,
                            IntentionQueue.getDefaultPriority(IntentionTypes.PUT_DOWN) + 10,
                        );
                    }
                }
            }
        }
    }

    /**
     * Checks if an intention is still valid based on current beliefs
     * @param intention The intention to validate
     * @returns True if the intention is still valid
     * @private
     */
    private _isIntentionValid(intention: Intention): boolean {
        if (!intention) return false;

        // Check if the intention is still valid based on its type
        switch (intention.type) {
            case IntentionTypes.PICK_UP:
                // Check if there are still parcels at the target position
                return this._beliefs.isPositionWithParcels(intention.position);
            case IntentionTypes.DELIVER:
                // Check if we're still carrying parcels to deliver
                // Also check if we're already at a delivery point - if so, we should just put down parcels
                // rather than trying to move to another delivery point
                if (this._beliefs.isAgentOnDeliveryTile()) {
                    // If we're already at a delivery point, this DELIVER intention is no longer needed
                    // We'll execute a PUT_DOWN intention instead
                    return false;
                }
                return this._beliefs.isCarrying;
            case IntentionTypes.PUT_DOWN:
                // Check if we're still carrying parcels to put down
                return this._beliefs.isCarrying;
            default:
                return true;
        }
    }

    updateKnownParcels(parcels: Parcel[]): void {
        this._beliefs.queueParcelsSynchronization(parcels);
    }

    updateKnownAgents(agents: Agent[]): void {
        this._beliefs.queueAgentsSynchronization(agents);
    }

    updatePlayerPosition(position: Position) {
        this.playerInfo.position = new Position(position.row, position.column);
        this._beliefs.synchronizeMyPosition(this.playerInfo.position);
    }

    /**
     * Executes a handoff at the meeting position
     * @private
     */
    private async executeHandoff(): Promise<boolean> {
        const activeHandoff = this._handoffCoordinator.getActiveHandoff();
        if (!activeHandoff) return false;
        
        // Check if we've reached the meeting position
        if (!this._beliefs.myPosition.equals(activeHandoff.meetingPosition)) {
            return false;
        }
        
        // Check if we're the initiator or receiver
        const isInitiator = activeHandoff.initiatorId === this.playerInfo.id.serialize();
        
        if (isInitiator) {
            // We're giving parcels
            console.log(`Executing handoff as initiator at ${activeHandoff.meetingPosition}`);
            
            // Get the parcels to transfer
            const parcelsToTransfer = this._beliefs.carriedParcels.filter(parcel => 
                activeHandoff.parcelIds.includes(parcel.id)
            );
            
            if (parcelsToTransfer.length === 0) {
                console.log("No parcels to transfer in handoff");
                
                // Send failure confirmation
                await this.messenger.sendHandoffConfirm(
                    activeHandoff.receiverId,
                    activeHandoff.requestId,
                    activeHandoff.parcelIds,
                    false,
                    this._beliefs.myPosition
                );
                
                // Complete the handoff as failed
                this._handoffCoordinator.completeHandoff(activeHandoff.requestId, false);
                return true;
            }
            
            // Put down the parcels
            const parcelIdsToPutDown = parcelsToTransfer.map(parcel => parcel.id);
            const putDownResult = await this.actuator.putDown(parcelIdsToPutDown);
            
            if (putDownResult.size === 0) {
                console.log("Failed to put down parcels for handoff");
                
                // Send failure confirmation
                await this.messenger.sendHandoffConfirm(
                    activeHandoff.receiverId,
                    activeHandoff.requestId,
                    activeHandoff.parcelIds,
                    false,
                    this._beliefs.myPosition
                );
                
                // Complete the handoff as failed
                this._handoffCoordinator.completeHandoff(activeHandoff.requestId, false);
                return true;
            }
            
            // Update our beliefs
            this._beliefs.updateDroppedParcels(putDownResult);
            
            // Send success confirmation
            await this.messenger.sendHandoffConfirm(
                activeHandoff.receiverId,
                activeHandoff.requestId,
                Array.from(putDownResult),
                true,
                this._beliefs.myPosition
            );
            
            // Complete the handoff
            this._handoffCoordinator.completeHandoff(activeHandoff.requestId, true);
            
            console.log(`Successfully handed off parcels: ${Array.from(putDownResult).join(', ')}`);
            return true;
        } else {
            // We're receiving parcels
            console.log(`Executing handoff as receiver at ${activeHandoff.meetingPosition}`);
            
            // Check if there are parcels at our position to pick up
            if (!this._beliefs.isPositionWithParcels(this._beliefs.myPosition)) {
                console.log("No parcels to pick up at handoff position");
                return false;
            }
            
            // Pick up the parcels
            const pickupResult = await this.actuator.pickup();
            
            if (pickupResult.size === 0) {
                console.log("Failed to pick up parcels during handoff");
                return false;
            }
            
            // Update our beliefs
            this._beliefs.updateCarriedParcelsAfterPickup(pickupResult);
            
            console.log(`Successfully picked up parcels in handoff: ${Array.from(pickupResult).join(', ')}`);
            
            // Complete the handoff
            this._handoffCoordinator.completeHandoff(activeHandoff.requestId, true);
            
            return true;
        }
    }

    private shoutHelloMessage(): Promise<void> {
        const helloMessage: HelloMessage = MessageFactory.createHelloMessage(
            this.playerInfo.id.serialize(),
            this._beliefs.myPosition,
            this._beliefs.myScore,
        );

        return this.messenger.shoutHelloMessage(helloMessage)
    }
}
