import type { Parcel } from "@domain/models";
import type { Agent } from "@domain/models/agent";
import type { Position } from "@domain/models/environment";

/**
 * Define the sensor methods
 */
export interface Sensor {
    /**
     * Perceives the parcels
     */
    detectParcels(): Promise<Parcel[]>;

    /**
     * Defines the behavior of the agent once a set of parcels have been detected
     * @callback callback   the method to be executed
     */
    onParcelDetected(callback: (parcels: Parcel[]) => void): void;

    /**
     * Event that is triggered when at least one agent is sensed.
     * @param callback The callback to call when agents are sensed.
     */
    onAgentSensing(callback: (agents: Agent[]) => void): void;

    /**
     *
     * @param callback the method to be executed
     */
    onPlayerPositionUpdate(callback: (position: Position) => void): void;
}
