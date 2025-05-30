import type { PositionWithDistance } from "@domain/map";
import type { Agent, Parcel } from "@domain/models";
import { HashSet } from "@utils/hashset";
import { EventEmitter } from "eventemitter3";
import type { BeliefContainer } from "../beliefs";
import type { Position } from "../models/environment";
import { Desire, DesirePriorities, DesireTypes } from "./desire";
import { HandoffCoordinator } from "@domain/models/handoff-coordinator";

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
    constructor(
        private readonly beliefs: BeliefContainer,
        private readonly handoffCordinator: HandoffCoordinator
    ) {}

    /**
     * Generates desires based on the current beliefs
     */
    generateDesires(): void {
        // Clear current desires
        //this._activeDesires = this._activeDesires.filter(desire => {
        //    if (desire.type === DesireTypes.PICKUP_HANDOFF && desire.context?.timeToMeet > Date.now()) {
        //        return true;
        //    }
//
        //    return false;
        //});
        this._activeDesires = [];

        // Generate desires based on current state
        this.generateDeliveryDesires();
        this.generatePickupDesires();
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
        const deliveryPoint: PositionWithDistance = this.beliefs.findBestDelivery();
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
            // Check if a handoff would be beneficial
            const potentialHandoffPartner = this.evaluatePotentialHandoffPartners();

            if (potentialHandoffPartner) {
                // Create a PutDownHandoff desire with handoff context
                const { agentId, meetingPosition, benefit } = potentialHandoffPartner;
                this.generatePutDownHandoffDesire(agentId, this.beliefs.carryingParcelIds, meetingPosition, benefit);
            } else {
                // Standard delivery desire without handoff
                const deliverDesire: Desire = Desire.deliverParcel(
                    80, // Medium-high priority
                    deliveryPoint.position,
                    this.beliefs.carryingParcelIds,
                );

                this._activeDesires.push(deliverDesire);
            }
        }
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

            // Calculate benefit of handoff
            const handoffBenefit = this.beliefs.evaluateHandoffBenefit(agent.agentId);

            // Only consider handoff if beneficial and better than current best
            if (handoffBenefit > 0 && handoffBenefit > maxBenefit) {
                // Calculate meeting position (midpoint between agents)
                const handoffPaths: Position[][] = this.beliefs.calculateMeetingPointPaths(
                    agent.position,
                );

                if (handoffPaths?.length >= 2 && handoffPaths[1].length > 0) {
                    const meetingPosition: Position = handoffPaths[1][0];

                    bestPartner = {
                        agentId: agent.agentId,
                        meetingPosition: meetingPosition,
                        benefit: handoffBenefit,
                    };

                    maxBenefit = handoffBenefit;
                }
            }
        }

        return bestPartner;
    }

    /**
     * Generates desires to pick up parcels
     * @private
     */
    private generatePickupDesires(): void {

        if (this.handoffCordinator.hasActiveHandoff()) {
            const activeHandoff = this.handoffCordinator.getActiveHandoff();
            if (activeHandoff.receiverId === this.beliefs.myId) {
                console.log("PORCO generatePickupDesires generatePickupHandoffDesire")
                this.generatePickupHandoffDesire(
                    activeHandoff.requestId,
                    activeHandoff.initiatorId,
                    activeHandoff.parcelIds,
                    activeHandoff.meetingPosition,
                    activeHandoff.timeToMeet,
                );
            }
        }

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

    // Handoff is now handled as part of the DELIVER_PARCEL desire generation

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

        //Checking if exploration is possible
        const explorationPath: Position[] = this.beliefs.calculateMovingPath(
            explorationPoint,
            this.beliefs.getOccupiedPositions(),
        );
        if (explorationPath?.length) {
            // Create exploration desire with the lowest priority
            const exploreDesire: Desire = Desire.exploreEnvironment(
                DesirePriorities.EXPLORATION,
                explorationPoint,
            );

            this._activeDesires.push(exploreDesire);
        }
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

    generatePickupHandoffDesire(requestId: string, partnerId: string, parcelIds: string[], meetingPosition: Position, benefit: number=0): void {
        // Create pickup handoff desire with the highest priority
        const pickUpHandoffDesire: Desire = Desire.pickupHandoff(
            DesirePriorities.HANDOFF_PRIORITY,
            requestId,
            partnerId,
            parcelIds,
            meetingPosition
        );

        this._activeDesires.push(pickUpHandoffDesire);

        console.log(`generatePickupHandoffDesire`);
    }

    generatePutDownHandoffDesire(partnerId: string, parcelIds: string[], meetingPosition: Position, benefit: number=0): void {
        // Create pickup handoff desire with the highest priority
        const putDownHandoffDesire: Desire = Desire.putDownHandoff(
            DesirePriorities.HANDOFF_PRIORITY,
            partnerId,
            parcelIds,
            meetingPosition
        );

        this._activeDesires.push(putDownHandoffDesire);

        console.log(`generatePutDownHandoffDesire`);
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
