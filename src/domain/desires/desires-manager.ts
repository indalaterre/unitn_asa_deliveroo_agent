import type { PositionWithDistance } from "@domain/map";
import { type Agent, GameConfiguration, type Parcel } from "@domain/models";
import { PriorityQueue } from "@domain/models/priority-queue";
import { HashSet } from "@utils/hashset";
import { InternalEventManager } from "@utils/internal-event-manager";
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
    private _activeDesires: PriorityQueue<DesireTypes, Desire> = new PriorityQueue();

    /**
     * Set of desires that have been tried but failed
     * @private
     */
    private _failedDesires: HashSet<Desire> = new HashSet();

    /**
     * Creates a new desires manager
     * @param beliefs The agent's beliefs
     */
    constructor(private readonly beliefs: BeliefContainer) {}

    /**
     * Generates desires based on the current beliefs
     */
    async generateDesires(): Promise<void> {
        // Generate desires based on current state
        this.generateDeliveryDesires();

        // Use PDDL-based pickup desires generation if enabled
        if (GameConfiguration.usePddl) {
            if (
                !this._activeDesires.size ||
                (this._activeDesires.size === 1 && this._activeDesires.peek()?.isExplore)
            ) {
                await this.generatePickupDesiresWithPDDL();
            }
        } else {
            this.generatePickupDesires();
        }

        //this.generateExplorationDesires();
        InternalEventManager.emit("desires:updated", this._activeDesires.toArray());
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
        if (
            this.beliefs.carryingParcelIds?.length &&
            deliveryPoint.position.equals(this.beliefs.myPosition)
        ) {
            const putDownDesire = Desire.putDownParcel(
                DesirePriorities.PRIORITY_DELIVERY, // High priority
                deliveryPoint.position,
                this.beliefs.carryingParcelIds,
            );

            this._activeDesires.add(putDownDesire, putDownDesire.priority);
        } else {
            // Check if a handoff would be beneficial
            const potentialHandoffPartner = this.evaluatePotentialHandoffPartners();

            if (potentialHandoffPartner) {
                // Create a DELIVER desire with handoff context
                const { agentId, meetingPosition, benefit } = potentialHandoffPartner;

                // Create context with both parcel IDs and handoff information
                const context = {
                    parcelIds: this.beliefs.carryingParcelIds,
                    handoff: {
                        partnerId: agentId,
                        meetingPosition: meetingPosition,
                        benefit: benefit,
                    },
                };

                // Create the desire with the combined context
                const deliverDesire: Desire = new Desire(
                    DesireTypes.DELIVER_PARCEL,
                    Math.min(85, 60 + Math.floor(benefit / 5)), // Priority based on benefit
                    deliveryPoint.position,
                    context,
                );

                this._activeDesires.add(deliverDesire, deliverDesire.priority);
            } else {
                // Standard delivery desire without handoff
                const deliverDesire: Desire = Desire.deliverParcel(
                    DesirePriorities.DELIVERY, // Medium-high priority
                    deliveryPoint.position,
                    this.beliefs.carryingParcelIds,
                );

                this._activeDesires.add(deliverDesire, deliverDesire.priority);
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

            this._activeDesires.add(pickupDesire, pickupDesire.priority);
        } else {
            // Otherwise, generate MOVE desire to get to the parcel
            const moveDesire = Desire.pickupParcel(
                DesirePriorities.PICKUP, // Medium priority
                bestParcel.position,
                (bestParcel.context.parcel as Parcel).id,
            );

            this._activeDesires.add(moveDesire, moveDesire.priority);
        }
    }

    private evaluateDetourPickups(): void {
        const currentDeliveryDesire: Desire = this._activeDesires
            .toArray()
            .find((desire: Desire) => desire.type === DesireTypes.DELIVER_PARCEL);

        if (!currentDeliveryDesire) {
            return;
        }

        const additionalParcel: PositionWithDistance =
            this.findAdditionalParcelsToKeep(currentDeliveryDesire);
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

            this._activeDesires.add(detourDesire, detourDesire.priority);
        }
    }

    /**
     * Generates pickup desires using Fast Downward planner to determine optimal parcels to pick up
     * These leverages the enhanced planning system with multiple package handling,
     * score decay, and balanced metrics.
     * @private
     */
    private async generatePickupDesiresWithPDDL(): Promise<void> {
        // Skip if already carrying maximum parcels
        if (this.beliefs.carriedParcels.length >= GameConfiguration.maxSpawnableParcels) {
            return;
        }

        // Find the best delivery point to use as a target
        const bestDelivery: PositionWithDistance = this.beliefs.findBestDelivery();
        if (!bestDelivery?.position) {
            return;
        }

        // Use Fast Downward planner to find parcels worth picking up en route to delivery
        const parcelsToPickup: PositionWithDistance[] =
            await this.beliefs.generatePickupParcelsWithPDDL();

        // If no parcels found, return
        if (!parcelsToPickup?.length) {
            return;
        }

        // Generate desires for each parcel, with priority based on their order in the plan
        for (const parcel of parcelsToPickup) {
            // If already at parcel position, generate high priority PICKUP desire
            if (parcel.position.equals(this.beliefs.myPosition)) {
                const pickupDesire: Desire = Desire.pickupParcel(
                    DesirePriorities.PRIORITY_PICKUP, // Highest priority
                    parcel.position,
                    parcel.context.parcel.id,
                );
                this._activeDesires.add(pickupDesire, pickupDesire.priority);
            } else {
                // Calculate priority based on pickup order, net benefit, and action type
                // Earlier pickups and higher net benefits get higher priority
                // Regular pick-up actions are prioritized over pick-up-any actions
                const orderFactor = Math.max(5 - parcel.context.pickupOrder, 0); // 4, 3, 2, 1, 0 for orders 1-5+
                const benefitFactor = Math.floor(parcel.context.netBenefit / 10);
                const actionBonus = parcel.context.action === "pick-up" ? 5 : 0;

                const priority = Math.min(
                    DesirePriorities.PICKUP + orderFactor + benefitFactor + actionBonus,
                    DesirePriorities.PRIORITY_PICKUP - 1,
                );

                const moveDesire = Desire.pickupParcel(
                    priority,
                    parcel.position,
                    parcel.context.parcel.id,
                );
                this._activeDesires.add(moveDesire, moveDesire.priority);
            }
        }
    }

    private findAdditionalParcelsToKeep(currentDeliveryDesire: Desire): PositionWithDistance {
        return this.beliefs.findAdditionalParcelWorthToKeep(currentDeliveryDesire.position);
    }

    // Handoff is now handled as part of the DELIVER_PARCEL desire generation

    /**
     * Generates desires to explore the environment
     * @private
     */
    generateExplorationDesires(): void {
        if (this._activeDesires.hasElementOfType(DesireTypes.EXPLORE_ENVIRONMENT)) {
            return;
        }

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

            this._activeDesires.add(exploreDesire, exploreDesire.priority);
            InternalEventManager.emit("desires:updated", this._activeDesires.toArray());
        }
    }

    /**
     * Gets all active desires
     * @returns Array of active desires
     */
    getAllDesires(): Desire[] {
        return this._activeDesires.toArray();
    }

    /**
     * The first desire in the queue
     */
    getTopDesire(): Desire {
        return this._activeDesires.poll();
    }

    /**
     * Marks a desire as failed
     * @param desire The desire that failed
     */
    markDesireAsFailed(desire: Desire): void {
        this._failedDesires.add(desire);

        // Remove from active desires
        this._activeDesires.remove(desire);

        // Emit event that a desire has failed
        InternalEventManager.emit("desire:failed", desire);
    }

    generateHandoffDesire(requestId: string, meetingPosition: Position): void {}
}
