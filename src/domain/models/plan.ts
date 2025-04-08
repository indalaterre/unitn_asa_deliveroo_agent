import type { Directions, Position } from "@domain/models/environment";
import type { Intention } from "@domain/models/intention";

export interface PlanMovingAction {
    /**
     * The plan intention
     */
    intention: Intention;

    /**
     * The starting position
     */
    from: Position;

    /**
     * The destination position
     */
    to: Position;

    /**
     * The intention data.
     * Can be both a set of directions (for MOVE actions) or a set of parcel ids (for PICKUP AND PUT DOWN actions)
     */
    data: (Directions | string)[];
}
