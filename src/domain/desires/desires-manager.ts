import type { BeliefContainer } from "@domain/beliefs";
import { Desire, DesirePriorities, DesireTypes } from "@domain/desires/desire";
import type { PositionWithDistance } from "@domain/map";
import { GameConfiguration, type Parcel } from "@domain/models";
import type { Position } from "@domain/models/environment";
import { PriorityQueue } from "@domain/models/priority-queue";
import type { HashMap } from "@utils/hashmap";
import { HashSet } from "@utils/hashset";
import { InternalEventManager } from "@utils/internal-event-manager";

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
     * @param beliefs            The agent's beliefs
     */
    constructor(private readonly beliefs: BeliefContainer) {}

    /**
     * Generates new desires only in case there are no actions to be taken
     */
    async generateDesiresIfWaiting(): Promise<void> {
        if (this._activeDesires.size > 0) return;
        return this.generateDesires();
    }

    /**
     * Generates desires based on the current beliefs
     */
    async generateDesires(): Promise<void> {
        // Generate desires based on current state

        // Use PDDL-based pickup desires generation if enabled
        if (GameConfiguration.usePddl) {
            if (
                !this._activeDesires.size ||
                (this._activeDesires.size === 1 && this._activeDesires.peek()?.isExplore)
            ) {
                await this.generatePickupDesiresWithPDDL();
            }
        } else {
            this.generateDeliveryDesires();
            this.generatePickupDesires();
        }

        this.generateExplorationDesires();

        this._activeDesires.size
            && InternalEventManager.emit("desires:updated", this._activeDesires.toArray());
    }

    private generateDeliveryDesireToPosition(deliveryPosition: Position): void {
        // Only generate delivery desires if carrying parcels
        if (!deliveryPosition) {
            return;
        }

        const desirePriority: DesirePriorities =
            this.beliefs.carryingParcelIds?.length &&
            deliveryPosition.equals(this.beliefs.myPosition)
                ? DesirePriorities.PRIORITY_DELIVERY // This has a highest priority
                : DesirePriorities.DELIVERY;

        const putDownDesire: Desire = Desire.deliverParcel(
            desirePriority,
            deliveryPosition,
            this.beliefs.carryingParcelIds,
        );

        this._activeDesires.add(putDownDesire, putDownDesire.priority);
    }

    /**
     * Generates desires to deliver parcels
     * @private
     */
    private generateDeliveryDesires(): void {
        // Find the best delivery point
        const deliveryPoint: PositionWithDistance = this.beliefs.findBestDelivery();
        if (!deliveryPoint?.position) {
            return;
        }

        return this.generateDeliveryDesireToPosition(deliveryPoint.position);
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

        const pickupDesire: Desire = Desire.pickupParcel(
            bestParcel.position.equals(this.beliefs.myPosition)
                ? DesirePriorities.PRIORITY_PICKUP // Highest priority
                : DesirePriorities.PICKUP, // Medium priority
            bestParcel.position,
            (bestParcel.context.parcel as Parcel).id,
        );

        this._activeDesires.add(pickupDesire, pickupDesire.priority);
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
        const parcelsToPickup: HashMap<Position, PositionWithDistance[]> =
            await this.beliefs.generatePickupParcelsWithPDDL();

        // If no parcels found, return
        if (parcelsToPickup?.isEmpty) {
            return;
        }

        // Generate desires for each parcel, with priority based on their order in the plan
        for (const [delivery, pickUps] of parcelsToPickup.entries()) {
            const parcelIds: string[] = [];
            for (const parcel of pickUps) {
                parcelIds.push(parcel.context.parcel.id);

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

                    const moveDesire: Desire = Desire.pickupParcel(
                        priority,
                        parcel.position,
                        parcel.context.parcel.id,
                    );
                    this._activeDesires.add(moveDesire, moveDesire.priority);
                }
            }

            if (!parcelIds?.length) continue;
            this.generateDeliveryDesireToPosition(delivery);
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

    generatePickupHandoffDesire(parcelIds: string[], meetingPosition: Position, benefit = 0): void {
        const pickUpHandoffDesire: Desire = Desire.pickupHandoff(
            // benefit will influence the priority
            DesirePriorities.HANDOFF_PRIORITY - benefit,
            parcelIds,
            meetingPosition,
        );

        this._activeDesires.add(pickUpHandoffDesire, pickUpHandoffDesire.priority);
        InternalEventManager.emit("desires:updated", this._activeDesires.toArray());
    }
}
