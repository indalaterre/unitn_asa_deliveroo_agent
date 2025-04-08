import { Parcel } from "@domain/models";
import type { Directions } from "@domain/models/environment";
import { HashSet } from "@utils/hashset";

/**
 * Defines the actuator methods
 */
export interface Actuator {
    /**
     * Moves the agent in the requested direction
     * @param direction     The requested direction
     * @returns             TRUE if the move is successful
     */
    move(direction: Directions): Promise<boolean>;

    /**
     * Picks up the parcel at the agent's current location.
     * @returns The IDs of the parcels picked up.
     */
    pickup(): Promise<Set<string>>;

    /**
     * Puts down the given parcels at the agent's current location.
     * @param parcels The parcels to put down. If null, all parcels are put down.
     * @returns The IDs of the parcels put down.
     */
    putDown(parcels: string[] | null): Promise<Set<string>>;
}
