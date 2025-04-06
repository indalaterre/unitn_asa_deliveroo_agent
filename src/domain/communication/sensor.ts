import type { Parcel } from "@domain/models";
import { Position } from "@domain/models/environment";

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
     * 
     * @param callback the method to be executed
     */
    onPlayerPositionUpdate(callback: (position: Position) => void): void;
}
