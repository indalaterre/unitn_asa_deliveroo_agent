import type { PositionWithDistance } from "@domain/map";
import { type Parcel } from "@domain/models";
import { EventEmitter } from "eventemitter3";
import { HashSet } from "@utils/hashset";
import type { BeliefContainer } from "../beliefs";
import type { Position } from "../models/environment";
import { Desire, DesirePriorities, DesireTypes } from "./desire";

/**
 * Manages the agent's desires
 * Responsible for generating desires based on current beliefs
 */
export class DesiresManager {
    /**
     * The current active desires
     * @private
     */
    private _activeDesires: Desire[] = [];

    /**
     * Set of desires that have been tried but failed
     * @private
     */
    private _failedDesires: HashSet<Desire> = new HashSet();

    /**
     * Event emitter for notifying changes to desires
     * @private
     */
    private readonly _eventEmitter: EventEmitter = new EventEmitter();

    /**
     * Creates a new desires manager
     * @param beliefs The agent's beliefs
     */
    constructor(private readonly beliefs: BeliefContainer) {}

    /**
     * Generates desires based on the current beliefs
     */
    generateDesires(): void {
        // Clear current desires
        this._activeDesires = [];

        // Generate desires based on current state
        this.generateDeliveryDesires();
        this.generatePickupDesires();
        this.generateHandoffDesires();
        this.generateExplorationDesires();

        // Emit event that desires have been updated
        this._eventEmitter.emit("desires:updated", this._activeDesires);
    }

    /**
     * Generates desires to deliver parcels
     * @private
     */
    private generateDeliveryDesires(): void {
        // Only generate delivery desires if carrying parcels
        if (!this.beliefs.isCarrying) {
            return;
        }

        // Find the best delivery point
        const deliveryPoint = this.beliefs.findBestDelivery();
        if (!deliveryPoint?.position) {
            return;
        }

        // If already at delivery point, generate PUT_DOWN desire
        if (deliveryPoint.position.equals(this.beliefs.myPosition)) {
            const putDownDesire = Desire.putDownParcel(
                90, // High priority
                deliveryPoint.position,
                this.beliefs.carryingParcelIds,
            );

            this._activeDesires.push(putDownDesire);
        } else {
            // Otherwise, generate DELIVER desire
            const deliverDesire: Desire = Desire.deliverParcel(
                80, // Medium-high priority
                deliveryPoint.position,
                this.beliefs.carryingParcelIds,
            );

            this._activeDesires.push(deliverDesire);
        }
    }

    /**
     * Generates desires to pick up parcels
     * @private
     */
    private generatePickupDesires(): void {
        // Find the best parcel to pick up
        if (this.beliefs.isCarrying) {
            //We need to evaluate additional opportunistic pickups
            this.evaluateDetourPickups();
        }

        const bestParcel: PositionWithDistance = this.beliefs.bestParcelToDeliver;
        if (!bestParcel?.position) {
            return;
        }

        // If already at parcel position, generate PICKUP desire
        if (bestParcel.position.equals(this.beliefs.myPosition)) {
            const pickupDesire: Desire = Desire.pickupParcel(
                DesirePriorities.PRIORITY_PICKUP, // Highest priority
                bestParcel.position,
                (bestParcel.context.parcel as Parcel).id,
            );

            this._activeDesires.push(pickupDesire);
        } else {
            // Otherwise, generate MOVE desire to get to the parcel
            const moveDesire = Desire.pickupParcel(
                DesirePriorities.PICKUP, // Medium priority
                bestParcel.position,
                (bestParcel.context.parcel as Parcel).id,
            );

            this._activeDesires.push(moveDesire);
        }
    }

    private evaluateDetourPickups(): void {
        const currentDeliveryDesire: Desire = this._activeDesires.find(
            (desire: Desire) => desire.type === DesireTypes.DELIVER_PARCEL,
        );

        if (!currentDeliveryDesire) {
            return;
        }

        const additionalParcel: PositionWithDistance = this.beliefs.findAdditionalParcelWorthToKeep(
            currentDeliveryDesire.position,
        );
        if (additionalParcel) {
            const netBenefit: number = additionalParcel.context.netBenefit;
            const detourDesire: Desire = Desire.pickupParcel(
                // Priority based on net benefit, but adjusted to be competitive
                // Higher net benefit = higher priority
                Math.min(
                    DesirePriorities.PICKUP + Math.floor(netBenefit / 10),
                    DesirePriorities.PRIORITY_PICKUP - 5,
                ),
                additionalParcel.position,
                additionalParcel.context.parcel.id,
            );

            this._activeDesires.push(detourDesire);
            this._eventEmitter.emit("desires:updated", this._activeDesires);
        }
    }

