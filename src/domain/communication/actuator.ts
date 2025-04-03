import type { Directions } from "@domain/models/environment";

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
}
