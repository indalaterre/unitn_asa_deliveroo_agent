import {BeliefContainer} from "@domain/beliefs";
import type {Actuator} from "@domain/communication";
import type {Sensor} from "@domain/communication/sensor";
import type {MatchMap, PositionWithDistance} from "@domain/map";
import {type CryptoConfiguration, GameConfiguration, type Parcel} from "@domain/models";
import type {Agent} from "@domain/models/agent";
import {type Directions, Position} from "@domain/models/environment";
import {Intention, IntentionTypes} from "@domain/models/intention";
import {IntentionQueue} from "@domain/models/intention-queue";
import {StatisticsLogger} from "@domain/models/statistics-logger";
import type {PlayerInfo} from "@domain/player-info";
import {Cipher} from "@utils/cipher";

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

    public constructor(
        matchMap: MatchMap,
        initialParcels: Parcel[],
        sensor: Sensor,
        private actuator: Actuator,
        private readonly playerInfo: PlayerInfo,
        cryptoConfiguration: CryptoConfiguration,
    ) {
        this._cipher = new Cipher(cryptoConfiguration);
        this._beliefs = new BeliefContainer(playerInfo, matchMap);

        this.updateKnownParcels(initialParcels);
        sensor.onAgentSensing((agents: Agent[]) => this.updateKnownAgents(agents));
        sensor.onParcelDetected((parcels: Parcel[]) => this.updateKnownParcels(parcels));
        sensor.onPlayerPositionUpdate((position: Position) => this.updatePlayerPosition(position));
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
        
        await this._run();
    }

    stop(): void {
        this._isAlive = false;
        
        // Log final statistics when stopping
        console.log("\n"); // Add a newline before final stats
        this._statsLogger.logFinalStatistics();
        console.log(""); // Add a newline after final stats
    }

    /**
     * Checks if intentions need to be recalculated based on current state
     * This helps prioritize more important intentions that may have become available
     * @private
     * @param forceRecalculate If true, always recalculate intentions regardless of conditions
     * @param justPickedUp If true, we just picked up a parcel, so prioritize delivery
     */
    private _checkAndRecalculateIntentions(forceRecalculate: boolean = false, justPickedUp: boolean = false): void {
        // Peek at the next intention in the queue
        const nextIntention = this._intentionQueue.peek();
        
        // Only recalculate if forced, or if next intention is EXPLORE, or if queue is empty
        if (forceRecalculate || !nextIntention || nextIntention.type === IntentionTypes.EXPLORE) {
            // Clear the queue and generate new intentions
            this._intentionQueue.clear();
            this._generateNewIntentions();
            
            // If we just picked up a parcel, immediately add a DELIVER intention with high priority
            // This helps prevent loops by ensuring we move to delivery after pickup
            if (justPickedUp && this._beliefs.isCarrying) {
                const deliveryPoint = this._beliefs.findBestDelivery();
                if (deliveryPoint?.position) {
                    // If we're not already at the delivery point, create a DELIVER intention
                    if (!deliveryPoint.position.equals(this._beliefs.myPosition)) {
                        const deliverIntention = Intention.deliver(deliveryPoint.position);
                        // Use an even higher priority to ensure it's selected next
                        this._intentionQueue.add(deliverIntention, IntentionQueue.getDefaultPriority(IntentionTypes.DELIVER) + 10);
                    } else {
                        // If we're already at a delivery point, create a PUT_DOWN intention
                        const putDownIntention = Intention.putDown(deliveryPoint.position);
                        this._intentionQueue.add(putDownIntention, IntentionQueue.getDefaultPriority(IntentionTypes.PUT_DOWN) + 10);
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
    
    private async _run(): Promise<void> {
        while (this._isAlive) {
            await new Promise((resolve) => setImmediate(resolve));

            this._beliefs.synchronizeKnownAgents();
            this._beliefs.synchronizeKnownParcels();

            // Manage current intention
            if (!this._currentIntention) {
                this._generateNewIntentions();
                this._currentIntention = this._intentionQueue.poll();
            }

            // Execute intention
            if (this._currentIntention) {
                // Check if the intention is still valid
                if (!this._isIntentionValid(this._currentIntention)) {
                    this._currentIntention = null;
                    continue;
                }

                console.log(`Current intention: ${this._currentIntention.toString()}`)

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
                } else if (this._currentIntention.type === IntentionTypes.MOVE || 
                           this._currentIntention.type === IntentionTypes.EXPLORE || 
                           this._currentIntention.type === IntentionTypes.DELIVER) {
                    // MOVE, EXPLORE, DELIVER cases
                    if (!this._currentIntention.hasContext()) {
                        // Calculate path for the intention
                        if (!this.calculateShortestPathFromMovingIntention(this._currentIntention)) {
                            if (this.handleIntentionFailure(this._currentIntention, "No path found")) {
                                this._currentIntention = null;
                            }
                            continue;
                        }
                    }
                
                    // Execute one step of the plan
                    const success = await this.goAheadWithChosenPlan();
                    if (!success && this._currentIntention) {
                        if (this.handleIntentionFailure(this._currentIntention, "Plan execution failed")) {
                            this._currentIntention = null;
                        }
                    }
                    
                    // If we've reached the destination, check if we need to recalculate intentions
                    if (this._currentIntention && 
                        this._beliefs.myPosition.equals(this._currentIntention.position)) {
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
        resetFailures: boolean = true
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
                    if (this.handleIntentionFailure(this._currentIntention, "Position occupied", nextPosition)) {
                        this._currentIntention = null;
                        return Promise.resolve(false);
                    } else {
                        nextDirection = this._currentIntention.context.directions.shift();
                    }
                }

                if (this._beliefs.isAgentOnDeliveryTile() && this._beliefs.isCarrying) {
                    await this.executePutDownIntention();
                    
                    // If we're executing a DELIVER intention and we've reached the delivery point and put down parcels,
                    // mark the intention as completed
                    if (this._currentIntention && this._currentIntention.type === IntentionTypes.DELIVER) {
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
    private handleIntentionFailure(intention: Intention, reason?: string, occupiedPosition?: Position): boolean {
        if (!intention) return false;
        
        intention.addFailure();

        // Special handling for different intention types
        if (intention.type === IntentionTypes.DELIVER) {
            // For delivery intentions, check if failure is due to an agent
            const isAgentBlocking = reason === "Position occupied";

            // If an agent is blocking and this is the first or second failure,
            // don't give up yet - try to recalculate the path
            if (isAgentBlocking && intention.getFailureCount() < 3) {
                console.log("Agent blocking delivery path, trying alternative route...");

                //TODO: We need to fix the failures reset
                const occupiedPositions: Position[] = occupiedPosition ? [occupiedPosition] : [];
                const success = this.calculateShortestPathFromMovingIntention(intention, occupiedPositions, false);
                if (success) {
                    return false; // Don't give up on the intention yet
                }

                // If it's not an agent blocking or we've tried too many times or recalculation failed,
                // give up on this intention
                if (intention.hasFailed() || intention.getFailureCount() >= 3) {
                    this._beliefs.giveUpWithIntention(intention);
                    this._intentionQueue.remove(intention);
                    this._checkAndRecalculateIntentions();
                    return true;
                }
            }
        }
        if (intention.type === IntentionTypes.DELIVER && intention.hasFailed()) {
            // For delivery intentions, give up after the first failure
            this._beliefs.giveUpWithIntention(intention);
            
            // Remove this intention from the queue if it exists there
            this._intentionQueue.remove(intention);
            
            // Check if we need to recalculate intentions
            this._checkAndRecalculateIntentions();
            return true;
        } else if (intention.type === IntentionTypes.MOVE && intention.getFailureCount() >= 2) {
            // For move intentions, be a bit more persistent but still give up earlier
            this._beliefs.giveUpWithIntention(intention);
            
            // Remove this intention from the queue if it exists there
            this._intentionQueue.remove(intention);
            
            // Check if we need to recalculate intentions
            this._checkAndRecalculateIntentions();
            return true;
        }
        
        // For other intentions or if not enough failures yet, use the standard threshold
        if (intention.shouldGiveUp()) {
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
    private _generateNewIntentions(justPickedUp: boolean = false): void {
        // Clear the queue before generating new intentions
        this._intentionQueue.clear();
        
        // Generate intentions based on the agent's current state
        const isCarrying: boolean = this._beliefs.isCarrying;
        
        if (isCarrying) {
            // If carrying parcels, prioritize delivery
            // Get all delivery tiles from the map
            const allDeliveryTiles = this._beliefs.map.getDeliveryTiles().map(tile => tile.position);
            
            // Sort delivery points by congestion score (lower is better)
            const sortedDeliveryPoints = allDeliveryTiles
                .map(position => {
                    const distance = this._beliefs.map.distanceIfPossible(this._beliefs.myPosition, position);
                    if (distance === null) return null;
                    
                    // Calculate congestion score using the public method
                    const congestionScore = this._beliefs.calculateDeliveryPointCongestionScore(position, distance);
                    
                    return {
                        position,
                        score: congestionScore
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
                    this._intentionQueue.add(putDownIntention, IntentionQueue.getDefaultPriority(IntentionTypes.PUT_DOWN) + priorityBonus);
                    continue;
                }
                
                // Create a DELIVER intention with priority based on ranking
                const deliverIntention = Intention.deliver(deliveryPoint.position);
                
                // Base priority is DELIVER, with bonus for being higher in the ranking
                // First delivery point gets highest priority, then decreasing
                const rankingBonus = 10 - Math.min(10, i); // 10 for first, 9 for second, etc.
                const justPickedUpBonus = justPickedUp ? 10 : 0; // Extra bonus if we just picked up parcels
                this._intentionQueue.add(deliverIntention, 
                    IntentionQueue.getDefaultPriority(IntentionTypes.DELIVER) + rankingBonus + justPickedUpBonus);
            }
            
            // If not carrying max parcels, check for additional valuable parcels nearby
            if (this._beliefs.carryingParcelIds?.length < GameConfiguration.maxCarryingParcels) {
                // Find the best delivery point (the one with highest priority)
                const bestDeliveryPoint = sortedDeliveryPoints.length > 0 ? sortedDeliveryPoints[0].position : null;
                
                if (bestDeliveryPoint) {
                    // Look for additional valuable parcels on the way to delivery
                    const newParcel = this._beliefs.findAdditionalParcelWorthToKeep(bestDeliveryPoint);
                    if (newParcel) {
                        if (newParcel.position.equals(this._beliefs.myPosition)) {
                            // If at parcel position, create pickup intention
                            const pickupIntention = Intention.pickUp(newParcel.position);
                            this._intentionQueue.add(pickupIntention, IntentionQueue.getDefaultPriority(IntentionTypes.PICK_UP));
                        } else {
                            // If not at parcel position, create move intention
                            const moveIntention = Intention.move(newParcel.position);
                            // Lower priority than delivery but higher than exploration
                            this._intentionQueue.add(moveIntention, IntentionQueue.getDefaultPriority(IntentionTypes.MOVE) - 10);
                        }
                    }
                }
            }
        } else {
            // If not carrying parcels, look for the best parcel to deliver
            const bestParcelPosition: PositionWithDistance = this._beliefs.bestParcelToDeliver;
            if (bestParcelPosition) {
                if (this._beliefs.myPosition?.equals(bestParcelPosition?.position)) {
                    // If at parcel position, create pickup intention
                    const pickupIntention = Intention.pickUp(bestParcelPosition.position);
                    this._intentionQueue.add(pickupIntention, IntentionQueue.getDefaultPriority(IntentionTypes.PICK_UP));
                } else {
                    // If not at parcel position, create move intention
                    const moveIntention = Intention.move(bestParcelPosition.position);
                    this._intentionQueue.add(moveIntention, IntentionQueue.getDefaultPriority(IntentionTypes.MOVE));
                }
            }
        }
        
        // Only add an exploration intention as a fallback if we don't already have one
        // This ensures we only have one EXPLORE intention at a time
        if (!this._intentionQueue.hasIntentionOfType(IntentionTypes.EXPLORE)) {
            const explorationSite: Position = this._beliefs.findBestExplorationSite();
            if (explorationSite) {
                const exploreIntention = Intention.explore(explorationSite);
                this._intentionQueue.add(exploreIntention, IntentionQueue.getDefaultPriority(IntentionTypes.EXPLORE));
            }
        }
    }
    
    /**
     * Legacy method for compatibility - will be removed in future versions
     * @private
     */
    private _calculateNextAction(currentIntention: Intention, forceExploration = false): Intention {
        if (forceExploration) {
            //Evaluate the best position to explore
            const explorationSite: Position = this._beliefs.findBestExplorationSite();
            return Intention.explore(explorationSite);
        }

        const isCarrying: boolean = this._beliefs.isCarrying;
        if (isCarrying) {
            //TODO: this part could be optimized
            const closestDelivery: Position =
                currentIntention?.type === IntentionTypes.DELIVER
                    ? currentIntention.position
                    : this._beliefs.findBestDelivery()?.position;

            if (closestDelivery.equals(this._beliefs.myPosition)) {
                return Intention.putDown(closestDelivery);
            }

            //Let's check if we have good parcels nearby
            if (this._beliefs.carryingParcelIds?.length < GameConfiguration.maxCarryingParcels) {
                const newParcel: PositionWithDistance =
                    this._beliefs.findAdditionalParcelWorthToKeep(closestDelivery);
                if (newParcel) {
                    if (newParcel.position.equals(this._beliefs.myPosition)) {
                        return Intention.pickUp(newParcel.position);
                    } else {
                        return Intention.move(newParcel.position);
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
        this._beliefs.queueParcelsSynchronization(parcels);
    }

    updateKnownAgents(agents: Agent[]): void {
        this._beliefs.queueAgentsSynchronization(agents);
    }

    updatePlayerPosition(position: Position) {
        this.playerInfo.position = new Position(position.row, position.column);
        this._beliefs.synchronizeMyPosition(this.playerInfo.position);
    }
}