    /**
     * Generates desires to hand off parcels
     * @private
     */
    private generateHandoffDesires(): void {
        // Only generate handoff desires if carrying parcels
        if (!this.beliefs.isCarrying) {
            return;
        }

        // Find potential handoff partners
        const agents = this.beliefs.getTrustedAgents();

        // Evaluate each agent as a potential handoff partner
        for (const agent of agents) {
            // Skip if agent is not trusted
            if (!this.beliefs.isTrustedAgent(agent.agentId)) {
                continue;
            }

            // Calculate benefit of handoff
            const handoffBenefit: number = this.beliefs.evaluateHandoffBenefit(agent.agentId);

            // Only consider handoff if beneficial
            if (handoffBenefit <= 0) {
                continue;
            }

            // Calculate meeting position (midpoint between agents)
            const handoffPaths: Position[][] = this.beliefs.calculateMeetingPointPaths(
                agent.position,
            );

            //We need paths calculation here
            const meetingPosition: Position = handoffPaths[1][0];

            // Create handoff desire with priority based on benefit
            const handoffDesire: Desire = Desire.handoffParcel(
                Math.min(85, 60 + Math.floor(handoffBenefit / 5)), // Priority based on benefit
                meetingPosition,
                this.beliefs.carryingParcelIds,
                agent.agentId,
            );

            this._activeDesires.push(handoffDesire);
        }
    }

    /**
     * Generates desires to explore the environment
     * @private
     */
    private generateExplorationDesires(): void {
        // Find promising exploration points
        const explorationPoint: Position = this.beliefs.findBestExplorationSite();
        if (!explorationPoint) {
            return;
        }

        // Create exploration desire with the lowest priority
        const exploreDesire: Desire = Desire.exploreEnvironment(
            DesirePriorities.EXPLORATION,
            explorationPoint,
        );
        this._activeDesires.push(exploreDesire);
    }

    /**
     * Gets all active desires
     * @returns Array of active desires
     */
    getAllDesires(): Desire[] {
        return [...this._activeDesires];
    }

    /**
     * Gets all active desires
     * @returns Array of active desires
     */
    getAllRankedDesires(): Desire[] {
        return this._activeDesires.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Gets the highest priority desire
     * @returns The highest priority desire, or null if none
     */
    getHighestPriorityDesire(): Desire | null {
        if (this._activeDesires.length === 0) {
            return null;
        }

        // Sort by priority (descending) and return the first
        return this.getAllRankedDesires()[0];
    }

    /**
     * Gets desires of a specific type
     * @param type The type of desires to get
     * @returns Array of desires of the specified type
     */
    getDesiresByType(type: DesireTypes): Desire[] {
        return this._activeDesires.filter((desire) => desire.type === type);
    }

    /**
     * Marks a desire as failed
     * @param desire The desire that failed
     */
    markDesireAsFailed(desire: Desire): void {
        this._failedDesires.add(desire);

        // Remove from active desires
        this._activeDesires = this._activeDesires.filter((d) => !d.equals(desire));

        // Emit event that a desire has failed
        this._eventEmitter.emit("desire:failed", desire);
    }

    /**
     * Checks if a desire has failed
     * @param desire The desire to check
     * @returns True if the desire has failed, false otherwise
     */
    hasDesireFailed(desire: Desire): boolean {
        return this._failedDesires.has(desire);
    }

    /**
     * Clears all failed desires
     */
    clearFailedDesires(): void {
        this._failedDesires.clear();
    }

    /**
     * Registers an event listener
     * @param event The event to listen for
     * @param listener The listener function
     */
    on(event: string, listener: (...args: any[]) => void): void {
        this._eventEmitter.on(event, listener);
    }
}
