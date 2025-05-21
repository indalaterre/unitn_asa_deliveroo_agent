import { AbstractHashable } from "@utils/abstract-hashable";
import type { Hashable } from "@utils/interfaces";
import type { Position } from "../models/environment";

/**
 * The priority of a desire
 */
export enum DesirePriorities {
    HANDOFF_PRIORITY = 110,
    PRIORITY_PICKUP = 100,
    PICKUP = 80,
    EXPLORATION = 50,
}

/**
 * Types of desires an agent can have
 */
export enum DesireTypes {
    DELIVER_PARCEL = "DELIVER_PARCEL",
    PICKUP_PARCEL = "PICKUP_PARCEL",
    EXPLORE_ENVIRONMENT = "EXPLORE_ENVIRONMENT",
    PUT_DOWN_PARCEL = "PUT_DOWN_PARCEL",
    PICKUP_HANDOFF = "PICKUP_HANDOFF",
    PUT_DOWN_HANDOFF = "PUT_DOWN_HANDOFF",
}

/**
 * Represents a desire - something the agent wants to achieve
 */
export class Desire extends AbstractHashable implements Hashable {
    /**
     * Creates a new desire
     * @param type The type of desire
     * @param priority The priority of the desire (higher values = higher priority)
     * @param position The position associated with this desire, if any
     * @param context Additional context for the desire
     */
    constructor(
        public readonly type: DesireTypes,
        public readonly priority: number,
        public readonly position?: Position,
        public readonly context?: any,
    ) {
        super();
    }

    /**
     * Creates a desire to deliver parcels to a delivery point
     * @param priority The priority of the desire
     * @param position The position of the delivery point
     * @param parcelIds The IDs of the parcels to deliver
     */
    static deliverParcel(priority: number, position: Position, parcelIds: string[]): Desire {
        return new Desire(DesireTypes.DELIVER_PARCEL, priority, position, { parcelIds });
    }

    /**
     * Creates a desire to pick up a parcel
     * @param priority The priority of the desire
     * @param position The position of the parcel
     * @param parcelId The ID of the parcel to pick up
     */
    static pickupParcel(priority: number, position: Position, parcelId: string): Desire {
        return new Desire(DesireTypes.PICKUP_PARCEL, priority, position, { parcelId });
    }

    /**
     * Creates a desire to explore the environment
     * @param priority The priority of the desire
     * @param position The position to explore
     */
    static exploreEnvironment(priority: number, position: Position): Desire {
        return new Desire(DesireTypes.EXPLORE_ENVIRONMENT, priority, position);
    }

    // Handoff is now handled as part of the DELIVER_PARCEL desire

    /**
     * Creates a desire to put down parcels at a delivery point
     * @param priority The priority of the desire
     * @param position The position of the delivery point
     * @param parcelIds The IDs of the parcels to put down
     */
    static putDownParcel(priority: number, position: Position, parcelIds: string[]): Desire {
        return new Desire(DesireTypes.PUT_DOWN_PARCEL, priority, position, { parcelIds });
    }

    /**
     * 
     * @param priority
     * @param position 
     * @returns 
     */
    static pickupHandoff(requestId: string, priority: number, position: Position): Desire {
        return new Desire(DesireTypes.PICKUP_HANDOFF, priority, position, { requestId });
    }

    /**
     * 
     * @param priority
     * @param position 
     * @returns 
     */
    static putDownHandoff(requestId: string, priority: number, position: Position): Desire {
        return new Desire(DesireTypes.PUT_DOWN_HANDOFF, priority, position, { requestId });
    }

    /**
     * Checks if this desire is equal to another
     * @param other The other desire to compare with
     */
    equals(other: Desire): boolean {
        return (
            this.type === other.type &&
            (this.position?.equals(other.position) ?? other.position === undefined) &&
            JSON.stringify(this.context) === JSON.stringify(other.context)
        );
    }

    /**
     * Generates a hash string for this desire
     */
    protected hashString(): string {
        return `${this.type}-${this.position?.hashCode() || "nopos"}-${JSON.stringify(this.context)}`;
    }

    /**
     * Returns a string representation of this desire
     */
    toString(): string {
        return `${this.type} - [${this.position?.toString() || "no position"}] - Priority: ${this.priority}`;
    }
}
